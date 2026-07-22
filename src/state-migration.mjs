import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseChange } from './change.mjs';
import { checkRepo } from './check.mjs';
import { findChangeledgerDir, integrationBranch } from './config.mjs';
import { VERSION } from './framing.mjs';
import { sanitizedGitEnv } from './git.mjs';
import { loadLedgerStore, STATE_REF } from './ledger-store.mjs';
import { parseSpec } from './spec.mjs';
import { PENDING_REF, readStateReplica, stateRemote } from './state-store.mjs';
import { parseYaml, stringifyYaml } from './yaml.mjs';

const STATE_ROOT = '.changeledger-state';
const MANIFEST_PATH = `${STATE_ROOT}/manifest.yml`;
const CONFIG_PATH = `${STATE_ROOT}/config.yml`;
const LEGACY_CONFIG_PATH = '.changeledger/config.yml';
const LEGACY_AUTHORITY_PATH = '.changeledger/authority.yml';
const RELEASES_DIR = '.changeledger/releases';
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SHA256 = /^[0-9a-f]{64}$/;

function gitOutput(repoRoot, args, { input, env, timeout } = {}) {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      env: sanitizedGitEnv(env),
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout,
    });
  } catch (error) {
    const detail = [error.stderr, error.stdout]
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean)
      .join('\n');
    throw new Error(detail || error.message, { cause: error });
  }
}

function git(repoRoot, args, options) {
  return gitOutput(repoRoot, args, options).trim();
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

function observeSource(repoRoot, value) {
  const source = parseSource(value);
  if (source.kind === 'local') return { ...source, commit: exactCommit(repoRoot, source.ref) };
  const configured = stateRemote(repoRoot);
  if (source.remote !== configured) {
    throw new Error(`migration source remote must be configured state remote "${configured}"`);
  }
  const commit = parseRemoteLine(
    gitOutput(repoRoot, ['ls-remote', '--refs', source.remote, source.ref]),
    source.name,
  );
  git(repoRoot, ['fetch', '--no-tags', '--no-write-fetch-head', source.remote, source.ref]);
  exactCommit(repoRoot, commit);
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
  return gitOutput(repoRoot, ['cat-file', 'blob', blob]);
}

function basename(file) {
  const value = path.posix.basename(file);
  if (!value || value === '.' || value === '..' || value.includes('\0')) {
    throw new Error(`invalid migration basename: ${value}`);
  }
  return value;
}

function candidateFromEntry(repoRoot, source, entry, kind) {
  regularBlob(entry, source.name);
  const content = blobText(repoRoot, entry.blob);
  const name = basename(entry.path);
  let identity;
  if (kind === 'change') {
    const parsed = parseChange(content);
    identity = `change:${parsed.frontmatter.id}`;
    if (!name.startsWith(`${parsed.frontmatter.id}-`) || !name.endsWith('.md')) {
      throw new Error(
        `migration source ${source.name} has invalid change filename at ${entry.path}`,
      );
    }
  } else if (kind === 'spec') {
    parseSpec(content);
    if (!name.endsWith('.md')) throw new Error(`invalid spec filename: ${entry.path}`);
    identity = `spec:${name.slice(0, -3)}`;
  } else if (kind === 'release') {
    const release = parseYaml(content);
    const version = release.version ?? name.replace(/\.ya?ml$/, '');
    identity = `release:${version}`;
  } else {
    parseYaml(content);
    identity = 'config';
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
  };
}

function inventorySource(repoRoot, observed) {
  const configEntries = treeEntries(repoRoot, observed.commit, [LEGACY_CONFIG_PATH]);
  const configEntry = configEntries.find((entry) => entry.path === LEGACY_CONFIG_PATH);
  if (!configEntry)
    throw new Error(`migration source ${observed.name} has no ${LEGACY_CONFIG_PATH}`);
  const configCandidate = candidateFromEntry(repoRoot, observed, configEntry, 'config');
  const config = parseYaml(blobText(repoRoot, configEntry.blob));
  const changesDir = normalizedRepoPath(config.changes_dir, 'changes_dir');
  const specsDir = normalizedRepoPath(config.specs_dir ?? '.changeledger/specs', 'specs_dir');
  const collections = [
    ['change', changesDir, '.md'],
    ['spec', specsDir, '.md'],
    ['release', RELEASES_DIR, '.yml'],
  ];
  const candidates = [configCandidate];
  for (const [kind, dir, extension] of collections) {
    const entries = treeEntries(repoRoot, observed.commit, [dir]);
    for (const entry of entries) {
      if (!entry.path.startsWith(`${dir}/`) || !entry.path.endsWith(extension)) continue;
      candidates.push(candidateFromEntry(repoRoot, observed, entry, kind));
    }
  }
  return { source: observed, projectId: config.project_id, candidates };
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
      return {
        identity,
        kind: selected.kind,
        candidates,
        resolution:
          variants.size === 1 ? { blob: selected.blob, basename: selected.basename } : null,
      };
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

export function previewStateMigration({ sources, output } = {}, start = process.cwd()) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error('state migrate --preview requires at least one --source');
  }
  const { repoRoot } = repoFor(start);
  const observed = [...new Set(sources)].sort().map((source) => observeSource(repoRoot, source));
  const inventories = observed.map((source) => inventorySource(repoRoot, source));
  const projectIds = new Set(inventories.map((item) => item.projectId));
  if (projectIds.size !== 1 || ![...projectIds][0]) {
    throw new Error('migration sources must share one non-empty project_id');
  }
  const documents = groupCandidates(inventories);
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
  };
  const text = stringifyYaml(plan);
  if (output) fs.writeFileSync(path.resolve(repoRoot, output), text);
  return {
    plan,
    text,
    output: output ? path.resolve(repoRoot, output) : null,
    network: observed.some((s) => s.kind === 'remote'),
    written: Boolean(output),
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
  const actualDigest = digest(migrationInventory(plan));
  if (actualDigest !== plan.inventory_digest) {
    throw new Error(
      'migration plan integrity check failed: inventory_digest does not match inventory',
    );
  }
  return { file, plan };
}

function revalidatePlan(repoRoot, plan) {
  for (const source of plan.sources) {
    const actual = observeSource(repoRoot, source.name).commit;
    if (actual !== source.commit) {
      throw new Error(
        `migration plan is stale: source ${source.name} expected ${source.commit} actual ${actual}`,
      );
    }
  }
}

function chosenContent(repoRoot, planFile, document) {
  const resolution = document.resolution;
  if (!resolution)
    throw new Error(`migration conflict: ${document.identity} has divergent candidates`);
  if (resolution.replacement) {
    const replacement = path.resolve(path.dirname(planFile), resolution.replacement);
    const content = fs.readFileSync(replacement, 'utf8');
    const actual = crypto.createHash('sha256').update(content).digest('hex');
    if (actual !== resolution.sha256) {
      throw new Error(
        `migration plan is stale: replacement ${resolution.replacement} expected ${resolution.sha256} actual ${actual}`,
      );
    }
    return {
      content,
      basename: resolution.basename,
      provenance: { replacement: resolution.replacement, sha256: actual },
    };
  }
  const candidate = document.candidates.find(
    (item) => item.blob === resolution.blob && item.basename === resolution.basename,
  );
  if (!candidate)
    throw new Error(
      `migration plan is stale: resolution for ${document.identity} is not a candidate`,
    );
  return {
    content: blobText(repoRoot, candidate.blob),
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

function candidateSnapshot(repoRoot, planFile, plan) {
  const writes = new Map();
  const decisions = [];
  for (const document of plan.documents) {
    const chosen = chosenContent(repoRoot, planFile, document);
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
  const { errors } = checkRepo({ config, changes, specs, releases });
  if (errors.length) {
    throw new Error(
      `migration candidate validation failed: ${errors.map((error) => error.message).join('; ')}`,
    );
  }
  const manifest = {
    format_version: 1,
    project_id: plan.project_id,
    inventory_digest: plan.inventory_digest,
    minimum_client_version: plan.minimum_client_version,
    sources: plan.sources.map(({ name, commit }) => ({ name, commit })),
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

function remoteRef(repoRoot, remote, ref) {
  const output = gitOutput(repoRoot, ['ls-remote', '--refs', remote, ref]);
  if (output.trim() === '') return null;
  return parseRemoteLine(output, `${remote}:${ref}`);
}

function fetchRef(repoRoot, remote, ref) {
  const oid = remoteRef(repoRoot, remote, ref);
  if (!oid) return null;
  git(repoRoot, ['fetch', '--no-tags', '--no-write-fetch-head', remote, ref]);
  exactCommit(repoRoot, oid);
  return oid;
}

export function createStateBaseline({ planFile } = {}, start = process.cwd()) {
  const { repoRoot } = repoFor(start);
  const loaded = loadPlan(planFile);
  revalidatePlan(repoRoot, loaded.plan);
  const candidate = candidateSnapshot(repoRoot, loaded.file, loaded.plan);
  const tree = treeFromWrites(repoRoot, candidate.writes);
  const commit = git(repoRoot, [
    'commit-tree',
    tree,
    '-m',
    `chore(state): migration baseline ${loaded.plan.inventory_digest}`,
  ]);
  const remote = stateRemote(repoRoot);
  const existing = fetchRef(repoRoot, remote, STATE_REF);
  let baseline = commit;
  let created = false;
  if (existing) {
    const existingTree = git(repoRoot, ['rev-parse', `${existing}^{tree}`]);
    if (existingTree !== tree)
      throw new Error('state baseline already exists with different content');
    baseline = existing;
  } else {
    try {
      git(repoRoot, ['push', remote, `${commit}:${STATE_REF}`]);
      created = true;
    } catch (error) {
      const raced = fetchRef(repoRoot, remote, STATE_REF);
      if (!raced || git(repoRoot, ['rev-parse', `${raced}^{tree}`]) !== tree) throw error;
      baseline = raced;
    }
  }
  return {
    baseline,
    remote,
    stateRef: STATE_REF,
    inventoryDigest: loaded.plan.inventory_digest,
    network: true,
    written: created,
  };
}

function treeEntry(repoRoot, commit, file) {
  return treeEntries(repoRoot, commit, [file]).find((entry) => entry.path === file) ?? null;
}

function stateFiles(repoRoot, revision) {
  return treeEntries(repoRoot, revision, [STATE_ROOT]);
}

function readStateMetadata(repoRoot, revision) {
  exactCommit(repoRoot, revision);
  const manifestEntry = treeEntry(repoRoot, revision, MANIFEST_PATH);
  const configEntry = treeEntry(repoRoot, revision, CONFIG_PATH);
  if (!manifestEntry || !configEntry)
    throw new Error('state baseline is missing manifest or config');
  regularBlob(manifestEntry, revision);
  regularBlob(configEntry, revision);
  return {
    manifest: parseYaml(blobText(repoRoot, manifestEntry.blob)),
    config: parseYaml(blobText(repoRoot, configEntry.blob)),
    configText: blobText(repoRoot, configEntry.blob),
  };
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

function collectionLegacyPath(config, stateFile) {
  const name = path.posix.basename(stateFile);
  if (stateFile.startsWith(`${STATE_ROOT}/changes/`)) {
    return `${normalizedRepoPath(config.changes_dir, 'changes_dir')}/${name}`;
  }
  if (stateFile.startsWith(`${STATE_ROOT}/specs/`)) {
    return `${normalizedRepoPath(config.specs_dir ?? '.changeledger/specs', 'specs_dir')}/${name}`;
  }
  if (stateFile.startsWith(`${STATE_ROOT}/releases/`)) return `${RELEASES_DIR}/${name}`;
  return null;
}

function createBranchCommit({ repoRoot, base, branch, writes, removals, message }) {
  const tree = withIndex(repoRoot, ({ git: indexed }) => {
    indexed(['read-tree', base]);
    for (const file of removals) indexed(['update-index', '--force-remove', '--', file]);
    for (const [file, content] of writes) {
      const blob = indexed(['hash-object', '-w', '--stdin'], { input: content });
      indexed(['update-index', '--add', '--cacheinfo', `100644,${blob},${file}`]);
    }
    return indexed(['write-tree']);
  });
  let existing = null;
  try {
    existing = exactCommit(repoRoot, branch);
  } catch {
    existing = null;
  }
  if (existing) {
    const existingTree = git(repoRoot, ['rev-parse', `${existing}^{tree}`]);
    let existingParent = null;
    try {
      existingParent = git(repoRoot, ['rev-parse', '--verify', `${existing}^`]);
    } catch {
      existingParent = null;
    }
    if (existingTree === tree && existingParent === base) return { commit: existing, reused: true };
    throw new Error(
      `branch ${branch.replace('refs/heads/', '')} already exists with different content`,
    );
  }
  const commit = git(repoRoot, ['commit-tree', tree, '-p', base, '-m', message]);
  git(repoRoot, ['update-ref', branch, commit, '']);
  return { commit, reused: false };
}

export function prepareStateActivation({ baseline } = {}, start = process.cwd()) {
  const { repoRoot } = repoFor(start);
  if (!OID.test(baseline ?? '')) throw new Error('--baseline must be an exact commit OID');
  const remote = stateRemote(repoRoot);
  const published = fetchRef(repoRoot, remote, STATE_REF);
  if (published !== baseline)
    throw new Error(
      `published state baseline is ${published ?? '(missing)'}, expected ${baseline}`,
    );
  const { manifest, config } = readStateMetadata(repoRoot, baseline);
  if (manifest.project_id !== config.project_id) throw new Error('baseline project_id mismatch');
  const integration = integrationBranch(config);
  if (!integration) throw new Error('state activation requires git.integration_branch');
  const base = exactCommit(repoRoot, `refs/heads/${integration}`);
  if (treeEntry(repoRoot, base, LEGACY_AUTHORITY_PATH)) {
    throw new Error('integration branch already contains state authority');
  }
  const removals = [];
  const stateEntries = stateFiles(repoRoot, baseline);
  for (const stateEntry of stateEntries) {
    const legacy = collectionLegacyPath(config, stateEntry.path);
    if (!legacy) continue;
    const current = treeEntry(repoRoot, base, legacy);
    if (!current) continue;
    regularBlob(current, integration);
    if (blobText(repoRoot, current.blob) !== blobText(repoRoot, stateEntry.blob)) {
      throw new Error(`integration legacy file diverged from baseline: ${legacy}`);
    }
    removals.push(legacy);
  }
  const legacyConfig = treeEntry(repoRoot, base, LEGACY_CONFIG_PATH);
  const stateConfig = treeEntry(repoRoot, baseline, CONFIG_PATH);
  if (legacyConfig) {
    if (blobText(repoRoot, legacyConfig.blob) !== blobText(repoRoot, stateConfig.blob)) {
      throw new Error(`integration legacy file diverged from baseline: ${LEGACY_CONFIG_PATH}`);
    }
    removals.push(LEGACY_CONFIG_PATH);
  }
  const branchName = `changeledger/activate-${baseline.slice(0, 12)}`;
  const branch = `refs/heads/${branchName}`;
  const created = createBranchCommit({
    repoRoot,
    base,
    branch,
    removals,
    writes: new Map([[LEGACY_AUTHORITY_PATH, authorityText({ baseline, manifest })]]),
    message: `feat(state): activate baseline ${baseline}`,
  });
  return {
    branch: branchName,
    commit: created.commit,
    baseline,
    integration,
    inventoryDigest: manifest.inventory_digest,
    network: true,
    written: !created.reused,
  };
}

function authorityAt(repoRoot, revision) {
  const entry = treeEntry(repoRoot, revision, LEGACY_AUTHORITY_PATH);
  if (!entry) throw new Error(`activation ref has no ${LEGACY_AUTHORITY_PATH}`);
  return parseYaml(blobText(repoRoot, entry.blob));
}

export function doctorStateMigration(
  { activationRef = 'HEAD', online = false } = {},
  start = process.cwd(),
) {
  const { repoRoot } = repoFor(start);
  const revision = exactCommit(repoRoot, activationRef);
  const authority = authorityAt(repoRoot, revision);
  const metadata = readStateMetadata(repoRoot, authority.baseline);
  const problems = [];
  if (authority.format_version !== 2) problems.push('authority format is not v2');
  for (const key of ['project_id', 'inventory_digest', 'minimum_client_version']) {
    if (authority[key] !== metadata.manifest[key]) problems.push(`${key} does not match baseline`);
  }
  const parents = git(repoRoot, ['rev-list', '--parents', '-n', '1', revision]).split(' ');
  if (parents.length !== 2) problems.push('activation must be a single-parent commit');
  const integration = integrationBranch(metadata.config);
  const integrationHead = exactCommit(repoRoot, `refs/heads/${integration}`);
  if (parents[1] !== integrationHead && revision !== integrationHead) {
    problems.push('activation parent does not match integration head');
  }
  const refs = readStateReplica(repoRoot);
  if (refs.pending) problems.push(`pending state exists at ${refs.pending}`);
  const observed = [];
  if (online) {
    const remote = stateRemote(repoRoot);
    const state = remoteRef(repoRoot, remote, STATE_REF);
    if (!state) problems.push('remote state is missing');
    else {
      git(repoRoot, ['fetch', '--no-tags', '--no-write-fetch-head', remote, STATE_REF]);
      try {
        git(repoRoot, ['merge-base', '--is-ancestor', authority.baseline, state]);
      } catch {
        problems.push('remote state does not descend from baseline');
      }
    }
    for (const source of metadata.manifest.sources ?? []) {
      if (!source.name || source.name.startsWith('local:')) continue;
      const parsed = parseSource(source.name);
      const actual = remoteRef(repoRoot, parsed.remote, parsed.ref);
      observed.push({ name: source.name, expected: source.commit, actual });
      if (actual !== source.commit) problems.push(`source advanced: ${source.name}`);
    }
  }
  return {
    ok: problems.length === 0,
    problems,
    activation: revision,
    baseline: authority.baseline,
    inventoryDigest: authority.inventory_digest,
    minimumClientVersion: authority.minimum_client_version,
    integration,
    network: online,
    enforcement: 'absent',
    permissions: online ? 'not-provable-without-provider-enforcement' : 'not-checked',
    sources: observed,
  };
}

function assertRecoveryTargetsEmpty(repoRoot, base, config) {
  const roots = [
    LEGACY_CONFIG_PATH,
    normalizedRepoPath(config.changes_dir, 'changes_dir'),
    normalizedRepoPath(config.specs_dir ?? '.changeledger/specs', 'specs_dir'),
    RELEASES_DIR,
  ];
  for (const entry of treeEntries(repoRoot, base, roots)) {
    if (entry.path === LEGACY_AUTHORITY_PATH) continue;
    throw new Error(`legacy recovery target is occupied: ${entry.path}`);
  }
}

export function exportStateRecovery(start = process.cwd()) {
  const { repoRoot } = repoFor(start);
  const store = loadLedgerStore(repoRoot);
  if (!store.replica)
    throw new Error('state recovery export requires authority.yml format_version: 2');
  const refs = readStateReplica(repoRoot);
  if (refs.pending) throw new Error(`state recovery export requires no ${PENDING_REF}`);
  if (!refs.confirmed || refs.observed !== refs.confirmed) {
    throw new Error(
      'state recovery export requires a fresh confirmed state; run `changeledger state sync`',
    );
  }
  const snapshot = store.load();
  const integration = integrationBranch(snapshot.config);
  if (!integration) throw new Error('state recovery export requires git.integration_branch');
  const base = exactCommit(repoRoot, `refs/heads/${integration}`);
  assertRecoveryTargetsEmpty(repoRoot, base, snapshot.config);
  const writes = new Map([[LEGACY_CONFIG_PATH, snapshot.configText]]);
  const changesDir = normalizedRepoPath(snapshot.config.changes_dir, 'changes_dir');
  const specsDir = normalizedRepoPath(
    snapshot.config.specs_dir ?? '.changeledger/specs',
    'specs_dir',
  );
  for (const change of snapshot.changes) writes.set(`${changesDir}/${change.name}`, change.text);
  for (const spec of snapshot.specs) writes.set(`${specsDir}/${spec.name}`, spec.text);
  for (const release of snapshot.releases)
    writes.set(`${RELEASES_DIR}/${release.name}`, release.text);
  const branchName = `changeledger/recover-${refs.confirmed.slice(0, 12)}`;
  const created = createBranchCommit({
    repoRoot,
    base,
    branch: `refs/heads/${branchName}`,
    writes,
    removals: [LEGACY_AUTHORITY_PATH],
    message: `feat(state): recover confirmed ${refs.confirmed}`,
  });
  return {
    branch: branchName,
    commit: created.commit,
    confirmed: refs.confirmed,
    integration,
    network: false,
    written: !created.reused,
  };
}
