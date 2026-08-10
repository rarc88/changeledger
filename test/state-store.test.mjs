import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { capturedRun } from '../src/git.mjs';
import {
  ACTIVATION_REF,
  initState,
  LedgerConflictError,
  mutateState,
  readActivation,
  readSnapshot,
  readStateConfigText,
  readStateRef,
  STATE_REF,
  STATE_ROOT,
  STATE_SCHEMA_VERSION,
  writeActivation,
} from '../src/state-store.mjs';
import { sanitizedEnv } from './helpers/git-env.mjs';
import {
  buildTreeEntries,
  changeText,
  commitTree,
  defaultStateFiles,
  git,
  initStateRepo,
  releaseText,
  seedStateRepo,
  specText,
  updateRef,
  writeLooseRef,
} from './helpers/state-repo.mjs';

function porcelainStatus(root) {
  return execFileSync('git', ['status', '--porcelain'], {
    cwd: root,
    env: sanitizedEnv(),
    encoding: 'utf8',
  });
}

// --- CR1: initState creates the ref with the full layout -------------------

test('CR1: initState creates the ref, and its tree carries the manifest', () => {
  const root = initStateRepo();
  const { revision } = initState(root, { projectId: 'demo' });

  assert.equal(git(root, ['rev-parse', STATE_REF]), revision);
  const manifestOid = git(root, ['rev-parse', `${revision}:${STATE_ROOT}/manifest.yml`]);
  const manifest = git(root, ['cat-file', 'blob', manifestOid]);
  assert.match(manifest, /format_version:\s*1/);
  assert.match(manifest, /project_id:\s*demo/);
  assert.equal(porcelainStatus(root), '');
});

test('CR1: a second initState on the same repo throws without moving the ref', () => {
  const root = initStateRepo();
  const { revision } = initState(root, { projectId: 'demo' });

  assert.throws(() => initState(root, { projectId: 'demo' }), /already initialized/);
  assert.equal(git(root, ['rev-parse', STATE_REF]), revision);
});

// --- CR2: the snapshot is read with no checkout, byte-identical ------------

test('CR2: readSnapshot returns byte-identical multibyte content with no checkout', () => {
  const { root, revision } = seedStateRepo();
  const snapshot = readSnapshot(root);

  assert.equal(snapshot.revision, revision);
  assert.equal(snapshot.documents['changes/20260808-000001-change.md'], changeText());
  assert.equal(snapshot.documents['specs/demo-spec.md'], specText());
  assert.equal(snapshot.documents['releases/0.1.0.yml'], releaseText());
  assert.equal(fs.existsSync(path.join(root, STATE_ROOT)), false);
});

// --- CR3: the CAS mutation advances the ref with the correct parent --------

test('CR3: mutateState advances the ref with the source revision as sole parent', () => {
  const { root, revision: s1 } = seedStateRepo();
  const texto = 'contenido nuevo: café, mañana\n';

  const snapshot = mutateState(root, { expectedRevision: s1, message: 'feat: add x' }, (stage) => {
    stage.write('changes/x.md', texto);
  });
  const s2 = snapshot.revision;

  assert.notEqual(s2, s1);
  assert.equal(git(root, ['rev-parse', STATE_REF]), s2);
  const parents = git(root, ['rev-list', '--parents', '-n', '1', s2]).split(/\s+/).slice(1);
  assert.deepEqual(parents, [s1]);

  assert.equal(readSnapshot(root, { revision: s2 }).documents['changes/x.md'], texto);
  assert.equal(porcelainStatus(root), '');
});

// --- CR4: a CAS conflict fails explicit and leaves the ref untouched -------

test('CR4: a stale expectedRevision throws LedgerConflictError naming both OIDs, ref unmoved', () => {
  const { root, revision: s1 } = seedStateRepo();
  const { revision: s2 } = mutateState(
    root,
    { expectedRevision: s1, message: 'feat: advance' },
    (stage) => stage.write('changes/other.md', 'x\n'),
  );

  assert.throws(
    () =>
      mutateState(root, { expectedRevision: s1, message: 'feat: conflict' }, (stage) =>
        stage.write('changes/y.md', 'y\n'),
      ),
    (e) => e instanceof LedgerConflictError && e.message.includes(s1) && e.message.includes(s2),
  );
  assert.equal(git(root, ['rev-parse', STATE_REF]), s2);
});

// --- CR5: a non-commit object is never accepted via a silent peel ----------

test('CR5: a state ref resolving to a tag, and an activation ref resolving to a blob, both reject naming the real type', () => {
  const root = initStateRepo();
  const { revision } = initState(root, { projectId: 'demo' });
  git(root, ['tag', '-a', '-m', 'tag', 'v1', revision]);
  const tagOid = git(root, ['rev-parse', 'refs/tags/v1']);
  // update-ref itself refuses a non-commit object under refs/heads/, so the
  // fixture writes the loose ref file directly to fabricate the scenario.
  writeLooseRef(root, STATE_REF, tagOid);
  assert.throws(() => readSnapshot(root), /resolves to a tag, not a commit/);

  const blobOid = git(root, ['hash-object', '-w', '--stdin'], { input: 'blob\n' });
  updateRef(root, ACTIVATION_REF, blobOid);
  assert.throws(() => readActivation(root), /resolves to a blob, not a commit/);
});

// --- CR6: ref absence and read failure are distinct outcomes ---------------

test('CR6: readActivation returns null when absent, and throws (not null) on an injected subprocess failure', () => {
  const root = initStateRepo();
  assert.equal(readActivation(root), null);

  const failing = (args, cwd, options) => {
    if (args[0] === 'rev-parse') {
      const e = new Error('fatal: boom');
      throw e;
    }
    return capturedRun(args, cwd, options);
  };
  assert.throws(() => readActivation(root, failing), /fatal: boom/);
});

// --- CR7: a non-UTF-8 blob is rejected, never transcoded -------------------

test('CR7: a non-UTF-8 blob is rejected naming its path, never as U+FFFD', () => {
  const root = initStateRepo();
  const badOid = git(root, ['hash-object', '-w', '--stdin'], { input: Buffer.from([0xff, 0xfe]) });
  const entries = Object.entries(defaultStateFiles()).map(([p, text]) => ({ path: p, text }));
  entries.push({ path: `${STATE_ROOT}/changes/legacy.md`, oid: badOid });
  const tree = buildTreeEntries(root, entries);
  const revision = commitTree(root, tree);
  updateRef(root, STATE_REF, revision);

  assert.throws(() => readSnapshot(root), {
    message: `state path ${STATE_ROOT}/changes/legacy.md is not valid UTF-8`,
  });
  try {
    readSnapshot(root);
    assert.fail('expected readSnapshot to throw');
  } catch (e) {
    assert.equal(e.message.includes('�'), false);
  }
});

test('20260809-113242 CR9: focused config read validates layout without reading document bodies', () => {
  const root = initStateRepo();
  const badOid = git(root, ['hash-object', '-w', '--stdin'], { input: Buffer.from([0xff, 0xfe]) });
  const entries = Object.entries(defaultStateFiles()).map(([p, text]) => ({ path: p, text }));
  entries.find((entry) => entry.path.endsWith('/changes/20260808-000001-change.md')).oid = badOid;
  delete entries.find((entry) => entry.path.endsWith('/changes/20260808-000001-change.md')).text;
  const tree = buildTreeEntries(root, entries);
  const revision = commitTree(root, tree);
  updateRef(root, STATE_REF, revision);

  assert.equal(readStateConfigText(root), 'project_id: demo\n');
});

// --- CR8: non-regular entries and out-of-layout paths reject both ways ----

test('CR8: a symlink tree entry is rejected on read, naming the entry and its mode', () => {
  const root = initStateRepo();
  const linkOid = git(root, ['hash-object', '-w', '--stdin'], { input: 'changes/target.md' });
  const entries = Object.entries(defaultStateFiles()).map(([p, text]) => ({ path: p, text }));
  entries.push({ path: `${STATE_ROOT}/changes/link.md`, mode: '120000', oid: linkOid });
  const tree = buildTreeEntries(root, entries);
  const revision = commitTree(root, tree);
  updateRef(root, STATE_REF, revision);

  assert.throws(() => readSnapshot(root), /120000/);
});

test('CR8: mutateState rejects a write outside the layout, leaving the ref untouched', () => {
  const { root, revision } = seedStateRepo();
  for (const badPath of ['../fuera.md', 'code/x.js']) {
    assert.throws(
      () =>
        mutateState(root, { expectedRevision: revision, message: 'x' }, (stage) =>
          stage.write(badPath, 'x'),
        ),
      /invalid state path/,
    );
  }
  assert.equal(git(root, ['rev-parse', STATE_REF]), revision);
});

// --- CR9: no identity disappears without an explicit remove ----------------

test('CR9: an integrity violation (identity vanished without an explicit remove) is rejected, ref unmoved', () => {
  const { root, revision: s1 } = seedStateRepo();
  const targetPath = `${STATE_ROOT}/changes/20260808-000001-change.md`;
  let lsTreeCalls = 0;
  // Fault-injected `run`: the public write/remove API cannot honestly build a
  // candidate that drops an untouched document, so this simulates the exact
  // defect (a construction bug silently losing an entry) the integrity check
  // exists to catch, by fabricating the SECOND ls-tree read (the candidate
  // tree) to omit `targetPath`.
  const faultyRun = (args, cwd, options) => {
    const out = capturedRun(args, cwd, options);
    if (args[0] === 'ls-tree') {
      lsTreeCalls += 1;
      if (lsTreeCalls === 2) {
        return out
          .split('\0')
          .filter((record) => record !== '' && !record.includes(targetPath))
          .map((record) => `${record}\0`)
          .join('');
      }
    }
    return out;
  };

  assert.throws(
    () =>
      mutateState(
        root,
        { expectedRevision: s1, message: 'feat: unrelated' },
        (stage) => stage.write('changes/other.md', 'otro\n'),
        faultyRun,
      ),
    /removes ".*20260808-000001-change\.md" without an explicit stage\.remove/,
  );
  assert.equal(git(root, ['rev-parse', STATE_REF]), s1);
});

test('CR9: an explicit stage.remove advances the ref and drops the document', () => {
  const { root, revision: s1 } = seedStateRepo();
  const relPath = 'changes/20260808-000001-change.md';

  const snapshot = mutateState(
    root,
    { expectedRevision: s1, message: 'feat: remove x' },
    (stage) => {
      stage.remove(relPath);
    },
  );

  assert.notEqual(snapshot.revision, s1);
  assert.equal(git(root, ['rev-parse', STATE_REF]), snapshot.revision);
  assert.equal(relPath in snapshot.documents, false);
});

// --- CR10: the low-level activation is checkout-independent ----------------

test('CR10: activation survives a checkout change and touches no working-tree file', () => {
  const root = initStateRepo();
  git(root, ['commit', '--allow-empty', '-qm', 'root']);
  writeActivation(root, { stateRef: STATE_REF });
  git(root, ['branch', 'other']);
  git(root, ['checkout', '-q', 'other']);

  assert.deepEqual(readActivation(root), {
    format_version: STATE_SCHEMA_VERSION,
    state_ref: STATE_REF,
    ledger_dir: '.changeledger',
  });
  assert.equal(fs.existsSync(path.join(root, 'authority.yml')), false);
  assert.equal(fs.existsSync(path.join(root, STATE_ROOT)), false);
});

// --- 20260809-113240 CR6: writeActivation is compare-and-swap ---------------

// Stage 1 shipped `writeActivation` as a bare `update-ref` with no old-value: a
// deliberate force-update, left as the declared pending of 20260808-151640
// until an adoption UX existed. These three cases are that semantics.

test('20260809-113240 CR6: writeActivation creates the activation ref when absent', () => {
  const root = initStateRepo();

  const { revision, created } = writeActivation(root, { stateRef: STATE_REF });

  assert.equal(created, true);
  assert.equal(git(root, ['rev-parse', ACTIVATION_REF]), revision);
  assert.deepEqual(readActivation(root), {
    format_version: STATE_SCHEMA_VERSION,
    state_ref: STATE_REF,
    ledger_dir: '.changeledger',
  });
});

test('20260809-113240 CR6: writeActivation over an identical activation is a no-op that does not move the ref', () => {
  const root = initStateRepo();
  const { revision } = writeActivation(root, { stateRef: STATE_REF });

  const again = writeActivation(root, { stateRef: STATE_REF });

  assert.equal(again.created, false);
  assert.equal(again.revision, revision);
  assert.equal(git(root, ['rev-parse', ACTIVATION_REF]), revision);
});

test('20260809-113240 CR6: writeActivation refuses a divergent activation instead of forcing it', () => {
  const root = initStateRepo();
  const { revision } = writeActivation(root, { stateRef: 'refs/heads/other/state' });

  assert.throws(
    () => writeActivation(root, { stateRef: STATE_REF }),
    (e) => /refs\/heads\/other\/state/.test(e.message) && /refus/i.test(e.message),
  );
  assert.equal(git(root, ['rev-parse', ACTIVATION_REF]), revision);
  assert.equal(readActivation(root).state_ref, 'refs/heads/other/state');
});

// --- 20260810-120457: the activation anchors the ledger it owns -------------
//
// Ownership of a discovered `.changeledger` used to be inferred (its location
// relative to the git top-level, plus the marker's `project_id`). The
// activation now records the ledger it was taken for, so the question is an
// exact path comparison and no inference survives.

// An activation written in the pre-anchor format: valid `format_version` and
// `state_ref`, no `ledger_dir`. Built with raw plumbing, never through
// `writeActivation`, so a bug there cannot fabricate the very shape under test.
function legacyActivation(root, { stateRef = STATE_REF } = {}) {
  const tree = buildTreeEntries(root, [
    { path: 'authority.yml', text: `format_version: 1\nstate_ref: ${stateRef}\n` },
  ]);
  const revision = commitTree(root, tree, { message: 'chore: activation' });
  updateRef(root, ACTIVATION_REF, revision);
  return revision;
}

test('20260810-120457 CR1: writeActivation anchors the ledger directory of the repo it activates', () => {
  const root = initStateRepo();

  writeActivation(root, { stateRef: STATE_REF });

  assert.deepEqual(readActivation(root), {
    format_version: STATE_SCHEMA_VERSION,
    state_ref: STATE_REF,
    ledger_dir: '.changeledger',
  });
});

test('20260810-120457 CR1: the anchor is the ledger path relative to the git top-level', () => {
  const root = initStateRepo();
  const nested = path.join(root, 'packages', 'app');
  fs.mkdirSync(path.join(nested, '.changeledger'), { recursive: true });

  writeActivation(nested, { stateRef: STATE_REF });

  assert.equal(readActivation(root).ledger_dir, 'packages/app/.changeledger');
  assert.equal(readActivation(nested).ledger_dir, 'packages/app/.changeledger');
});

// writeActivation's own precondition, exercised directly rather than through
// a CLI caller: `activate` and `cutover` both already run a git subprocess
// before reaching writeActivation, so a non-Git `repoRoot` never gets this far
// through either of them — but writeActivation is exported and callable on its
// own, and it must still refuse to write `ledger_dir: null` into the
// activation authority for a repoRoot outside any Git repository.
test('20260810-180434: writeActivation refuses a repoRoot outside any Git repository', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-no-git-'));

  assert.throws(
    () => writeActivation(root, { stateRef: STATE_REF }),
    /^Error: cannot activate .+: it is not inside a Git repository$/,
  );
});

test('20260810-120457 CR5: readActivation refuses an activation that declares no ledger_dir', () => {
  const root = initStateRepo();
  legacyActivation(root);

  assert.throws(
    () => readActivation(root),
    (e) => /ledger_dir/.test(e.message) && /changeledger activate/.test(e.message),
  );
});

test('20260810-120457 CR5: re-activating repairs an activation written without the anchor', () => {
  const root = initStateRepo();
  const legacy = legacyActivation(root);

  const { revision, created } = writeActivation(root, { stateRef: STATE_REF });

  assert.equal(created, false);
  assert.notEqual(revision, legacy);
  assert.equal(git(root, ['rev-parse', ACTIVATION_REF]), revision);
  assert.equal(readActivation(root).ledger_dir, '.changeledger');
});

test('20260810-120457 CR5: an activation anchored to another ledger is refused, never overwritten', () => {
  const root = initStateRepo();
  const nested = path.join(root, 'packages', 'app');
  fs.mkdirSync(path.join(nested, '.changeledger'), { recursive: true });
  const { revision } = writeActivation(nested, { stateRef: STATE_REF });

  assert.throws(
    () => writeActivation(root, { stateRef: STATE_REF }),
    (e) => /packages\/app\/\.changeledger/.test(e.message) && /refus/i.test(e.message),
  );
  assert.equal(git(root, ['rev-parse', ACTIVATION_REF]), revision);
  assert.equal(readActivation(root).ledger_dir, 'packages/app/.changeledger');
});

// --- CR11: the core works on SHA-256 repositories ---------------------------

test('CR11: CR1-CR4 scenarios pass on a sha256 repository with 64-char oids', () => {
  const bareRoot = initStateRepo({ objectFormat: 'sha256' });
  const { revision: bareRevision } = initState(bareRoot, { projectId: 'demo' });
  assert.equal(bareRevision.length, 64);
  assert.throws(() => initState(bareRoot, { projectId: 'demo' }), /already initialized/);

  const { root, revision: s1 } = seedStateRepo({ objectFormat: 'sha256' });
  assert.equal(s1.length, 64);
  const snapshot = readSnapshot(root);
  assert.equal(snapshot.documents['changes/20260808-000001-change.md'], changeText());

  const { revision: s2 } = mutateState(
    root,
    { expectedRevision: s1, message: 'feat: x' },
    (stage) => stage.write('changes/x.md', 'x\n'),
  );
  assert.equal(s2.length, 64);
  assert.equal(git(root, ['rev-parse', STATE_REF]), s2);

  assert.throws(
    () =>
      mutateState(root, { expectedRevision: s1, message: 'feat: conflict' }, (stage) =>
        stage.write('changes/y.md', 'y\n'),
      ),
    (e) => e instanceof LedgerConflictError && e.message.includes(s1) && e.message.includes(s2),
  );
});

// --- readStateRef: fail-closed absence ---------------------------------

test('readStateRef returns null when the ref does not exist', () => {
  const root = initStateRepo();
  assert.equal(readStateRef(root), null);
});

// --- correction round (independent review, fail-retry) ---------------------

// Finding 1: `--verify --quiet` exits 1 with EMPTY stderr for a genuinely
// absent ref, but ALSO exits 1 with a non-empty "warning: ignoring broken
// ref ..." for a corrupt loose ref (probed directly against real git). The
// pre-fix `optionalRefOid` classified both as absence purely from
// `status === 1`, so a corrupt ref silently read back as "not initialized"
// instead of failing loudly.
test('CORRECTION 1: a broken loose state ref throws (real git exit path), never read back as absence', () => {
  const root = initStateRepo();
  // Garbage content, not a valid oid — this is what `git update-ref` itself
  // refuses to write, so the fixture writes the loose ref file directly.
  writeLooseRef(root, STATE_REF, 'not-a-valid-ref-target');

  assert.throws(() => readStateRef(root), /cannot read Git ref|broken ref/);
});

function lockRefPath(root, ref) {
  const gitDir = git(root, ['rev-parse', '--git-dir']);
  return path.join(root, gitDir, `${ref}.lock`);
}

function withStaleLock(root, ref, fn) {
  const lockPath = lockRefPath(root, ref);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, '');
  try {
    return fn();
  } finally {
    fs.rmSync(lockPath, { force: true });
  }
}

// Finding 2a: `advanceOrConflict` relabeled EVERY `update-ref` failure as
// LedgerConflictError. A stale `.lock` file makes `update-ref` fail for a
// reason that has nothing to do with the ref's value (it never moved), so the
// old code produced the self-contradicting "expected X, found X — reload and
// retry".
test('CORRECTION 2a: a stale .lock during mutateState is NOT relabeled LedgerConflictError', () => {
  const { root, revision: s1 } = seedStateRepo();

  withStaleLock(root, STATE_REF, () => {
    assert.throws(
      () =>
        mutateState(root, { expectedRevision: s1, message: 'feat: x' }, (stage) =>
          stage.write('changes/x.md', 'x\n'),
        ),
      (e) =>
        !(e instanceof LedgerConflictError) && /cannot lock ref|Unable to create/.test(e.message),
    );
  });
  assert.equal(git(root, ['rev-parse', STATE_REF]), s1);
});

// Finding 2b: same over-broad catch in `initState`, relabeling any
// `update-ref` failure as "already initialized".
test('CORRECTION 2b: a stale .lock during initState is NOT relabeled "already initialized"', () => {
  const root = initStateRepo();

  withStaleLock(root, STATE_REF, () => {
    assert.throws(
      () => initState(root, { projectId: 'demo' }),
      (e) =>
        !/already initialized/.test(e.message) &&
        /cannot lock ref|Unable to create/.test(e.message),
    );
  });
  assert.equal(readStateRef(root), null);
});

// Finding 2c (20260810-120457): the third CAS site. `writeActivation` has two
// arms — creating the ref from absence, and rewriting an activation that
// declares no `ledger_dir` over its current oid — and a stale `.lock` fails
// both for a reason that has nothing to do with the ref's value. Relabeling
// either as a concurrent write would send the caller retrying a race that never
// happened, exactly as 2a/2b describe for the other two sites.
test('CORRECTION 2c: a stale .lock creating the activation is NOT relabeled a concurrent write', () => {
  const root = initStateRepo();

  withStaleLock(root, ACTIVATION_REF, () => {
    assert.throws(
      () => writeActivation(root, { stateRef: STATE_REF }),
      (e) =>
        !(e instanceof LedgerConflictError) &&
        !/written concurrently/.test(e.message) &&
        /cannot lock ref|Unable to create/.test(e.message),
    );
  });
  assert.equal(readActivation(root), null);
});

test('CORRECTION 2c: a stale .lock repairing the activation is NOT relabeled a concurrent write', () => {
  const root = initStateRepo();
  const legacy = legacyActivation(root);

  withStaleLock(root, ACTIVATION_REF, () => {
    assert.throws(
      () => writeActivation(root, { stateRef: STATE_REF }),
      (e) =>
        !(e instanceof LedgerConflictError) &&
        !/written concurrently/.test(e.message) &&
        /cannot lock ref|Unable to create/.test(e.message),
    );
  });
  assert.equal(git(root, ['rev-parse', ACTIVATION_REF]), legacy);
});

// Finding 3: the `fs.lstatSync(repoRoot/.git)` pre-check misclassifies a
// SUBDIRECTORY of a repo (`.git` is not a direct child, but git still
// discovers the repo upward) as "not a repo". Dropped entirely — git's own
// exit 128 for a genuine non-repo is what the catch branch already handles.
test('CORRECTION 3: readStateRef resolves from a subdirectory of the repo (no false "not a repo")', () => {
  const { root, revision } = seedStateRepo();
  const subdir = path.join(root, 'sub', 'dir');
  fs.mkdirSync(subdir, { recursive: true });

  assert.equal(readStateRef(subdir), revision);
});

function doubleFailureRun(ref, primary, secondary) {
  let updateFailed = false;
  return (args, cwd, options) => {
    if (args[0] === 'update-ref' && args[1] === ref) {
      updateFailed = true;
      throw primary;
    }
    if (updateFailed && args[0] === 'rev-parse' && args.at(-1) === ref) throw secondary;
    return capturedRun(args, cwd, options);
  };
}

function assertPrimaryCause(run, primary) {
  assert.throws(run, (error) => {
    assert.equal(error instanceof LedgerConflictError, false);
    assert.equal(error.message, `cannot read Git ref ${STATE_REF}: secondary ref read`);
    assert.equal(error.cause, primary);
    return true;
  });
}

test('20260808-171107 CR2: initState preserves update-ref as the cause when conflict disambiguation also fails', () => {
  const root = initStateRepo();
  const primary = new Error('primary update-ref');
  const run = doubleFailureRun(STATE_REF, primary, new Error('secondary ref read'));

  assertPrimaryCause(() => initState(root, { projectId: 'demo' }, run), primary);
  assert.equal(readStateRef(root), null);
});

test('20260808-171107 CR2: mutateState preserves update-ref as the cause when conflict disambiguation also fails', () => {
  const { root, revision } = seedStateRepo();
  const primary = new Error('primary update-ref');
  const run = doubleFailureRun(STATE_REF, primary, new Error('secondary ref read'));

  assertPrimaryCause(
    () =>
      mutateState(
        root,
        { expectedRevision: revision, message: 'feat: losing write' },
        (stage) => stage.write('changes/loser.md', 'loser\n'),
        run,
      ),
    primary,
  );
  assert.equal(readStateRef(root), revision);
});

test('20260808-171107 CR2: writeActivation preserves update-ref as the cause when conflict disambiguation also fails', () => {
  const root = initStateRepo();
  const primary = new Error('primary update-ref');
  const secondary = new Error('secondary ref read');
  const run = doubleFailureRun(ACTIVATION_REF, primary, secondary);

  assert.throws(
    () => writeActivation(root, { stateRef: STATE_REF }, run),
    (error) => {
      assert.equal(error instanceof LedgerConflictError, false);
      assert.equal(error.message, `cannot read Git ref ${ACTIVATION_REF}: secondary ref read`);
      assert.equal(error.cause, primary);
      return true;
    },
  );
  assert.equal(readActivation(root), null);
});

// 20260809-194236 CR3 — post-review of 171107 found this test's coverage
// injected: it fabricated `error.cause` by hand instead of exercising the
// real `capturedRun` exit path, so it proved the message-building logic in
// isolation but never that real git's stderr actually threads through that
// path the way the fabricated shape assumed. Replaced with the cheap real
// fixture (a loose state ref overwritten with corrupt content) already
// proven in "CORRECTION 1" above, but pinned to the exact single-copy
// diagnostic instead of that test's looser `/cannot read Git ref|broken
// ref/`, which passed unchanged against the wrapper-message mutant re-derived
// below.
test('20260809-194236 CR3: a broken loose state ref fails with the exact real-git diagnostic', () => {
  const root = initStateRepo();
  writeLooseRef(root, STATE_REF, 'not-a-valid-ref-target');

  assert.throws(() => readStateRef(root), {
    message: `cannot read Git ref ${STATE_REF}: warning: ignoring broken ref ${STATE_REF}`,
  });
});
