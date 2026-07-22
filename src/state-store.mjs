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
const FETCHED_REF = 'refs/changeledger/fetched';

function gitOutput(repoRoot, args, { input, env } = {}) {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      env: sanitizedGitEnv(env),
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
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
  git(repoRoot, ['update-ref', '--stdin'], { input: lines.join('\n') });
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

function isAncestor(repoRoot, ancestor, descendant) {
  try {
    git(repoRoot, ['merge-base', '--is-ancestor', ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

function pendingState(repoRoot, refs) {
  if (!refs.pending) return null;
  const base = resolveRef(repoRoot, `${refs.pending}^`);
  return { head: refs.pending, base, paths: changedPaths(repoRoot, base, refs.pending) };
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
      const entry = gitOutput(repoRoot, ['ls-tree', '-z', pending.head, '--', file]);
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

function remoteName(repoRoot) {
  const configured = (() => {
    try {
      return git(repoRoot, ['config', '--get', 'changeledger.remote']);
    } catch {
      return '';
    }
  })();
  const remote = configured || 'origin';
  try {
    git(repoRoot, ['remote', 'get-url', remote]);
  } catch {
    throw new Error(`state sync requires configured remote "${remote}"`);
  }
  return remote;
}

function recordObserved(repoRoot, before, observed, at) {
  transaction(repoRoot, [{ ref: OBSERVED_REF, before, after: observed }]);
  writeObservation(repoRoot, observed, at);
}

export function syncStateReplica(
  repoRoot,
  { now = () => new Date().toISOString(), validateRevision = () => {} } = {},
) {
  const remote = remoteName(repoRoot);
  const before = readStateReplica(repoRoot);
  git(repoRoot, ['fetch', '--no-tags', remote, `+${PUBLIC_STATE_REF}:${FETCHED_REF}`]);
  const fetched = resolveRef(repoRoot, FETCHED_REF);
  if (!fetched) throw new Error(`remote "${remote}" has no ${PUBLIC_STATE_REF}`);
  validateRevision(fetched);

  const pending = pendingState(repoRoot, before);
  const observedPaths = pending ? changedPaths(repoRoot, pending.base, fetched) : [];
  const plan = planReplicaSync(
    { confirmed: before.confirmed, observed: fetched, pending, observedPaths },
    { isAncestor: (ancestor, descendant) => isAncestor(repoRoot, ancestor, descendant) },
  );
  const at = now();

  if (['adopt-observed', 'advance-confirmed', 'current'].includes(plan.action)) {
    transaction(repoRoot, [
      { ref: OBSERVED_REF, before: before.observed, after: fetched },
      { ref: CONFIRMED_REF, before: before.confirmed, after: fetched },
    ]);
    writeObservation(repoRoot, fetched, at);
    return { ...plan, effective: fetched, confirmed: true, pending: false, remote };
  }

  if (plan.action === 'publish-pending') {
    try {
      git(repoRoot, ['push', remote, `${PENDING_REF}:${PUBLIC_STATE_REF}`]);
    } catch (error) {
      recordObserved(repoRoot, before.observed, fetched, at);
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
      replay = replayPending(repoRoot, pending, fetched, validateRevision);
    } catch (error) {
      recordObserved(repoRoot, before.observed, fetched, at);
      throw error;
    }
    transaction(repoRoot, [
      { ref: OBSERVED_REF, before: before.observed, after: fetched },
      { ref: CONFIRMED_REF, before: before.confirmed, after: fetched },
      { ref: PENDING_REF, before: before.pending, after: replay.head },
    ]);
    writeObservation(repoRoot, fetched, at);
    try {
      git(repoRoot, ['push', remote, `${PENDING_REF}:${PUBLIC_STATE_REF}`]);
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

  recordObserved(repoRoot, before.observed, fetched, at);
  if (plan.action === 'reject-remote-rewrite') {
    throw new Error(`remote state ${fetched} does not descend from confirmed ${before.confirmed}`);
  }
  if (plan.action === 'conflict') {
    const overlap = pending.paths.filter((file) => observedPaths.includes(file));
    throw new Error(`state replica conflict on paths: ${overlap.join(', ')}`);
  }
  throw new Error(`state sync cannot continue: ${plan.action}`);
}
