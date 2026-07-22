import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { integrationBranch } from './config.mjs';
import { sanitizedGitEnv } from './git.mjs';
import { parseStateAuthority, STATE_REF, validateServerStateRevision } from './ledger-store.mjs';

export const DEFAULT_STATE_LIMITS = Object.freeze({
  max_commits: 256,
  max_object_bytes: 64 * 1024 * 1024,
  timeout_ms: 30_000,
});

const AUTHORITY_PATH = '.changeledger/authority.yml';
const LEGACY_CONFIG_PATH = '.changeledger/config.yml';

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
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)
    .join('\n');
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
  const run = (args, cwd = repoRoot, { input } = {}) => {
    const remaining = Math.ceil(budget.timeout_ms - (now() - started));
    if (remaining <= 0)
      throw new ValidationTimeoutError(`validation timeout ${budget.timeout_ms}ms exceeded`);
    try {
      return execFileSync('git', args, {
        cwd,
        env,
        input,
        timeout: remaining,
        encoding: 'utf8',
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
  return { run, budget, now, started };
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
    return run(['rev-parse', '--verify', ref], repoRoot).trim();
  } catch (error) {
    const timeout = timeoutError(error);
    if (timeout) throw timeout;
    return null;
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

function commitsInRange(run, repoRoot, oldOid, newOid, maxCommits) {
  const range = /^0+$/.test(oldOid) ? newOid : `${oldOid}..${newOid}`;
  const commits = run(['rev-list', '--reverse', `--max-count=${maxCommits + 1}`, range], repoRoot)
    .trim()
    .split('\n')
    .filter(Boolean);
  if (commits.length > maxCommits) throw new Error(`commit limit ${maxCommits} exceeded`);
  return { commits, range };
}

function countObjectBytes(run, repoRoot, range, maxBytes) {
  const objects = [
    ...new Set(
      run(['rev-list', '--objects', '--no-object-names', range], repoRoot)
        .trim()
        .split('\n')
        .filter(Boolean),
    ),
  ];
  if (!objects.length) return 0;
  const output = run(['cat-file', '--batch-check=%(objectname) %(objectsize)'], repoRoot, {
    input: `${objects.join('\n')}\n`,
  });
  let bytes = 0;
  for (const line of output.trim().split('\n')) {
    const match = line.match(/^[0-9a-f]+ (\d+)$/);
    if (!match) throw new Error(`invalid object metadata: ${line}`);
    bytes += Number(match[1]);
    if (bytes > maxBytes) throw new Error(`object byte limit ${maxBytes} exceeded`);
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

function readConfirmedConfig(run, repoRoot, authority, stateRef, integrationRef) {
  const stateRevision = resolveRef(run, repoRoot, stateRef);
  if (!stateRevision) throw new Error(`protected state ref ${stateRef} is unavailable`);
  const snapshot = validateServerStateRevision(repoRoot, authority, stateRevision, run);
  const configured = integrationBranch(snapshot.config);
  if (!configured || integrationRef !== `refs/heads/${configured}`) {
    throw new Error(`integration ref ${integrationRef} does not match confirmed state config`);
  }
  return snapshot.config;
}

function legacyRoots(config) {
  return [
    LEGACY_CONFIG_PATH,
    config.changes_dir,
    config.specs_dir,
    '.changeledger/releases',
  ].filter((value) => typeof value === 'string' && value.length > 0);
}

function protectedPath(file, roots) {
  return (
    file === AUTHORITY_PATH || roots.some((root) => file === root || file.startsWith(`${root}/`))
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

function validateStateRef(ctx, update, authority) {
  const { run, repoRoot, length, budget } = ctx;
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
    budget.max_commits,
  );
  const objectBytes = countObjectBytes(run, repoRoot, range, budget.max_object_bytes);
  for (const commit of commits) {
    try {
      validateServerStateRevision(repoRoot, authority, commit, run);
    } catch (error) {
      throw new Error(`invalid state snapshot at ${commit}: ${error.message}`, { cause: error });
    }
  }
  return { ...update, commits: commits.length, object_bytes: objectBytes };
}

function validateIntegrationRef(ctx, update) {
  const { run, repoRoot, length, budget } = ctx;
  const zero = zeroOid(length);
  if (update.oldOid === zero || update.newOid === zero) {
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
    budget.max_commits,
  );
  const objectBytes = countObjectBytes(run, repoRoot, range, budget.max_object_bytes);
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
    result = validateWithContext(ctx, { oldOid, newOid, ref });
  } catch (error) {
    const normalized = timeoutError(error) ?? error;
    normalized.receipt = { oldOid, newOid, protectedRef: ref };
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
    assertOid(oldOid, oidLength, 'old');
    assertOid(newOid, oidLength, 'new');
    updates.push({ oldOid, newOid, ref, line: index + 1 });
  }
  return updates;
}

export function validateReceiveBatch(input, options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const ctx = validationContext(repoRoot, options);
  const updates = parseReceiveBatch(input, { oidLength: ctx.length });
  const protectedRefs = new Set([ctx.stateRef, ctx.integrationRef]);
  const relevant = updates.filter((update) => protectedRefs.has(update.ref));
  const seen = new Set();
  for (const update of relevant) {
    if (seen.has(update.ref))
      throw new Error(`duplicate protected ref ${update.ref} at line ${update.line}`);
    seen.add(update.ref);
  }
  return relevant.map((update) => {
    try {
      const result = validateWithContext(ctx, update);
      return { ok: true, ...result, network: false, written: false };
    } catch (error) {
      const normalized = timeoutError(error) ?? error;
      normalized.receipt = {
        oldOid: update.oldOid,
        newOid: update.newOid,
        protectedRef: update.ref,
      };
      throw normalized;
    }
  });
}
