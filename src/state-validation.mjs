import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { integrationBranch } from './config.mjs';
import { GIT_MAX_BUFFER, sanitizedGitEnv } from './git.mjs';
import { batchBlobReader } from './git-batch.mjs';
import {
  assertNoDisappearance,
  deriveCandidateSnapshot,
  MANIFEST,
  parseStateAuthority,
  STATE_REF,
  statePathIsValid,
  validateServerStateRevision,
  validateSnapshotContent,
} from './ledger-store.mjs';
import { parseYaml } from './yaml.mjs';

export const DEFAULT_STATE_LIMITS = Object.freeze({
  max_commits: 256,
  max_object_bytes: 64 * 1024 * 1024,
  timeout_ms: 30_000,
});

const AUTHORITY_PATH = '.changeledger/authority.yml';
const LEGACY_CONFIG_PATH = '.changeledger/config.yml';
const STATE_CONFIG_PATH = '.changeledger-state/config.yml';
// A maxBuffer-exceeded execFileSync error still carries the truncated
// stdout/stderr captured so far; with a batch `cat-file --batch` read this
// can be up to `max_object_bytes` (64 MiB default) of raw object content, so
// cap the diagnostic the same way 20260722-202101 already bounds
// state-migration.mjs's git-output errors.
const GIT_ERROR_DETAIL_LIMIT = 2000;

class ValidationTimeoutError extends Error {}

function timeoutError(error) {
  let current = error;
  while (current) {
    if (current instanceof ValidationTimeoutError) return current;
    current = current.cause;
  }
  return null;
}

function cleanError(error) {
  const detail = [error?.stderr, error?.stdout]
    .map((value) => (Buffer.isBuffer(value) ? value.toString('utf8') : value))
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)
    .join('\n');
  if (detail.length > GIT_ERROR_DETAIL_LIMIT) {
    const omitted = detail.length - GIT_ERROR_DETAIL_LIMIT;
    const code = error?.code ? ` (${error.code})` : '';
    return `${detail.slice(0, GIT_ERROR_DETAIL_LIMIT)}... (${omitted} more bytes omitted)${code}`;
  }
  return detail || error?.message || String(error);
}

function runner(
  repoRoot,
  { env = sanitizedGitEnv(), limits = {}, now = performance.now.bind(performance) } = {},
) {
  const budget = { ...DEFAULT_STATE_LIMITS, ...limits };
  for (const [name, value] of Object.entries(budget)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`invalid validation limit ${name}`);
    }
  }
  const started = now();
  const run = (args, cwd = repoRoot, { input, encoding = 'utf8' } = {}) => {
    const remaining = Math.ceil(budget.timeout_ms - (now() - started));
    if (remaining <= 0)
      throw new ValidationTimeoutError(`validation timeout ${budget.timeout_ms}ms exceeded`);
    try {
      return execFileSync('git', args, {
        cwd,
        env: { ...env, GIT_NO_LAZY_FETCH: '1' },
        input,
        timeout: remaining,
        encoding,
        // A batch `cat-file --batch` read (git-batch.mjs) returns every
        // requested blob in one response, which a single small object would
        // never have hit under execFileSync's 1 MiB default. This is a
        // subprocess-pipe ceiling, deliberately independent of the semantic
        // `budget.max_object_bytes` check below (line ~171): it must stay at
        // least that large (a configured budget larger than 16 MiB must still
        // be readable) without shrinking to match a small configured budget,
        // which would fail the subprocess with an opaque ENOBUFS before that
        // check ever ran.
        maxBuffer: Math.max(GIT_MAX_BUFFER, budget.max_object_bytes),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      if (error?.code === 'ETIMEDOUT' || error?.signal === 'SIGTERM') {
        throw new ValidationTimeoutError(`validation timeout ${budget.timeout_ms}ms exceeded`, {
          cause: error,
        });
      }
      throw new Error(cleanError(error), { cause: error });
    }
  };
  return { run, budget, now, started, usage: { commits: 0, objectBytes: 0, objects: new Set() } };
}

function objectFormat(run, repoRoot) {
  return run(['rev-parse', '--show-object-format'], repoRoot).trim() === 'sha256' ? 64 : 40;
}

function zeroOid(length) {
  return '0'.repeat(length);
}

function assertOid(value, length, label) {
  if (!new RegExp(`^[0-9a-f]{${length}}$`).test(value)) throw new Error(`invalid ${label} OID`);
}

function resolveRef(run, repoRoot, ref) {
  try {
    return run(['rev-parse', '--verify', '--quiet', ref], repoRoot).trim();
  } catch (error) {
    const timeout = timeoutError(error);
    if (timeout) throw timeout;
    let current = error;
    while (current?.cause) current = current.cause;
    if (current?.status === 1) return null;
    throw new Error(`cannot resolve protected ref ${ref}: ${cleanError(error)}`, { cause: error });
  }
}

function assertCommit(run, repoRoot, oid) {
  try {
    if (run(['cat-file', '-t', oid], repoRoot).trim() !== 'commit') throw new Error('not commit');
  } catch (error) {
    const timeout = timeoutError(error);
    if (timeout) throw timeout;
    throw new Error(`missing commit object ${oid}`, { cause: error });
  }
}

function assertFastForward(run, repoRoot, oldOid, newOid) {
  try {
    run(['merge-base', '--is-ancestor', oldOid, newOid], repoRoot);
  } catch (error) {
    const timeout = timeoutError(error);
    if (timeout) throw timeout;
    throw new Error(`non-fast-forward update ${oldOid} -> ${newOid}`, { cause: error });
  }
}

function commitsInRange(run, repoRoot, oldOid, newOid, budget, usage) {
  const range = /^0+$/.test(oldOid) ? newOid : `${oldOid}..${newOid}`;
  const commits = run(
    ['rev-list', '--reverse', `--max-count=${budget.max_commits + 1}`, range],
    repoRoot,
  )
    .trim()
    .split('\n')
    .filter(Boolean);
  usage.commits += commits.length;
  if (usage.commits > budget.max_commits)
    throw new Error(`commit limit ${budget.max_commits} exceeded`);
  return { commits, range };
}

function countObjectBytes(run, repoRoot, range, budget, usage) {
  const objects = run(['rev-list', '--objects', '--no-object-names', range], repoRoot)
    .trim()
    .split('\n')
    .filter((oid) => oid && !usage.objects.has(oid));
  if (!objects.length) return 0;
  for (const oid of objects) usage.objects.add(oid);
  const output = run(['cat-file', '--batch-check=%(objectname) %(objectsize)'], repoRoot, {
    input: `${objects.join('\n')}\n`,
  });
  let bytes = 0;
  for (const line of output.trim().split('\n')) {
    const match = line.match(/^[0-9a-f]+ (\d+)$/);
    if (!match) throw new Error(`invalid object metadata: ${line}`);
    bytes += Number(match[1]);
    usage.objectBytes += Number(match[1]);
    if (usage.objectBytes > budget.max_object_bytes)
      throw new Error(`object byte limit ${budget.max_object_bytes} exceeded`);
  }
  return bytes;
}

function readAuthority(run, repoRoot, revision) {
  let text;
  try {
    text = run(['show', `${revision}:${AUTHORITY_PATH}`], repoRoot);
  } catch (error) {
    const timeout = timeoutError(error);
    if (timeout) throw timeout;
    throw new Error('integration protection is not active', { cause: error });
  }
  const authority = parseStateAuthority(text);
  if (authority.format_version !== 2) throw new Error('integration protection is not active');
  return { authority, text };
}

function readConfirmedConfig(run, repoRoot, authority, stateRef, integrationRef, fallbackRevision) {
  const stateRevision = resolveRef(run, repoRoot, stateRef) ?? fallbackRevision;
  if (!stateRevision) throw new Error(`protected state ref ${stateRef} is unavailable`);
  const snapshot = validateServerStateRevision(repoRoot, authority, stateRevision, run);
  const configured = integrationBranch(snapshot.config);
  if (!configured || integrationRef !== `refs/heads/${configured}`) {
    throw new Error(`integration ref ${integrationRef} does not match confirmed state config`);
  }
  return snapshot.config;
}

function assertProtectedRefs(ctx, fallbackStateRevision) {
  const source = resolveRef(ctx.run, ctx.repoRoot, ctx.integrationRef);
  if (!source) throw new Error('integration protection is not active');
  const active = readAuthority(ctx.run, ctx.repoRoot, source);
  readConfirmedConfig(
    ctx.run,
    ctx.repoRoot,
    active.authority,
    ctx.stateRef,
    ctx.integrationRef,
    fallbackStateRevision,
  );
}

// A batch that touches no protected ref must not pay for a full snapshot
// validation, but a hook whose configured integration ref name has drifted
// from the confirmed config must still be caught -- otherwise the real
// integration branch silently loses protection until someone happens to push
// to it directly. This reads only config.yml (not the whole state tree) and
// tolerates "not active yet" the same way the full check does.
function assertConfiguredIntegrationRefCheap(ctx) {
  const source = resolveRef(ctx.run, ctx.repoRoot, ctx.integrationRef);
  if (!source) return;
  try {
    readAuthority(ctx.run, ctx.repoRoot, source);
  } catch (error) {
    if (timeoutError(error)) throw error;
    return;
  }
  const stateRevision = resolveRef(ctx.run, ctx.repoRoot, ctx.stateRef);
  if (!stateRevision) return;
  let config;
  try {
    config = parseYaml(ctx.run(['show', `${stateRevision}:${STATE_CONFIG_PATH}`], ctx.repoRoot));
  } catch (error) {
    if (timeoutError(error)) throw error;
    return;
  }
  const configured = integrationBranch(config);
  if (!configured || ctx.integrationRef !== `refs/heads/${configured}`) {
    throw new Error(`integration ref ${ctx.integrationRef} does not match confirmed state config`);
  }
}

function legacyRoots(config) {
  return [LEGACY_CONFIG_PATH, config.changes_dir, config.specs_dir, '.changeledger/releases']
    .filter((value) => typeof value === 'string' && value.length > 0)
    .map((value) =>
      path.posix.normalize(value.replaceAll('\\', '/')).replace(/^\.\//, '').toLowerCase(),
    );
}

function protectedPath(file, roots) {
  const folded = file.toLowerCase();
  return (
    folded === AUTHORITY_PATH.toLowerCase() ||
    roots.some((root) => folded === root || folded.startsWith(`${root}/`))
  );
}

function changedPaths(run, repoRoot, parent, commit) {
  const output = run(
    ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', parent, commit],
    repoRoot,
  );
  if (output && !output.endsWith('\0')) throw new Error('malformed changed-path framing');
  return output ? output.slice(0, -1).split('\0') : [];
}

function commitParents(run, repoRoot, commit) {
  const fields = run(['rev-list', '--parents', '-n', '1', commit], repoRoot).trim().split(/\s+/);
  if (fields[0] !== commit || fields.length < 2) {
    throw new Error(`integration commit ${commit} has no parent`);
  }
  return fields.slice(1);
}

// Root commits (the initial state baseline) have no parent and nothing prior
// to compare against; every other commit's parents are whatever `rev-list`
// reports, independent of whether they fall inside the validated range.
function commitParentsOrRoot(run, repoRoot, commit) {
  const fields = run(['rev-list', '--parents', '-n', '1', commit], repoRoot).trim().split(/\s+/);
  return fields.slice(1);
}

// One `rev-list --parents` call for the whole range instead of one per
// commit -- a batch of N commits would otherwise pay N subprocess spawns just
// to learn topology (dominant cost at scale: spawn overhead, not CPU).
function allCommitParents(run, repoRoot, range) {
  const output = run(['rev-list', '--reverse', '--parents', range], repoRoot).trim();
  const parents = new Map();
  if (!output) return parents;
  for (const line of output.split('\n')) {
    const fields = line.split(/\s+/);
    parents.set(fields[0], fields.slice(1));
  }
  return parents;
}

const DIFF_TREE_RECORD = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40,64}) ([0-9a-f]{40,64}) ([A-Z])$/;

// Every commit's raw delta against its first parent, for the whole range, in
// one `git log` call -- the incremental-eligible (single already-validated
// parent) case is exactly the common linear-history case this targets, so
// "against the first parent" is the delta that matters; merges never use
// this (see deriveIncrementalSnapshot) and pay their own diff there.
// `--format=%x00%H` wraps each commit hash in NUL on both sides, giving an
// unambiguous split: a token that is the empty string marks "next token is a
// new commit hash"; anything else is `:mode mode oldoid newoid status`
// (optionally prefixed with the newline git emits after the format string)
// immediately followed by its path token.
function logRawEntries(run, repoRoot, range) {
  const output = run(
    // --no-renames: git's own rename/copy detection is on by default for
    // `log --raw` and emits a two-path `R<score>`/`C<score>` record that
    // DIFF_TREE_RECORD's single-letter status doesn't match. Without it, a
    // renamed spec or release file (change filenames are id-locked and can't
    // rename) throws here even though the full closed-snapshot path -- which
    // reads the whole tree, rename-agnostic -- would accept the same commit.
    [
      'log',
      '--reverse',
      '--raw',
      '--no-renames',
      '--no-abbrev',
      '-r',
      '-z',
      '--format=%x00%H',
      range,
    ],
    repoRoot,
  );
  const byCommit = new Map();
  if (output === '') return byCommit;
  const tokens = output.split('\0');
  let i = 1; // tokens[0] is '' from the leading %x00 of the first commit
  while (i < tokens.length) {
    const hash = tokens[i];
    if (!hash) break;
    i++;
    const entries = [];
    while (i < tokens.length) {
      const token = tokens[i];
      if (token === '') {
        i++;
        break;
      }
      const header = token.startsWith('\n') ? token.slice(1) : token;
      const match = header.match(DIFF_TREE_RECORD);
      if (!match) throw new Error(`malformed log --raw record: ${token}`);
      i++;
      const filePath = tokens[i];
      if (filePath === undefined) throw new Error('malformed log --raw record: missing path');
      i++;
      entries.push({ path: filePath, status: match[5], newOid: match[4] });
    }
    byCommit.set(hash, entries);
  }
  return byCommit;
}

// Derives commit's snapshot from its already-validated single parent plus the
// blobs it actually changed, instead of re-materializing the whole tree --
// the parent's untouched documents are reused by reference (deriveCandidateSnapshot,
// shared with the client mutation path). `entries` and `blobCache` are
// precomputed once for the whole range (see validateStateRef), not per call.
// Returns null when the delta isn't safe to derive incrementally (touches the
// manifest, whose authority-anchored fields this path doesn't re-verify) so
// the caller falls back to a full, closed-snapshot validation instead of
// silently skipping those checks.
function deriveIncrementalSnapshot(repoRoot, run, parentSnapshot, commit, entries, blobCache) {
  for (const entry of entries) {
    if (!statePathIsValid(entry.path)) throw new Error(`invalid state path: ${entry.path}`);
  }
  if (entries.some((entry) => entry.path === MANIFEST)) return null;
  const writes = new Map();
  const removals = new Set();
  const toRead = [];
  for (const entry of entries) {
    if (entry.status === 'D') {
      removals.add(entry.path);
      continue;
    }
    removals.delete(entry.path);
    if (blobCache.has(entry.newOid)) writes.set(entry.path, blobCache.get(entry.newOid));
    else toRead.push(entry);
  }
  if (toRead.length) {
    // Defensive fallback only: every added/modified OID across the range is
    // already prefetched into blobCache before this runs (see
    // validateStateRef), so this should never actually spawn a subprocess.
    const readBlob = batchBlobReader(
      repoRoot,
      toRead.map((entry) => ({ type: 'blob', oid: entry.newOid })),
      run,
    );
    for (const entry of toRead) {
      const text = readBlob(entry.newOid);
      blobCache.set(entry.newOid, text);
      writes.set(entry.path, text);
    }
  }
  const candidate = deriveCandidateSnapshot(parentSnapshot, commit, writes, removals);
  validateSnapshotContent(candidate);
  return candidate;
}

function validateStateRef(ctx, update, authority) {
  const { run, repoRoot, length, budget, usage } = ctx;
  const zero = zeroOid(length);
  if (update.newOid === zero) throw new Error(`state ref ${update.ref} cannot be deleted`);
  assertCommit(run, repoRoot, update.newOid);
  const current = resolveRef(run, repoRoot, update.ref);
  if (update.oldOid === zero) {
    if (current) throw new Error(`protected ref mismatch for ${update.ref}: expected ${current}`);
    if (update.newOid !== authority.baseline) {
      throw new Error(`state ref creation must publish authority baseline ${authority.baseline}`);
    }
  } else {
    if (current !== update.oldOid) {
      throw new Error(`protected ref mismatch for ${update.ref}: expected ${current ?? 'absent'}`);
    }
    assertFastForward(run, repoRoot, update.oldOid, update.newOid);
  }
  const { commits, range } = commitsInRange(
    run,
    repoRoot,
    update.oldOid,
    update.newOid,
    budget,
    usage,
  );
  const objectBytes = countObjectBytes(run, repoRoot, range, budget, usage);
  // Computed once for the whole range (not per commit): topology and raw
  // per-blob deltas are the two things the old per-commit loop paid a fresh
  // subprocess spawn for on every iteration, which dominates at scale far
  // more than the actual (in-memory) validation work.
  const parentsByCommit = allCommitParents(run, repoRoot, range);
  const rawEntriesByCommit = logRawEntries(run, repoRoot, range);
  const blobCache = new Map();
  const allNewOids = new Set();
  for (const entries of rawEntriesByCommit.values()) {
    for (const entry of entries) {
      if (entry.status !== 'D') allNewOids.add(entry.newOid);
    }
  }
  if (allNewOids.size) {
    const readBlob = batchBlobReader(
      repoRoot,
      [...allNewOids].map((oid) => ({ type: 'blob', oid })),
      run,
    );
    for (const oid of allNewOids) blobCache.set(oid, readBlob(oid));
  }
  const commitParentsOf = (commit) =>
    parentsByCommit.get(commit) ?? commitParentsOrRoot(run, repoRoot, commit);
  const snapshotCache = new Map();
  const loadSnapshot = (commit) => {
    if (snapshotCache.has(commit)) return snapshotCache.get(commit);
    const parents = commitParentsOf(commit);
    let snapshot = null;
    // Only a single already-validated parent is eligible: a merge is
    // validated as a full closed snapshot (its content must reconcile
    // against every parent, not just be derived from one), and a parent
    // outside this batch was never computed here to derive from.
    if (parents.length === 1 && snapshotCache.has(parents[0])) {
      try {
        snapshot = deriveIncrementalSnapshot(
          repoRoot,
          run,
          snapshotCache.get(parents[0]),
          commit,
          rawEntriesByCommit.get(commit) ?? [],
          blobCache,
        );
      } catch (error) {
        throw new Error(`invalid state snapshot at ${commit}: ${error.message}`, { cause: error });
      }
    }
    if (!snapshot) {
      try {
        snapshot = validateServerStateRevision(repoRoot, authority, commit, run);
      } catch (error) {
        throw new Error(`invalid state snapshot at ${commit}: ${error.message}`, { cause: error });
      }
    }
    snapshotCache.set(commit, snapshot);
    return snapshot;
  };
  for (const commit of commits) {
    const snapshot = loadSnapshot(commit);
    const configured = integrationBranch(snapshot.config);
    if (!configured || ctx.integrationRef !== `refs/heads/${configured}`) {
      throw new Error(
        `state update changes integration_branch away from protected ref ${ctx.integrationRef}`,
      );
    }
    for (const parent of commitParentsOf(commit)) {
      assertNoDisappearance(loadSnapshot(parent), snapshot, commit);
    }
  }
  return { ...update, commits: commits.length, object_bytes: objectBytes };
}

function validateIntegrationRef(ctx, update) {
  const { run, repoRoot, length, budget, usage } = ctx;
  const zero = zeroOid(length);
  if (update.newOid === zero) {
    throw new Error(`deleting the protected integration ref ${update.ref} is forbidden`);
  }
  if (update.oldOid === zero) {
    throw new Error('integration protection is not active');
  }
  const current = resolveRef(run, repoRoot, update.ref);
  if (current !== update.oldOid) {
    throw new Error(`protected ref mismatch for ${update.ref}: expected ${current ?? 'absent'}`);
  }
  assertCommit(run, repoRoot, update.newOid);
  assertFastForward(run, repoRoot, update.oldOid, update.newOid);
  const active = readAuthority(run, repoRoot, update.oldOid);
  const roots = legacyRoots(
    readConfirmedConfig(run, repoRoot, active.authority, ctx.stateRef, update.ref),
  );
  const { commits, range } = commitsInRange(
    run,
    repoRoot,
    update.oldOid,
    update.newOid,
    budget,
    usage,
  );
  const objectBytes = countObjectBytes(run, repoRoot, range, budget, usage);
  for (const commit of commits) {
    for (const parent of commitParents(run, repoRoot, commit)) {
      for (const file of changedPaths(run, repoRoot, parent, commit)) {
        if (protectedPath(file, roots))
          throw new Error(`protected path changed at ${commit}: ${file}`);
      }
    }
    const next = readAuthority(run, repoRoot, commit);
    if (next.text !== active.text)
      throw new Error(`protected path changed at ${commit}: ${AUTHORITY_PATH}`);
  }
  return { ...update, commits: commits.length, object_bytes: objectBytes };
}

function validateWithContext(ctx, { oldOid, newOid, ref }) {
  const { run, repoRoot, length, stateRef, integrationRef } = ctx;
  assertOid(oldOid, length, 'old');
  assertOid(newOid, length, 'new');
  if (![stateRef, integrationRef].includes(ref)) throw new Error(`unexpected protected ref ${ref}`);
  const update = { ref, oldOid, newOid };
  if (ref === stateRef) {
    const source = resolveRef(run, repoRoot, integrationRef);
    if (!source) throw new Error('integration protection is not active');
    return validateStateRef(ctx, update, readAuthority(run, repoRoot, source).authority);
  }
  return validateIntegrationRef(ctx, update);
}

function validationContext(repoRoot, options) {
  const stateRef = options.stateRef ?? STATE_REF;
  const integrationRef = options.integrationRef;
  if (stateRef !== STATE_REF) throw new Error(`unsupported protected state ref ${stateRef}`);
  if (
    typeof integrationRef !== 'string' ||
    !integrationRef.startsWith('refs/heads/') ||
    integrationRef === stateRef
  ) {
    throw new Error('a distinct full integration ref is required');
  }
  const base = runner(path.resolve(repoRoot), options);
  return {
    ...base,
    repoRoot: path.resolve(repoRoot),
    length: objectFormat(base.run, repoRoot),
    stateRef,
    integrationRef,
  };
}

export function validateStateUpdate({
  repoRoot = process.cwd(),
  oldOid,
  newOid,
  ref,
  stateRef = STATE_REF,
  integrationRef,
  env,
  limits,
  now,
} = {}) {
  const ctx = validationContext(repoRoot, { stateRef, integrationRef, env, limits, now });
  let result;
  try {
    assertProtectedRefs(ctx, ref === stateRef && /^0+$/.test(oldOid) ? newOid : undefined);
    result = validateWithContext(ctx, { oldOid, newOid, ref });
  } catch (error) {
    const normalized = timeoutError(error) ?? error;
    normalized.receipt = {
      oldOid,
      newOid,
      protectedRef: ref,
      commits: ctx.usage.commits,
      object_bytes: ctx.usage.objectBytes,
    };
    throw normalized;
  }
  return { ok: true, ...result, network: false, written: false };
}

export function parseReceiveBatch(input, { oidLength }) {
  const value = String(input ?? '');
  if (!value) return [];
  if (!value.endsWith('\n')) {
    throw new Error(
      `invalid pre-receive input at line ${value.split('\n').length}: truncated line`,
    );
  }
  const updates = [];
  for (const [index, line] of value.slice(0, -1).split('\n').entries()) {
    if (line === '') throw new Error(`invalid pre-receive input at line ${index + 1}`);
    const match = line.match(/^([0-9a-f]+) ([0-9a-f]+) (refs\/[^\s\0]+)$/);
    if (!match) throw new Error(`invalid pre-receive input at line ${index + 1}`);
    const [, oldOid, newOid, ref] = match;
    try {
      assertOid(oldOid, oidLength, 'old');
      assertOid(newOid, oidLength, 'new');
    } catch (error) {
      throw new Error(`invalid pre-receive input at line ${index + 1}: ${error.message}`, {
        cause: error,
      });
    }
    updates.push({ oldOid, newOid, ref, line: index + 1 });
  }
  return updates;
}

export function validateReceiveBatch(input, options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const ctx = validationContext(repoRoot, options);
  let updates = [];
  let relevant = [];
  try {
    updates = parseReceiveBatch(input, { oidLength: ctx.length });
    const protectedRefs = new Set([ctx.stateRef, ctx.integrationRef]);
    relevant = updates.filter((update) => protectedRefs.has(update.ref));
    const creation = relevant.find(
      (update) => update.ref === ctx.stateRef && /^0+$/.test(update.oldOid),
    );
    if (relevant.length > 0) assertProtectedRefs(ctx, creation?.newOid);
    else assertConfiguredIntegrationRefCheap(ctx);
    const seen = new Set();
    for (const update of relevant) {
      if (seen.has(update.ref))
        throw new Error(`duplicate protected ref ${update.ref} at line ${update.line}`);
      seen.add(update.ref);
    }
    return relevant.map((update) => {
      const result = validateWithContext(ctx, update);
      return { ok: true, ...result, network: false, written: false };
    });
  } catch (error) {
    const normalized = timeoutError(error) ?? error;
    const update = relevant[0] ?? updates[0];
    normalized.receipt = {
      ...(normalized.receipt ?? {}),
      ...(update ? { oldOid: update.oldOid, newOid: update.newOid, protectedRef: update.ref } : {}),
      commits: ctx.usage.commits,
      object_bytes: ctx.usage.objectBytes,
    };
    throw normalized;
  }
}
