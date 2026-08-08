// Local-first, single-writer git store for the global-state ledger (etapa 1
// of `global-state-scope.md`): a fixed ref holding the whole ledger as an
// exclusive tree, a snapshot read with no checkout, a compare-and-swap
// mutation, and the low-level activation primitive. No network, sync,
// migration or server-side validation — see the change's Investigation for
// what was deliberately left in `codex/state-replica-v2`.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertCommitObject, capturedRun } from './git.mjs';
import { assertRegularBlobEntry, batchBlobReader, treeEntries } from './git-batch.mjs';
import { parseYaml, stringifyYaml } from './yaml.mjs';

export const STATE_REF = 'refs/heads/changeledger/state';
// Outside refs/heads/ so every worktree of the repo shares one activation
// decision (checkout-independent — the lesson v2 paid for in 20260723-202646:
// authority living in a worktree file degraded to legacy mode on a branch
// switch or a deletion).
export const ACTIVATION_REF = 'refs/changeledger/activation';
export const STATE_ROOT = '.changeledger-state';
export const STATE_SCHEMA_VERSION = 1;

const MANIFEST = `${STATE_ROOT}/manifest.yml`;
const CONFIG = `${STATE_ROOT}/config.yml`;
const STATE_COLLECTION_EXTENSIONS = new Map([
  ['changes', '.md'],
  ['specs', '.md'],
  ['releases', '.yml'],
]);
const ACTIVATION_AUTHORITY_PATH = 'authority.yml';

export class LedgerConflictError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'LedgerConflictError';
  }
}

// The exclusive layout of the state tree: exactly the manifest, the config,
// or `<collection>/<name><ext>` under STATE_ROOT. Anything else — a path
// outside STATE_ROOT, an unknown collection, a wrong extension — is rejected
// on both the read path (a foreign entry in the tree) and the write path (a
// mutator trying to stage one).
export function statePathIsValid(file) {
  if (typeof file !== 'string' || file === '' || file.includes('\0')) return false;
  if (file === MANIFEST || file === CONFIG) return true;
  const parts = file.split('/');
  if (parts.length !== 3 || parts[0] !== STATE_ROOT) return false;
  const extension = STATE_COLLECTION_EXTENSIONS.get(parts[1]);
  const name = parts[2];
  return Boolean(extension && name.length > extension.length && name.endsWith(extension));
}

// --- subprocess plumbing -----------------------------------------------

const GIT_LOCATION_ENV_VARS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CEILING_DIRECTORIES',
];

function sanitizedEnv(extra) {
  const env = { ...process.env, LC_ALL: 'C' };
  for (const key of GIT_LOCATION_ENV_VARS) delete env[key];
  return extra ? { ...env, ...extra } : env;
}

function stderrOf(e) {
  const raw = e?.stderr;
  const text = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : '';
  return text.trim();
}

// Runs `git` against a private temp index (never the repo's own index or
// working tree) so a candidate tree can be built entirely in the object
// database. Used for every mutating tree-construction step (`read-tree`,
// `update-index`, `write-tree`, `hash-object`); `commit-tree` and `update-ref`
// operate on object/ref names directly and use the plain injected `run`
// instead.
function indexedRun(args, cwd, indexFile, { input } = {}) {
  try {
    return execFileSync('git', args, {
      cwd,
      env: sanitizedEnv({ GIT_INDEX_FILE: indexFile }),
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    const detail = stderrOf(e);
    throw new Error(detail ? `${e.message}\n${detail}` : e.message, { cause: e });
  }
}

function withTempIndex(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-state-index-'));
  const indexFile = path.join(dir, 'index');
  try {
    return fn(indexFile);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Builds a tree object from `base` (a revision to seed via `read-tree`, or
// `null` for an empty tree) plus a `writes` map (full-path -> text) and a
// `removals` set (full paths), entirely in a private temp index. Returns the
// resulting tree oid; never touches the repo's working tree or real index.
function buildTree(repoRoot, { base, writes, removals }) {
  return withTempIndex((indexFile) => {
    if (base) indexedRun(['read-tree', base], repoRoot, indexFile);
    for (const full of removals) {
      indexedRun(['update-index', '--force-remove', '--', full], repoRoot, indexFile);
    }
    for (const [full, text] of writes) {
      const blob = indexedRun(['hash-object', '-w', '--stdin'], repoRoot, indexFile, {
        input: text,
      }).trim();
      indexedRun(
        ['update-index', '--add', '--cacheinfo', `100644,${blob},${full}`],
        repoRoot,
        indexFile,
      );
    }
    return indexedRun(['write-tree'], repoRoot, indexFile).trim();
  });
}

function commitTree(repoRoot, tree, { parents = [], message }, run) {
  const args = ['commit-tree', tree];
  for (const parent of parents) args.push('-p', parent);
  args.push('-m', message);
  return run(args, repoRoot).trim();
}

// The oid of an absent ref, or `null` on genuine absence: the ref itself does
// not exist, or `repoRoot` is not a git repository at all. Any other
// subprocess failure (a corrupt repo, a permissions error, an injected
// failure) propagates with git's stderr in the message rather than being
// folded into "absent" — the two are different classes and a caller must be
// able to tell them apart (a CAS store served stale truth once by conflating
// them: 20260723-235906).
function optionalRefOid(repoRoot, ref, run) {
  try {
    fs.lstatSync(path.join(repoRoot, '.git'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  try {
    const out = run(['rev-parse', '--verify', '--quiet', ref], repoRoot);
    return out.trim() || null;
  } catch (e) {
    // `--quiet` makes git exit 1 with empty stderr for "ref does not resolve"
    // specifically; any other status (corrupt ref, permissions, an injected
    // failure) is a real failure and must not be swallowed as absence.
    if (e.cause?.status === 1) return null;
    throw new Error(`cannot read Git ref ${ref}: ${e.message}`, { cause: e });
  }
}

function toFullPath(relPath) {
  if (typeof relPath !== 'string' || relPath === '' || relPath.includes('\0')) {
    throw new Error(`invalid state path: ${relPath}`);
  }
  return path.posix.join(STATE_ROOT, relPath);
}

// --- state ref: init, read, snapshot, mutate ----------------------------

export function initState(repoRoot, { projectId, config = {} } = {}, run = capturedRun) {
  if (typeof projectId !== 'string' || projectId === '') {
    throw new Error('initState requires a projectId');
  }
  if (optionalRefOid(repoRoot, STATE_REF, run) !== null) {
    throw new Error(`state is already initialized at ${STATE_REF}`);
  }
  const manifestText = stringifyYaml({
    format_version: STATE_SCHEMA_VERSION,
    project_id: projectId,
  });
  const configText = stringifyYaml({ project_id: projectId, ...config });
  const writes = new Map([
    [MANIFEST, manifestText],
    [CONFIG, configText],
  ]);
  const tree = buildTree(repoRoot, { base: null, writes, removals: new Set() });
  const commit = commitTree(
    repoRoot,
    tree,
    { parents: [], message: 'chore: initialize state' },
    run,
  );
  const zeroOid = '0'.repeat(commit.length);
  try {
    run(['update-ref', STATE_REF, commit, zeroOid], repoRoot);
  } catch (e) {
    throw new LedgerConflictError(`state is already initialized at ${STATE_REF}`, { cause: e });
  }
  return { revision: commit };
}

export function readStateRef(repoRoot, run = capturedRun) {
  const oid = optionalRefOid(repoRoot, STATE_REF, run);
  if (oid === null) return null;
  assertCommitObject(repoRoot, STATE_REF, run);
  return oid;
}

// Reads `revision` (defaulting to the current state ref tip) via git-batch,
// with no checkout: enumerates the tree once, validates every entry is a
// regular blob at a layout-valid path, and returns manifest/config parsed
// plus every other document as `{ [relPathUnderStateRoot]: text }`, byte
// identical to what is stored (a non-UTF-8 blob throws naming its path,
// never silently transcoding to U+FFFD).
export function readSnapshot(repoRoot, { revision } = {}, run = capturedRun) {
  const rev = revision ?? readStateRef(repoRoot, run);
  if (rev === null) throw new Error('state is not initialized');
  assertCommitObject(repoRoot, rev, run);

  let entries;
  try {
    entries = treeEntries(repoRoot, rev, run);
  } catch (e) {
    throw new Error(`state revision ${rev} has no readable tree: ${e.message}`, { cause: e });
  }
  for (const entry of entries) assertRegularBlobEntry(entry.mode, entry.path, entry.type);

  const names = entries.map((entry) => entry.path).sort();
  for (const name of names) {
    if (!statePathIsValid(name)) throw new Error(`invalid state path: ${name}`);
  }
  if (!names.includes(MANIFEST)) throw new Error(`state revision ${rev} is missing ${MANIFEST}`);
  if (!names.includes(CONFIG)) throw new Error(`state revision ${rev} is missing ${CONFIG}`);

  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const readBlob = batchBlobReader(repoRoot, entries, run);
  const readPath = (full) => {
    try {
      return readBlob(byPath.get(full).oid);
    } catch (e) {
      throw new Error(`state path ${full} is not valid UTF-8`, { cause: e });
    }
  };

  const manifest = parseYaml(readPath(MANIFEST));
  if (manifest?.format_version !== STATE_SCHEMA_VERSION) {
    throw new Error(`state revision ${rev} has unsupported manifest format_version`);
  }
  const config = parseYaml(readPath(CONFIG));

  const documents = {};
  for (const name of names) {
    if (name === MANIFEST || name === CONFIG) continue;
    documents[name.slice(STATE_ROOT.length + 1)] = readPath(name);
  }

  return { revision: rev, manifest, config, documents };
}

// Compare-and-swap mutation over `expectedRevision`. `mutator({ write, remove
// })` stages `write(relPath, text)` / `remove(relPath)` calls (paths relative
// to STATE_ROOT, e.g. `changes/x.md`); the candidate tree is built from
// `expectedRevision`'s tree plus that delta via a private temp index. A
// mutation with no net diff creates no commit but still passes through the
// ref's CAS lock, so a concurrent mover is still detected. Any parent path
// that disappears from the candidate without a matching explicit `remove` is
// an integrity violation and aborts before any ref is touched.
export function mutateState(
  repoRoot,
  { expectedRevision, message } = {},
  mutator,
  run = capturedRun,
) {
  if (typeof expectedRevision !== 'string' || expectedRevision === '') {
    throw new Error('mutateState requires expectedRevision');
  }
  if (typeof message !== 'string' || message === '') {
    throw new Error('mutateState requires a commit message');
  }
  if (typeof mutator !== 'function') {
    throw new Error('mutateState requires a mutator function');
  }
  assertCommitObject(repoRoot, expectedRevision, run);

  const writes = new Map();
  const removals = new Set();
  const write = (relPath, text) => {
    const full = toFullPath(relPath);
    if (!statePathIsValid(full)) throw new Error(`invalid state path: ${relPath}`);
    if (typeof text !== 'string') throw new Error(`state content must be text: ${relPath}`);
    removals.delete(full);
    writes.set(full, text);
  };
  const remove = (relPath) => {
    const full = toFullPath(relPath);
    if (!statePathIsValid(full) || full === MANIFEST || full === CONFIG) {
      throw new Error(`cannot remove required or invalid state path: ${relPath}`);
    }
    writes.delete(full);
    removals.add(full);
  };
  mutator({ write, remove });

  const advanceOrConflict = (newRevision) => {
    try {
      run(['update-ref', STATE_REF, newRevision, expectedRevision], repoRoot);
    } catch (e) {
      const current = optionalRefOid(repoRoot, STATE_REF, run) ?? 'unknown';
      throw new LedgerConflictError(
        `state ref moved: expected ${expectedRevision}, found ${current} — reload and retry`,
        { cause: e },
      );
    }
  };

  if (writes.size === 0 && removals.size === 0) {
    advanceOrConflict(expectedRevision);
    return readSnapshot(repoRoot, { revision: expectedRevision }, run);
  }

  const sourceTree = run(['rev-parse', `${expectedRevision}^{tree}`], repoRoot).trim();
  const candidateTree = buildTree(repoRoot, { base: expectedRevision, writes, removals });
  if (candidateTree === sourceTree) {
    advanceOrConflict(expectedRevision);
    return readSnapshot(repoRoot, { revision: expectedRevision }, run);
  }

  const parentNames = new Set(treeEntries(repoRoot, expectedRevision, run).map((e) => e.path));
  const candidateNames = new Set(treeEntries(repoRoot, candidateTree, run).map((e) => e.path));
  for (const name of parentNames) {
    if (!candidateNames.has(name) && !removals.has(name)) {
      throw new Error(`state mutation removes "${name}" without an explicit stage.remove`);
    }
  }

  const commit = commitTree(repoRoot, candidateTree, { parents: [expectedRevision], message }, run);
  advanceOrConflict(commit);
  return readSnapshot(repoRoot, { revision: commit }, run);
}

// --- activation: low-level, checkout-independent ------------------------

export function readActivation(repoRoot, run = capturedRun) {
  const oid = optionalRefOid(repoRoot, ACTIVATION_REF, run);
  if (oid === null) return null;
  assertCommitObject(repoRoot, ACTIVATION_REF, run);
  let text;
  try {
    text = run(['cat-file', 'blob', `${oid}:${ACTIVATION_AUTHORITY_PATH}`], repoRoot);
  } catch (e) {
    throw new Error(`activation commit ${oid} has no readable ${ACTIVATION_AUTHORITY_PATH}`, {
      cause: e,
    });
  }
  const authority = parseYaml(text);
  if (authority?.format_version !== STATE_SCHEMA_VERSION) {
    throw new Error(
      `activation authority has unsupported format_version: ${authority?.format_version}`,
    );
  }
  if (typeof authority.state_ref !== 'string' || authority.state_ref === '') {
    throw new Error('activation authority is missing state_ref');
  }
  return { format_version: authority.format_version, state_ref: authority.state_ref };
}

export function writeActivation(repoRoot, { stateRef } = {}, run = capturedRun) {
  if (typeof stateRef !== 'string' || stateRef === '') {
    throw new Error('writeActivation requires a stateRef');
  }
  const authorityText = stringifyYaml({
    format_version: STATE_SCHEMA_VERSION,
    state_ref: stateRef,
  });
  const tree = buildTree(repoRoot, {
    base: null,
    writes: new Map([[ACTIVATION_AUTHORITY_PATH, authorityText]]),
    removals: new Set(),
  });
  const commit = commitTree(repoRoot, tree, { parents: [], message: 'chore: activation' }, run);
  run(['update-ref', ACTIVATION_REF, commit], repoRoot);
  return { revision: commit };
}
