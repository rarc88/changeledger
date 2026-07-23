import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from './atomic-write.mjs';
import { sanitizedGitEnv } from './git.mjs';
import { planReplicaSync } from './state-replica.mjs';

export const PUBLIC_STATE_REF = 'refs/heads/changeledger/state';
export const CONFIRMED_REF = 'refs/changeledger/confirmed';
export const OBSERVED_REF = 'refs/changeledger/observed';
export const PENDING_REF = 'refs/changeledger/pending';
const NETWORK_TIMEOUT_MS = 30_000;

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

function resolveRef(repoRoot, ref) {
  try {
    return git(repoRoot, ['rev-parse', '--verify', ref]);
  } catch {
    return null;
  }
}

function observationFile(repoRoot) {
  const gitPath = git(repoRoot, [
    'rev-parse',
    '--path-format=absolute',
    '--git-path',
    'changeledger/observed.json',
  ]);
  return path.resolve(repoRoot, gitPath);
}

function readObservation(repoRoot, observed) {
  if (!observed) return null;
  try {
    const value = JSON.parse(fs.readFileSync(observationFile(repoRoot), 'utf8'));
    return value?.oid === observed && typeof value?.at === 'string' ? value.at : null;
  } catch {
    return null;
  }
}

function writeObservation(repoRoot, observed, at) {
  const file = observationFile(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileAtomic(file, `${JSON.stringify({ oid: observed, at })}\n`);
}

export function readStateReplica(repoRoot) {
  const confirmed = resolveRef(repoRoot, CONFIRMED_REF);
  const observed = resolveRef(repoRoot, OBSERVED_REF);
  const pending = resolveRef(repoRoot, PENDING_REF);
  return {
    confirmed,
    observed,
    pending,
    effective: pending ?? confirmed,
    observedAt: readObservation(repoRoot, observed),
  };
}

function transaction(repoRoot, operations) {
  const lines = ['start'];
  for (const { ref, before, after } of operations) {
    if (before === after) {
      lines.push(before ? `verify ${ref} ${before}` : `verify ${ref}`);
      continue;
    }
    if (!before && after) lines.push(`create ${ref} ${after}`);
    else if (before && !after) lines.push(`delete ${ref} ${before}`);
    else lines.push(`update ${ref} ${after} ${before}`);
  }
  lines.push('prepare', 'commit', '');
  try {
    git(repoRoot, ['update-ref', '--stdin'], { input: lines.join('\n') });
  } catch (error) {
    if (/cannot lock ref/i.test(error.message)) {
      throw new Error('confirmed state changed concurrently; retry the operation', {
        cause: error,
      });
    }
    throw error;
  }
}

function isFilesystemError(error) {
  const code = error?.code ?? error?.cause?.code;
  if (code === 'EACCES' || code === 'ENOSPC') return true;
  return /ENOSPC|no space left on device|EACCES|permission denied/i.test(error?.message ?? '');
}

// `git()` (this file's own wrapper, see gitOutput) always sets `.cause` to the
// raw execFileSync failure it caught, which carries `.status`/`.signal`/`.code`.
// A plain `throw new Error(...)` from inside replayPending itself (invalid
// tree entry, candidate validation) never sets those -- so their absence is
// what distinguishes an actual Git process failure (infrastructure) from a
// genuine path/content conflict produced by replayPending's own logic.
function isGitProcessError(error) {
  // Walk the full cause chain: validators rewrap git failures in plain Errors
  // (sometimes more than once), so a single-level check would mislabel an
  // infrastructure failure as a semantic replica conflict.
  for (let cause = error?.cause; cause && typeof cause === 'object'; cause = cause.cause) {
    if (typeof cause.status === 'number' || typeof cause.signal === 'string' || 'code' in cause)
      return true;
  }
  return false;
}

export function createStatePending(repoRoot, confirmed, head) {
  const refs = readStateReplica(repoRoot);
  if (refs.pending) {
    throw new Error('resolve the existing pending state before mutating again');
  }
  if (!confirmed || refs.confirmed !== confirmed) {
    throw new Error('confirmed state changed concurrently; retry the operation');
  }
  const parent = resolveRef(repoRoot, `${head}^`);
  if (parent !== confirmed) throw new Error('pending state must directly descend from confirmed');
  transaction(repoRoot, [
    { ref: CONFIRMED_REF, before: confirmed, after: confirmed },
    { ref: PENDING_REF, before: null, after: head },
  ]);
  return readStateReplica(repoRoot);
}

export function keepStateReplicaRevision(repoRoot, confirmed) {
  const refs = readStateReplica(repoRoot);
  if (refs.pending) {
    throw new Error('resolve the existing pending state before mutating again');
  }
  if (!confirmed || refs.confirmed !== confirmed) {
    throw new Error('confirmed state changed concurrently; retry the operation');
  }
  transaction(repoRoot, [
    { ref: CONFIRMED_REF, before: confirmed, after: confirmed },
    { ref: PENDING_REF, before: null, after: null },
  ]);
  return readStateReplica(repoRoot);
}

function isAncestor(repoRoot, ancestor, descendant) {
  try {
    git(repoRoot, ['merge-base', '--is-ancestor', ancestor, descendant]);
    return true;
  } catch (error) {
    if (error.cause?.status === 1) return false;
    throw error;
  }
}

function pendingState(repoRoot, refs) {
  if (!refs.pending) return null;
  const base = resolveRef(repoRoot, `${refs.pending}^`);
  return {
    head: refs.pending,
    base,
    paths: base ? changedPaths(repoRoot, base, refs.pending) : [],
  };
}

function changedPaths(repoRoot, before, after) {
  const output = gitOutput(repoRoot, [
    'diff-tree',
    '-r',
    '-z',
    '--name-only',
    before,
    after,
    '--',
    '.changeledger-state',
  ]);
  if (output === '') return [];
  if (!output.endsWith('\0')) throw new Error('Git returned malformed path framing');
  return output.slice(0, -1).split('\0').sort();
}

function replayPending(repoRoot, pending, observed, validateRevision) {
  const replicaDir = path.dirname(observationFile(repoRoot));
  fs.mkdirSync(replicaDir, { recursive: true });
  const indexDir = fs.mkdtempSync(path.join(replicaDir, 'replay-'));
  const indexFile = path.join(indexDir, 'index');
  const env = { GIT_INDEX_FILE: indexFile };
  try {
    git(repoRoot, ['read-tree', observed], { env });
    for (const file of pending.paths) {
      const entry = gitOutput(repoRoot, ['ls-tree', '-z', pending.head, '--', `:(literal)${file}`]);
      if (entry === '') {
        git(repoRoot, ['update-index', '--force-remove', '--', file], { env });
        continue;
      }
      const match = entry.match(/^([0-7]+) blob ([0-9a-f]{40,64})\t([\s\S]+)\0$/);
      if (!match || match[3] !== file) throw new Error(`invalid Git tree entry for ${file}`);
      git(repoRoot, ['update-index', '--add', '--cacheinfo', `${match[1]},${match[2]},${file}`], {
        env,
      });
    }
    const tree = git(repoRoot, ['write-tree'], { env });
    validateRevision(tree);
    const message = gitOutput(repoRoot, ['show', '-s', '--format=%B', pending.head]).trimEnd();
    const replayMessage = `${message}\n\nReplica-Replayed-From: ${pending.head}`;
    const head = git(repoRoot, ['commit-tree', tree, '-p', observed, '-m', replayMessage], { env });
    return { head, tree };
  } finally {
    fs.rmSync(indexDir, { recursive: true, force: true });
  }
}

export function stateRemote(repoRoot, { required = true } = {}) {
  const configuredValues = (() => {
    try {
      const output = gitOutput(repoRoot, ['config', '--null', '--get-all', 'changeledger.remote']);
      return output.endsWith('\0') ? output.slice(0, -1).split('\0') : [];
    } catch {
      return [];
    }
  })();
  const distinct = [...new Set(configuredValues)];
  if (distinct.length > 1) {
    if (!required) return null;
    throw new Error(`ambiguous changeledger.remote configuration: ${distinct.join(', ')}`);
  }
  if (distinct.length === 1 && distinct[0] === '') {
    if (!required) return null;
    throw new Error('changeledger.remote is configured with an empty value');
  }
  const remote = distinct[0] || 'origin';
  try {
    git(repoRoot, ['remote', 'get-url', remote]);
  } catch {
    if (!required) return null;
    throw new Error(`state sync requires configured remote "${remote}"`);
  }
  return remote;
}

function recordObserved(repoRoot, before, observed, at) {
  transaction(repoRoot, [
    { ref: OBSERVED_REF, before: before.observed, after: observed },
    { ref: CONFIRMED_REF, before: before.confirmed, after: before.confirmed },
    { ref: PENDING_REF, before: before.pending, after: before.pending },
  ]);
  writeObservation(repoRoot, observed, at);
}

export function syncStateReplica(
  repoRoot,
  {
    now = () => new Date().toISOString(),
    validateRevision = () => {},
    validateCandidate = validateRevision,
    pushState = (root, remote, refspec) =>
      git(root, ['push', remote, refspec], { timeout: NETWORK_TIMEOUT_MS }),
  } = {},
) {
  const remote = stateRemote(repoRoot);
  const before = readStateReplica(repoRoot);
  git(repoRoot, ['fetch', '--no-tags', remote, PUBLIC_STATE_REF], {
    timeout: NETWORK_TIMEOUT_MS,
  });
  const fetched = resolveRef(repoRoot, 'FETCH_HEAD');
  if (!fetched) throw new Error(`remote "${remote}" has no ${PUBLIC_STATE_REF}`);
  const at = now();
  validateRevision(fetched);
  if (before.pending) {
    try {
      validateRevision(before.pending);
    } catch (error) {
      recordObserved(repoRoot, before, fetched, at);
      throw new Error(`invalid pending state ${before.pending}: ${error.message}`, {
        cause: error,
      });
    }
  }

  const pending = pendingState(repoRoot, before);
  const observedPaths = pending?.base ? changedPaths(repoRoot, pending.base, fetched) : [];
  const plan = planReplicaSync(
    { confirmed: before.confirmed, observed: fetched, pending, observedPaths },
    { isAncestor: (ancestor, descendant) => isAncestor(repoRoot, ancestor, descendant) },
  );
  if (['adopt-observed', 'advance-confirmed', 'current'].includes(plan.action)) {
    transaction(repoRoot, [
      { ref: OBSERVED_REF, before: before.observed, after: fetched },
      { ref: CONFIRMED_REF, before: before.confirmed, after: fetched },
      { ref: PENDING_REF, before: null, after: null },
    ]);
    writeObservation(repoRoot, fetched, at);
    return { ...plan, effective: fetched, confirmed: true, pending: false, remote };
  }

  if (plan.action === 'publish-pending') {
    try {
      pushState(repoRoot, remote, `${before.pending}:${PUBLIC_STATE_REF}`);
    } catch (error) {
      recordObserved(repoRoot, before, fetched, at);
      return {
        ...plan,
        effective: before.pending,
        confirmed: false,
        pending: true,
        remote,
        error: error.message,
      };
    }
    transaction(repoRoot, [
      { ref: OBSERVED_REF, before: before.observed, after: before.pending },
      { ref: CONFIRMED_REF, before: before.confirmed, after: before.pending },
      { ref: PENDING_REF, before: before.pending, after: null },
    ]);
    writeObservation(repoRoot, before.pending, at);
    return {
      ...plan,
      effective: before.pending,
      confirmed: true,
      pending: false,
      remote,
    };
  }

  if (plan.action === 'confirm-observed') {
    transaction(repoRoot, [
      { ref: OBSERVED_REF, before: before.observed, after: fetched },
      { ref: CONFIRMED_REF, before: before.confirmed, after: fetched },
      { ref: PENDING_REF, before: before.pending, after: null },
    ]);
    writeObservation(repoRoot, fetched, at);
    return { ...plan, effective: fetched, confirmed: true, pending: false, remote };
  }

  if (plan.action === 'replay-pending') {
    let replay;
    try {
      replay = replayPending(repoRoot, pending, fetched, validateCandidate);
    } catch (error) {
      recordObserved(repoRoot, before, fetched, at);
      if (isFilesystemError(error)) {
        throw new Error(`state replica replay failed: ${error.message}`, { cause: error });
      }
      if (isGitProcessError(error)) {
        throw new Error(`state replica replay failed: git command failed: ${error.message}`, {
          cause: error,
        });
      }
      throw new Error(
        `state replica conflict: base=${pending.base}; observed=${fetched}; pending_paths=${JSON.stringify(pending.paths)}; observed_paths=${JSON.stringify(observedPaths)}; cause=${error.message}`,
        { cause: error },
      );
    }
    transaction(repoRoot, [
      { ref: OBSERVED_REF, before: before.observed, after: fetched },
      { ref: CONFIRMED_REF, before: before.confirmed, after: fetched },
      { ref: PENDING_REF, before: before.pending, after: replay.head },
    ]);
    writeObservation(repoRoot, fetched, at);
    try {
      pushState(repoRoot, remote, `${replay.head}:${PUBLIC_STATE_REF}`);
    } catch (error) {
      return {
        ...plan,
        effective: replay.head,
        confirmed: false,
        pending: true,
        remote,
        replayedFrom: before.pending,
        error: error.message,
      };
    }
    transaction(repoRoot, [
      { ref: OBSERVED_REF, before: fetched, after: replay.head },
      { ref: CONFIRMED_REF, before: fetched, after: replay.head },
      { ref: PENDING_REF, before: replay.head, after: null },
    ]);
    writeObservation(repoRoot, replay.head, at);
    return {
      ...plan,
      effective: replay.head,
      confirmed: true,
      pending: false,
      remote,
      replayedFrom: before.pending,
    };
  }

  recordObserved(repoRoot, before, fetched, at);
  if (plan.action === 'reject-remote-rewrite') {
    try {
      validateRevision(before.confirmed);
    } catch (error) {
      throw new Error(
        `state replica corrupt: confirmed ${before.confirmed} fails its own snapshot validation and is the corrupt side, not remote ${fetched}: ${error.message}`,
        { cause: error },
      );
    }
    throw new Error(`remote state ${fetched} does not descend from confirmed ${before.confirmed}`);
  }
  if (plan.action === 'conflict') {
    const overlap = pending.paths.filter((file) => observedPaths.includes(file));
    throw new Error(
      `state replica conflict: base=${pending.base}; observed=${fetched}; pending_paths=${JSON.stringify(pending.paths)}; observed_paths=${JSON.stringify(observedPaths)}; overlap=${JSON.stringify(overlap)}`,
    );
  }
  if (plan.action === 'invalid-local-state') {
    throw new Error(
      `state sync cannot continue: invalid-local-state: confirmed=${before.confirmed}; pending_head=${pending?.head}; pending_base=${pending?.base}`,
    );
  }
  throw new Error(`state sync cannot continue: ${plan.action}`);
}

export function stateReplicaStatus(repoRoot) {
  const remote = stateRemote(repoRoot, { required: false });
  const refs = readStateReplica(repoRoot);
  let condition = 'unknown';
  if (refs.pending) {
    const pending = pendingState(repoRoot, refs);
    if (!pending.base || pending.base !== refs.confirmed) {
      condition = 'conflict';
    } else if (refs.observed && refs.observed !== pending.base) {
      // A remote that already carries `pending.head` (or descends from it) has
      // already published this exact pending state -- `syncStateReplica`
      // resolves that as the benign `confirm-observed` action. Short-circuit
      // to `pending` before the base..observed overlap check below, which
      // would otherwise see the pending's own paths reflected in observed and
      // misreport a real conflict.
      if (isAncestor(repoRoot, pending.head, refs.observed)) {
        condition = 'pending';
      } else {
        const observedPaths = changedPaths(repoRoot, pending.base, refs.observed);
        const overlaps = pending.paths.some((file) => observedPaths.includes(file));
        condition =
          overlaps || !isAncestor(repoRoot, pending.base, refs.observed) ? 'conflict' : 'pending';
      }
    } else {
      condition = 'pending';
    }
  } else if (refs.confirmed && refs.observed) {
    if (refs.confirmed === refs.observed) condition = refs.observedAt ? 'fresh' : 'unknown';
    else if (isAncestor(repoRoot, refs.confirmed, refs.observed)) {
      condition = refs.observedAt ? 'stale' : 'unknown';
    } else condition = 'conflict';
  }
  return { ...refs, remote, condition };
}

export function abortStatePending(
  repoRoot,
  {
    offline = false,
    now = () => new Date().toISOString(),
    validateRevision = () => {},
    isAncestor: resolveAncestry = isAncestor,
  } = {},
) {
  const before = readStateReplica(repoRoot);
  if (!before.pending) throw new Error('there is no pending state to abort');
  if (offline) {
    transaction(repoRoot, [
      { ref: CONFIRMED_REF, before: before.confirmed, after: before.confirmed },
      { ref: OBSERVED_REF, before: before.observed, after: before.observed },
      { ref: PENDING_REF, before: before.pending, after: null },
    ]);
    return {
      aborted: true,
      confirmed: false,
      offline: true,
      effective: before.confirmed,
      stale: stateReplicaStatus(repoRoot).condition === 'stale',
    };
  }

  const remote = stateRemote(repoRoot);
  let fetched;
  try {
    git(repoRoot, ['fetch', '--no-tags', remote, PUBLIC_STATE_REF], {
      timeout: NETWORK_TIMEOUT_MS,
    });
    fetched = resolveRef(repoRoot, 'FETCH_HEAD');
    if (!fetched) throw new Error(`remote "${remote}" has no ${PUBLIC_STATE_REF}`);
    validateRevision(fetched);
  } catch (error) {
    throw new Error(
      `cannot verify whether pending reached the remote; retry or use --offline to discard only the local ref: ${error.message}`,
      { cause: error },
    );
  }

  const published = resolveAncestry(repoRoot, before.pending, fetched);
  transaction(repoRoot, [
    { ref: CONFIRMED_REF, before: before.confirmed, after: published ? fetched : before.confirmed },
    { ref: OBSERVED_REF, before: before.observed, after: fetched },
    { ref: PENDING_REF, before: before.pending, after: null },
  ]);
  writeObservation(repoRoot, fetched, now());
  return {
    aborted: !published,
    confirmed: published,
    offline: false,
    effective: published ? fetched : before.confirmed,
    remote,
    stale: stateReplicaStatus(repoRoot).condition === 'stale',
  };
}
