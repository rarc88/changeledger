import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { mutateLedgerFile, repoIsActivated, writeLedgerFiles } from '../src/change-store.mjs';
import { capturedRun } from '../src/git.mjs';
import {
  LedgerConflictError,
  readSnapshot,
  STATE_REF,
  STATE_ROOT,
  writeActivation,
} from '../src/state-store.mjs';
import { git, initStateRepo, seedStateRepo } from './helpers/state-repo.mjs';

function activeRepo() {
  const { root, revision } = seedStateRepo();
  return { repo: { repoRoot: root, state: { revision } }, root, revision };
}

// --- repoIsActivated -----------------------------------------------------

test('repoIsActivated: a plain non-git directory is inactive with zero git subprocesses', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-cs-'));
  const throwingRun = () => {
    throw new Error('unexpected git subprocess invocation');
  };
  assert.equal(repoIsActivated(dir, throwingRun), false);
});

test('repoIsActivated: a git repo with no activation record is inactive', () => {
  const root = initStateRepo();
  assert.equal(repoIsActivated(root), false);
});

test('repoIsActivated: a git repo with an activation record is active', () => {
  const root = initStateRepo();
  writeActivation(root, { stateRef: STATE_REF });
  assert.equal(repoIsActivated(root), true);
});

// --- mutateLedgerFile: inactive passthrough -------------------------------

test('mutateLedgerFile inactive: delegates to mutateFileAtomic on the worktree file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-cs-'));
  const file = path.join(dir, 'doc.md');
  fs.writeFileSync(file, 'before\n');

  const result = mutateLedgerFile({ state: null }, { file }, (text) => `${text}after\n`);

  assert.equal(result, 'before\nafter\n');
  assert.equal(fs.readFileSync(file, 'utf8'), 'before\nafter\n');
});

test('mutateLedgerFile inactive: returning undefined skips the write', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-cs-'));
  const file = path.join(dir, 'doc.md');
  fs.writeFileSync(file, 'before\n');

  mutateLedgerFile({ state: null }, { file }, () => undefined);

  assert.equal(fs.readFileSync(file, 'utf8'), 'before\n');
});

// --- mutateLedgerFile / writeLedgerFiles: active (CR1) --------------------

test('CR1: an active mutation lands as a CAS commit on the state ref, worktree untouched', () => {
  const { repo, root, revision } = activeRepo();
  const relPath = 'changes/20260808-000001-change.md';
  const before = readSnapshot(root, { revision }).documents[relPath];

  const after = mutateLedgerFile(repo, { relPath, text: before }, (text) => `${text}more\n`, {
    message: 'status: 20260808-000001 → in-progress',
  });

  assert.equal(after, `${before}more\n`);
  const newRevision = git(root, ['rev-parse', STATE_REF]);
  assert.notEqual(newRevision, revision);
  const snapshot = readSnapshot(root, { revision: newRevision });
  assert.equal(snapshot.documents[relPath], after);
  assert.equal(
    git(root, ['log', '-1', '--format=%s', STATE_REF]),
    'status: 20260808-000001 → in-progress',
  );
  // Worktree is never touched by the active path.
  assert.equal(fs.existsSync(path.join(root, STATE_ROOT)), false);
});

test('CR1: undefined from mutate skips the write, ref does not advance', () => {
  const { repo, root, revision } = activeRepo();
  const relPath = 'changes/20260808-000001-change.md';

  mutateLedgerFile(repo, { relPath, text: 'anything' }, () => undefined, { message: 'noop' });

  assert.equal(git(root, ['rev-parse', STATE_REF]), revision);
});

test('writeLedgerFiles active: multiple entries land in exactly one commit', () => {
  const { repo, root, revision } = activeRepo();
  const before = readSnapshot(root, { revision });

  writeLedgerFiles(
    repo,
    [
      { relPath: 'changes/20260808-000001-change.md', text: 'changed\n' },
      { relPath: 'specs/demo-spec.md', text: 'graduated\n' },
    ],
    { message: 'graduate: 20260808-000001' },
  );

  const tip = git(root, ['rev-parse', STATE_REF]);
  assert.equal(git(root, ['rev-list', '--count', `${revision}..${tip}`]), '1');
  const snapshot = readSnapshot(root, { revision: tip });
  assert.equal(snapshot.documents['changes/20260808-000001-change.md'], 'changed\n');
  assert.equal(snapshot.documents['specs/demo-spec.md'], 'graduated\n');
  assert.notEqual(before.documents['changes/20260808-000001-change.md'], 'changed\n');
});

// --- CR2: CAS conflict propagates undisguised -----------------------------

test('CR2: a stale expectedRevision surfaces LedgerConflictError, ref stays put, no partial write', () => {
  const { root, revision } = seedStateRepo();
  // Advance the ref out from under the caller, simulating a concurrent writer.
  const relPath = 'changes/20260808-000001-change.md';
  writeLedgerFiles({ repoRoot: root, state: { revision } }, [{ relPath, text: 'concurrent\n' }], {
    message: 'concurrent write',
  });
  const advancedTip = git(root, ['rev-parse', STATE_REF]);
  assert.notEqual(advancedTip, revision);

  assert.throws(
    () =>
      mutateLedgerFile(
        { repoRoot: root, state: { revision } },
        { relPath, text: 'anything' },
        (text) => `${text}stale\n`,
        { message: 'stale write' },
      ),
    LedgerConflictError,
  );

  // The ref is exactly where the concurrent writer left it; the failed
  // caller's text is nowhere in its snapshot.
  assert.equal(git(root, ['rev-parse', STATE_REF]), advancedTip);
  const snapshot = readSnapshot(root, { revision: advancedTip });
  assert.equal(snapshot.documents[relPath], 'concurrent\n');
});

// --- CR7: identity integrity runs through this seam -----------------------

test('CR7: a candidate that would silently drop a document is rejected through this seam', () => {
  const { root, revision } = seedStateRepo();
  const survivingPath = `${STATE_ROOT}/changes/20260808-000001-change.md`;
  let lsTreeCalls = 0;
  // The public write-only API cannot honestly build a candidate that drops an
  // untouched document; fault-inject the second ls-tree read (the candidate
  // tree) to simulate the exact defect the integrity check exists to catch.
  const faultyRun = (args, cwd, options) => {
    const out = capturedRun(args, cwd, options);
    if (args[0] === 'ls-tree') {
      lsTreeCalls += 1;
      if (lsTreeCalls === 2) {
        return out
          .split('\0')
          .filter((record) => record !== '' && !record.includes(survivingPath))
          .map((record) => `${record}\0`)
          .join('');
      }
    }
    return out;
  };

  assert.throws(
    () =>
      writeLedgerFiles(
        { repoRoot: root, state: { revision } },
        [{ relPath: 'changes/other.md', text: 'otro\n' }],
        { message: 'feat: unrelated', run: faultyRun },
      ),
    /removes ".*20260808-000001-change\.md" without an explicit stage\.remove/,
  );
  assert.equal(git(root, ['rev-parse', STATE_REF]), revision);
});
