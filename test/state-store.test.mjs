import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
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
  readStateRef,
  STATE_REF,
  STATE_ROOT,
  STATE_SCHEMA_VERSION,
  writeActivation,
} from '../src/state-store.mjs';
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
  return execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
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

  assert.throws(() => readSnapshot(root), /changes\/legacy\.md/);
  try {
    readSnapshot(root);
    assert.fail('expected readSnapshot to throw');
  } catch (e) {
    assert.equal(e.message.includes('�'), false);
  }
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
  });
  assert.equal(fs.existsSync(path.join(root, 'authority.yml')), false);
  assert.equal(fs.existsSync(path.join(root, STATE_ROOT)), false);
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
