// `changeledger cutover` and `cutover --undo` — the one-shot stage-2 adoption
// tool (20260809-113240 CR1-CR5, CR7, CR8). Every assertion goes through the
// real bin so the exit code under test is the process's own.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadRepo } from '../src/repo.mjs';
import {
  ACTIVATION_REF,
  mutateState,
  readSnapshot,
  STATE_REF,
  STATE_ROOT,
} from '../src/state-store.mjs';
import {
  buildTree,
  commitTree,
  defaultLedgerFiles,
  defaultStateFiles,
  git,
  ledgerChangeText,
  ledgerConfigText,
  ledgerReleaseText,
  ledgerSpecText,
  seedLedgerRepo,
  updateRef,
  writeLedgerFiles,
} from './helpers/state-repo.mjs';

const BIN = fileURLToPath(new URL('../bin/changeledger.mjs', import.meta.url));

const CLI_ENV = { ...process.env };
for (const key of [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CEILING_DIRECTORIES',
]) {
  delete CLI_ENV[key];
}

function cli(root, ...args) {
  try {
    const out = execFileSync(process.execPath, [BIN, ...args], {
      cwd: root,
      env: CLI_ENV,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out, err: '' };
  } catch (e) {
    return { code: e.status ?? 1, out: e.stdout ?? '', err: e.stderr ?? '' };
  }
}

const CHANGE_DOC = 'changes/20260808-000001-demo.md';
const SPEC_DOC = 'specs/demo-spec.md';
const RELEASE_DOC = 'releases/0.1.0.yml';

function head(root) {
  return git(root, ['rev-parse', 'HEAD']);
}

function refExists(root, ref) {
  try {
    git(root, ['rev-parse', '--verify', ref]);
    return true;
  } catch {
    return false;
  }
}

function exists(root, rel) {
  return fs.existsSync(path.join(root, rel));
}

// --- CR1: the happy path publishes, activates and cleans the worktree -------

test('20260809-113240 CR1: cutover publishes the ledger, activates the repo and commits the cleanup', () => {
  const { root } = seedLedgerRepo();
  const before = head(root);

  const { code, out } = cli(root, 'cutover');
  assert.equal(code, 0, out);

  const snapshot = readSnapshot(root);
  assert.deepEqual(Object.keys(snapshot.documents).sort(), [CHANGE_DOC, RELEASE_DOC, SPEC_DOC]);
  assert.equal(snapshot.documents[CHANGE_DOC], ledgerChangeText());
  assert.equal(snapshot.documents[SPEC_DOC], ledgerSpecText());
  assert.equal(snapshot.documents[RELEASE_DOC], ledgerReleaseText());
  // Byte for byte, comments included: the ref is the config authority once the
  // repo is activated, so a YAML round-trip here would silently lose them.
  // Read untrimmed on purpose: the fixture helper's `git()` trims, which would
  // make a trailing-newline loss invisible.
  assert.equal(
    execFileSync('git', ['cat-file', 'blob', `${STATE_REF}:${STATE_ROOT}/config.yml`], {
      cwd: root,
      env: CLI_ENV,
      encoding: 'utf8',
    }),
    ledgerConfigText,
  );

  assert.equal(refExists(root, ACTIVATION_REF), true);
  const repo = loadRepo(root);
  assert.equal(repo.state.revision, snapshot.revision);
  assert.deepEqual(
    repo.changes.map((c) => String(c.frontmatter.id)),
    ['20260808-000001'],
  );

  const parents = git(root, ['rev-list', '--parents', '-n', '1', 'HEAD']).split(/\s+/).slice(1);
  assert.deepEqual(parents, [before]);
  assert.equal(exists(root, '.changeledger/config.yml'), true);
  assert.equal(exists(root, '.changeledger/changes'), false);
  assert.equal(exists(root, '.changeledger/specs'), false);
  assert.equal(exists(root, '.changeledger/releases'), false);
  assert.equal(git(root, ['status', '--porcelain']), '');
});

// --- CR2: everything is validated before anything is written ----------------

test('20260809-113240 CR2: an invalid ledger aborts naming the document, writing nothing', () => {
  const { root } = seedLedgerRepo({
    files: defaultLedgerFiles({ changeText: ledgerChangeText({ withLog: false }) }),
  });
  const before = head(root);

  const { code, err } = cli(root, 'cutover');

  assert.notEqual(code, 0);
  assert.match(err, /20260808-000001-demo\.md/);
  assert.match(err, /log/i);
  assert.equal(refExists(root, STATE_REF), false);
  assert.equal(refExists(root, ACTIVATION_REF), false);
  assert.equal(head(root), before);
});

// --- CR3: a dirty ledger is refused -----------------------------------------

test('20260809-113240 CR3: an uncommitted edit under .changeledger/ is refused', () => {
  const { root } = seedLedgerRepo();
  const before = head(root);
  fs.appendFileSync(path.join(root, '.changeledger', 'changes', '20260808-000001-demo.md'), 'x\n');

  const { code, err } = cli(root, 'cutover');

  assert.notEqual(code, 0);
  assert.match(err, /clean ledger/);
  assert.equal(refExists(root, STATE_REF), false);
  assert.equal(refExists(root, ACTIVATION_REF), false);
  assert.equal(head(root), before);
});

// --- CR4: an identical re-run is a no-op ------------------------------------

test('20260809-113240 CR4: re-running cutover over an identical cut is a no-op on exit 0', () => {
  const { root } = seedLedgerRepo();
  assert.equal(cli(root, 'cutover').code, 0);
  const revision = git(root, ['rev-parse', STATE_REF]);
  const after = head(root);

  const { code, out } = cli(root, 'cutover');

  assert.equal(code, 0, out);
  assert.match(out, /already cut over/i);
  assert.equal(git(root, ['rev-parse', STATE_REF]), revision);
  assert.equal(head(root), after);
});

// --- CR5: a divergent state ref is refused without touching anything --------

test('20260809-113240 CR5: an existing state ref holding different content is refused', () => {
  const { root } = seedLedgerRepo();
  // A state ref whose content is NOT what this ledger would publish.
  const tree = buildTree(root, defaultStateFiles({ projectId: 'fixture01' }));
  const revision = commitTree(root, tree, { message: 'chore: foreign state' });
  updateRef(root, STATE_REF, revision);
  const before = head(root);

  const { code, err } = cli(root, 'cutover');

  assert.notEqual(code, 0);
  assert.match(err, /does not hold the ledger this cutover would publish/);
  assert.equal(git(root, ['rev-parse', STATE_REF]), revision);
  assert.equal(refExists(root, ACTIVATION_REF), false);
  assert.equal(head(root), before);
  assert.equal(exists(root, '.changeledger/changes'), true);
});

// --- CR7: the undo is a first-class path while the cut is reversible --------

test('20260809-113240 CR7: undo restores the worktree byte for byte and drops both refs', () => {
  const { root } = seedLedgerRepo();
  const files = defaultLedgerFiles();
  assert.equal(cli(root, 'cutover').code, 0);

  const { code, out } = cli(root, 'cutover', '--undo');

  assert.equal(code, 0, out);
  assert.equal(refExists(root, STATE_REF), false);
  assert.equal(refExists(root, ACTIVATION_REF), false);
  for (const [rel, text] of Object.entries(files)) {
    assert.equal(fs.readFileSync(path.join(root, rel), 'utf8'), text, rel);
  }
  assert.equal(git(root, ['status', '--porcelain']), '');
  assert.equal(loadRepo(root).state, null);
});

test('20260809-113240 CR7: a second undo fails, there is no cutover left to undo', () => {
  const { root } = seedLedgerRepo();
  assert.equal(cli(root, 'cutover').code, 0);
  assert.equal(cli(root, 'cutover', '--undo').code, 0);
  const before = head(root);

  const { code, err } = cli(root, 'cutover', '--undo');

  assert.notEqual(code, 0);
  assert.match(err, /nothing to undo/);
  assert.equal(head(root), before);
});

// --- CR8: past the baseline the undo refuses and returns the decision -------

test('20260809-113240 CR8: a mutation past the baseline blocks the undo, touching nothing', () => {
  const { root } = seedLedgerRepo();
  assert.equal(cli(root, 'cutover').code, 0);
  const baseline = git(root, ['rev-parse', STATE_REF]);
  const moved = mutateState(
    root,
    { expectedRevision: baseline, message: 'chore: advance status' },
    (stage) => stage.write(CHANGE_DOC, ledgerChangeText().replace('draft', 'approved')),
  ).revision;
  const before = head(root);

  const { code, err } = cli(root, 'cutover', '--undo');

  assert.notEqual(code, 0);
  assert.match(err, /no longer reversible/);
  assert.match(err, /decision is yours/);
  assert.equal(git(root, ['rev-parse', STATE_REF]), moved);
  assert.equal(refExists(root, ACTIVATION_REF), true);
  assert.equal(head(root), before);
  assert.equal(exists(root, '.changeledger/changes'), false);
});

// --- preconditions shared by both directions --------------------------------

test('20260809-113240 CR3: staged work outside the ledger is refused, nothing is written', () => {
  const { root } = seedLedgerRepo();
  const before = head(root);
  writeLedgerFiles(root, { 'README.md': '# demo\n' });
  git(root, ['add', 'README.md']);

  const { code, err } = cli(root, 'cutover');

  assert.notEqual(code, 0);
  assert.match(err, /empty index/);
  assert.equal(refExists(root, STATE_REF), false);
  assert.equal(head(root), before);
});

test('20260809-113240 CR1: cutover off the integration branch is refused', () => {
  const { root } = seedLedgerRepo();
  git(root, ['checkout', '-q', '-b', 'feature/x']);
  const before = head(root);

  const { code, err } = cli(root, 'cutover');

  assert.notEqual(code, 0);
  assert.match(err, /integration branch "main"/);
  assert.equal(refExists(root, STATE_REF), false);
  assert.equal(head(root), before);
});
