import { isUtf8 } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseChange } from './change.mjs';
import { checkRepo } from './check.mjs';
import { findChangeledgerDir, integrationBranch } from './config.mjs';
import { migrateStructuredSections } from './fix.mjs';
import { VERSION } from './framing.mjs';
import { GIT_MAX_BUFFER, sanitizedGitEnv } from './git.mjs';
import { batchBlobReader } from './git-batch.mjs';
import { ACTIVATION_REF, loadLedgerStore, STATE_REF } from './ledger-store.mjs';
import { compareVersions } from './release.mjs';
import { parseSpec } from './spec.mjs';
import {
  CONFIRMED_REF,
  OBSERVED_REF,
  PENDING_REF,
  readStateReplica,
  stateRemote,
} from './state-store.mjs';
import { parseYaml, stringifyYaml } from './yaml.mjs';

const STATE_ROOT = '.changeledger-state';
const MANIFEST_PATH = `${STATE_ROOT}/manifest.yml`;
const CONFIG_PATH = `${STATE_ROOT}/config.yml`;
const LEGACY_CONFIG_PATH = '.changeledger/config.yml';
const LEGACY_AUTHORITY_PATH = '.changeledger/authority.yml';
const RELEASES_DIR = '.changeledger/releases';
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SHA256 = /^[0-9a-f]{64}$/;
const GIT_ERROR_DETAIL_LIMIT = 2000;

function recordActivity(activity, values) {
  Object.assign(activity, values);
}

function boundedErrorSummary(prefix, errors) {
  const shown = errors
    .slice(0, 5)
    .map((error) => `${error.file}: ${error.message}`)
    .join('; ');
  const remaining = errors.length - 5;
  const suffix = remaining > 0 ? `; and ${remaining} more error${remaining === 1 ? '' : 's'}` : '';
  const message = `${prefix}: ${shown}${suffix}`;
  const LIMIT = 4000;
  return message.length <= LIMIT ? message : `${message.slice(0, LIMIT)}... (truncated)`;
}

function recordSourceActivity(activity, source) {
  if (!activity) return;
  const sources = [...(activity.sources ?? [])];
  const index = sources.findIndex((item) => item.name === source.name);
  if (index === -1) sources.push(source);
  else sources[index] = { ...sources[index], ...source };
  recordActivity(activity, {
    sources,
    sourceOids: { ...(activity.sourceOids ?? {}), [source.name]: source.commit },
  });
}

function gitOutput(
  repoRoot,
  args,
  { input, env, timeout, encoding = 'utf8', maxBuffer = GIT_MAX_BUFFER } = {},
) {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      env: sanitizedGitEnv(env),
      input,
      encoding,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout,
      maxBuffer,
    });
  } catch (error) {
    const detail = [error.stderr, error.stdout]
      .map((value) => (Buffer.isBuffer(value) ? value.toString('utf8') : value))
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean)
      .join('\n');
    if (detail.length > GIT_ERROR_DETAIL_LIMIT) {
      const omitted = detail.length - GIT_ERROR_DETAIL_LIMIT;
      const code = error.code ? ` (${error.code})` : '';
      throw new Error(
        `git ${args[0]} failed${code}: ${detail.slice(0, GIT_ERROR_DETAIL_LIMIT)}... (${omitted} more bytes omitted)`,
        { cause: error },
      );
    }
    throw new Error(detail || error.message, { cause: error });
  }
}

function git(repoRoot, args, options) {
  return gitOutput(repoRoot, args, options).trim();
}

// Adapts `gitOutput`'s (repoRoot, args, options) signature to the (args, cwd,
// options) contract `git-batch.mjs` expects, so this file's blob reads share
// its one-`cat-file --batch` abstraction instead of a subprocess per blob.
function batchRun(args, cwd, options) {
  return gitOutput(cwd, args, options);
}

// This file's tree entries carry the blob OID under `.blob` (its own
// long-standing field name); `git-batch.mjs` expects `.oid`. Adapts one shape
// to the other rather than duplicating the mapping at every call site.
function toBatchEntries(entries) {
  return entries.map((entry) => ({ type: entry.type, oid: entry.blob }));
}

function repoFor(start) {
  const changeledgerDir = findChangeledgerDir(start);
  if (!changeledgerDir) throw new Error('Not a ChangeLedger repo. Run `changeledger init` first.');
  return { changeledgerDir, repoRoot: path.dirname(changeledgerDir) };
}

function exactCommit(repoRoot, ref) {
  const commit = git(repoRoot, ['rev-parse', '--verify', `${ref}^{commit}`]);
  if (!OID.test(commit)) throw new Error(`source ref did not resolve to an exact commit: ${ref}`);
  return commit;
}

function parseRemoteLine(output, label) {
  const lines = output.trim().split('\n').filter(Boolean);
  if (lines.length !== 1) throw new Error(`source ${label} did not resolve to exactly one ref`);
  const [oid, ref] = lines[0].split('\t');
  if (!OID.test(oid) || !ref) throw new Error(`source ${label} returned malformed Git output`);
  return oid;
}

function parseSource(value) {
  if (typeof value !== 'string' || value === '') throw new Error('migration source is required');
  if (value.startsWith('local:')) {
    const ref = value.slice('local:'.length);
    if (!ref.startsWith('refs/')) throw new Error(`local source requires a full ref: ${value}`);
    return { name: value, kind: 'local', ref };
  }
  const split = value.indexOf(':');
  if (split <= 0) throw new Error(`remote source must be <remote>:<full-ref>: ${value}`);
  const remote = value.slice(0, split);
  const ref = value.slice(split + 1);
  if (!ref.startsWith('refs/')) throw new Error(`remote source requires a full ref: ${value}`);
  return { name: value, kind: 'remote', remote, ref };
}

function observeSource(repoRoot, value, activity) {
  const source = parseSource(value);
  if (source.kind === 'local') {
    const observed = { ...source, commit: exactCommit(repoRoot, source.ref) };
    recordSourceActivity(activity, observed);
    return observed;
  }
  const configured = stateRemote(repoRoot);
  if (source.remote !== configured) {
    throw new Error(`migration source remote must be configured state remote "${configured}"`);
  }
  const commit = remoteRef(repoRoot, source.remote, source.ref, activity);
  if (!commit) throw new Error(`source ${source.name} did not resolve to exactly one ref`);
  recordSourceActivity(activity, { ...source, commit });
  git(repoRoot, ['fetch', '--no-tags', '--no-write-fetch-head', source.remote, commit]);
  exactCommit(repoRoot, commit);
  const current = remoteRef(repoRoot, source.remote, source.ref, activity);
  if (current !== commit) {
    throw new Error(
      `source ${source.name} changed while fetching: expected ${commit} actual ${current ?? '(missing)'}`,
    );
  }
  return { ...source, commit };
}

function normalizedRepoPath(value, field) {
  if (typeof value !== 'string' || value === '' || value.includes('\0')) {
    throw new Error(`config "${field}" must be a non-empty relative path`);
  }
  const normalized = path.posix.normalize(value.replaceAll('\\', '/'));
  if (normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`config "${field}" escapes the repo root: ${value}`);
  }
  return normalized.replace(/^\.\//, '');
}

function parseTreeEntries(output) {
  if (output === '') return [];
  if (!output.endsWith('\0')) throw new Error('Git returned malformed path framing');
  return output
    .slice(0, -1)
    .split('\0')
    .map((record) => {
      const match = record.match(/^([0-7]{6}) ([^ ]+) ([0-9a-f]{40,64})\t([\s\S]+)$/);
      if (!match) throw new Error('Git returned malformed tree entry');
      return { mode: match[1], type: match[2], blob: match[3], path: match[4] };
    });
}

function treeEntries(repoRoot, commit, paths) {
  const args = ['ls-tree', '-r', '-z', '--full-tree', commit, '--'];
  args.push(...paths.map((file) => `:(literal)${file}`));
  return parseTreeEntries(gitOutput(repoRoot, args));
}

function regularBlob(entry, sourceName) {
  if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) {
    throw new Error(
      `migration source ${sourceName} contains unsupported Git entry ${entry.mode} ${entry.type} at ${entry.path}`,
    );
  }
}

function blobText(repoRoot, blob) {
  if (!OID.test(blob)) throw new Error(`invalid Git blob OID: ${blob}`);
  const buffer = gitOutput(repoRoot, ['cat-file', 'blob', blob], { encoding: null });
  if (!isUtf8(buffer)) throw new Error(`blob ${blob} is not valid UTF-8`);
  return buffer.toString('utf8');
}

function basename(file) {
  const value = path.posix.basename(file);
  if (!value || value === '.' || value === '..' || value.includes('\0')) {
    throw new Error(`invalid migration basename: ${value}`);
  }
  return value;
}

// Legacy-normalization rules this migrator knows how to apply mechanically,
// versioned so a plan's recorded rule/version can be revalidated
// deterministically. This is the ONLY escape hatch from the otherwise-fatal
// "any invalid document rejects the whole source" contract (20260721-193103
// CR3, 20260722-163405 CR1): a change whose sole defect is legacy task
// metadata or an untyped Log event, and which the versioned normalizer can
// rewrite without semantic loss, is classified legacy-normalizable instead of
// aborting. Everything else — hostile Git structure, non-UTF-8 encoding,
// unparseable content, undeliverable identity, or legacy shapes the
// normalizer does not cover — still rejects the whole source exactly as
// before (20260722-185043 CR1/CR4).
const NORMALIZATION_RULES = { change: { rule: 'structured-sections', version: 1 } };

// Runs the same single-document checks `checkRepo` would run at create time
// (frontmatter, stages, tasks, Log sequence) without needing sibling documents.
function scopedChangeErrors(config, name, text) {
  const parsed = parseChange(text);
  const { errors } = checkRepo(
    { config, changes: [{ name, text, ...parsed }], specs: [], releases: [] },
    { id: parsed.frontmatter.id, skipAdvisory: true },
  );
  return errors.map((error) => error.message);
}

function isRecognizedLegacyResidual(message, migrated) {
  const changedPlan = migrated.applied.some((item) => item.includes('task metadata'));
  const changedLog = migrated.applied.some((item) => item.includes('typed Log event'));
  const manualTask = migrated.manual.some((item) => item.includes('legacy task metadata'));
  const manualLog = migrated.manual.some((item) => item.includes('untyped Log entry'));
  return (
    (manualTask &&
      (/^invalid task metadata structure for task #\d+$/.test(message) ||
        /^(?:done|blocked) task is missing an ISO 8601 UTC resolution timestamp$/.test(message) ||
        /^blocked task is missing a reason$/.test(message) ||
        /^status is "done" but \d+ task\(s\) are not done$/.test(message))) ||
    (manualLog && /^Log line \d+: invalid typed event$/.test(message)) ||
    (changedPlan && /^Plan task for CR\d+ must name target and verification\b/.test(message)) ||
    (changedLog &&
      /^Log line \d+: transition ".+" starts from ".+" but the reconstructed status is ".+"$/.test(
        message,
      )) ||
    (changedLog && /^Log reconstructs status ".+" but frontmatter says ".+"$/.test(message))
  );
}

// Classifies an already-identified change's content as valid,
// legacy-normalizable or requiring an explicit human replacement. The last
// state is only reachable after parseChange derived a stable identity and
// migrateStructuredSections recognized a legacy task/Log shape; transport,
// encoding, parsing and identity failures never reach this function.
// `manual` must be checked before `changed`:
// `migrateStructuredSections` can leave the text byte-identical (`changed:
// false`) while still recording an unmigratable defect (e.g. a lone untyped
// Log line with no other legacy pattern to rewrite) — checking `changed`
// first would silently classify that document as valid.
function classifyLegacyChange(config, name, content) {
  const migrated = migrateStructuredSections(content);
  if (!migrated.changed && !migrated.manual.length) return { compatible: true };
  const errors = scopedChangeErrors(config, name, migrated.text);
  const unrelated = errors.filter((error) => !isRecognizedLegacyResidual(error, migrated));
  if (unrelated.length) return { compatible: false, reasons: unrelated };
  if (migrated.manual.length) {
    return {
      compatible: 'requires-replacement',
      reasons: migrated.manual,
      ...NORMALIZATION_RULES.change,
    };
  }
  if (errors.length) {
    return {
      compatible: 'requires-replacement',
      reasons: errors,
      ...NORMALIZATION_RULES.change,
    };
  }
  const sha256 = crypto.createHash('sha256').update(migrated.text).digest('hex');
  return { compatible: 'legacy', text: migrated.text, sha256, ...NORMALIZATION_RULES.change };
}

function contentIdentity(kind, name, content) {
  if (kind === 'change') {
    const parsed = parseChange(content);
    return `change:${parsed.frontmatter.id}`;
  }
  if (kind === 'spec') {
    parseSpec(content);
    return `spec:${name.slice(0, -3)}`;
  }
  if (kind === 'release') {
    const release = parseYaml(content);
    return `release:${release.version ?? name.slice(0, -4)}`;
  }
  parseYaml(content);
  return 'config';
}

function documentIdentity(kind, name, content) {
  const identity = contentIdentity(kind, name, content);
  if (kind === 'change') {
    const id = identity.slice('change:'.length);
    if (!name.startsWith(`${id}-`) || !name.endsWith('.md')) {
      throw new Error('change filename does not match its id');
    }
  } else if (kind === 'spec' && !name.endsWith('.md')) {
    throw new Error('spec filename must end in .md');
  } else if (kind === 'release' && !name.endsWith('.yml')) {
    throw new Error('release filename must end in .yml');
  } else if (kind === 'config' && name !== 'config.yml') {
    throw new Error('config filename must be config.yml');
  }
  return identity;
}

function assertDocumentIdentity(document, name, content, label) {
  const actual = contentIdentity(document.kind, name, content);
  if (actual !== document.identity) {
    throw new Error(`${label} identity mismatch: expected ${document.identity} actual ${actual}`);
  }
  documentIdentity(document.kind, name, content);
}

function candidateFromEntry(readBlob, source, entry, kind, config) {
  try {
    regularBlob(entry, source.name);
    const content = readBlob(entry.blob);
    const name = basename(entry.path);
    const identity = documentIdentity(kind, kind === 'config' ? 'config.yml' : name, content);
    let compatibility = true;
    let normalization;
    let replacement;
    if (kind === 'change') {
      const classified = classifyLegacyChange(config, name, content);
      if (classified.compatible === false) {
        throw new Error(
          `document ${identity} has legacy metadata no normalizer covers: ${classified.reasons.join('; ')}`,
        );
      }
      if (classified.compatible === 'legacy') {
        compatibility = 'legacy';
        normalization = {
          rule: classified.rule,
          version: classified.version,
          sha256: classified.sha256,
        };
      } else if (classified.compatible === 'requires-replacement') {
        compatibility = 'requires-replacement';
        replacement = {
          rule: classified.rule,
          version: classified.version,
          reasons: classified.reasons,
        };
      }
    }
    return {
      identity,
      kind,
      source: source.name,
      commit: source.commit,
      path: entry.path,
      mode: entry.mode,
      blob: entry.blob,
      basename: kind === 'config' ? 'config.yml' : name,
      compatibility,
      ...(normalization ? { normalization } : {}),
      ...(replacement ? { replacement } : {}),
    };
  } catch (error) {
    throw new Error(
      `migration source ${source.name} at ${source.commit}:${entry.path}: ${error.message}`,
      { cause: error },
    );
  }
}

function inventorySource(repoRoot, observed) {
  const configEntries = treeEntries(repoRoot, observed.commit, [LEGACY_CONFIG_PATH]);
  const configEntry = configEntries.find((entry) => entry.path === LEGACY_CONFIG_PATH);
  if (!configEntry)
    throw new Error(`migration source ${observed.name} has no ${LEGACY_CONFIG_PATH}`);
  const configText = batchBlobReader(
    repoRoot,
    toBatchEntries([configEntry]),
    batchRun,
  )(configEntry.blob);
  const configCandidate = candidateFromEntry(() => configText, observed, configEntry, 'config');
  const config = parseYaml(configText);
  let changesDir;
  let specsDir;
  try {
    changesDir = normalizedRepoPath(config.changes_dir, 'changes_dir');
    specsDir = normalizedRepoPath(config.specs_dir ?? '.changeledger/specs', 'specs_dir');
  } catch (error) {
    throw new Error(
      `migration source ${observed.name} at ${observed.commit}:${LEGACY_CONFIG_PATH}: ${error.message}`,
      { cause: error },
    );
  }
  const collections = [
    ['change', changesDir, '.md'],
    ['spec', specsDir, '.md'],
    ['release', RELEASES_DIR, '.yml'],
  ];
  const dirEntries = collections.map(([kind, dir, extension]) => [
    kind,
    dir,
    extension,
    treeEntries(repoRoot, observed.commit, [dir]),
  ]);
  const readBlob = batchBlobReader(
    repoRoot,
    toBatchEntries(
      dirEntries.flatMap(([, , extension, entries]) =>
        entries.filter((entry) => entry.path.endsWith(extension)),
      ),
    ),
    batchRun,
  );
  const candidates = [configCandidate];
  const uninventoried = [];
  for (const [kind, dir, extension, entries] of dirEntries) {
    for (const entry of entries) {
      if (!entry.path.startsWith(`${dir}/`)) {
        throw new Error(
          `migration source ${observed.name} at ${observed.commit}:${entry.path}: path escapes ${dir}`,
        );
      }
      try {
        regularBlob(entry, observed.name);
      } catch (error) {
        throw new Error(
          `migration source ${observed.name} at ${observed.commit}:${entry.path}: ${error.message}`,
          { cause: error },
        );
      }
      if (!entry.path.endsWith(extension)) {
        uninventoried.push({
          source: observed.name,
          commit: observed.commit,
          path: entry.path,
          blob: entry.blob,
        });
        continue;
      }
      candidates.push(candidateFromEntry(readBlob, observed, entry, kind, config));
    }
  }
  return { source: observed, projectId: config.project_id, candidates, uninventoried };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
}

function digest(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

function assertClientCompatible(minimum, label) {
  try {
    if (compareVersions(VERSION, minimum) < 0) {
      throw new Error(`${label} requires client >= ${minimum}`);
    }
  } catch (error) {
    if (error.message.includes('requires client')) throw error;
    throw new Error(`${label} has invalid minimum_client_version`, { cause: error });
  }
}

function groupCandidates(inventories) {
  const groups = new Map();
  for (const inventory of inventories) {
    for (const candidate of inventory.candidates) {
      if (!groups.has(candidate.identity)) groups.set(candidate.identity, []);
      groups.get(candidate.identity).push(candidate);
    }
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([identity, values]) => {
      const candidates = values.sort((a, b) =>
        `${a.source}\0${a.path}`.localeCompare(`${b.source}\0${b.path}`),
      );
      const variants = new Set(candidates.map((item) => `${item.blob}\0${item.basename}`));
      const selected = candidates[0];
      const resolved = variants.size === 1;
      const requiresReplacement = resolved && selected.compatibility === 'requires-replacement';
      const document = {
        identity,
        kind: selected.kind,
        candidates,
        resolution:
          resolved && !requiresReplacement
            ? { blob: selected.blob, basename: selected.basename }
            : null,
      };
      // Compatibility is a pure function of content: a single-variant document
      // shares its lone candidate's diagnosis. A cross-source conflict has no
      // single content to diagnose yet — the operator resolves the variant
      // first, then a later preview classifies it.
      if (resolved) {
        document.compatibility = selected.compatibility;
        if (selected.normalization) document.normalization = selected.normalization;
        if (selected.replacement) document.replacement = selected.replacement;
      }
      return document;
    });
}

function migrationInventory({ project_id, minimum_client_version, sources, documents }) {
  return {
    project_id,
    minimum_client_version,
    sources,
    documents: documents.map(({ identity, kind, candidates }) => ({
      identity,
      kind,
      candidates,
    })),
  };
}

export function previewStateMigration(
  { sources, output } = {},
  start = process.cwd(),
  activity = {},
) {
  const requestedSources = Array.isArray(sources) ? [...new Set(sources)].sort() : [];
  recordActivity(activity, {
    network: false,
    written: false,
    sources: requestedSources.map((name) => ({ name, commit: null })),
    sourceOids: Object.fromEntries(requestedSources.map((name) => [name, null])),
    baseline: null,
    branch: null,
    ref: null,
    inventoryDigest: null,
  });
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error('state migrate --preview requires at least one --source');
  }
  const { repoRoot } = repoFor(start);
  const observed = requestedSources.map((source) => observeSource(repoRoot, source, activity));
  const inventories = observed.map((source) => inventorySource(repoRoot, source));
  const projectIds = new Set(inventories.map((item) => item.projectId));
  if (projectIds.size !== 1 || ![...projectIds][0]) {
    throw new Error('migration sources must share one non-empty project_id');
  }
  const documents = groupCandidates(inventories);
  const uninventoried = inventories
    .flatMap((item) => item.uninventoried)
    .sort((a, b) => `${a.source}\0${a.path}`.localeCompare(`${b.source}\0${b.path}`));
  const sourceInventory = observed.map(({ name, kind, remote, ref, commit }) => ({
    name,
    kind,
    ...(remote ? { remote } : {}),
    ref,
    commit,
  }));
  const inventory = migrationInventory({
    project_id: [...projectIds][0],
    minimum_client_version: VERSION,
    sources: sourceInventory,
    documents,
  });
  const plan = {
    format_version: 1,
    project_id: inventory.project_id,
    minimum_client_version: VERSION,
    inventory_digest: digest(inventory),
    sources: sourceInventory,
    documents,
    uninventoried,
  };
  // CR1/CR6: once every document has a determinate resolution (the common
  // single-source case; a cross-source variant conflict still leaves
  // `resolution: null` and is skipped here), dry-run the exact closed
  // candidate snapshot `--create` would build and run the SAME full
  // `checkRepo` — local per-document rules (frontmatter, stages, tasks, Log
  // sequence) and global rules (duplicate ids, dependency cycles, specs,
  // releases, config) alike — so a green preview can't fail create on any
  // rule already evaluated, legacy or not. Read-only: `candidateSnapshot`
  // never writes objects, refs, worktree or config; it throws (rejecting the
  // whole source, matching create) on any error.
  if (plan.documents.every((document) => document.resolution)) {
    candidateSnapshot(repoRoot, path.join(repoRoot, '.changeledger-migration-preview.yml'), plan, {
      allowImplicitNormalization: true,
      skipAdvisory: true,
    });
  }
  const text = stringifyYaml(plan);
  if (output) {
    fs.writeFileSync(path.resolve(repoRoot, output), text);
    activity.written = true;
  }
  recordActivity(activity, {
    sources: sourceInventory,
    sourceOids: Object.fromEntries(sourceInventory.map((source) => [source.name, source.commit])),
    inventoryDigest: plan.inventory_digest,
  });
  return {
    plan,
    text,
    output: output ? path.resolve(repoRoot, output) : null,
    sources: sourceInventory,
    sourceOids: Object.fromEntries(sourceInventory.map((source) => [source.name, source.commit])),
    baseline: null,
    branch: null,
    ref: null,
    inventoryDigest: plan.inventory_digest,
    uninventoried,
    network: activity.network,
    written: activity.written,
  };
}

function loadPlan(planFile) {
  if (typeof planFile !== 'string' || planFile === '') throw new Error('--plan is required');
  const file = path.resolve(planFile);
  const plan = parseYaml(fs.readFileSync(file, 'utf8'));
  if (plan.format_version !== 1) throw new Error('Unsupported migration plan format_version');
  if (!Array.isArray(plan.sources) || !Array.isArray(plan.documents)) {
    throw new Error('Invalid migration plan structure');
  }
  if (!SHA256.test(plan.inventory_digest ?? '')) throw new Error('Invalid inventory_digest');
  assertClientCompatible(plan.minimum_client_version, 'migration plan');
  const actualDigest = digest(migrationInventory(plan));
  if (actualDigest !== plan.inventory_digest) {
    throw new Error(
      'migration plan integrity check failed: inventory_digest does not match inventory',
    );
  }
  return { file, plan };
}

function revalidatePlan(repoRoot, plan, activity) {
  const inventories = [];
  const sources = [];
  for (const source of plan.sources) {
    const observed = observeSource(repoRoot, source.name, activity);
    if (observed.commit !== source.commit) {
      throw new Error(
        `migration plan is stale: source ${source.name} expected ${source.commit} actual ${observed.commit}`,
      );
    }
    inventories.push(inventorySource(repoRoot, observed));
    sources.push({
      name: observed.name,
      kind: observed.kind,
      ...(observed.remote ? { remote: observed.remote } : {}),
      ref: observed.ref,
      commit: observed.commit,
    });
  }
  const projectIds = new Set(inventories.map((item) => item.projectId));
  const actualInventory = migrationInventory({
    project_id: projectIds.size === 1 ? [...projectIds][0] : null,
    minimum_client_version: plan.minimum_client_version,
    sources,
    documents: groupCandidates(inventories),
  });
  const actualDigest = digest(actualInventory);
  if (actualDigest !== plan.inventory_digest) {
    throw new Error(
      `migration plan is stale: inventory expected ${plan.inventory_digest} actual ${actualDigest}`,
    );
  }
}

export function previewStateMigrationPlan({ planFile } = {}, start = process.cwd(), activity = {}) {
  recordActivity(activity, {
    network: false,
    written: false,
    sources: [],
    sourceOids: {},
    baseline: null,
    branch: null,
    ref: null,
    inventoryDigest: null,
  });
  const { repoRoot } = repoFor(start);
  const loaded = loadPlan(planFile);
  recordActivity(activity, {
    sources: loaded.plan.sources,
    sourceOids: Object.fromEntries(
      loaded.plan.sources.map((source) => [source.name, source.commit]),
    ),
    inventoryDigest: loaded.plan.inventory_digest,
  });
  revalidatePlan(repoRoot, loaded.plan, activity);
  candidateSnapshot(repoRoot, loaded.file, loaded.plan, {
    allowImplicitNormalization: false,
    skipAdvisory: true,
  });
  const text = stringifyYaml(loaded.plan);
  return {
    plan: loaded.plan,
    text,
    output: null,
    sources: loaded.plan.sources,
    sourceOids: Object.fromEntries(
      loaded.plan.sources.map((source) => [source.name, source.commit]),
    ),
    baseline: null,
    branch: null,
    ref: null,
    inventoryDigest: loaded.plan.inventory_digest,
    uninventoried: loaded.plan.uninventoried ?? [],
    network: activity.network,
    written: false,
  };
}

function resolvedCandidate(document) {
  const resolution = document.resolution;
  if (!resolution || resolution.replacement) return null;
  const candidate = document.candidates.find(
    (item) => item.blob === resolution.blob && item.basename === resolution.basename,
  );
  if (!candidate)
    throw new Error(
      `migration plan is stale: resolution for ${document.identity} is not a candidate`,
    );
  return candidate;
}

function chosenContent(readBlob, planFile, document, { allowImplicitNormalization = false } = {}) {
  const resolution = document.resolution;
  if (!resolution) {
    const reason =
      document.compatibility === 'requires-replacement'
        ? 'requires an explicit replacement'
        : 'has divergent candidates';
    throw new Error(`migration conflict: ${document.identity} ${reason}`);
  }
  if (resolution.replacement) {
    const replacement = path.resolve(path.dirname(planFile), resolution.replacement);
    const content = fs.readFileSync(replacement, 'utf8');
    const actual = crypto.createHash('sha256').update(content).digest('hex');
    if (actual !== resolution.sha256) {
      throw new Error(
        `migration plan is stale: replacement ${resolution.replacement} expected ${resolution.sha256} actual ${actual}`,
      );
    }
    assertDocumentIdentity(document, resolution.basename, content, 'migration replacement');
    return {
      content,
      basename: resolution.basename,
      provenance: { replacement: resolution.replacement, sha256: actual },
    };
  }
  const candidate = resolvedCandidate(document);
  if (candidate.compatibility === 'requires-replacement') {
    throw new Error(
      `migration conflict: ${document.identity} requires an explicit replacement; ` +
        'selecting its legacy source blob is not a resolution',
    );
  }
  if (candidate.compatibility === 'legacy') {
    // Source preview may apply a known-safe transform in memory to prove the
    // generated plan can form a closed candidate. Previewing an edited plan
    // and create both require the operator's explicit normalization decision.
    const normalize = resolution.normalize;
    if (
      !allowImplicitNormalization &&
      (!normalize ||
        normalize.rule !== candidate.normalization.rule ||
        normalize.version !== candidate.normalization.version)
    ) {
      throw new Error(
        `migration plan requires an explicit normalization decision for ${document.identity}: ` +
          `add resolution.normalize {rule: "${candidate.normalization.rule}", version: ${candidate.normalization.version}}`,
      );
    }
    const migrated = migrateStructuredSections(readBlob(candidate.blob));
    if (migrated.manual.length || !migrated.changed) {
      throw new Error(
        `migration plan is stale: ${document.identity} no longer normalizes the same way`,
      );
    }
    const sha256 = crypto.createHash('sha256').update(migrated.text).digest('hex');
    if (sha256 !== candidate.normalization.sha256) {
      throw new Error(
        `migration plan is stale: normalized result for ${document.identity} changed`,
      );
    }
    return {
      content: migrated.text,
      basename: candidate.basename,
      provenance: {
        source: candidate.source,
        commit: candidate.commit,
        path: candidate.path,
        blob: candidate.blob,
        normalization: {
          rule: candidate.normalization.rule,
          version: candidate.normalization.version,
        },
      },
    };
  }
  return {
    content: readBlob(candidate.blob),
    basename: candidate.basename,
    provenance: {
      source: candidate.source,
      commit: candidate.commit,
      path: candidate.path,
      blob: candidate.blob,
    },
  };
}

function statePath(document, name) {
  if (document.kind === 'config') return CONFIG_PATH;
  const collection =
    document.kind === 'change' ? 'changes' : document.kind === 'spec' ? 'specs' : 'releases';
  if (basename(name) !== name) throw new Error(`invalid migration target basename: ${name}`);
  return `${STATE_ROOT}/${collection}/${name}`;
}

function candidateSnapshot(
  repoRoot,
  planFile,
  plan,
  { allowImplicitNormalization = false, skipAdvisory = false } = {},
) {
  const resolvedCandidates = plan.documents.map(resolvedCandidate).filter(Boolean);
  const readBlob = batchBlobReader(
    repoRoot,
    resolvedCandidates.map((candidate) => ({ type: 'blob', oid: candidate.blob })),
    batchRun,
  );
  const writes = new Map();
  const decisions = [];
  for (const document of plan.documents) {
    const chosen = chosenContent(readBlob, planFile, document, {
      allowImplicitNormalization,
    });
    const target = statePath(document, chosen.basename);
    if (writes.has(target)) throw new Error(`migration target collision: ${target}`);
    writes.set(target, chosen.content);
    decisions.push({ identity: document.identity, target, ...chosen.provenance });
  }
  if (!writes.has(CONFIG_PATH)) throw new Error('migration plan has no config');
  const configText = writes.get(CONFIG_PATH);
  const config = parseYaml(configText);
  if (config.project_id !== plan.project_id)
    throw new Error('migration config project_id mismatch');
  const changes = [];
  const specs = [];
  const releases = [];
  for (const [file, text] of writes) {
    const name = path.posix.basename(file);
    if (file.startsWith(`${STATE_ROOT}/changes/`))
      changes.push({ name, text, ...parseChange(text) });
    else if (file.startsWith(`${STATE_ROOT}/specs/`))
      specs.push({ name, text, ...parseSpec(text) });
    else if (file.startsWith(`${STATE_ROOT}/releases/`))
      releases.push({ name, text, ...parseYaml(text) });
  }
  // Both preview modes run the same local and global rules as create. They may
  // skip only the advisory scan, which cannot add errors and whose warnings
  // every caller discards.
  const { errors } = checkRepo({ config, changes, specs, releases }, { skipAdvisory });
  if (errors.length) {
    throw new Error(boundedErrorSummary('migration candidate validation failed', errors));
  }
  const manifest = {
    format_version: 1,
    project_id: plan.project_id,
    inventory_digest: plan.inventory_digest,
    minimum_client_version: plan.minimum_client_version,
    sources: plan.sources,
    inventory: migrationInventory(plan),
    decisions,
  };
  writes.set(MANIFEST_PATH, stringifyYaml(manifest));
  return { writes, manifest, config, changes, specs, releases };
}

function withIndex(repoRoot, setup) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-migration-index-'));
  const index = path.join(dir, 'index');
  const env = { GIT_INDEX_FILE: index };
  try {
    return setup({
      git: (args, options = {}) =>
        git(repoRoot, args, { ...options, env: { ...env, ...options.env } }),
      gitOutput: (args, options = {}) =>
        gitOutput(repoRoot, args, { ...options, env: { ...env, ...options.env } }),
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function treeFromWrites(repoRoot, writes, base) {
  return withIndex(repoRoot, ({ git: indexed }) => {
    indexed(base ? ['read-tree', base] : ['read-tree', '--empty']);
    for (const [file, content] of writes) {
      const blob = indexed(['hash-object', '-w', '--stdin'], { input: content });
      indexed(['update-index', '--add', '--cacheinfo', `100644,${blob},${file}`]);
    }
    return indexed(['write-tree']);
  });
}

function remoteRef(repoRoot, remote, ref, activity) {
  if (activity) activity.network = true;
  const output = gitOutput(repoRoot, ['ls-remote', '--refs', remote, ref]);
  if (output.trim() === '') return null;
  return parseRemoteLine(output, `${remote}:${ref}`);
}

function fetchRef(repoRoot, remote, ref, activity) {
  const oid = remoteRef(repoRoot, remote, ref, activity);
  if (!oid) return null;
  git(repoRoot, ['fetch', '--no-tags', '--no-write-fetch-head', remote, oid]);
  exactCommit(repoRoot, oid);
  const current = remoteRef(repoRoot, remote, ref, activity);
  if (current !== oid) {
    throw new Error(
      `remote ref ${remote}:${ref} changed while fetching: expected ${oid} actual ${current ?? '(missing)'}`,
    );
  }
  return oid;
}

export function createStateBaseline({ planFile } = {}, start = process.cwd(), activity = {}) {
  recordActivity(activity, {
    network: false,
    written: false,
    sources: [],
    sourceOids: {},
    baseline: null,
    branch: STATE_REF.replace('refs/heads/', ''),
    ref: STATE_REF,
    inventoryDigest: null,
  });
  const { repoRoot } = repoFor(start);
  const loaded = loadPlan(planFile);
  recordActivity(activity, {
    sources: loaded.plan.sources,
    sourceOids: Object.fromEntries(
      loaded.plan.sources.map((source) => [source.name, source.commit]),
    ),
    inventoryDigest: loaded.plan.inventory_digest,
  });
  revalidatePlan(repoRoot, loaded.plan, activity);
  const candidate = candidateSnapshot(repoRoot, loaded.file, loaded.plan);
  const tree = treeFromWrites(repoRoot, candidate.writes);
  const commit = git(repoRoot, [
    'commit-tree',
    tree,
    '-m',
    `chore(state): migration baseline ${loaded.plan.inventory_digest}`,
  ]);
  activity.baseline = commit;
  const remote = stateRemote(repoRoot);
  const existing = fetchRef(repoRoot, remote, STATE_REF, activity);
  let baseline = commit;
  if (existing) {
    const existingTree = git(repoRoot, ['rev-parse', `${existing}^{tree}`]);
    if (existingTree !== tree)
      throw new Error('state baseline already exists with different content');
    baseline = existing;
  } else {
    try {
      git(repoRoot, ['push', remote, `${commit}:${STATE_REF}`]);
      activity.written = true;
    } catch (error) {
      const raced = fetchRef(repoRoot, remote, STATE_REF, activity);
      if (!raced || git(repoRoot, ['rev-parse', `${raced}^{tree}`]) !== tree) throw error;
      baseline = raced;
    }
  }
  activity.baseline = baseline;
  return {
    baseline,
    remote,
    stateRef: STATE_REF,
    inventoryDigest: loaded.plan.inventory_digest,
    sources: loaded.plan.sources,
    sourceOids: Object.fromEntries(
      loaded.plan.sources.map((source) => [source.name, source.commit]),
    ),
    branch: STATE_REF.replace('refs/heads/', ''),
    ref: STATE_REF,
    network: activity.network,
    written: activity.written,
  };
}

function treeEntry(repoRoot, commit, file) {
  return treeEntries(repoRoot, commit, [file]).find((entry) => entry.path === file) ?? null;
}

function validateManifestDecisions(readBlob, manifest, entries) {
  const inventory = manifest.inventory;
  if (
    inventory.minimum_client_version !== manifest.minimum_client_version ||
    !Array.isArray(inventory.documents)
  ) {
    throw new Error('state manifest inventory metadata mismatch');
  }
  const sources = new Map(inventory.sources.map((source) => [source.name, source]));
  const decisions = new Map();
  for (const decision of manifest.decisions) {
    if (
      typeof decision?.identity !== 'string' ||
      typeof decision?.target !== 'string' ||
      decisions.has(decision.identity)
    ) {
      throw new Error('state manifest has invalid or duplicate decisions');
    }
    decisions.set(decision.identity, decision);
  }
  const entryByPath = new Map(entries.map((entry) => [entry.path, entry]));
  const targets = new Set();
  const identities = new Set();
  for (const document of inventory.documents) {
    if (
      typeof document?.identity !== 'string' ||
      !['change', 'config', 'release', 'spec'].includes(document?.kind) ||
      !Array.isArray(document.candidates) ||
      identities.has(document.identity)
    ) {
      throw new Error('state manifest has invalid inventory documents');
    }
    identities.add(document.identity);
    for (const candidate of document.candidates) {
      const source = sources.get(candidate.source);
      if (
        !source ||
        candidate.commit !== source.commit ||
        !OID.test(candidate.blob ?? '') ||
        !['100644', '100755'].includes(candidate.mode)
      ) {
        throw new Error(`state manifest has invalid candidate for ${document.identity}`);
      }
    }
    const decision = decisions.get(document.identity);
    if (!decision) throw new Error(`state manifest has no decision for ${document.identity}`);
    const targetName = path.posix.basename(decision.target);
    if (statePath(document, targetName) !== decision.target || targets.has(decision.target)) {
      throw new Error(`state manifest has invalid target for ${document.identity}`);
    }
    targets.add(decision.target);
    const target = entryByPath.get(decision.target);
    if (!target) throw new Error(`state manifest target is missing: ${decision.target}`);
    if (decision.replacement) {
      const content = readBlob(target.blob);
      const actual = crypto.createHash('sha256').update(content).digest('hex');
      if (!SHA256.test(decision.sha256 ?? '') || actual !== decision.sha256) {
        throw new Error(`state manifest replacement mismatch for ${document.identity}`);
      }
      assertDocumentIdentity(document, targetName, content, 'state manifest replacement');
      continue;
    }
    if (decision.normalization) {
      // The original source blob is not necessarily fetchable from this clone,
      // so re-derivation isn't possible here; instead trust the digest-verified
      // inventory's recorded expectation and confirm the target blob matches it
      // exactly (create() already re-derived and hash-checked it before publish).
      const normalized = document.candidates.find(
        (candidate) =>
          candidate.source === decision.source &&
          candidate.commit === decision.commit &&
          candidate.path === decision.path &&
          candidate.blob === decision.blob &&
          candidate.basename === targetName &&
          candidate.compatibility === 'legacy' &&
          candidate.normalization?.rule === decision.normalization.rule &&
          candidate.normalization?.version === decision.normalization.version,
      );
      if (!normalized)
        throw new Error(`state manifest normalization mismatch for ${document.identity}`);
      const actual = crypto.createHash('sha256').update(readBlob(target.blob)).digest('hex');
      if (actual !== normalized.normalization.sha256) {
        throw new Error(`state manifest normalized content mismatch for ${document.identity}`);
      }
      continue;
    }
    const selected = document.candidates.find(
      (candidate) =>
        candidate.source === decision.source &&
        candidate.commit === decision.commit &&
        candidate.path === decision.path &&
        candidate.blob === decision.blob &&
        candidate.basename === targetName,
    );
    if (!selected || target.blob !== selected.blob) {
      throw new Error(`state manifest decision mismatch for ${document.identity}`);
    }
  }
  if (decisions.size !== identities.size) throw new Error('state manifest has unknown decisions');
  const actualTargets = entries
    .map((entry) => entry.path)
    .filter((file) => file !== MANIFEST_PATH)
    .sort();
  if (JSON.stringify(actualTargets) !== JSON.stringify([...targets].sort())) {
    throw new Error('state manifest decisions do not cover the complete snapshot');
  }
}

function readStateMetadata(repoRoot, revision) {
  exactCommit(repoRoot, revision);
  const entries = treeEntries(repoRoot, revision, []);
  const allowed = (file) =>
    file === MANIFEST_PATH ||
    file === CONFIG_PATH ||
    [
      [`${STATE_ROOT}/changes/`, '.md'],
      [`${STATE_ROOT}/specs/`, '.md'],
      [`${STATE_ROOT}/releases/`, '.yml'],
    ].some(
      ([prefix, extension]) =>
        file.startsWith(prefix) &&
        !file.slice(prefix.length).includes('/') &&
        file.length > prefix.length + extension.length &&
        file.endsWith(extension),
    );
  for (const entry of entries) {
    regularBlob(entry, revision);
    if (!allowed(entry.path)) throw new Error(`invalid state path: ${entry.path}`);
  }
  const manifestEntry = entries.find((entry) => entry.path === MANIFEST_PATH);
  const configEntry = entries.find((entry) => entry.path === CONFIG_PATH);
  if (!manifestEntry || !configEntry)
    throw new Error('state baseline is missing manifest or config');
  const readBlob = batchBlobReader(repoRoot, toBatchEntries(entries), batchRun);
  const manifest = parseYaml(readBlob(manifestEntry.blob));
  const configText = readBlob(configEntry.blob);
  const config = parseYaml(configText);
  if (
    manifest?.format_version !== 1 ||
    typeof manifest.project_id !== 'string' ||
    !SHA256.test(manifest.inventory_digest ?? '') ||
    typeof manifest.minimum_client_version !== 'string' ||
    !Array.isArray(manifest.sources) ||
    !manifest.inventory ||
    !Array.isArray(manifest.decisions)
  ) {
    throw new Error('invalid state manifest structure');
  }
  const inventoryDigest = digest(manifest.inventory);
  if (inventoryDigest !== manifest.inventory_digest) {
    throw new Error(
      `state manifest inventory_digest mismatch: expected ${manifest.inventory_digest} actual ${inventoryDigest}`,
    );
  }
  if (
    JSON.stringify(canonical(manifest.sources)) !==
    JSON.stringify(canonical(manifest.inventory.sources))
  ) {
    throw new Error('state manifest sources do not match inventory');
  }
  if (
    manifest.project_id !== config.project_id ||
    manifest.inventory.project_id !== config.project_id
  ) {
    throw new Error('state baseline project_id mismatch');
  }
  validateManifestDecisions(readBlob, manifest, entries);
  const changes = [];
  const specs = [];
  const releases = [];
  for (const entry of entries) {
    const text = readBlob(entry.blob);
    const name = path.posix.basename(entry.path);
    if (entry.path.startsWith(`${STATE_ROOT}/changes/`)) {
      changes.push({ name, text, ...parseChange(text) });
    } else if (entry.path.startsWith(`${STATE_ROOT}/specs/`)) {
      specs.push({ name, text, ...parseSpec(text) });
    } else if (entry.path.startsWith(`${STATE_ROOT}/releases/`)) {
      releases.push({ name, text, ...parseYaml(text) });
    }
  }
  const { errors } = checkRepo({ config, changes, specs, releases });
  if (errors.length) {
    throw new Error(boundedErrorSummary('state baseline validation failed', errors));
  }
  return { manifest, config, configText, entries, changes, specs, releases };
}

function authorityText({ baseline, manifest }) {
  return stringifyYaml({
    format_version: 2,
    state_ref: STATE_REF,
    baseline,
    project_id: manifest.project_id,
    inventory_digest: manifest.inventory_digest,
    minimum_client_version: manifest.minimum_client_version,
  });
}

function activationRemovals(repoRoot, base, manifest) {
  const inventory = manifest.inventory;
  if (!inventory?.sources?.some((source) => source.commit === base)) {
    throw new Error(`integration head ${base} is not a migration source commit`);
  }
  const removals = new Map();
  for (const document of inventory.documents ?? []) {
    for (const candidate of document.candidates ?? []) {
      if (candidate.commit !== base) continue;
      const previous = removals.get(candidate.path);
      if (previous && (previous.blob !== candidate.blob || previous.mode !== candidate.mode)) {
        throw new Error(`baseline inventory conflicts at ${candidate.path}`);
      }
      removals.set(candidate.path, candidate);
    }
  }
  if (!removals.has(LEGACY_CONFIG_PATH)) {
    throw new Error(`baseline inventory has no integration ${LEGACY_CONFIG_PATH}`);
  }
  const paths = [...removals.keys()];
  const currentByPath = new Map(
    treeEntries(repoRoot, base, paths).map((entry) => [entry.path, entry]),
  );
  for (const [file, candidate] of removals) {
    const current = currentByPath.get(file) ?? null;
    if (!current || current.mode !== candidate.mode || current.blob !== candidate.blob) {
      throw new Error(
        `integration legacy inventory diverged at ${file}: expected ${candidate.mode} ${candidate.blob} actual ${current ? `${current.mode} ${current.blob}` : '(missing)'}`,
      );
    }
  }
  return paths.sort();
}

function deterministicCommit(repoRoot, tree, base, message) {
  const date = git(repoRoot, ['show', '-s', '--format=%cI', base]);
  return git(repoRoot, ['commit-tree', tree, '-p', base, '-m', message], {
    env: {
      GIT_AUTHOR_NAME: 'ChangeLedger',
      GIT_AUTHOR_EMAIL: 'changeledger@local',
      GIT_COMMITTER_NAME: 'ChangeLedger',
      GIT_COMMITTER_EMAIL: 'changeledger@local',
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    },
  });
}

function guardedRefTransaction(repoRoot, commands) {
  const lines = ['start'];
  lines.push(...commands, 'prepare', 'commit', '');
  try {
    git(repoRoot, ['update-ref', '--stdin'], { input: lines.join('\n') });
  } catch (error) {
    throw new Error('state refs changed concurrently; branch was not created', {
      cause: error,
    });
  }
}

function verifyCommand({ ref, expected }) {
  return expected ? `verify ${ref} ${expected}` : `verify ${ref}`;
}

function createBranchCommit({
  repoRoot,
  base,
  branch,
  writes,
  removals,
  message,
  guards = [],
  allowExactReuse = false,
  beforeRefTransaction,
  activity,
}) {
  const tree = withIndex(repoRoot, ({ git: indexed }) => {
    indexed(['read-tree', base]);
    for (const file of removals) indexed(['update-index', '--force-remove', '--', file]);
    for (const [file, content] of writes) {
      const blob = indexed(['hash-object', '-w', '--stdin'], { input: content });
      indexed(['update-index', '--add', '--cacheinfo', `100644,${blob},${file}`]);
    }
    return indexed(['write-tree']);
  });
  const commit = deterministicCommit(repoRoot, tree, base, message);
  let existing = null;
  try {
    existing = exactCommit(repoRoot, branch);
  } catch {
    existing = null;
  }
  if (existing) {
    if (allowExactReuse && existing === commit) {
      guardedRefTransaction(repoRoot, [`verify ${branch} ${commit}`, ...guards.map(verifyCommand)]);
      return { commit, reused: true };
    }
    throw new Error(
      `branch ${branch.replace('refs/heads/', '')} already exists with different content`,
    );
  }
  beforeRefTransaction?.();
  if (guards.length) {
    guardedRefTransaction(repoRoot, [...guards.map(verifyCommand), `create ${branch} ${commit}`]);
  } else {
    try {
      git(repoRoot, ['update-ref', branch, commit, '']);
    } catch (error) {
      throw new Error(`branch ${branch.replace('refs/heads/', '')} changed concurrently`, {
        cause: error,
      });
    }
  }
  if (activity) activity.written = true;
  return { commit, reused: false };
}

function expectedActivation(repoRoot, base, baseline, metadata) {
  const removals = activationRemovals(repoRoot, base, metadata.manifest);
  const writes = new Map([
    [LEGACY_AUTHORITY_PATH, authorityText({ baseline, manifest: metadata.manifest })],
  ]);
  const tree = withIndex(repoRoot, ({ git: indexed }) => {
    indexed(['read-tree', base]);
    for (const file of removals) indexed(['update-index', '--force-remove', '--', file]);
    for (const [file, content] of writes) {
      const blob = indexed(['hash-object', '-w', '--stdin'], { input: content });
      indexed(['update-index', '--add', '--cacheinfo', `100644,${blob},${file}`]);
    }
    return indexed(['write-tree']);
  });
  return { removals, writes, tree };
}

export function prepareStateActivation(
  { baseline, beforeRefTransaction } = {},
  start = process.cwd(),
  activity = {},
) {
  const branchName = OID.test(baseline ?? '')
    ? `changeledger/activate-${baseline.slice(0, 12)}`
    : null;
  recordActivity(activity, {
    network: false,
    written: false,
    sources: [],
    sourceOids: {},
    baseline: baseline ?? null,
    branch: branchName,
    ref: branchName ? `refs/heads/${branchName}` : null,
    inventoryDigest: null,
  });
  const { repoRoot } = repoFor(start);
  if (!OID.test(baseline ?? '')) throw new Error('--baseline must be an exact commit OID');
  const remote = stateRemote(repoRoot);
  const published = fetchRef(repoRoot, remote, STATE_REF, activity);
  if (published !== baseline)
    throw new Error(
      `published state baseline is ${published ?? '(missing)'}, expected ${baseline}`,
    );
  const metadata = readStateMetadata(repoRoot, baseline);
  const { manifest, config } = metadata;
  recordActivity(activity, {
    sources: manifest.sources,
    sourceOids: Object.fromEntries(manifest.sources.map((source) => [source.name, source.commit])),
    inventoryDigest: manifest.inventory_digest,
  });
  assertClientCompatible(manifest.minimum_client_version, 'state baseline');
  if (manifest.project_id !== config.project_id) throw new Error('baseline project_id mismatch');
  const integration = integrationBranch(config);
  if (!integration) throw new Error('state activation requires git.integration_branch');
  const base = exactCommit(repoRoot, `refs/heads/${integration}`);
  if (treeEntry(repoRoot, base, LEGACY_AUTHORITY_PATH)) {
    throw new Error('integration branch already contains state authority');
  }
  const expected = expectedActivation(repoRoot, base, baseline, metadata);
  const branch = `refs/heads/${branchName}`;
  const created = createBranchCommit({
    repoRoot,
    base,
    branch,
    removals: expected.removals,
    writes: expected.writes,
    message: `feat(state): activate baseline ${baseline}`,
    guards: [{ ref: `refs/heads/${integration}`, expected: base }],
    allowExactReuse: true,
    beforeRefTransaction,
    activity,
  });
  return {
    branch: branchName,
    commit: created.commit,
    baseline,
    integration,
    inventoryDigest: manifest.inventory_digest,
    sources: manifest.sources,
    sourceOids: Object.fromEntries(manifest.sources.map((source) => [source.name, source.commit])),
    ref: branch,
    network: activity.network,
    written: activity.written,
  };
}

function authorityAt(repoRoot, revision) {
  const entry = treeEntry(repoRoot, revision, LEGACY_AUTHORITY_PATH);
  if (!entry) throw new Error(`activation ref has no ${LEGACY_AUTHORITY_PATH}`);
  regularBlob(entry, revision);
  try {
    return parseYaml(blobText(repoRoot, entry.blob));
  } catch (error) {
    throw new Error(`invalid activation authority: ${error.message}`, { cause: error });
  }
}

function authorityProblems(authority, metadata) {
  const compatibility = [];
  const divergence = [];
  if (authority?.format_version !== 2) compatibility.push('authority format is not v2');
  if (authority?.state_ref !== STATE_REF)
    compatibility.push('state_ref is not the public state ref');
  if (!OID.test(authority?.baseline ?? ''))
    compatibility.push('baseline is not an exact commit OID');
  for (const key of ['project_id', 'inventory_digest', 'minimum_client_version']) {
    if (authority?.[key] !== metadata.manifest[key]) {
      divergence.push(`${key} does not match baseline`);
    }
  }
  try {
    if (compareVersions(VERSION, authority.minimum_client_version) < 0) {
      compatibility.push(`client ${VERSION} is older than ${authority.minimum_client_version}`);
    }
  } catch {
    compatibility.push('minimum_client_version is invalid');
  }
  return { compatibility, divergence };
}

function integrationSourceMayBeActivation(source, actual, revision, parent, integration) {
  if (actual === source.commit) return true;
  const parsed = parseSource(source.name);
  return (
    parsed.ref === `refs/heads/${integration}` && source.commit === parent && actual === revision
  );
}

export function doctorStateMigration(
  { activationRef = 'HEAD', online = false } = {},
  start = process.cwd(),
  activity = {},
) {
  recordActivity(activity, {
    network: false,
    written: false,
    sources: [],
    sourceOids: {},
    baseline: null,
    branch: activationRef,
    ref: activationRef,
    inventoryDigest: null,
  });
  const { repoRoot } = repoFor(start);
  const revision = exactCommit(repoRoot, activationRef);
  const authority = authorityAt(repoRoot, revision);
  recordActivity(activity, {
    baseline: authority.baseline ?? null,
    inventoryDigest: authority.inventory_digest ?? null,
  });
  const metadata = readStateMetadata(repoRoot, authority.baseline);
  recordActivity(activity, {
    sources: metadata.manifest.sources ?? [],
    sourceOids: Object.fromEntries(
      (metadata.manifest.sources ?? []).map((source) => [source.name, source.commit]),
    ),
  });
  const categories = {
    compatibility: [],
    data_divergence: [],
    permissions: [online ? 'not-provable-without-provider-enforcement' : 'not-checked'],
    enforcement: ['absent; tracked by change 20260721-193104'],
  };
  const authorityIssues = authorityProblems(authority, metadata);
  categories.compatibility.push(...authorityIssues.compatibility);
  categories.data_divergence.push(...authorityIssues.divergence);
  const parents = git(repoRoot, ['rev-list', '--parents', '-n', '1', revision]).split(' ');
  if (parents.length !== 2)
    categories.data_divergence.push('activation must be a single-parent commit');
  const parent = parents[1] ?? null;
  const integration = integrationBranch(metadata.config);
  const integrationHead = exactCommit(repoRoot, `refs/heads/${integration}`);
  if (parent !== integrationHead && revision !== integrationHead) {
    categories.data_divergence.push('activation parent does not match integration head');
  }
  if (parent) {
    try {
      const expected = expectedActivation(repoRoot, parent, authority.baseline, metadata);
      const actualTree = git(repoRoot, ['rev-parse', `${revision}^{tree}`]);
      if (actualTree !== expected.tree) {
        categories.data_divergence.push('activation tree does not match exact cutover');
      }
    } catch (error) {
      categories.data_divergence.push(`activation cannot be reconstructed: ${error.message}`);
    }
  }
  const refs = readStateReplica(repoRoot);
  if (refs.pending) categories.data_divergence.push(`pending state exists at ${refs.pending}`);
  const observed = [];
  for (const source of metadata.manifest.sources ?? []) {
    const parsed = parseSource(source.name);
    if (parsed.kind !== 'local') {
      observed.push({
        name: source.name,
        commit: source.commit,
        expected: source.commit,
        actual: null,
        network: false,
        observed: false,
      });
      continue;
    }
    let actual = null;
    try {
      actual = exactCommit(repoRoot, parsed.ref);
    } catch {
      actual = null;
    }
    observed.push({
      name: source.name,
      commit: source.commit,
      expected: source.commit,
      actual,
      network: false,
      observed: true,
    });
    if (!integrationSourceMayBeActivation(source, actual, revision, parent, integration)) {
      categories.data_divergence.push(`source advanced or disappeared: ${source.name}`);
    }
  }
  if (online) {
    const remote = stateRemote(repoRoot);
    const state = fetchRef(repoRoot, remote, STATE_REF, activity);
    if (!state) categories.data_divergence.push('remote state is missing');
    else {
      try {
        git(repoRoot, ['merge-base', '--is-ancestor', authority.baseline, state]);
      } catch {
        categories.data_divergence.push('remote state does not descend from baseline');
      }
    }
    for (const source of metadata.manifest.sources ?? []) {
      if (!source.name || source.name.startsWith('local:')) continue;
      const parsed = parseSource(source.name);
      const actual = remoteRef(repoRoot, parsed.remote, parsed.ref, activity);
      const observation = observed.find((item) => item.name === source.name);
      Object.assign(observation, { actual, network: true, observed: true });
      if (!integrationSourceMayBeActivation(source, actual, revision, parent, integration)) {
        categories.data_divergence.push(`source advanced or disappeared: ${source.name}`);
      }
    }
  }
  const problems = [...categories.compatibility, ...categories.data_divergence];
  return {
    ok: problems.length === 0,
    problems,
    activation: revision,
    baseline: authority.baseline,
    inventoryDigest: authority.inventory_digest,
    minimumClientVersion: authority.minimum_client_version,
    integration,
    network: activity.network,
    written: false,
    enforcement: 'absent',
    permissions: online ? 'not-provable-without-provider-enforcement' : 'not-checked',
    categories,
    sources: observed,
    sourceOids: Object.fromEntries(observed.map((source) => [source.name, source.commit])),
    branch: activationRef,
    ref: activationRef,
  };
}

function assertIntegrationAuthority(repoRoot, base, expected) {
  const entry = treeEntry(repoRoot, base, LEGACY_AUTHORITY_PATH);
  if (!entry) throw new Error('integration authority is missing');
  regularBlob(entry, base);
  let actual;
  try {
    actual = parseYaml(blobText(repoRoot, entry.blob));
  } catch (error) {
    throw new Error(`integration authority is invalid: ${error.message}`, { cause: error });
  }
  if (JSON.stringify(canonical(actual)) !== JSON.stringify(canonical(expected))) {
    throw new Error('integration authority does not match active authority');
  }
}

function assertRecoveryTargetsEmpty(repoRoot, base, roots, targets) {
  for (const entry of treeEntries(repoRoot, base, roots)) {
    if (entry.path === LEGACY_AUTHORITY_PATH) continue;
    if (!targets.has(entry.path)) continue;
    throw new Error(`legacy recovery target is occupied: ${entry.path}`);
  }
}

export function exportStateRecovery(
  start = process.cwd(),
  { beforeRefTransaction } = {},
  activity = {},
) {
  recordActivity(activity, {
    network: false,
    written: false,
    sources: [],
    sourceOids: {},
    baseline: null,
    branch: null,
    ref: null,
    inventoryDigest: null,
  });
  const { repoRoot } = repoFor(start);
  const store = loadLedgerStore(repoRoot);
  if (!store.replica)
    throw new Error('state recovery export requires authority.yml format_version: 2');
  const authoritySnapshot = store.validateAuthority();
  recordActivity(activity, {
    baseline: authoritySnapshot.authority.baseline,
    inventoryDigest: authoritySnapshot.authority.inventory_digest,
    sources: authoritySnapshot.manifest.sources ?? [],
    sourceOids: Object.fromEntries(
      (authoritySnapshot.manifest.sources ?? []).map((source) => [source.name, source.commit]),
    ),
  });
  const refs = readStateReplica(repoRoot);
  if (refs.confirmed) {
    const branchName = `changeledger/recover-${refs.confirmed.slice(0, 12)}`;
    recordActivity(activity, {
      branch: branchName,
      ref: `refs/heads/${branchName}`,
    });
  }
  if (refs.pending) throw new Error(`state recovery export requires no ${PENDING_REF}`);
  if (!refs.confirmed || refs.observed !== refs.confirmed) {
    throw new Error(
      'state recovery export requires a fresh confirmed state; run `changeledger state sync`',
    );
  }
  const snapshot = store.loadRevision(refs.confirmed);
  // A closed-snapshot validation cannot see truth dropped earlier in the
  // confirmed history; recovery materializes that history outside the replica,
  // so it must not export a lineage that lost an identity since the baseline.
  store.validateHistory(refs.confirmed);
  const integration = integrationBranch(snapshot.config);
  if (!integration) throw new Error('state recovery export requires git.integration_branch');
  const base = exactCommit(repoRoot, `refs/heads/${integration}`);
  assertIntegrationAuthority(repoRoot, base, authoritySnapshot.authority);
  const changesDir = normalizedRepoPath(snapshot.config.changes_dir, 'changes_dir');
  const specsDir = normalizedRepoPath(
    snapshot.config.specs_dir ?? '.changeledger/specs',
    'specs_dir',
  );
  const writes = new Map([[LEGACY_CONFIG_PATH, snapshot.configText]]);
  for (const change of snapshot.changes) writes.set(`${changesDir}/${change.name}`, change.text);
  for (const spec of snapshot.specs) writes.set(`${specsDir}/${spec.name}`, spec.text);
  for (const release of snapshot.releases)
    writes.set(`${RELEASES_DIR}/${release.name}`, release.text);
  assertRecoveryTargetsEmpty(
    repoRoot,
    base,
    [LEGACY_CONFIG_PATH, changesDir, specsDir, RELEASES_DIR],
    new Set(writes.keys()),
  );
  const branchName = `changeledger/recover-${refs.confirmed.slice(0, 12)}`;
  const created = createBranchCommit({
    repoRoot,
    base,
    branch: `refs/heads/${branchName}`,
    writes,
    removals: [LEGACY_AUTHORITY_PATH],
    message: `feat(state): recover confirmed ${refs.confirmed}`,
    guards: [
      { ref: CONFIRMED_REF, expected: refs.confirmed },
      { ref: OBSERVED_REF, expected: refs.observed },
      { ref: PENDING_REF, expected: null },
      { ref: `refs/heads/${integration}`, expected: base },
    ],
    allowExactReuse: true,
    beforeRefTransaction,
    activity,
  });
  return {
    branch: branchName,
    commit: created.commit,
    confirmed: refs.confirmed,
    baseline: snapshot.authority.baseline,
    integration,
    inventoryDigest: snapshot.manifest.inventory_digest,
    sources: snapshot.manifest.sources ?? [],
    sourceOids: Object.fromEntries(
      (snapshot.manifest.sources ?? []).map((source) => [source.name, source.commit]),
    ),
    ref: `refs/heads/${branchName}`,
    network: activity.network,
    written: activity.written,
  };
}

function resolveActivationCommitOrNull(repoRoot) {
  let oid;
  try {
    oid = git(repoRoot, ['rev-parse', '--verify', '--quiet', ACTIVATION_REF]);
  } catch (error) {
    if (error.cause?.status === 1) return null;
    throw new Error(`cannot read Git ref ${ACTIVATION_REF}: ${error.message}`, { cause: error });
  }
  if (!OID.test(oid)) {
    throw new Error(`cannot read Git ref ${ACTIVATION_REF}: ref did not resolve to an exact OID`);
  }
  try {
    const commit = git(repoRoot, [
      'rev-parse',
      '--verify',
      '--quiet',
      `${ACTIVATION_REF}^{commit}`,
    ]);
    if (!OID.test(commit)) {
      throw new Error('activation ref did not resolve to an exact commit OID');
    }
    return { oid, commit };
  } catch (error) {
    if (error.cause?.status === 1) {
      throw new Error(`state activation ref ${ACTIVATION_REF} must point to a commit`);
    }
    throw new Error(`cannot read Git ref ${ACTIVATION_REF}: ${error.message}`, { cause: error });
  }
}

// A fully-qualified integration ref names `git.integration_branch` exactly:
// the local branch, or a single remote's tracking copy of it. Anything else
// (a differently-named branch that merely happens to carry authority, a short
// name, a tag) is rejected so activation can only be installed by pointing at
// the protected integration branch itself.
function refNamesIntegration(fullRef, integration) {
  if (fullRef === `refs/heads/${integration}`) return true;
  const prefix = 'refs/remotes/';
  const suffix = `/${integration}`;
  if (fullRef.startsWith(prefix) && fullRef.endsWith(suffix)) {
    const remote = fullRef.slice(prefix.length, fullRef.length - suffix.length);
    return remote.length > 0 && !remote.includes('/');
  }
  return false;
}

function isFullIntegrationRef(fullRef) {
  if (fullRef.startsWith('refs/heads/')) return fullRef.length > 'refs/heads/'.length;
  if (!fullRef.startsWith('refs/remotes/')) return false;
  const [remote, ...branch] = fullRef.slice('refs/remotes/'.length).split('/');
  return Boolean(remote && branch.join('/'));
}

function activationSourceAuthority(repoRoot, integrationRef) {
  const commit = exactCommit(repoRoot, integrationRef);
  const authority = authorityAt(repoRoot, commit);
  if (authority?.format_version !== 2) {
    throw new Error('state activation source authority.yml is not format_version: 2');
  }
  if (!OID.test(authority.baseline ?? '')) {
    throw new Error('state activation source authority baseline is not an exact commit OID');
  }
  if (authority.state_ref !== STATE_REF) {
    throw new Error(`Unsupported state authority ref: ${authority.state_ref}`);
  }
  const metadata = readStateMetadata(repoRoot, authority.baseline);
  const integration = integrationBranch(metadata.config);
  if (!integration) throw new Error('state activation requires git.integration_branch');
  if (!refNamesIntegration(integrationRef, integration)) {
    throw new Error(
      `state activation install requires --integration-ref to name git.integration_branch ${integration}`,
    );
  }
  for (const key of ['project_id', 'inventory_digest', 'minimum_client_version']) {
    if (authority[key] !== metadata.manifest[key]) {
      throw new Error(`state activation source ${key} does not match baseline manifest`);
    }
  }
  return { commit, authority, metadata, integration };
}

export function installStateActivation(
  { integrationRef, beforeRefTransaction } = {},
  start = process.cwd(),
  activity = {},
) {
  recordActivity(activity, {
    network: false,
    written: false,
    sources: [],
    sourceOids: {},
    baseline: null,
    branch: null,
    ref: ACTIVATION_REF,
    protectedRef: ACTIVATION_REF,
    inventoryDigest: null,
  });
  if (typeof integrationRef !== 'string' || integrationRef === '') {
    throw new Error('state activation install requires --integration-ref');
  }
  const { repoRoot } = repoFor(start);
  const { commit, authority, metadata, integration } = activationSourceAuthority(
    repoRoot,
    integrationRef,
  );
  recordActivity(activity, {
    baseline: authority.baseline,
    inventoryDigest: authority.inventory_digest,
    sources: metadata.manifest.sources ?? [],
    sourceOids: Object.fromEntries(
      (metadata.manifest.sources ?? []).map((source) => [source.name, source.commit]),
    ),
    newOid: commit,
  });
  const current = resolveActivationCommitOrNull(repoRoot);
  recordActivity(activity, { oldOid: current?.oid ?? null });
  const base = {
    activation: commit,
    baseline: authority.baseline,
    integration,
    inventoryDigest: authority.inventory_digest,
    sources: metadata.manifest.sources ?? [],
    sourceOids: Object.fromEntries(
      (metadata.manifest.sources ?? []).map((source) => [source.name, source.commit]),
    ),
    ref: ACTIVATION_REF,
    protectedRef: ACTIVATION_REF,
    oldOid: current?.oid ?? null,
    newOid: commit,
    network: false,
  };
  if (current?.commit === commit) return { ...base, written: false };
  if (current) {
    throw new Error(
      `state activation already points to ${current.commit}; refusing to replace it with ${commit}`,
    );
  }
  beforeRefTransaction?.();
  const lines = [
    'start',
    `verify ${integrationRef} ${commit}`,
    `create ${ACTIVATION_REF} ${commit}`,
    'prepare',
    'commit',
    '',
  ];
  try {
    git(repoRoot, ['update-ref', '--stdin'], { input: lines.join('\n') });
  } catch (error) {
    throw new Error('state activation source changed concurrently; retry', { cause: error });
  }
  activity.written = true;
  return { ...base, written: true };
}

export function deactivateStateActivation(
  { integrationRef, beforeRefTransaction } = {},
  start = process.cwd(),
  activity = {},
) {
  recordActivity(activity, {
    network: false,
    written: false,
    sources: [],
    sourceOids: {},
    baseline: null,
    branch: null,
    ref: ACTIVATION_REF,
    protectedRef: ACTIVATION_REF,
    inventoryDigest: null,
  });
  if (typeof integrationRef !== 'string' || integrationRef === '') {
    throw new Error('state activation deactivation requires --integration-ref');
  }
  const { repoRoot } = repoFor(start);
  const activation = resolveActivationCommitOrNull(repoRoot);
  const replica = readStateReplica(repoRoot);
  recordActivity(activity, { oldOid: activation?.oid ?? null, newOid: null });
  const base = {
    ref: ACTIVATION_REF,
    protectedRef: ACTIVATION_REF,
    oldOid: activation?.oid ?? null,
    newOid: null,
    network: false,
  };
  if (replica.pending) {
    throw new Error(`state activation deactivation requires no ${PENDING_REF}`);
  }
  const tip = exactCommit(repoRoot, integrationRef);
  // Once every ref is gone, no authority remains from which to re-derive the
  // configured branch. The retry is still accepted only for an exact,
  // fully-qualified Git ref.
  if (!activation && !replica.confirmed && !replica.observed) {
    if (!isFullIntegrationRef(integrationRef)) {
      throw new Error('state activation deactivation requires a full --integration-ref');
    }
    return { ...base, deactivated: false, removed: [], written: false };
  }
  if (!activation) {
    throw new Error(`state activation deactivation requires ${ACTIVATION_REF}`);
  }
  const authority = authorityAt(repoRoot, activation.commit);
  const metadata = readStateMetadata(repoRoot, authority.baseline);
  const integration = integrationBranch(metadata.config);
  if (!integration)
    throw new Error('state activation deactivation requires git.integration_branch');
  if (!refNamesIntegration(integrationRef, integration)) {
    throw new Error(
      `state activation deactivation requires --integration-ref to name git.integration_branch ${integration}`,
    );
  }
  if (!replica.confirmed || !replica.observed || replica.confirmed !== replica.observed) {
    throw new Error(
      `state activation deactivation requires matching ${CONFIRMED_REF} and ${OBSERVED_REF}`,
    );
  }
  if (treeEntry(repoRoot, tip, LEGACY_AUTHORITY_PATH)) {
    throw new Error(
      `state activation deactivation requires ${integrationRef} without ${LEGACY_AUTHORITY_PATH}`,
    );
  }
  const deletions = [
    [ACTIVATION_REF, activation.oid],
    [CONFIRMED_REF, replica.confirmed],
    [OBSERVED_REF, replica.observed],
  ].filter(([, oid]) => oid);
  beforeRefTransaction?.();
  const lines = ['start', `verify ${integrationRef} ${tip}`, `verify ${PENDING_REF}`];
  for (const [ref, oid] of deletions) lines.push(`delete ${ref} ${oid}`);
  lines.push('prepare', 'commit', '');
  try {
    git(repoRoot, ['update-ref', '--stdin'], { input: lines.join('\n') });
  } catch (error) {
    throw new Error('state activation refs changed concurrently; retry', { cause: error });
  }
  activity.written = true;
  return {
    ...base,
    deactivated: true,
    removed: deletions.map(([ref]) => ref),
    confirmed: replica.confirmed,
    integration: integrationRef,
    written: true,
  };
}
