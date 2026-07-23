// One immutable ledger snapshot per command. Legacy repositories read their
// worktree; activated repositories read only the committed state tree.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseChange } from './change.mjs';
import { checkRepo } from './check.mjs';
import { findChangeledgerDir, loadConfig, resolveRepoPath, resolveSpecsDir } from './config.mjs';
import { assertSupportedSchema } from './config-migration.mjs';
import { VERSION } from './framing.mjs';
import { defaultRun, sanitizedGitEnv } from './git.mjs';
import { assertRegularBlobEntry, batchBlobReader, treeEntries } from './git-batch.mjs';
import { compareVersions, DEFAULT_RELEASES_DIR } from './release.mjs';
import { parseSpec } from './spec.mjs';
import {
  abortStatePending,
  CONFIRMED_REF,
  createStatePending,
  keepStateReplicaRevision,
  OBSERVED_REF,
  PENDING_REF,
  stateReplicaStatus,
  syncStateReplica,
} from './state-store.mjs';
import { parseYaml } from './yaml.mjs';

export const STATE_REF = 'refs/heads/changeledger/state';
const STATE_ROOT = '.changeledger-state';
export const MANIFEST = `${STATE_ROOT}/manifest.yml`;
export const CONFIG = `${STATE_ROOT}/config.yml`;
const STATE_COLLECTION_EXTENSIONS = new Map([
  ['changes', '.md'],
  ['specs', '.md'],
  ['releases', '.yml'],
]);
const EXACT_COMMIT_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const SHA256_DIGEST = /^[0-9a-f]{64}$/;

export class LedgerConflictError extends Error {
  constructor(message = 'Ledger state changed concurrently; reload before saving', options) {
    super(message, options);
    this.name = 'LedgerConflictError';
  }
}

export function ledgerReceipt(snapshot) {
  return Object.freeze({
    ledger_revision: snapshot?.revision ?? null,
    ledger_freshness: snapshot?.revision ? (snapshot.ledgerFreshness ?? 'local') : null,
    ...(snapshot?.revision
      ? {
          ledger_confirmation: snapshot.ledgerConfirmation ?? 'local',
          ledger_observed_at: snapshot.ledgerObservedAt ?? null,
        }
      : {}),
  });
}

export function formatLedgerReceipt(receipt) {
  if (!receipt?.ledger_revision) return null;
  const provenance =
    receipt.project_id != null || receipt.repository_path != null
      ? ` (project: ${receipt.project_id ?? 'unknown'}) (repo: ${receipt.repository_path ?? 'unknown'})`
      : '';
  return `Ledger revision: ${receipt.ledger_revision} (freshness: ${receipt.ledger_freshness}) (confirmation: ${receipt.ledger_confirmation}) (observed at: ${receipt.ledger_observed_at ?? 'unknown'})${provenance}`;
}

// The CLI's own repo/project attribution for a receipt — always derived from
// the invocation's own `cwd`, never from another surface's selection (CR3).
// Cheap (no git subprocess, no state-tree read) so it stays safe to call even
// while building a failure receipt (CR2): on any resolution problem,
// `project_id` degrades to null but `repository_path` still names the
// directory the command actually ran against.
export function repoProvenance(cwd = process.cwd()) {
  const changeledgerDir = findChangeledgerDir(cwd);
  const repository_path = changeledgerDir ? path.dirname(changeledgerDir) : path.resolve(cwd);
  let project_id = null;
  try {
    if (changeledgerDir) {
      const authority = authorityFor(changeledgerDir);
      project_id = authority?.project_id ?? loadConfig(changeledgerDir).project_id ?? null;
    }
  } catch {
    project_id = null;
  }
  return Object.freeze({ project_id, repository_path });
}

export function assertLedgerRevision(snapshot, observedRevision) {
  if (snapshot?.mode !== 'state') return null;
  if (
    typeof observedRevision !== 'string' ||
    observedRevision === '' ||
    observedRevision !== snapshot.revision
  ) {
    throw new LedgerConflictError();
  }
  return snapshot.revision;
}

function listWorktreeFiles(dir, extension) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(extension))
    .sort();
}

function loadWorktreeSnapshot(repoRoot, changeledgerDir) {
  const configFile = path.join(changeledgerDir, 'config.yml');
  const config = loadConfig(changeledgerDir);
  const changesDir = resolveRepoPath(repoRoot, config.changes_dir, 'changes_dir');
  const changes = listWorktreeFiles(changesDir, '.md').map((name) => {
    const file = path.join(changesDir, name);
    const text = fs.readFileSync(file, 'utf8');
    return { file, name, text, ...parseChange(text) };
  });
  changes.sort((a, b) => String(a.frontmatter.id).localeCompare(String(b.frontmatter.id)));

  const specsDir = resolveSpecsDir(repoRoot, config);
  const specs = listWorktreeFiles(specsDir, '.md').map((name) => {
    const file = path.join(specsDir, name);
    return { file, name, ...parseSpec(fs.readFileSync(file, 'utf8')) };
  });
  const releasesDir = resolveRepoPath(repoRoot, DEFAULT_RELEASES_DIR, 'releases_dir');
  const releases = listWorktreeFiles(releasesDir, '.yml').map((name) => {
    const file = path.join(releasesDir, name);
    return { file, name, ...parseYaml(fs.readFileSync(file, 'utf8')) };
  });

  return {
    mode: 'worktree',
    revision: null,
    manifest: null,
    repoRoot,
    changeledgerDir,
    configFile,
    configText: fs.readFileSync(configFile, 'utf8'),
    config,
    changes,
    specs,
    releases,
  };
}

export function parseStateAuthority(text) {
  let authority;
  try {
    authority = parseYaml(text);
  } catch (error) {
    throw new Error(`Invalid state authority: ${error.message}`);
  }
  if (!authority || typeof authority !== 'object') throw new Error('Invalid state authority');
  if (![1, 2].includes(authority.format_version)) {
    throw new Error('Unsupported state authority format_version');
  }
  if (authority.state_ref !== STATE_REF)
    throw new Error(`Unsupported state authority ref: ${authority.state_ref}`);
  if (typeof authority.baseline !== 'string' || authority.baseline === '') {
    throw new Error('Invalid state authority baseline');
  }
  if (!EXACT_COMMIT_OID.test(authority.baseline)) {
    throw new Error('Invalid state authority: baseline must be an exact commit OID');
  }
  if (typeof authority.project_id !== 'string' || authority.project_id === '') {
    throw new Error('Invalid state authority project_id');
  }
  if (authority.format_version === 2) {
    if (!SHA256_DIGEST.test(authority.inventory_digest ?? '')) {
      throw new Error('Invalid state authority inventory_digest');
    }
    if (
      typeof authority.minimum_client_version !== 'string' ||
      authority.minimum_client_version === ''
    ) {
      throw new Error('Invalid state authority minimum_client_version');
    }
    try {
      if (compareVersions(VERSION, authority.minimum_client_version) < 0) {
        throw new Error(`state authority requires client >= ${authority.minimum_client_version}`);
      }
    } catch (error) {
      if (/requires client/.test(error.message)) throw error;
      throw new Error('Invalid state authority minimum_client_version', { cause: error });
    }
  }
  return authority;
}

function authorityFor(changeledgerDir) {
  const file = path.join(changeledgerDir, 'authority.yml');
  if (!fs.existsSync(file)) return null;
  return parseStateAuthority(fs.readFileSync(file, 'utf8'));
}

function gitStateRevision(repoRoot, authority, run) {
  let revision;
  let baseline;
  let baselineType;
  try {
    if (authority.format_version === 2) {
      let confirmed;
      let pending;
      try {
        confirmed = run(['rev-parse', '--verify', CONFIRMED_REF], repoRoot).trim();
      } catch {
        confirmed = null;
      }
      try {
        pending = run(['rev-parse', '--verify', PENDING_REF], repoRoot).trim();
      } catch {
        pending = null;
      }
      if (!confirmed && !pending) {
        throw new Error('state replica is unavailable; run `changeledger state sync`');
      }
      if (pending) {
        if (!confirmed) throw new Error('invalid state replica: pending has no confirmed base');
        const parent = run(['rev-parse', '--verify', `${pending}^`], repoRoot).trim();
        if (parent !== confirmed) {
          throw new Error(
            'invalid state replica: pending does not descend directly from confirmed',
          );
        }
      }
      revision = pending ?? confirmed;
    } else {
      const hasReplicaRef = [CONFIRMED_REF, OBSERVED_REF, PENDING_REF].some((ref) => {
        try {
          run(['rev-parse', '--verify', ref], repoRoot);
          return true;
        } catch {
          return false;
        }
      });
      if (hasReplicaRef) {
        throw new Error(
          'state authority v1 conflicts with local replica v2 refs; resolve the mismatch before reading or mutating the ledger',
        );
      }
      revision = run(['rev-parse', '--verify', authority.state_ref], repoRoot).trim();
    }
    baseline = run(['rev-parse', '--verify', authority.baseline], repoRoot).trim();
    baselineType = run(['cat-file', '-t', baseline], repoRoot).trim();
  } catch (error) {
    if (
      error.message.startsWith('state replica') ||
      error.message.startsWith('invalid state replica') ||
      error.message.startsWith('state authority v1 conflicts')
    ) {
      throw error;
    }
    throw new Error('state authority is unavailable or does not descend from its baseline');
  }
  if (baseline.toLowerCase() !== authority.baseline.toLowerCase() || baselineType !== 'commit') {
    throw new Error('Invalid state authority: baseline must identify a commit object');
  }
  try {
    run(['merge-base', '--is-ancestor', baseline, revision], repoRoot);
  } catch {
    throw new Error('state authority is unavailable or does not descend from its baseline');
  }
  return revision;
}

function loadStateTree(repoRoot, revision, run) {
  let tree;
  try {
    tree = treeEntries(repoRoot, revision, run);
  } catch (error) {
    throw new Error('state authority is unavailable or has no readable tree', { cause: error });
  }
  // The state tree is read as documents: a non-regular entry (symlink, gitlink,
  // subtree) must be rejected with a clear diagnostic, not materialized. Kept
  // out of the enumeration try/catch above so the mode violation surfaces its
  // own message instead of being masked as an unreadable tree.
  for (const entry of tree) assertRegularBlobEntry(entry.mode, entry.path, entry.type);
  const names = tree.map((entry) => entry.path).sort();
  for (const name of names) {
    if (!statePathIsValid(name)) throw new Error(`invalid state path: ${name}`);
  }
  for (const required of [MANIFEST, CONFIG]) {
    if (!names.includes(required)) throw new Error(`missing ${required}`);
  }
  const byPath = new Map(tree.map((entry) => [entry.path, entry]));
  const readBlob = batchBlobReader(repoRoot, tree, run);
  return { names, read: (file) => readBlob(byPath.get(file).oid) };
}

function loadStateSnapshotAt(repoRoot, changeledgerDir, authority, revision, run) {
  const { names, read } = loadStateTree(repoRoot, revision, run);
  const manifest = parseYaml(read(MANIFEST));
  const configText = read(CONFIG);
  const config = parseYaml(configText);
  if (manifest?.format_version !== 1) throw new Error('Unsupported ledger state format_version');
  if (
    manifest?.project_id !== authority.project_id ||
    config?.project_id !== authority.project_id
  ) {
    throw new Error('state project_id does not match authority');
  }
  if (authority.format_version === 2) {
    if (manifest?.inventory_digest !== authority.inventory_digest) {
      throw new Error('state inventory_digest does not match authority');
    }
    if (manifest?.minimum_client_version !== authority.minimum_client_version) {
      throw new Error('state minimum_client_version does not match authority');
    }
  }

  const entries = (dir, extension, parse) =>
    names
      .filter((name) => name.startsWith(`${STATE_ROOT}/${dir}/`) && name.endsWith(extension))
      .map((file) => {
        const name = path.posix.basename(file);
        const text = read(file);
        return { file: `git:${revision}:${file}`, statePath: file, name, text, ...parse(text) };
      });
  const changes = entries('changes', '.md', parseChange);
  changes.sort((a, b) => String(a.frontmatter.id).localeCompare(String(b.frontmatter.id)));
  const specs = entries('specs', '.md', parseSpec);
  const releases = entries('releases', '.yml', parseYaml);

  return {
    mode: 'state',
    revision,
    authority,
    manifest,
    repoRoot,
    changeledgerDir,
    configFile: `git:${revision}:${CONFIG}`,
    configStatePath: CONFIG,
    configText,
    config,
    changes,
    specs,
    releases,
  };
}

export function snapshotIdentities(snapshot) {
  return {
    changes: new Set(snapshot.changes.map((change) => change.frontmatter.id)),
    specs: new Set(snapshot.specs.map((spec) => spec.name)),
    releases: new Set(snapshot.releases.map((release) => release.name)),
  };
}

// No lifecycle transition (archive, discard, graduation) ever removes a
// document from its collection -- it only changes fields within it. A
// snapshot transition that drops an identity present in any parent is either
// data loss or tampering; content_validation must not report "verified" for
// it, and a read must not serve it as current truth either.
export function assertNoDisappearance(parentSnapshot, childSnapshot, revision) {
  const parent = snapshotIdentities(parentSnapshot);
  const child = snapshotIdentities(childSnapshot);
  for (const [collection, parentIdentities] of Object.entries(parent)) {
    const childIdentities = child[collection];
    for (const identity of parentIdentities) {
      if (!childIdentities.has(identity)) {
        throw new Error(`state revision ${revision} removes ${collection} identity "${identity}"`);
      }
    }
  }
}

// A root commit (the initial state baseline) has no parent and nothing prior
// to compare against.
function gitParentsOrRoot(repoRoot, commit, run) {
  const fields = run(['rev-list', '--parents', '-n', '1', commit], repoRoot).trim().split(/\s+/);
  return fields.slice(1);
}

function loadStateSnapshot(repoRoot, changeledgerDir, authority, run) {
  const revision = gitStateRevision(repoRoot, authority, run);
  const snapshot = loadStateSnapshotAt(repoRoot, changeledgerDir, authority, revision, run);
  if (authority.format_version === 1) {
    return { ...snapshot, ledgerFreshness: 'local', ledgerConfirmation: 'local' };
  }
  for (const parent of gitParentsOrRoot(repoRoot, revision, run)) {
    const parentSnapshot = loadStateSnapshotAt(repoRoot, changeledgerDir, authority, parent, run);
    assertNoDisappearance(parentSnapshot, snapshot, revision);
  }
  const replica = stateReplicaStatus(repoRoot);
  return {
    ...snapshot,
    ledgerFreshness: replica.condition,
    ledgerConfirmation: replica.pending ? 'pending publication' : 'confirmed',
    ledgerObservedAt: replica.observedAt,
    ledgerReplica: replica,
  };
}

export function statePathIsValid(file) {
  if (typeof file !== 'string' || file.includes('\0')) return false;
  if (file === MANIFEST || file === CONFIG) return true;
  const parts = file.split('/');
  if (parts.length !== 3 || parts[0] !== STATE_ROOT) return false;
  const extension = STATE_COLLECTION_EXTENSIONS.get(parts[1]);
  const name = parts[2];
  return Boolean(extension && name.length > extension.length && name.endsWith(extension));
}

function runIndexedGit(args, cwd, indexFile, { input } = {}) {
  try {
    return execFileSync('git', args, {
      cwd,
      env: sanitizedGitEnv({ GIT_INDEX_FILE: indexFile }),
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    const detail = [error.stderr, error.stdout]
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean)
      .join('\n');
    throw new Error(detail ? `${error.message}\n${detail}` : error.message, { cause: error });
  }
}

function keepStateRevision(repoRoot, revision, ref, run) {
  try {
    // A no-op transaction still needs a linearization point. Updating a ref to
    // its existing value with the same expected old value acquires Git's ref
    // lock and fails atomically if another writer already published a successor.
    run(['update-ref', ref, revision, revision], repoRoot);
  } catch (error) {
    throw new LedgerConflictError('Ledger state changed concurrently; retry the operation', {
      cause: error,
    });
  }
}

function keepMutationRevision(repoRoot, revision, replica, run) {
  try {
    if (replica) keepStateReplicaRevision(repoRoot, revision);
    else keepStateRevision(repoRoot, revision, STATE_REF, run);
  } catch (error) {
    if (error instanceof LedgerConflictError) throw error;
    throw new LedgerConflictError('Ledger state changed concurrently; retry the operation', {
      cause: error,
    });
  }
}

// Same content checks `validateStateRevision` runs after a git-backed load,
// factored out so an in-memory candidate (already parsed, never re-read from
// git) can be validated identically instead of duplicating the checks.
export function validateSnapshotContent(snapshot) {
  assertSupportedSchema(snapshot.config);
  // Neither caller of this function (validateStateRevision, the incremental
  // batch path in state-validation.mjs) ever inspects `.warnings` -- skip the
  // advisory-only checks that would otherwise dominate the cost at scale.
  const { errors } = checkRepo(snapshot, { skipAdvisory: true });
  if (errors.length) {
    throw new Error(
      `Ledger state validation failed: ${errors.map((error) => error.message).join('; ')}`,
    );
  }
}

export function validateStateRevision(
  repoRoot,
  changeledgerDir,
  authority,
  revision,
  run,
  { requireBaseline = false } = {},
) {
  let snapshot;
  try {
    snapshot = loadStateSnapshotAt(repoRoot, changeledgerDir, authority, revision, run);
  } catch (error) {
    throw new Error(`Ledger state validation failed: ${error.message}`, { cause: error });
  }
  validateSnapshotContent(snapshot);
  if (requireBaseline) {
    try {
      run(['merge-base', '--is-ancestor', authority.baseline, revision], repoRoot);
    } catch (error) {
      throw new Error(
        `Ledger state validation failed: revision ${revision} does not descend from authority baseline ${authority.baseline}`,
        { cause: error },
      );
    }
  }
  return snapshot;
}

export function validateServerStateRevision(repoRoot, authority, revision, run = defaultRun) {
  return validateStateRevision(
    repoRoot,
    path.join(repoRoot, '.changeledger'),
    authority,
    revision,
    run,
    { requireBaseline: true },
  );
}

const STATE_COLLECTION_PARSERS = { changes: parseChange, specs: parseSpec, releases: parseYaml };

function stateCollectionOf(file) {
  for (const collection of Object.keys(STATE_COLLECTION_PARSERS)) {
    if (file.startsWith(`${STATE_ROOT}/${collection}/`)) return collection;
  }
  return null;
}

// Builds the post-mutation snapshot from the already-loaded source snapshot
// plus the write/remove delta the mutator produced, entirely in memory: the
// candidate tree's exact content is already known from `writes`/`removals`,
// so re-reading it from git would just reparse what this function already
// has. Does not replicate `loadStateSnapshotAt`'s manifest/authority
// consistency checks -- callers must fall back to a git-backed validation
// when `writes` touches the manifest (see `mutateState`).
export function deriveCandidateSnapshot(snapshot, revision, writes, removals) {
  const candidate = { ...snapshot, revision };
  for (const [collection, parse] of Object.entries(STATE_COLLECTION_PARSERS)) {
    // Untouched documents are reused by reference, not cloned: `.file` is a
    // diagnostic `git:<revision>:<path>` label nothing in checkRepo reads
    // (it reports by `.name`), so re-stamping every survivor on every call
    // would be pure waste -- costly when this runs once per commit across a
    // batch (20260722-203027). `restampRevision` fixes `.file` up in one pass
    // wherever a final, caller-facing snapshot actually needs it current.
    const survivors = snapshot[collection].filter(
      (doc) => !removals.has(doc.statePath) && !writes.has(doc.statePath),
    );
    const added = [...writes]
      .filter(([file]) => stateCollectionOf(file) === collection)
      .map(([file, text]) => {
        try {
          return {
            file: `git:${revision}:${file}`,
            statePath: file,
            name: path.posix.basename(file),
            text,
            ...parse(text),
          };
        } catch (error) {
          throw new Error(`Ledger state validation failed: ${error.message}`, { cause: error });
        }
      });
    candidate[collection] = [...survivors, ...added];
  }
  candidate.changes = [...candidate.changes].sort((a, b) =>
    String(a.frontmatter.id).localeCompare(String(b.frontmatter.id)),
  );
  // loadStateSnapshotAt derives specs/releases order from `tree.map(entry =>
  // entry.path).sort()` -- a plain code-unit (ordinal) sort, not locale-aware.
  // `localeCompare` disagrees with it on mixed-case names (e.g. it can order
  // "b.md" before "A.md" where ordinal sort does not), so match ordinal
  // comparison here too, or a candidate and a fresh git-backed load of the
  // same content would disagree on order.
  const byStatePathOrdinal = (a, b) =>
    a.statePath < b.statePath ? -1 : a.statePath > b.statePath ? 1 : 0;
  candidate.specs = [...candidate.specs].sort(byStatePathOrdinal);
  candidate.releases = [...candidate.releases].sort(byStatePathOrdinal);
  if (writes.has(CONFIG)) {
    candidate.configText = writes.get(CONFIG);
    try {
      candidate.config = parseYaml(candidate.configText);
    } catch (error) {
      throw new Error(`Ledger state validation failed: ${error.message}`, { cause: error });
    }
    // project_id is authority-anchored (loadStateSnapshotAt enforces it
    // against `authority.project_id` on every git-backed load); the source
    // snapshot already passed that check, so require the candidate to keep
    // it stable rather than re-deriving the authority reference here.
    if (candidate.config.project_id !== snapshot.config.project_id) {
      throw new Error('Ledger state validation failed: state project_id does not match authority');
    }
  }
  candidate.configFile = `git:${revision}:${CONFIG}`;
  return candidate;
}

// Cheaply relabels an already-validated in-memory snapshot for a new
// revision string (e.g. the tree OID validated pre-commit vs. the commit OID
// it ends up under) -- pure string substitution, no reparsing.
function restampRevision(snapshot, revision) {
  const restamp = (doc) => ({ ...doc, file: `git:${revision}:${doc.statePath}` });
  return {
    ...snapshot,
    revision,
    configFile: `git:${revision}:${CONFIG}`,
    changes: snapshot.changes.map(restamp),
    specs: snapshot.specs.map(restamp),
    releases: snapshot.releases.map(restamp),
  };
}

function finalizeMutationSnapshot(repoRoot, authority, candidate, commit) {
  const stamped = restampRevision(candidate, commit);
  if (authority.format_version === 1) {
    return { ...stamped, ledgerFreshness: 'local', ledgerConfirmation: 'local' };
  }
  const replica = stateReplicaStatus(repoRoot);
  return {
    ...stamped,
    ledgerFreshness: replica.condition,
    ledgerConfirmation: replica.pending ? 'pending publication' : 'confirmed',
    ledgerObservedAt: replica.observedAt,
    ledgerReplica: replica,
  };
}

function mutateState(
  repoRoot,
  changeledgerDir,
  authority,
  run,
  options,
  mutate,
  { preflighted = false } = {},
) {
  if (!options?.message || typeof options.message !== 'string') {
    throw new Error('Ledger state mutation requires a commit message');
  }
  if (typeof mutate !== 'function')
    throw new Error('Ledger state mutation requires a mutator function');
  if (typeof options.expectedRevision !== 'string' || options.expectedRevision === '') {
    throw new Error('Ledger state mutation expectedRevision is required');
  }

  const replica = authority.format_version === 2;
  const validateCandidate = (revision) =>
    validateStateRevision(repoRoot, changeledgerDir, authority, revision, run);
  // syncStateReplica runs at most twice per mutation (before and after
  // creating the pending commit); when the remote hasn't moved between the
  // two, it revalidates the same fetched OID -- memoize so the second call
  // reuses that result instead of re-materializing it from git.
  const replicaValidationCache = new Map();
  const validateReplicaRevision = (revision) => {
    if (replicaValidationCache.has(revision)) return replicaValidationCache.get(revision);
    const snapshot = validateStateRevision(repoRoot, changeledgerDir, authority, revision, run, {
      requireBaseline: true,
    });
    replicaValidationCache.set(revision, snapshot);
    return snapshot;
  };
  if (replica && options.offline !== true && !preflighted) {
    syncStateReplica(repoRoot, {
      validateRevision: validateReplicaRevision,
      validateCandidate,
    });
  }
  if (replica) {
    try {
      run(['rev-parse', '--verify', PENDING_REF], repoRoot);
      throw new Error('resolve the existing pending state before mutating again');
    } catch (error) {
      if (error.message === 'resolve the existing pending state before mutating again') throw error;
    }
  }
  const revision = gitStateRevision(repoRoot, authority, run);
  if (options.expectedRevision !== revision) {
    throw new LedgerConflictError('Ledger state changed concurrently; retry the operation');
  }
  const snapshot = loadStateSnapshot(repoRoot, changeledgerDir, authority, run);
  assertSupportedSchema(snapshot.config);
  const writes = new Map();
  const removals = new Set();
  const write = (file, text) => {
    if (!statePathIsValid(file)) throw new Error(`invalid state path: ${file}`);
    if (typeof text !== 'string') throw new Error(`state content must be text: ${file}`);
    removals.delete(file);
    writes.set(file, text);
  };
  const remove = (file) => {
    if (!statePathIsValid(file) || file === MANIFEST || file === CONFIG) {
      throw new Error(`cannot remove required or invalid state path: ${file}`);
    }
    writes.delete(file);
    removals.add(file);
  };
  mutate({ snapshot, write, remove });
  if (!writes.size && !removals.size) {
    keepMutationRevision(repoRoot, revision, replica, run);
    return snapshot;
  }

  const indexDir = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-state-index-'));
  const indexFile = path.join(indexDir, 'index');
  try {
    runIndexedGit(['read-tree', revision], repoRoot, indexFile);
    const sourceTree = runIndexedGit(['write-tree'], repoRoot, indexFile).trim();
    for (const file of removals) {
      runIndexedGit(['update-index', '--force-remove', '--', file], repoRoot, indexFile);
    }
    for (const [file, text] of writes) {
      const blob = runIndexedGit(['hash-object', '-w', '--stdin'], repoRoot, indexFile, {
        input: text,
      }).trim();
      runIndexedGit(
        ['update-index', '--add', '--cacheinfo', `100644,${blob},${file}`],
        repoRoot,
        indexFile,
      );
    }
    const tree = runIndexedGit(['write-tree'], repoRoot, indexFile).trim();
    if (tree === sourceTree) {
      keepMutationRevision(repoRoot, revision, replica, run);
      return snapshot;
    }
    // The candidate's exact content is already known from `writes`/`removals`
    // -- validate it in memory instead of re-reading `tree` back from git,
    // unless it touches the manifest (see `deriveCandidateSnapshot`).
    const canDeriveInMemory = !writes.has(MANIFEST);
    let candidate;
    if (canDeriveInMemory) {
      candidate = deriveCandidateSnapshot(snapshot, tree, writes, removals);
      validateSnapshotContent(candidate);
      if (replica) assertNoDisappearance(snapshot, candidate, tree);
    } else {
      candidate = validateCandidate(tree);
    }
    const commit = runIndexedGit(
      ['commit-tree', tree, '-p', revision, '-m', options.message],
      repoRoot,
      indexFile,
    ).trim();
    try {
      if (replica) createStatePending(repoRoot, revision, commit);
      else runIndexedGit(['update-ref', STATE_REF, commit, revision], repoRoot, indexFile);
    } catch (error) {
      throw new LedgerConflictError('Ledger state changed concurrently; retry the operation', {
        cause: error,
      });
    }
    if (replica && options.offline !== true) {
      const result = syncStateReplica(repoRoot, {
        validateRevision: validateReplicaRevision,
        validateCandidate,
      });
      // A replay or a failed publish means the effective state is not
      // exactly our commit (it was replaced or is still pending under a
      // different OID) -- reload from git rather than serve stale content.
      if (canDeriveInMemory && result.effective === commit) {
        return finalizeMutationSnapshot(repoRoot, authority, candidate, commit);
      }
      return loadStateSnapshot(repoRoot, changeledgerDir, authority, run);
    }
    if (canDeriveInMemory) return finalizeMutationSnapshot(repoRoot, authority, candidate, commit);
    return loadStateSnapshot(repoRoot, changeledgerDir, authority, run);
  } finally {
    fs.rmSync(indexDir, { recursive: true, force: true });
  }
}

export function loadLedgerStore(start = process.cwd(), { run = defaultRun } = {}) {
  const changeledgerDir = findChangeledgerDir(start);
  if (!changeledgerDir) {
    throw new Error(
      'Not a ChangeLedger repo (no .changeledger/ found). Run `changeledger init` first.',
    );
  }
  const repoRoot = path.dirname(changeledgerDir);
  const authority = authorityFor(changeledgerDir);
  if (!authority)
    return {
      mode: 'worktree',
      validateAuthority: () => null,
      load: () => loadWorktreeSnapshot(repoRoot, changeledgerDir),
      prepareMutation: () => loadWorktreeSnapshot(repoRoot, changeledgerDir),
      mutate: () => {
        throw new Error('LedgerStore mutations require an active state authority');
      },
    };
  const replica = authority.format_version === 2;
  const validateReplicaRevision = (revision) =>
    validateStateRevision(repoRoot, changeledgerDir, authority, revision, run, {
      requireBaseline: true,
    });
  const validateCandidate = (revision) =>
    validateStateRevision(repoRoot, changeledgerDir, authority, revision, run);
  const validateAuthority = () =>
    validateStateRevision(repoRoot, changeledgerDir, authority, authority.baseline, run, {
      requireBaseline: true,
    });
  const syncReplica = () => {
    return syncStateReplica(repoRoot, {
      validateRevision: validateReplicaRevision,
      validateCandidate,
    });
  };
  const load = () => loadStateSnapshot(repoRoot, changeledgerDir, authority, run);
  let prepared = null;
  return {
    mode: 'state',
    validateAuthority,
    load,
    loadRevision: (revision) =>
      validateStateRevision(repoRoot, changeledgerDir, authority, revision, run, {
        requireBaseline: true,
      }),
    prepareMutation: ({ offline = false } = {}) => {
      if (replica && !offline) syncReplica();
      const snapshot = load();
      prepared = { revision: snapshot.revision, offline: Boolean(offline) };
      return snapshot;
    },
    mutate: (options, mutate) => {
      const preflighted =
        Boolean(prepared) &&
        prepared.revision === options?.expectedRevision &&
        prepared.offline === Boolean(options?.offline);
      prepared = null;
      return mutateState(repoRoot, changeledgerDir, authority, run, options, mutate, {
        preflighted,
      });
    },
    replica: replica
      ? {
          status: () => {
            validateAuthority();
            return stateReplicaStatus(repoRoot);
          },
          sync: syncReplica,
          abort: ({ offline = false } = {}) => {
            validateAuthority();
            return abortStatePending(repoRoot, {
              offline,
              validateRevision: validateReplicaRevision,
            });
          },
        }
      : null,
  };
}
