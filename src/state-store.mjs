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
import { assertCommitObject, capturedRun, isAncestor, sanitizedEnv } from './git.mjs';
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
export const CAS_CONFLICT_MESSAGE = 'state changed since load';

const MANIFEST = `${STATE_ROOT}/manifest.yml`;
const CONFIG = `${STATE_ROOT}/config.yml`;
const STATE_COLLECTION_EXTENSIONS = new Map([
  ['changes', '.md'],
  ['specs', '.md'],
  ['releases', '.yml'],
]);
const ACTIVATION_AUTHORITY_PATH = 'authority.yml';
const LEDGER_DIR_NAME = '.changeledger';

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

// Builds a tree from an EXACT set of already-hashed entries (`{ path, mode, oid
// }`), with no base to inherit from: what a reconciliation needs, where every
// entry was chosen from one of three existing trees and no content is
// rehashed, so a document that crosses a merge keeps its bytes and its oid.
function buildTreeFromEntries(repoRoot, entries) {
  return withTempIndex((indexFile) => {
    for (const { path: full, mode, oid } of entries) {
      indexedRun(
        ['update-index', '--add', '--cacheinfo', `${mode},${oid},${full}`],
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

// The oid of an absent ref, or `null` on genuine absence. `--verify --quiet`
// exits 1 with EMPTY stderr specifically for "this ref does not resolve" —
// but a CORRUPT loose ref (garbage content) also exits 1, with a non-empty
// "warning: ignoring broken ref ..." (probed directly against real git, not
// assumed). Branching on `status === 1` alone conflated the two, silently
// reading a corrupt ref back as "not initialized" instead of failing loudly
// — the exact class this closes (a CAS store served stale truth once by
// conflating absence with failure: 20260723-235906). No pre-check on
// `repoRoot/.git` either: that misclassified a subdirectory of a repo (whose
// `.git` is not a direct child, though git still discovers it upward) as "not
// a repo"; a genuine non-repo directory exits 128 (non-empty stderr, status
// != 1) and is already caught by the `throw` branch below. Any stderr,
// including advice that may be benign, deliberately fails closed: filtering
// warning classes could hide the corrupt-ref diagnostic this distinction
// exists to preserve.
export function optionalRefOid(repoRoot, ref, run = capturedRun) {
  try {
    const out = run(['rev-parse', '--verify', '--quiet', ref], repoRoot);
    return out.trim() || null;
  } catch (e) {
    const stderr = stderrOf(e.cause);
    if (e.cause?.status === 1) {
      if (stderr === '') return null;
      throw new Error(`cannot read Git ref ${ref}: ${stderr}`, { cause: e });
    }
    throw new Error(`cannot read Git ref ${ref}: ${e.message}`, { cause: e });
  }
}

function refOidAfterUpdateFailure(repoRoot, ref, run, updateError) {
  try {
    return optionalRefOid(repoRoot, ref, run);
  } catch (readError) {
    throw new Error(readError.message, { cause: updateError });
  }
}

function toFullPath(relPath) {
  if (typeof relPath !== 'string' || relPath === '' || relPath.includes('\0')) {
    throw new Error(`invalid state path: ${relPath}`);
  }
  return path.posix.join(STATE_ROOT, relPath);
}

// Every move of the state ref, from every writer, goes through this one
// compare-and-swap. Only a ref that no longer holds `expectedRevision` is a CAS
// conflict: re-reading the tip tells that apart from a failure that left the ref
// exactly where it was (a stale `.lock`, a permissions error), which relabeling
// as "state ref moved" would both self-contradict (expected X, found X) and hide.
function casUpdateStateRef(repoRoot, revision, expectedRevision, run) {
  try {
    run(['update-ref', STATE_REF, revision, expectedRevision], repoRoot);
  } catch (e) {
    const current = refOidAfterUpdateFailure(repoRoot, STATE_REF, run, e);
    if (current !== expectedRevision) {
      throw new LedgerConflictError(
        `state ref moved: expected ${expectedRevision}, found ${current ?? 'no ref'} — reload and retry`,
        { cause: e },
      );
    }
    throw e;
  }
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
    // Only a genuine old-value mismatch — the ref now resolves to something,
    // proving a concurrent initState won the race — is "already initialized".
    // Any other failure (e.g. a stale `.lock`, where the ref never moved) is
    // a real failure and must not be relabeled: it was never actually
    // initialized, so reporting that would send a caller retrying nothing.
    if (refOidAfterUpdateFailure(repoRoot, STATE_REF, run, e) !== null) {
      throw new LedgerConflictError(`state is already initialized at ${STATE_REF}`, { cause: e });
    }
    throw e;
  }
  return { revision: commit };
}

export function readStateRef(repoRoot, run = capturedRun) {
  const oid = optionalRefOid(repoRoot, STATE_REF, run);
  if (oid === null) return null;
  assertCommitObject(repoRoot, STATE_REF, run);
  return oid;
}

function inspectStateTree(repoRoot, { revision } = {}, run = capturedRun) {
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

  return {
    revision: rev,
    entries,
    names,
    byPath: new Map(entries.map((entry) => [entry.path, entry])),
  };
}

function statePathReader(repoRoot, entries, byPath, run) {
  const readBlob = batchBlobReader(repoRoot, entries, run);
  return (full) => {
    try {
      return readBlob(byPath.get(full).oid);
    } catch (e) {
      // Only the strict-UTF-8 check gets relabeled with the path (git-batch's
      // own message names the oid, not the path a caller actually needs).
      // Every other failure (a missing object, an over-budget blob, malformed
      // batch framing) propagates with its own message unchanged — relabeling
      // it as a UTF-8 problem would misdirect whoever reads the error.
      if (/not valid UTF-8/.test(e.message)) {
        throw new Error(`state path ${full} is not valid UTF-8`, { cause: e });
      }
      throw e;
    }
  };
}

// Enumerates and validates the complete state layout, but materializes only
// config.yml. Config-only callers retain the snapshot path's regular-blob and
// strict UTF-8 guarantees without loading every ledger document body.
export function readStateConfigText(repoRoot, { revision } = {}, run = capturedRun) {
  const tree = inspectStateTree(repoRoot, { revision }, run);
  const entry = tree.byPath.get(CONFIG);
  return statePathReader(repoRoot, [entry], tree.byPath, run)(CONFIG);
}

// Reads `revision` (defaulting to the current state ref tip) via git-batch,
// with no checkout: enumerates the tree once, validates every entry is a
// regular blob at a layout-valid path, and returns manifest/config parsed
// plus every other document as `{ [relPathUnderStateRoot]: text }`, byte
// identical to what is stored (a non-UTF-8 blob throws naming its path,
// never silently transcoding to U+FFFD).
export function readSnapshot(repoRoot, { revision } = {}, run = capturedRun) {
  const tree = inspectStateTree(repoRoot, { revision }, run);
  const { entries, names, byPath } = tree;
  const readPath = statePathReader(repoRoot, entries, byPath, run);

  const manifest = parseYaml(readPath(MANIFEST));
  if (manifest?.format_version !== STATE_SCHEMA_VERSION) {
    throw new Error(`state revision ${tree.revision} has unsupported manifest format_version`);
  }
  const config = parseYaml(readPath(CONFIG));

  const documents = {};
  for (const name of names) {
    if (name === MANIFEST || name === CONFIG) continue;
    documents[name.slice(STATE_ROOT.length + 1)] = readPath(name);
  }

  return { revision: tree.revision, manifest, config, documents };
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

  const advanceOrConflict = (newRevision) =>
    casUpdateStateRef(repoRoot, newRevision, expectedRevision, run);

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

// Fast-forwards the state ref from `expectedRevision` onto `revision` — the
// move `sync` needs when another clone's journal already contains this one's.
// No commit is created: the local journal adopts a history it is fully
// contained in. Three guards, all before any ref moves, keep that claim true
// instead of trusting the caller's classification:
//
// - `revision` must be a commit OBJECT (never an annotated tag peeled to one);
// - `expectedRevision` must be an ancestor of it, so a "fast-forward" that
//   would actually drop local journal entries is refused rather than performed;
// - its tree must be a valid state layout, read in full — a ref fetched from a
//   remote is untrusted input, and adopting a foreign or non-UTF-8 tree would
//   only fail later, on the next read, with the ledger already moved.
export function advanceStateRef(repoRoot, { expectedRevision, revision } = {}, run = capturedRun) {
  if (typeof expectedRevision !== 'string' || expectedRevision === '') {
    throw new Error('advanceStateRef requires expectedRevision');
  }
  if (typeof revision !== 'string' || revision === '') {
    throw new Error('advanceStateRef requires a revision');
  }
  assertCommitObject(repoRoot, revision, run);
  if (!isAncestor(repoRoot, expectedRevision, revision, run)) {
    throw new Error(
      `cannot fast-forward ${STATE_REF} to ${revision}: it does not contain ${expectedRevision}`,
    );
  }
  const snapshot = readSnapshot(repoRoot, { revision }, run);
  casUpdateStateRef(repoRoot, revision, expectedRevision, run);
  return snapshot;
}

// Lands a reconciled state tree as ONE commit with BOTH parents: the local tip
// this CAS is taken against, and the other side's tip, whose history is
// preserved whole rather than replayed. A rebase would rewrite commits every
// other clone has already CAS'd against, so it is not an option here — the
// merge commit is.
//
// `entries` is the COMPLETE final tree as `{ path, mode, oid }` (the shape
// `treeEntries` yields), never a delta: the caller decided per document which
// side wins, and this primitive refuses to guess. It validates that decision
// before anything is written — every entry a regular blob at a layout-valid
// path, and the manifest and config both present — because a tree assembled
// from a remote's objects is untrusted input.
export function commitMergedState(
  repoRoot,
  { expectedRevision, otherRevision, entries, message } = {},
  run = capturedRun,
) {
  if (typeof expectedRevision !== 'string' || expectedRevision === '') {
    throw new Error('commitMergedState requires expectedRevision');
  }
  if (typeof otherRevision !== 'string' || otherRevision === '') {
    throw new Error('commitMergedState requires otherRevision');
  }
  if (typeof message !== 'string' || message === '') {
    throw new Error('commitMergedState requires a commit message');
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('commitMergedState requires the complete merged tree entries');
  }
  assertCommitObject(repoRoot, expectedRevision, run);
  assertCommitObject(repoRoot, otherRevision, run);

  const names = new Set();
  for (const entry of entries) {
    assertRegularBlobEntry(entry.mode, entry.path, entry.type);
    if (!statePathIsValid(entry.path)) throw new Error(`invalid state path: ${entry.path}`);
    if (names.has(entry.path)) throw new Error(`duplicate state path: ${entry.path}`);
    names.add(entry.path);
  }
  for (const required of [MANIFEST, CONFIG]) {
    if (!names.has(required)) throw new Error(`merged state is missing ${required}`);
  }

  const tree = buildTreeFromEntries(repoRoot, entries);
  const commit = commitTree(
    repoRoot,
    tree,
    { parents: [expectedRevision, otherRevision], message },
    run,
  );
  // Read BEFORE the CAS, exactly like `advanceStateRef`: the per-entry checks
  // above judge the tree's shape, but only a full read judges its CONTENT — an
  // unsupported manifest format_version, a non-UTF-8 blob — and one side of
  // this merge came from a remote. Validating after the ref moved would leave
  // the ledger pointing at a revision no reader can load, recoverable only with
  // a manual `git update-ref`. The commit object may survive unreferenced; an
  // unreachable object is garbage, while a moved ref is a broken ledger.
  const snapshot = readSnapshot(repoRoot, { revision: commit }, run);
  casUpdateStateRef(repoRoot, commit, expectedRevision, run);
  return snapshot;
}

// --- activation: low-level, checkout-independent ------------------------

// The nearest ancestor of `from` (inclusive) holding a `.git` entry — file or
// directory, so a linked worktree's gitdir pointer counts — or `null` outside
// any git repo. The same fs-only upward walk git itself does for discovery, and
// deliberately not `rev-parse --show-toplevel`: the anchor is derived on both
// the write and the read path, and git's answer is a realpath while the paths
// callers hold are not (`/var` vs `/private/var` on macOS), so mixing the two
// would compare a path against a differently spelled one. Being fs-only also
// keeps a directory outside any git repo at zero subprocesses.
function gitTopLevelDir(from) {
  let dir = path.resolve(from);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// The ledger a repo rooted at `repoRoot` owns, as a POSIX path relative to the
// git top-level (`.changeledger` in the canonical layout, `packages/app/
// .changeledger` when the ledger lives below it). `null` outside any git repo.
// `repoRoot` is always the parent of the discovered `.changeledger` — every
// producer of one is `findChangeledgerDir` or an explicit
// `path.join(root, '.changeledger')`, and every `repoRoot` is that directory's
// `dirname` — so the ledger path is derivable from the root alone.
export function ledgerAnchor(repoRoot) {
  const root = path.resolve(repoRoot);
  const topLevel = gitTopLevelDir(root);
  if (topLevel === null) return null;
  return path
    .relative(topLevel, path.join(root, LEDGER_DIR_NAME))
    .split(path.sep)
    .join(path.posix.sep);
}

// The activation record as stored, with `ledger_dir` still optional: the one
// reader that must tolerate the pre-anchor format, because repairing it is
// exactly `writeActivation`'s job. Every other caller goes through
// `readActivation`, which requires the anchor.
function readActivationRecord(repoRoot, run) {
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
  const ledgerDir = authority.ledger_dir;
  if (ledgerDir !== undefined && (typeof ledgerDir !== 'string' || ledgerDir === '')) {
    throw new Error('activation authority has a malformed ledger_dir');
  }
  return {
    oid,
    format_version: authority.format_version,
    state_ref: authority.state_ref,
    ledgerDir,
  };
}

// An activation with no anchor cannot answer which ledger it owns, and there is
// no second truth to fall back on: fail with the command that rewrites it.
export function readActivation(repoRoot, run = capturedRun) {
  const record = readActivationRecord(repoRoot, run);
  if (record === null) return null;
  if (record.ledgerDir === undefined) {
    throw new Error(
      `${ACTIVATION_REF} does not declare the ledger it activates (ledger_dir) — run \`changeledger activate\` to rewrite it`,
    );
  }
  return {
    format_version: record.format_version,
    state_ref: record.state_ref,
    ledger_dir: record.ledgerDir,
  };
}

// The activation of the ledger `repoRoot` owns, or `null` — no activation, or
// one anchored to a different ledger (a nested project under an activated host,
// whose own `.changeledger` the host's activation never covered). The single
// ownership decision: both the config seam and the content seam ask it here, so
// they cannot diverge, and a directory outside any git repo costs no subprocess.
export function resolveOwnedActivation(repoRoot, run) {
  const anchor = ledgerAnchor(repoRoot);
  if (anchor === null) return null;
  const activation = readActivation(repoRoot, run);
  if (activation === null) return null;
  return activation.ledger_dir === anchor ? activation : null;
}

// Compare-and-swap activation write. Stage 1 shipped this as a bare
// `update-ref` with no old-value — a deliberate force-update with no CLI on top
// of it, left as the declared pending of 20260808-151640 until an adoption UX
// existed. It now has three outcomes and no fourth:
//
// - absent: created with a zero old-value, so a concurrent writer that won the
//   race is detected instead of being silently overwritten;
// - present and declaring the SAME state_ref: the same decision already taken —
//   a no-op that does not move the ref (the commit object cannot be compared
//   directly: `commit-tree` stamps a timestamp, so re-deriving it would produce
//   a different oid for identical content and force-update every re-run);
// - present and declaring a DIFFERENT state_ref: a divergence a tool must never
//   resolve on its own. Explicit error, ref untouched, decision to the human.
//
// A plain Error (not LedgerConflictError) for divergence on purpose: the bin
// collapses LedgerConflictError to the actionable CAS message, which is exactly
// the wrong advice for a divergence that a re-run cannot fix.
//
// The activation also records the ledger it is taken for (`ledger_dir`), so an
// activation present but declaring a DIFFERENT ledger is refused on the same
// grounds as a different state_ref, and one declaring NO ledger — the pre-anchor
// format — is rewritten in place: that repair is what makes the read path's
// refusal actionable rather than terminal.
export function writeActivation(repoRoot, { stateRef } = {}, run = capturedRun) {
  if (typeof stateRef !== 'string' || stateRef === '') {
    throw new Error('writeActivation requires a stateRef');
  }
  const ledgerDir = ledgerAnchor(repoRoot);
  if (ledgerDir === null) {
    throw new Error(`cannot activate ${repoRoot}: it is not inside a Git repository`);
  }
  const current = readActivationRecord(repoRoot, run);
  if (current !== null) {
    if (current.state_ref !== stateRef) {
      throw new Error(
        `${ACTIVATION_REF} already activates "${current.state_ref}", not "${stateRef}" — refusing to overwrite an existing activation`,
      );
    }
    if (current.ledgerDir === ledgerDir) return { revision: current.oid, created: false };
    if (current.ledgerDir !== undefined) {
      throw new Error(
        `${ACTIVATION_REF} already activates the ledger "${current.ledgerDir}", not "${ledgerDir}" — refusing to overwrite an existing activation`,
      );
    }
  }
  const authorityText = stringifyYaml({
    format_version: STATE_SCHEMA_VERSION,
    state_ref: stateRef,
    ledger_dir: ledgerDir,
  });
  const tree = buildTree(repoRoot, {
    base: null,
    writes: new Map([[ACTIVATION_AUTHORITY_PATH, authorityText]]),
    removals: new Set(),
  });
  const commit = commitTree(repoRoot, tree, { parents: [], message: 'chore: activation' }, run);
  const previous = current === null ? '0'.repeat(commit.length) : current.oid;
  try {
    run(['update-ref', ACTIVATION_REF, commit, previous], repoRoot);
  } catch (e) {
    // Same discipline as `initState` and `mutateState`: only a ref that no
    // longer holds the old value this write expected proves a concurrent writer
    // won. Any other failure (a stale `.lock`) left the ref exactly where it
    // was and must not be relabeled as a race the caller could retry away.
    const now = refOidAfterUpdateFailure(repoRoot, ACTIVATION_REF, run, e);
    if (current === null ? now !== null : now !== current.oid) {
      throw new LedgerConflictError(`${ACTIVATION_REF} was written concurrently`, { cause: e });
    }
    throw e;
  }
  return { revision: commit, created: current === null, repaired: current !== null };
}
