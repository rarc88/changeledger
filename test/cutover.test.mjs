// `changeledger cutover` and `cutover --undo` — the one-shot stage-2 adoption
// tool (20260809-113240 CR1-CR5, CR7, CR8). Every assertion goes through the
// real bin so the exit code under test is the process's own.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadRepo } from '../src/repo.mjs';
import {
  ACTIVATION_REF,
  initState,
  mutateState,
  readSnapshot,
  STATE_REF,
  STATE_ROOT,
  writeActivation,
} from '../src/state-store.mjs';
import { parseYaml } from '../src/yaml.mjs';
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

function cliWithEnv(root, args, extraEnv = {}) {
  try {
    const out = execFileSync(process.execPath, [BIN, ...args], {
      cwd: root,
      env: { ...CLI_ENV, ...extraEnv },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out, err: '' };
  } catch (e) {
    return { code: e.status ?? 1, out: e.stdout ?? '', err: e.stderr ?? '' };
  }
}

function cli(root, ...args) {
  return cliWithEnv(root, args);
}

function cliCaptured(root, ...args) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd: root,
    env: CLI_ENV,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { code: result.status ?? 1, out: result.stdout, err: result.stderr };
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

function publishLedgerState(root, { activate = false } = {}) {
  const config = parseYaml(ledgerConfigText);
  const initialized = initState(root, { projectId: config.project_id, config }).revision;
  const baseline = mutateState(
    root,
    { expectedRevision: initialized, message: 'chore: publish the cutover baseline' },
    (stage) => {
      stage.write('config.yml', ledgerConfigText);
      stage.write(CHANGE_DOC, ledgerChangeText());
      stage.write(SPEC_DOC, ledgerSpecText());
      stage.write(RELEASE_DOC, ledgerReleaseText());
    },
  ).revision;
  if (activate) writeActivation(root, { stateRef: STATE_REF });
  return baseline;
}

function commitInterruptedUndo(root) {
  const cutoverCommit = head(root);
  git(root, ['revert', '-n', cutoverCommit]);
  git(root, [
    'commit',
    '--no-verify',
    '-q',
    '-m',
    'chore(state): undo the ledger cutover',
    '-m',
    'ChangeLedger: none — restores the ledger to the worktree',
  ]);
  return head(root);
}

function externalChangesLedgerFiles() {
  const files = defaultLedgerFiles();
  files['.changeledger/config.yml'] = ledgerConfigText.replace(
    'changes_dir: .changeledger/changes',
    'changes_dir: ledger-changes',
  );
  files['ledger-changes/20260808-000001-demo.md'] =
    files['.changeledger/changes/20260808-000001-demo.md'];
  delete files['.changeledger/changes/20260808-000001-demo.md'];
  return files;
}

function stageDefaultCleanup(root, paths = ['changes', 'specs', 'releases']) {
  git(root, ['rm', '-r', '-q', '--', ...paths.map((name) => `.changeledger/${name}`)]);
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

test('20260809-131004 CR1: a trailerless exact-subject decoy warns but cannot block re-run or undo', () => {
  const { root } = seedLedgerRepo();
  const files = defaultLedgerFiles();
  assert.equal(cli(root, 'cutover').code, 0);
  writeLedgerFiles(root, { 'README.md': '# decoy\n' });
  git(root, ['add', 'README.md']);
  git(root, ['commit', '-q', '-m', 'chore(state): cut the ledger over to the state ref']);
  const decoy = head(root);

  const rerun = cliCaptured(root, 'cutover');

  assert.equal(rerun.code, 0, rerun.err || rerun.out);
  assert.match(rerun.err, new RegExp(decoy));
  assert.match(rerun.err, /ignoring.*trailer/i);
  assert.match(rerun.out, /already cut over/i);
  assert.equal(head(root), decoy);

  const undone = cliCaptured(root, 'cutover', '--undo');
  assert.equal(undone.code, 0, undone.err || undone.out);
  assert.match(undone.err, new RegExp(decoy));
  assert.match(undone.err, /ignoring.*trailer/i);
  assert.equal(refExists(root, STATE_REF), false);
  assert.equal(refExists(root, ACTIVATION_REF), false);
  for (const [rel, text] of Object.entries(files)) {
    assert.equal(fs.readFileSync(path.join(root, rel), 'utf8'), text, rel);
  }
});

// The original brick: the decoy seeded BEFORE any cut. Naming trailerless
// commits when the baseline cannot be verified must stay gated on the repo's
// own cutover evidence — a repo with no state ref and no activation has nothing
// to verify, so the decoy is only a decoy and the first cut must still run.
test('20260809-131004 CR1: a decoy on a never-cut repo does not block the first cutover', () => {
  const { root } = seedLedgerRepo();
  const files = defaultLedgerFiles();
  writeLedgerFiles(root, { 'README.md': '# decoy\n' });
  git(root, ['add', 'README.md']);
  git(root, ['commit', '-q', '-m', 'chore(state): cut the ledger over to the state ref']);
  const decoy = head(root);

  const first = cliCaptured(root, 'cutover');

  assert.equal(first.code, 0, first.err || first.out);
  assert.match(first.err, new RegExp(decoy));
  assert.match(first.err, /ignoring.*trailer/i);
  assert.doesNotMatch(first.err, /baseline cannot be verified/);
  assert.equal(refExists(root, STATE_REF), true);
  assert.equal(refExists(root, ACTIVATION_REF), true);
  assert.equal(git(root, ['rev-parse', 'HEAD^']), decoy);
  assert.equal(
    git(root, ['log', '-1', '--format=%s', 'HEAD']),
    'chore(state): cut the ledger over to the state ref',
  );
  assert.equal(exists(root, '.changeledger/changes'), false);

  const undone = cliCaptured(root, 'cutover', '--undo');

  assert.equal(undone.code, 0, undone.err || undone.out);
  assert.equal(refExists(root, STATE_REF), false);
  assert.equal(refExists(root, ACTIVATION_REF), false);
  for (const [rel, text] of Object.entries(files)) {
    assert.equal(fs.readFileSync(path.join(root, rel), 'utf8'), text, rel);
  }
});

// A genuine cut can lose its trailer to a message rewrite (`git commit --amend
// -m`, a squash merge). Skipping it as if it were a hand-written decoy would
// tell the operator that nothing is reachable while the warning above names the
// very commit that is — the failure has to name it and say what cannot be
// verified.
test('20260809-131004 CR1: a genuine cut whose trailer was rewritten away fails naming the commit', () => {
  const { root } = seedLedgerRepo();
  assert.equal(cli(root, 'cutover').code, 0);
  const baseline = git(root, ['rev-parse', STATE_REF]);
  git(root, [
    'commit',
    '--amend',
    '--no-verify',
    '-q',
    '-m',
    'chore(state): cut the ledger over to the state ref',
  ]);
  const rewritten = head(root);

  const undone = cliCaptured(root, 'cutover', '--undo');

  assert.notEqual(undone.code, 0);
  assert.match(undone.err, new RegExp(rewritten));
  assert.match(undone.err, /baseline cannot be verified/);
  assert.doesNotMatch(undone.err, /nothing to undo/);

  const rerun = cliCaptured(root, 'cutover');

  assert.notEqual(rerun.code, 0);
  assert.match(rerun.err, new RegExp(rewritten));
  assert.match(rerun.err, /baseline cannot be verified/);
  assert.equal(git(root, ['rev-parse', STATE_REF]), baseline);
  assert.equal(refExists(root, ACTIVATION_REF), true);
  assert.equal(head(root), rewritten);
});

test('20260809-131004 CR2: undo selects the live cutover over a later-dated undone lateral cut', () => {
  const { root } = seedLedgerRepo();
  const files = defaultLedgerFiles();
  const seed = head(root);
  const future = {
    GIT_AUTHOR_DATE: '2036-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2036-01-01T00:00:00Z',
  };
  assert.equal(cliWithEnv(root, ['cutover'], future).code, 0);
  const retiredBaseline = git(root, ['rev-parse', STATE_REF]);
  assert.equal(
    cliWithEnv(root, ['cutover', '--undo'], {
      GIT_AUTHOR_DATE: '2036-01-02T00:00:00Z',
      GIT_COMMITTER_DATE: '2036-01-02T00:00:00Z',
    }).code,
    0,
  );
  git(root, ['branch', '-m', 'retired-cut']);
  git(root, ['checkout', '-q', '-b', 'main', seed]);

  const live = cliWithEnv(root, ['cutover'], {
    GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z',
  });
  assert.equal(live.code, 0, live.err || live.out);
  const liveBaseline = git(root, ['rev-parse', STATE_REF]);
  assert.notEqual(liveBaseline, retiredBaseline);
  git(root, ['merge', '-q', '--no-ff', '-s', 'ours', 'retired-cut', '-m', 'merge retired cut']);

  const undone = cli(root, 'cutover', '--undo');

  assert.equal(undone.code, 0, undone.err || undone.out);
  assert.equal(refExists(root, STATE_REF), false);
  assert.equal(refExists(root, ACTIVATION_REF), false);
  for (const [rel, text] of Object.entries(files)) {
    assert.equal(fs.readFileSync(path.join(root, rel), 'utf8'), text, rel);
  }
});

// The falsifying edge of a first-parent-only search, and an ordinary workflow:
// a topic branch merges the integration branch and the integration branch then
// fast-forwards onto that merge, so the cut is reachable only as the merge's
// SECOND parent. Missing it strands the repo activated with no ledger anywhere
// in the worktree — the stuck state this change exists to remove.
test('20260809-131004 CR2: a cut reachable only through a merge second parent is still found', () => {
  const { root } = seedLedgerRepo();
  const files = defaultLedgerFiles();
  const seed = head(root);
  assert.equal(cli(root, 'cutover').code, 0);
  const cut = head(root);
  git(root, ['checkout', '-q', '-b', 'topic', seed]);
  writeLedgerFiles(root, { 'topic.txt': 'topic\n' });
  git(root, ['add', 'topic.txt']);
  git(root, ['commit', '-q', '-m', 'chore: topic work']);
  git(root, ['merge', '-q', '--no-ff', 'main', '-m', 'merge main into topic']);
  git(root, ['checkout', '-q', 'main']);
  git(root, ['merge', '-q', '--ff-only', 'topic']);
  assert.equal(git(root, ['log', '-1', '--format=%P', 'HEAD']).split(' ')[1], cut);

  const rerun = cli(root, 'cutover');
  assert.equal(rerun.code, 0, rerun.err || rerun.out);
  assert.match(rerun.out, /already cut over/i);

  const undone = cli(root, 'cutover', '--undo');

  assert.equal(undone.code, 0, undone.err || undone.out);
  assert.equal(refExists(root, STATE_REF), false);
  assert.equal(refExists(root, ACTIVATION_REF), false);
  for (const [rel, text] of Object.entries(files)) {
    assert.equal(fs.readFileSync(path.join(root, rel), 'utf8'), text, rel);
  }
});

test('20260809-131004 CR3: an initialized-only state diagnoses half-publication and literal recovery', () => {
  const { root } = seedLedgerRepo();
  const config = parseYaml(ledgerConfigText);
  const initialized = initState(root, { projectId: config.project_id, config }).revision;
  const before = head(root);

  const { code, err } = cli(root, 'cutover');

  assert.notEqual(code, 0);
  assert.match(err, /half-published cutover/i);
  assert.match(err, new RegExp(`${STATE_REF}.*present`));
  assert.match(err, new RegExp(`${ACTIVATION_REF}.*absent`));
  assert.match(err, /git update-ref -d refs\/heads\/changeledger\/state/);
  assert.equal(git(root, ['rev-parse', STATE_REF]), initialized);
  assert.equal(refExists(root, ACTIVATION_REF), false);
  assert.equal(head(root), before);
});

test('20260809-131004 CR4: re-running after publication and activation creates only cleanup', () => {
  const { root } = seedLedgerRepo();
  const before = head(root);
  const baseline = publishLedgerState(root, { activate: true });

  const { code, out, err } = cli(root, 'cutover');

  assert.equal(code, 0, err || out);
  assert.equal(git(root, ['rev-parse', STATE_REF]), baseline);
  assert.equal(git(root, ['rev-list', '--count', `${before}..HEAD`]), '1');
  assert.equal(
    git(root, ['log', '-1', '--format=%s', 'HEAD']),
    'chore(state): cut the ledger over to the state ref',
  );
  assert.equal(git(root, ['rev-parse', 'HEAD^']), before);
  assert.equal(exists(root, '.changeledger/config.yml'), true);
  assert.equal(exists(root, '.changeledger/changes'), false);
  assert.equal(exists(root, '.changeledger/specs'), false);
  assert.equal(exists(root, '.changeledger/releases'), false);
  assert.equal(git(root, ['status', '--porcelain']), '');
});

test('20260809-131004 CR4: re-running with the exact cleanup already staged commits it once', () => {
  const { root } = seedLedgerRepo();
  const before = head(root);
  const baseline = publishLedgerState(root, { activate: true });
  stageDefaultCleanup(root);
  assert.deepEqual(git(root, ['diff', '--cached', '--name-only']).split('\n').sort(), [
    '.changeledger/changes/20260808-000001-demo.md',
    '.changeledger/releases/0.1.0.yml',
    '.changeledger/specs/demo-spec.md',
  ]);

  const { code, out, err } = cli(root, 'cutover');

  assert.equal(code, 0, err || out);
  assert.equal(git(root, ['rev-parse', STATE_REF]), baseline);
  assert.equal(git(root, ['rev-list', '--count', `${before}..HEAD`]), '1');
  assert.equal(git(root, ['rev-parse', 'HEAD^']), before);
  assert.equal(git(root, ['status', '--porcelain']), '');
});

test('20260809-131004 CR4: a partial staged cleanup remains fail-closed', () => {
  const { root } = seedLedgerRepo();
  const before = head(root);
  publishLedgerState(root, { activate: true });
  stageDefaultCleanup(root, ['changes']);

  const { code, err } = cli(root, 'cutover');

  assert.notEqual(code, 0);
  assert.match(err, /requires an empty index/);
  assert.equal(head(root), before);
  assert.equal(refExists(root, STATE_REF), true);
  assert.equal(refExists(root, ACTIVATION_REF), true);
  assert.equal(exists(root, '.changeledger/specs/demo-spec.md'), true);
});

test('20260809-131004 CR4: exact staged cleanup plus unrelated staged work remains fail-closed', () => {
  const { root } = seedLedgerRepo();
  const before = head(root);
  publishLedgerState(root, { activate: true });
  stageDefaultCleanup(root);
  writeLedgerFiles(root, { 'README.md': '# unrelated staged work\n' });
  git(root, ['add', 'README.md']);

  const { code, err } = cli(root, 'cutover');

  assert.notEqual(code, 0);
  assert.match(err, /requires an empty index/);
  assert.equal(head(root), before);
  assert.equal(refExists(root, STATE_REF), true);
  assert.equal(refExists(root, ACTIVATION_REF), true);
  assert.match(git(root, ['diff', '--cached', '--name-only']), /README\.md/);
});

test('20260809-131004 CR4: exact staged cleanup plus ordinary untracked ledger content remains fail-closed', () => {
  const { root } = seedLedgerRepo();
  const before = head(root);
  publishLedgerState(root, { activate: true });
  stageDefaultCleanup(root);
  writeLedgerFiles(root, { '.changeledger/changes/untracked.md': 'untracked ledger content\n' });

  const { code, err } = cli(root, 'cutover');

  assert.notEqual(code, 0);
  assert.match(err, /requires an empty index/);
  assert.equal(head(root), before);
  assert.equal(refExists(root, STATE_REF), true);
  assert.equal(refExists(root, ACTIVATION_REF), true);
  assert.equal(exists(root, '.changeledger/changes/untracked.md'), true);
});

test('20260809-131004 CR4: exact staged cleanup plus ignored ledger content remains fail-closed', () => {
  const { root } = seedLedgerRepo({
    files: {
      ...defaultLedgerFiles(),
      '.gitignore': '.changeledger/changes/ignored.md\n',
    },
  });
  const before = head(root);
  publishLedgerState(root, { activate: true });
  stageDefaultCleanup(root);
  writeLedgerFiles(root, { '.changeledger/changes/ignored.md': 'ignored ledger content\n' });
  assert.equal(
    git(root, ['check-ignore', '.changeledger/changes/ignored.md']),
    '.changeledger/changes/ignored.md',
  );

  const { code, err } = cli(root, 'cutover');

  assert.notEqual(code, 0);
  assert.match(err, /requires an empty index/);
  assert.equal(head(root), before);
  assert.equal(refExists(root, STATE_REF), true);
  assert.equal(refExists(root, ACTIVATION_REF), true);
  assert.equal(exists(root, '.changeledger/changes/ignored.md'), true);
});

test('20260809-131004 CR4: ignored content outside ledger paths does not block exact staged cleanup', () => {
  const { root } = seedLedgerRepo({
    files: { ...defaultLedgerFiles(), '.gitignore': 'ignored-outside.txt\n' },
  });
  const before = head(root);
  publishLedgerState(root, { activate: true });
  stageDefaultCleanup(root);
  writeLedgerFiles(root, { 'ignored-outside.txt': 'unrelated ignored content\n' });

  const { code, out, err } = cli(root, 'cutover');

  assert.equal(code, 0, err || out);
  assert.equal(git(root, ['rev-list', '--count', `${before}..HEAD`]), '1');
  assert.equal(exists(root, 'ignored-outside.txt'), true);
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

test('20260809-131004 CR5: re-running an interrupted undo deletes both refs without another commit', () => {
  const { root } = seedLedgerRepo();
  const files = defaultLedgerFiles();
  assert.equal(cli(root, 'cutover').code, 0);
  const interruptedHead = commitInterruptedUndo(root);

  const { code, out, err } = cli(root, 'cutover', '--undo');

  assert.equal(code, 0, err || out);
  assert.equal(head(root), interruptedHead);
  assert.equal(refExists(root, STATE_REF), false);
  assert.equal(refExists(root, ACTIVATION_REF), false);
  for (const [rel, text] of Object.entries(files)) {
    assert.equal(fs.readFileSync(path.join(root, rel), 'utf8'), text, rel);
  }
  assert.equal(git(root, ['status', '--porcelain']), '');
  assert.equal(loadRepo(root).state, null);
});

test('20260809-131004 CR5: interrupted undo refuses an unstaged edit in an external configured collection', () => {
  const { root } = seedLedgerRepo({ files: externalChangesLedgerFiles() });
  assert.equal(cli(root, 'cutover').code, 0);
  const interruptedHead = commitInterruptedUndo(root);
  fs.appendFileSync(path.join(root, 'ledger-changes', '20260808-000001-demo.md'), 'dirty\n');

  const { code, err } = cli(root, 'cutover', '--undo');

  assert.notEqual(code, 0);
  assert.match(err, /clean ledger/);
  assert.equal(head(root), interruptedHead);
  assert.equal(refExists(root, STATE_REF), true);
  assert.equal(refExists(root, ACTIVATION_REF), true);
});

test('20260809-131004 CR5: interrupted undo refuses an unstaged deletion in an external configured collection', () => {
  const { root } = seedLedgerRepo({ files: externalChangesLedgerFiles() });
  assert.equal(cli(root, 'cutover').code, 0);
  const interruptedHead = commitInterruptedUndo(root);
  fs.rmSync(path.join(root, 'ledger-changes', '20260808-000001-demo.md'));

  const { code, err } = cli(root, 'cutover', '--undo');

  assert.notEqual(code, 0);
  assert.match(err, /clean ledger/);
  assert.equal(head(root), interruptedHead);
  assert.equal(refExists(root, STATE_REF), true);
  assert.equal(refExists(root, ACTIVATION_REF), true);
});

test('20260809-131004 CR5: a post-undo ledger edit is not mistaken for the interrupted state', () => {
  const { root } = seedLedgerRepo();
  assert.equal(cli(root, 'cutover').code, 0);
  commitInterruptedUndo(root);
  fs.rmSync(path.join(root, '.changeledger', 'changes', '20260808-000001-demo.md'));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'docs: change the restored ledger']);
  const before = head(root);

  const { code, err } = cli(root, 'cutover', '--undo');

  assert.notEqual(code, 0);
  assert.match(err, /cannot be completed automatically/);
  assert.equal(head(root), before);
  assert.equal(refExists(root, STATE_REF), true);
  assert.equal(refExists(root, ACTIVATION_REF), true);
});

// The reversibility condition the Proposal states is the state ref still
// pointing at the published baseline — nothing about where HEAD happens to be.
// Requiring HEAD to BE the cutover commit killed the escape hatch on the first
// ordinary commit or merge that landed after the cut.
test('20260809-113240 CR7: undo still works after ordinary commits land on the integration branch', () => {
  const { root } = seedLedgerRepo();
  const files = defaultLedgerFiles();
  assert.equal(cli(root, 'cutover').code, 0);
  const baseline = git(root, ['rev-parse', STATE_REF]);
  writeLedgerFiles(root, { 'README.md': '# ordinary work\n' });
  git(root, ['add', 'README.md']);
  git(root, ['commit', '-q', '-m', 'docs: ordinary commit']);
  assert.equal(git(root, ['rev-parse', STATE_REF]), baseline);

  const { code, out, err } = cli(root, 'cutover', '--undo');

  assert.equal(code, 0, err || out);
  assert.equal(refExists(root, STATE_REF), false);
  assert.equal(refExists(root, ACTIVATION_REF), false);
  for (const [rel, text] of Object.entries(files)) {
    assert.equal(fs.readFileSync(path.join(root, rel), 'utf8'), text, rel);
  }
  // The unrelated commit that landed in between is preserved, not rewound.
  assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), '# ordinary work\n');
  assert.equal(git(root, ['status', '--porcelain']), '');
  assert.equal(loadRepo(root).state, null);
});

test('20260809-113240 CR7: a commit that re-touched the removed paths blocks the undo, fail-closed', () => {
  const { root } = seedLedgerRepo();
  assert.equal(cli(root, 'cutover').code, 0);
  const stateRevision = git(root, ['rev-parse', STATE_REF]);
  // A later commit re-adds one of the very paths the cleanup removed, so
  // reverting that cleanup can no longer apply cleanly.
  writeLedgerFiles(root, { '.changeledger/changes/20260808-000001-demo.md': 'conflicting\n' });
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'docs: re-add a ledger document']);
  const before = head(root);

  const { code, err } = cli(root, 'cutover', '--undo');

  assert.notEqual(code, 0);
  assert.match(err, /cannot be reverted automatically/);
  assert.equal(head(root), before);
  assert.equal(git(root, ['rev-parse', STATE_REF]), stateRevision);
  assert.equal(refExists(root, ACTIVATION_REF), true);
  // No half-applied revert left behind for the human to clean up.
  assert.equal(git(root, ['status', '--porcelain']), '');
  assert.equal(fs.existsSync(path.join(root, '.git', 'REVERT_HEAD')), false);
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

// Locating the cutover commit by history rather than by HEAD means an undone
// cut leaves its commit behind as a decoy. Neither ref surviving is what tells
// the two apart, so the repo stays cuttable — and the SECOND cut is the one the
// next undo must find.
test('20260809-113240 CR7: a repo can be cut over again after an undo, and undone again', () => {
  const { root } = seedLedgerRepo();
  const files = defaultLedgerFiles();
  assert.equal(cli(root, 'cutover').code, 0);
  assert.equal(cli(root, 'cutover', '--undo').code, 0);

  const recut = cli(root, 'cutover');
  assert.equal(recut.code, 0, recut.err);
  assert.equal(refExists(root, STATE_REF), true);
  assert.equal(refExists(root, ACTIVATION_REF), true);

  const { code, err } = cli(root, 'cutover', '--undo');
  assert.equal(code, 0, err);
  assert.equal(refExists(root, STATE_REF), false);
  for (const [rel, text] of Object.entries(files)) {
    assert.equal(fs.readFileSync(path.join(root, rel), 'utf8'), text, rel);
  }
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
