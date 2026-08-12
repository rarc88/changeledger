// `changeledger cutover` and `cutover --undo` — the one-shot stage-2 adoption
// tool (20260809-113240 CR1-CR5, CR7, CR8). Every assertion goes through the
// real bin so the exit code under test is the process's own.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadRepo } from '../src/repo.mjs';
import {
  ACTIVATION_REF,
  initState,
  mutateState,
  readActivation,
  readSnapshot,
  STATE_REF,
  STATE_ROOT,
  writeActivation,
} from '../src/state-store.mjs';
import { parseYaml } from '../src/yaml.mjs';
import { sanitizedEnv } from './helpers/git-env.mjs';
import {
  buildTree,
  buildTreeEntries,
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

const CLI_ENV = sanitizedEnv();

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

  const { code, out, err } = cli(root, 'cutover');
  assert.equal(code, 0, err || out);

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

  const { code, out, err } = cli(root, 'cutover');

  assert.equal(code, 0, err || out);
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

// The other side of the mode question, and the reason the check cannot be a
// flat equality against the snapshot's mode: the store publishes every document
// at 100644 (`state-store.mjs`), so a genuine cut of an EXECUTABLE document
// publishes it normalized, and its honest undo restores the 100755 the worktree
// had. Both modes are regular files — which is the rule that matters.
test('20260809-194233 CR5: an executable ledger document survives the cut and its undo', () => {
  const { root } = seedLedgerRepo();
  const changeDoc = '.changeledger/changes/20260808-000001-demo.md';
  const stateDoc = `${STATE_ROOT}/changes/20260808-000001-demo.md`;
  const mode = (revision, filePath) =>
    git(root, ['ls-tree', revision, '--', filePath]).split(/\s+/)[0];
  // The bit is set on disk as well as in the index, or the worktree stays
  // dirty against HEAD and the cut refuses before it ever reads a mode.
  fs.chmodSync(path.join(root, changeDoc), 0o755);
  git(root, ['update-index', '--chmod=+x', '--', changeDoc]);
  git(root, ['commit', '--no-verify', '-q', '-m', 'chore: make the document executable']);
  assert.equal(mode('HEAD', changeDoc), '100755');
  assert.equal(git(root, ['status', '--porcelain']), '');

  assert.equal(cli(root, 'cutover').code, 0);
  // Publication normalizes the mode — the snapshot cannot carry the exec bit.
  assert.equal(mode(STATE_REF, stateDoc), '100644');

  const undone = cli(root, 'cutover', '--undo');

  assert.equal(undone.code, 0, undone.err || undone.out);
  assert.equal(fs.readFileSync(path.join(root, changeDoc), 'utf8'), ledgerChangeText());
  assert.equal(mode('HEAD', changeDoc), '100755');
  assert.equal(refExists(root, STATE_REF), false);
  assert.equal(refExists(root, ACTIVATION_REF), false);
  assert.equal(git(root, ['status', '--porcelain']), '');
});

// Bytes are not the whole snapshot. The state store admits regular blobs only
// (`assertRegularBlobEntry`), so a decoy whose parent tree carries the very
// published blob at symlink mode passes an oid-only comparison and materializes
// a DANGLING SYMLINK where the change document belongs. Same bytes, different
// object kind — not the snapshot.
test('20260809-194233 CR5: a mode-swapped faithful decoy fails closed on the mode', () => {
  const { root } = seedLedgerRepo();
  const changeDoc = '.changeledger/changes/20260808-000001-demo.md';
  const seed = head(root);
  assert.equal(cli(root, 'cutover').code, 0);
  const baseline = git(root, ['rev-parse', STATE_REF]);
  const real = head(root);

  // Probe E's retirement shape: the real record is retired for good.
  git(root, ['revert', '-n', real]);
  git(root, [
    'commit',
    '--no-verify',
    '-q',
    '-m',
    'chore(state): undo the ledger cutover',
    '-m',
    'ChangeLedger: none — restores the ledger to the worktree',
  ]);
  git(root, ['rm', '-r', '-q', '--', '.changeledger/changes']);
  git(root, ['commit', '--no-verify', '-q', '-m', 'chore: re-apply the cut by hand']);

  // The decoy's parent tree is the real cut's parent tree with ONE entry
  // re-hashed at symlink mode over the very same published blob.
  const entries = git(root, ['ls-tree', '-r', seed])
    .split('\n')
    .map((line) => {
      const [meta, filePath] = line.split('\t');
      const [mode, , oid] = meta.split(/\s+/);
      return { path: filePath, oid, mode: filePath === changeDoc ? '120000' : mode };
    });
  const swapped = commitTree(root, buildTreeEntries(root, entries), {
    parents: [seed],
    message: 'chore: re-hash the document as a symlink',
  });
  const decoy = commitTree(
    root,
    buildTreeEntries(
      root,
      // Faithful in every other respect: it removes exactly the collections
      // the genuine cleanup removes, so only the MODE sets it apart.
      entries.filter(
        (entry) =>
          !['changes', 'specs', 'releases'].some((collection) =>
            entry.path.startsWith(`.changeledger/${collection}/`),
          ),
      ),
    ),
    {
      parents: [swapped],
      message: `chore(state): cut the ledger over to the state ref\n\nChangeLedger: none\n\nChangeledger-Cutover-Baseline: ${baseline}`,
    },
  );
  git(root, ['merge', '-q', '--no-ff', '-s', 'ours', decoy, '-m', 'merge the mode-swapped cut']);
  const before = head(root);
  // The decoy is byte-faithful: the blob it would restore IS the published one.
  assert.equal(
    git(root, ['rev-parse', `${decoy}^:${changeDoc}`]),
    git(root, ['rev-parse', `${STATE_REF}:${STATE_ROOT}/changes/20260808-000001-demo.md`]),
  );
  const materialized = () => {
    const full = path.join(root, changeDoc);
    if (!fs.existsSync(full) && !fs.lstatSync(full, { throwIfNoEntry: false })) return '<absent>';
    const stat = fs.lstatSync(full);
    return stat.isSymbolicLink()
      ? `symlink -> ${fs.readlinkSync(full)} (dangling=${!fs.existsSync(full)})`
      : 'regular file';
  };

  const undone = cli(root, 'cutover', '--undo');

  assert.notEqual(
    undone.code,
    0,
    `undo exited 0 — worktree ${changeDoc} is a ${materialized()}, ${STATE_REF} exists=${refExists(root, STATE_REF)}`,
  );
  assert.match(undone.err, new RegExp(decoy));
  assert.match(undone.err, /changes\/20260808-000001-demo\.md/);
  assert.match(undone.err, /120000/);
  assert.equal(git(root, ['rev-parse', STATE_REF]), baseline);
  assert.equal(refExists(root, ACTIVATION_REF), true);
  assert.equal(head(root), before);
  assert.equal(fs.lstatSync(path.join(root, changeDoc), { throwIfNoEntry: false }), undefined);
  assert.equal(git(root, ['status', '--porcelain']), '');
  assert.equal(fs.existsSync(path.join(root, '.git', 'REVERT_HEAD')), false);
});

// Topology answers "did an undo happen after this cut", never "is that undo's
// effect still standing". A genuine undo on the mainline retires the real cut
// permanently, so a later hand-made re-application of the cut leaves a forged
// same-baseline decoy as the only survivor. The selection cannot see this; the
// undo has to check what it is about to write against what the ref publishes.
test('20260809-194233 CR5: a revert restoring content the state ref never published fails closed', () => {
  const { root } = seedLedgerRepo();
  const poisoned = '# poisoned ledger the attacker never published\n';
  const changeDoc = '.changeledger/changes/20260808-000001-demo.md';
  const seed = head(root);
  assert.equal(cli(root, 'cutover').code, 0);
  const baseline = git(root, ['rev-parse', STATE_REF]);
  const real = head(root);

  // A genuine undo on the mainline — first-parent, real inverse commit — which
  // retires the real cut for good.
  git(root, ['revert', '-n', real]);
  git(root, [
    'commit',
    '--no-verify',
    '-q',
    '-m',
    'chore(state): undo the ledger cutover',
    '-m',
    'ChangeLedger: none — restores the ledger to the worktree',
  ]);
  // …then the cut is re-applied by hand, with no trailer of its own.
  git(root, ['rm', '-r', '-q', '--', '.changeledger/changes']);
  git(root, ['commit', '--no-verify', '-q', '-m', 'chore: re-apply the cut by hand']);

  // The decoy: a same-baseline record over a doctored ledger, merged so its
  // content stays out of the branch tree.
  git(root, ['checkout', '-q', '-b', 'poison', seed]);
  writeLedgerFiles(root, { [changeDoc]: poisoned });
  git(root, ['add', '-A']);
  git(root, ['commit', '--no-verify', '-q', '-m', 'docs: doctor the ledger']);
  git(root, ['rm', '-r', '-q', '--', '.changeledger/changes']);
  git(root, [
    'commit',
    '--no-verify',
    '-q',
    '-m',
    'chore(state): cut the ledger over to the state ref',
    '-m',
    `ChangeLedger: none\n\nChangeledger-Cutover-Baseline: ${baseline}`,
  ]);
  const decoy = head(root);
  git(root, ['checkout', '-q', 'main']);
  git(root, ['merge', '-q', '--no-ff', '-s', 'ours', 'poison', '-m', 'merge the poisoned cut']);
  const before = head(root);
  const restored = () =>
    fs.existsSync(path.join(root, changeDoc))
      ? JSON.stringify(fs.readFileSync(path.join(root, changeDoc), 'utf8'))
      : '<absent>';

  const undone = cli(root, 'cutover', '--undo');

  assert.notEqual(
    undone.code,
    0,
    `undo exited 0 — worktree ${changeDoc} is now ${restored()}, ${STATE_REF} exists=${refExists(root, STATE_REF)}`,
  );
  // The first mismatching path is named, and it is the decoy that was selected.
  assert.match(undone.err, new RegExp(decoy));
  assert.match(undone.err, /changes\/20260808-000001-demo\.md/);
  assert.match(undone.err, new RegExp(baseline));
  assert.equal(git(root, ['rev-parse', STATE_REF]), baseline);
  assert.equal(refExists(root, ACTIVATION_REF), true);
  assert.equal(head(root), before);
  assert.equal(fs.existsSync(path.join(root, changeDoc)), false);
  assert.equal(git(root, ['status', '--porcelain']), '');
  assert.equal(fs.existsSync(path.join(root, '.git', 'REVERT_HEAD')), false);
});

// Retirement is about EFFECT, not reachability. A genuine `git revert` of the
// cut on a side branch is a real inverse commit, but a merge that discarded it
// (`-s ours`) restored nothing here — the branch is still standing on the cut.
// Letting it retire the live record collapsed the tie onto a same-baseline
// decoy, and `--undo` reverted the decoy: never-published content written into
// the worktree and both refs dropped, on exit 0.
test('20260809-194233 CR1: an undo a merge discarded cannot retire the live cut', () => {
  const { root } = seedLedgerRepo();
  const poisoned = '# poisoned ledger the attacker never published\n';
  const changeDoc = '.changeledger/changes/20260808-000001-demo.md';
  assert.equal(cli(root, 'cutover').code, 0);
  const baseline = git(root, ['rev-parse', STATE_REF]);
  const real = head(root);

  // A genuine undo — a real `git revert` of the cut, not a forgery — but on a
  // side branch, so it never took effect on the integration branch.
  git(root, ['checkout', '-q', '-b', 'poison']);
  git(root, ['revert', '-n', real]);
  git(root, [
    'commit',
    '--no-verify',
    '-q',
    '-m',
    'chore(state): undo the ledger cutover',
    '-m',
    'ChangeLedger: none — restores the ledger to the worktree',
  ]);
  const discardedUndo = head(root);

  // On that same side branch, a decoy re-cut over a doctored ledger, declaring
  // the very baseline the state ref holds.
  writeLedgerFiles(root, { [changeDoc]: poisoned });
  git(root, ['add', '-A']);
  git(root, ['commit', '--no-verify', '-q', '-m', 'docs: doctor the ledger']);
  git(root, ['rm', '-r', '-q', '--', '.changeledger/changes']);
  git(root, [
    'commit',
    '--no-verify',
    '-q',
    '-m',
    'chore(state): cut the ledger over to the state ref',
    '-m',
    `ChangeLedger: none\n\nChangeledger-Cutover-Baseline: ${baseline}`,
  ]);
  const decoy = head(root);
  git(root, ['checkout', '-q', 'main']);
  git(root, ['merge', '-q', '--no-ff', '-s', 'ours', 'poison', '-m', 'merge the discarded undo']);
  const before = head(root);
  // The discarded undo really is reachable from HEAD — the premise of the
  // shape. `git()` throws on a non-zero exit, so this asserts by not throwing.
  assert.equal(git(root, ['merge-base', '--is-ancestor', discardedUndo, 'HEAD']), '');
  const restored = () =>
    fs.existsSync(path.join(root, changeDoc))
      ? JSON.stringify(fs.readFileSync(path.join(root, changeDoc), 'utf8'))
      : '<absent>';

  const undone = cli(root, 'cutover', '--undo');

  assert.notEqual(
    undone.code,
    0,
    `undo exited 0 — worktree ${changeDoc} is now ${restored()}, ${STATE_REF} exists=${refExists(root, STATE_REF)}`,
  );
  assert.match(undone.err, new RegExp(real));
  assert.match(undone.err, new RegExp(decoy));
  assert.match(undone.err, /by hand/);
  assert.equal(git(root, ['rev-parse', STATE_REF]), baseline);
  assert.equal(refExists(root, ACTIVATION_REF), true);
  assert.equal(head(root), before);
  assert.equal(fs.existsSync(path.join(root, changeDoc)), false);
  assert.equal(git(root, ['status', '--porcelain']), '');

  const rerun = cli(root, 'cutover');

  assert.notEqual(rerun.code, 0);
  assert.match(rerun.err, new RegExp(real));
  assert.match(rerun.err, new RegExp(decoy));
  assert.equal(git(root, ['rev-parse', STATE_REF]), baseline);
  assert.equal(head(root), before);
  assert.equal(fs.existsSync(path.join(root, changeDoc)), false);
});

// Retirement takes the undo SUBJECT as a claim and the diff as the proof. A
// bare exact-subject commit that reverts nothing is not a completed undo, and
// treating it as one hands an attacker the whole tie: retire the real cut with
// a forged undo, leave a same-baseline decoy as the only survivor, and `--undo`
// reverts the decoy — restoring content that was never published and dropping
// the refs the real cut was standing on, on exit 0.
test('20260809-194233 CR1: a forged undo cannot retire the real cut and elect a decoy', () => {
  const { root } = seedLedgerRepo();
  const files = defaultLedgerFiles();
  const poisoned = '# poisoned ledger the attacker never published\n';
  const changeDoc = '.changeledger/changes/20260808-000001-demo.md';
  const seed = head(root);
  assert.equal(cli(root, 'cutover').code, 0);
  const baseline = git(root, ['rev-parse', STATE_REF]);
  const real = head(root);

  // Forged "undo": the exact subject, reverting nothing at all.
  git(root, [
    'commit',
    '--no-verify',
    '--allow-empty',
    '-q',
    '-m',
    'chore(state): undo the ledger cutover',
    '-m',
    'ChangeLedger: none — restores the ledger to the worktree',
  ]);

  // The decoy cut, over a doctored ledger, merged so its content stays out of
  // the branch tree — reverting it is what would inject the poison.
  git(root, ['checkout', '-q', '-b', 'poison', seed]);
  writeLedgerFiles(root, { [changeDoc]: poisoned });
  git(root, ['add', '-A']);
  git(root, ['commit', '--no-verify', '-q', '-m', 'docs: doctor the ledger']);
  git(root, ['rm', '-r', '-q', '--', '.changeledger/changes']);
  git(root, [
    'commit',
    '--no-verify',
    '-q',
    '-m',
    'chore(state): cut the ledger over to the state ref',
    '-m',
    `ChangeLedger: none\n\nChangeledger-Cutover-Baseline: ${baseline}`,
  ]);
  const decoy = head(root);
  git(root, ['checkout', '-q', 'main']);
  git(root, ['merge', '-q', '--no-ff', '-s', 'ours', 'poison', '-m', 'merge the poisoned cut']);
  const before = head(root);
  const restored = () =>
    fs.existsSync(path.join(root, changeDoc))
      ? JSON.stringify(fs.readFileSync(path.join(root, changeDoc), 'utf8'))
      : '<absent>';

  const undone = cli(root, 'cutover', '--undo');

  assert.notEqual(
    undone.code,
    0,
    `undo exited 0 — worktree ${changeDoc} is now ${restored()}, ${STATE_REF} exists=${refExists(root, STATE_REF)}`,
  );
  assert.match(undone.err, new RegExp(real));
  assert.match(undone.err, new RegExp(decoy));
  assert.match(undone.err, /by hand/);
  assert.equal(git(root, ['rev-parse', STATE_REF]), baseline);
  assert.equal(refExists(root, ACTIVATION_REF), true);
  assert.equal(head(root), before);
  assert.equal(fs.existsSync(path.join(root, changeDoc)), false);
  assert.equal(git(root, ['status', '--porcelain']), '');

  const rerun = cli(root, 'cutover');

  assert.notEqual(rerun.code, 0);
  assert.match(rerun.err, new RegExp(real));
  assert.match(rerun.err, new RegExp(decoy));
  assert.equal(git(root, ['rev-parse', STATE_REF]), baseline);
  assert.equal(head(root), before);
  assert.equal(fs.existsSync(path.join(root, changeDoc)), false);
  assert.equal(files[changeDoc] === poisoned, false);
});

// A baseline oid is not a unique identifier: a trailer is plain text anyone can
// write. When two reachable records claim the baseline the state ref holds and
// NEITHER is retired by a later undo, topology picked one and `--undo` restored
// content that was never published — that tie has to fail closed instead. The
// forged decoy below has no undo behind it, which is exactly the shape.
test('20260809-194233 CR1: two records claiming the held baseline fail closed naming both', () => {
  const { root } = seedLedgerRepo();
  const files = defaultLedgerFiles();
  const seed = head(root);
  assert.equal(cli(root, 'cutover').code, 0);
  const baseline = git(root, ['rev-parse', STATE_REF]);
  const real = head(root);
  git(root, ['checkout', '-q', '-b', 'forged', seed]);
  git(root, [
    'commit',
    '--no-verify',
    '--allow-empty',
    '-q',
    '-m',
    'chore(state): cut the ledger over to the state ref',
    '-m',
    `ChangeLedger: none\n\nChangeledger-Cutover-Baseline: ${baseline}`,
  ]);
  const forged = head(root);
  git(root, ['checkout', '-q', 'main']);
  git(root, ['merge', '-q', '--no-ff', '-s', 'ours', 'forged', '-m', 'merge the forged cut']);
  const before = head(root);

  const undone = cli(root, 'cutover', '--undo');

  assert.notEqual(undone.code, 0);
  assert.match(undone.err, new RegExp(real));
  assert.match(undone.err, new RegExp(forged));
  assert.match(undone.err, /by hand/);
  assert.equal(git(root, ['rev-parse', STATE_REF]), baseline);
  assert.equal(refExists(root, ACTIVATION_REF), true);
  assert.equal(head(root), before);
  assert.equal(exists(root, '.changeledger/changes'), false);
  assert.equal(git(root, ['status', '--porcelain']), '');

  const rerun = cli(root, 'cutover');

  assert.notEqual(rerun.code, 0);
  assert.match(rerun.err, new RegExp(real));
  assert.match(rerun.err, new RegExp(forged));
  assert.match(rerun.err, /by hand/);
  assert.equal(git(root, ['rev-parse', STATE_REF]), baseline);
  assert.equal(head(root), before);
  for (const rel of Object.keys(files)) {
    if (rel.startsWith('.changeledger/changes/')) assert.equal(exists(root, rel), false);
  }
});

// The honest shape of the same tie, and why the fail-closed cannot be flat:
// with committer dates pinned — reproducible builds, CI — a re-cut of identical
// content reproduces the previous baseline oid with nothing forged, so the
// retired record and the live one tie against the ref. The undo commit sitting
// after the retired cut is what tells them apart.
test('20260809-194233 CR4: a re-cut reproducing the baseline under pinned dates stays usable', () => {
  const { root } = seedLedgerRepo();
  const files = defaultLedgerFiles();
  const pinned = {
    GIT_AUTHOR_DATE: '2030-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2030-01-01T00:00:00Z',
  };
  assert.equal(cliWithEnv(root, ['cutover'], pinned).code, 0);
  const retiredBaseline = git(root, ['rev-parse', STATE_REF]);
  assert.equal(cliWithEnv(root, ['cutover', '--undo'], pinned).code, 0);

  const recut = cliWithEnv(root, ['cutover'], pinned);

  assert.equal(recut.code, 0, recut.err || recut.out);
  // The collision is this test's premise, not a coincidence: assert it, or the
  // tie it exists for would silently stop being exercised.
  assert.equal(git(root, ['rev-parse', STATE_REF]), retiredBaseline);
  assert.equal(
    git(root, ['rev-list', '--count', '-F', '--grep=Changeledger-Cutover-Baseline', 'HEAD']),
    '2',
  );

  const rerun = cliWithEnv(root, ['cutover'], pinned);

  assert.equal(rerun.code, 0, rerun.err || rerun.out);
  assert.match(rerun.out, /already cut over/i);
  assert.equal(git(root, ['rev-parse', STATE_REF]), retiredBaseline);

  const undone = cliWithEnv(root, ['cutover', '--undo'], pinned);

  assert.equal(undone.code, 0, undone.err || undone.out);
  assert.equal(refExists(root, STATE_REF), false);
  assert.equal(refExists(root, ACTIVATION_REF), false);
  for (const [rel, text] of Object.entries(files)) {
    assert.equal(fs.readFileSync(path.join(root, rel), 'utf8'), text, rel);
  }
  assert.equal(git(root, ['status', '--porcelain']), '');
  assert.equal(loadRepo(root).state, null);
});

// The falsifying edge of `findCompletedUndo`'s `--first-parent`, and the
// asymmetry with the cutover search: an undo commit a merge reached but
// discarded (`-s ours`) restored nothing here, so the repo still has no ledger
// in the worktree and the real undo must still run.
test('20260809-194233 CR2: an undo discarded by an `-s ours` merge still lets the real undo run', () => {
  const { root } = seedLedgerRepo();
  const files = defaultLedgerFiles();
  assert.equal(cli(root, 'cutover').code, 0);
  const cut = head(root);
  git(root, ['checkout', '-q', '-b', 'lateral']);
  git(root, ['revert', '-n', cut]);
  git(root, [
    'commit',
    '--no-verify',
    '-q',
    '-m',
    'chore(state): undo the ledger cutover',
    '-m',
    'ChangeLedger: none — restores the ledger to the worktree',
  ]);
  const discarded = head(root);
  git(root, ['checkout', '-q', 'main']);
  git(root, ['merge', '-q', '--no-ff', '-s', 'ours', 'lateral', '-m', 'merge the discarded undo']);
  assert.equal(git(root, ['log', '-1', '--format=%P', 'HEAD']).split(' ')[1], discarded);
  assert.equal(exists(root, '.changeledger/changes'), false);

  const { code, out, err } = cli(root, 'cutover', '--undo');

  assert.equal(code, 0, err || out);
  assert.equal(refExists(root, STATE_REF), false);
  assert.equal(refExists(root, ACTIVATION_REF), false);
  for (const [rel, text] of Object.entries(files)) {
    assert.equal(fs.readFileSync(path.join(root, rel), 'utf8'), text, rel);
  }
  assert.equal(git(root, ['status', '--porcelain']), '');
  assert.equal(loadRepo(root).state, null);
});

// The activated-only arm of the trailerless gate: cutover evidence can be just
// the activation, with no state ref at all. That is still evidence, so the
// decoy has to be reported as an unverifiable baseline rather than swallowed
// into the "already activated" diagnostic.
test('20260809-194233 CR3: activation without a state ref reports the decoy as unverifiable', () => {
  const { root } = seedLedgerRepo();
  const files = defaultLedgerFiles();
  writeLedgerFiles(root, { 'README.md': '# decoy\n' });
  git(root, ['add', 'README.md']);
  git(root, ['commit', '-q', '-m', 'chore(state): cut the ledger over to the state ref']);
  const decoy = head(root);
  writeActivation(root, { stateRef: STATE_REF });
  const activation = git(root, ['rev-parse', ACTIVATION_REF]);

  const { code, err } = cliCaptured(root, 'cutover');

  assert.notEqual(code, 0);
  assert.match(err, new RegExp(decoy));
  assert.match(err, /baseline cannot be verified/);
  assert.doesNotMatch(err, /already activated/);
  assert.equal(refExists(root, STATE_REF), false);
  assert.equal(git(root, ['rev-parse', ACTIVATION_REF]), activation);
  assert.equal(head(root), decoy);
  for (const [rel, text] of Object.entries(files)) {
    assert.equal(fs.readFileSync(path.join(root, rel), 'utf8'), text, rel);
  }
  assert.equal(git(root, ['status', '--porcelain']), '');
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

  const { code, out, err } = cli(root, 'cutover', '--undo');

  assert.equal(code, 0, err || out);
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
//
// Dates are pinned so the re-cut deterministically reproduces the first
// baseline oid. Left to the wall clock this passed only when the two cuts
// straddled a second boundary, which made the interesting case — the two
// records tying against the ref — a coin flip rather than coverage.
test('20260809-113240 CR7: a repo can be cut over again after an undo, and undone again', () => {
  const { root } = seedLedgerRepo();
  const files = defaultLedgerFiles();
  const pinned = {
    GIT_AUTHOR_DATE: '2031-02-03T04:05:06Z',
    GIT_COMMITTER_DATE: '2031-02-03T04:05:06Z',
  };
  assert.equal(cliWithEnv(root, ['cutover'], pinned).code, 0);
  const firstBaseline = git(root, ['rev-parse', STATE_REF]);
  assert.equal(cliWithEnv(root, ['cutover', '--undo'], pinned).code, 0);

  const recut = cliWithEnv(root, ['cutover'], pinned);
  assert.equal(recut.code, 0, recut.err);
  assert.equal(refExists(root, STATE_REF), true);
  assert.equal(refExists(root, ACTIVATION_REF), true);
  assert.equal(git(root, ['rev-parse', STATE_REF]), firstBaseline);

  const { code, err } = cliWithEnv(root, ['cutover', '--undo'], pinned);
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

// --- 20260810-120457 CR1: the cutover anchors the ledger it published --------
//
// The activation is what a later read consults to decide whether a discovered
// `.changeledger` is the one this repo owns, so the cut must record which
// directory it just published — including the supported layout where the ledger
// does not sit at the git top-level.

test('20260810-120457 CR1: cutover anchors the canonical ledger directory', () => {
  const { root } = seedLedgerRepo();

  assert.equal(cli(root, 'cutover').code, 0);

  assert.equal(readActivation(root).ledger_dir, '.changeledger');
});

test('20260810-120457 CR1: cutover anchors a ledger that lives below the git top-level', () => {
  const files = {};
  for (const [rel, text] of Object.entries(defaultLedgerFiles())) {
    files[`packages/app/${rel}`] = text;
  }
  const { root } = seedLedgerRepo({ files });
  const ledgerRoot = path.join(root, 'packages', 'app');

  const { code, err } = cli(ledgerRoot, 'cutover');

  assert.equal(code, 0, err);
  assert.equal(readActivation(root).ledger_dir, 'packages/app/.changeledger');
});

// --- 20260810-181802 CR1: the undo verification's enumeration does not grow
// with the number of published documents ------------------------------------
//
// The CLI runs as a child process, so the spawn count is observed via a PATH
// shim wrapping the real `git`, mirroring `countGitSpawns` in
// test/repo.test.mjs but across a real subprocess boundary instead of an
// in-process `run`.

function ledgerFilesWithChangeCount(n) {
  const files = {
    '.changeledger/config.yml': ledgerConfigText,
    '.changeledger/specs/demo-spec.md': ledgerSpecText(),
    '.changeledger/releases/0.1.0.yml': ledgerReleaseText(),
  };
  for (let i = 0; i < n; i += 1) {
    const id = `20260808-00000${i}`;
    files[`.changeledger/changes/${id}-demo.md`] = ledgerChangeText({ id });
  }
  return files;
}

function countGitSpawnsCli(root, args) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-cli-git-shim-'));
  const log = path.join(dir, 'spawns.log');
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  fs.writeFileSync(log, '');
  fs.writeFileSync(
    path.join(dir, 'git'),
    `#!/bin/sh\nprintf '%s ' "$@" >> ${JSON.stringify(log)}\nprintf '\\n' >> ${JSON.stringify(log)}\nexec ${realGit} "$@"\n`,
    { mode: 0o755 },
  );
  const result = cliWithEnv(root, args, { PATH: `${dir}${path.delimiter}${CLI_ENV.PATH}` });
  const spawns = fs
    .readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.trim());
  return { result, spawns };
}

function lsTreeSpawnCount(spawns) {
  return spawns.filter((line) => line.startsWith('ls-tree ')).length;
}

test('20260810-181802 CR1: the undo verification enumeration does not grow with document count', () => {
  const small = seedLedgerRepo({ files: ledgerFilesWithChangeCount(2) });
  const large = seedLedgerRepo({ files: ledgerFilesWithChangeCount(5) });
  const smallBefore = fs.readFileSync(
    path.join(small.root, '.changeledger', 'specs', 'demo-spec.md'),
  );
  const largeBefore = fs.readFileSync(
    path.join(large.root, '.changeledger', 'specs', 'demo-spec.md'),
  );
  assert.equal(cli(small.root, 'cutover').code, 0);
  assert.equal(cli(large.root, 'cutover').code, 0);

  const smallUndo = countGitSpawnsCli(small.root, ['cutover', '--undo']);
  const largeUndo = countGitSpawnsCli(large.root, ['cutover', '--undo']);

  assert.equal(smallUndo.result.code, 0, smallUndo.result.err);
  assert.equal(largeUndo.result.code, 0, largeUndo.result.err);

  const smallCount = lsTreeSpawnCount(smallUndo.spawns);
  const largeCount = lsTreeSpawnCount(largeUndo.spawns);
  assert.equal(
    smallCount,
    largeCount,
    `ls-tree spawn count grew with document count: 2 docs -> ${smallCount}, 5 docs -> ${largeCount}\n${smallUndo.spawns.join('\n')}\n---\n${largeUndo.spawns.join('\n')}`,
  );

  assert.equal(
    fs
      .readFileSync(path.join(small.root, '.changeledger', 'specs', 'demo-spec.md'))
      .equals(smallBefore),
    true,
  );
  assert.equal(
    fs
      .readFileSync(path.join(large.root, '.changeledger', 'specs', 'demo-spec.md'))
      .equals(largeBefore),
    true,
  );
});

// 20260812-003311 — "keeps only config.yml" must be literally true: an empty
// collection directory is invisible to `git rm` (git tracks files, not dirs),
// so ranchops' cut left an untracked empty `releases/` contradicting the help.
test('20260812-003311: the cleanup leaves no empty collection directory behind', () => {
  const { root } = seedLedgerRepo();
  fs.mkdirSync(path.join(root, '.changeledger', 'empty-extra'), { recursive: true });

  const { code, out, err } = cli(root, 'cutover');
  assert.equal(code, 0, err || out);
  // Only the extra untracked dir may linger (out of the collections' scope);
  // the COLLECTION directories themselves must be gone along with their files.
  const left = fs.readdirSync(path.join(root, '.changeledger')).sort();
  assert.ok(!left.includes('changes'), `changes/ survived: ${left}`);
  assert.ok(!left.includes('specs'), `specs/ survived: ${left}`);
  assert.ok(!left.includes('releases'), `releases/ survived: ${left}`);
});

// The ranchops shape itself: a collection directory that is EMPTY before the
// cut (nothing tracked in it, so `git rm` never sees it) must not survive.
test('20260812-003311: an empty collection directory before the cut is removed too', () => {
  const { root } = seedLedgerRepo();
  fs.rmSync(path.join(root, '.changeledger', 'releases'), { recursive: true, force: true });
  execFileSync('git', ['commit', '-aqm', 'chore: drop releases', '--no-verify'], {
    cwd: root,
    env: CLI_ENV,
  });
  fs.mkdirSync(path.join(root, '.changeledger', 'releases'), { recursive: true });

  const { code, out, err } = cli(root, 'cutover');
  assert.equal(code, 0, err || out);
  assert.deepEqual(fs.readdirSync(path.join(root, '.changeledger')).sort(), ['config.yml']);
});

// 20260812-020449 CR1 — the cosmetic directory removal must never abort a cut
// that is already published: the throw sat between `git rm` and the cleanup
// commit, stranding the cut in its interrupted window (Windows delete-pending
// semantics hit exactly this). Any rmdir failure other than ENOENT degrades to
// a warning naming the directory and the code.
test('20260812-020449 CR1: a failing cleanup rmdir warns and the cut still lands', async () => {
  const { cutover } = await import('../src/commands/cutover.mjs');
  const root = fs.realpathSync(seedLedgerRepo().root);
  const warnings = [];
  const output = { log: () => {}, warn: (m) => warnings.push(m) };
  const realRmdir = fs.rmdirSync;
  fs.rmdirSync = () => {
    const e = new Error('EPERM: operation not permitted');
    e.code = 'EPERM';
    throw e;
  };
  try {
    const exit = cutover({}, root, output);
    assert.equal(exit, 0);
  } finally {
    fs.rmdirSync = realRmdir;
  }
  assert.ok(
    warnings.some((m) => /could not remove/.test(m) && /EPERM/.test(m)),
    `expected the EPERM warning, got: ${warnings}`,
  );
  const subject = execFileSync('git', ['log', '-1', '--format=%s'], {
    cwd: root,
    env: CLI_ENV,
    encoding: 'utf8',
  }).trim();
  assert.equal(subject, 'chore(state): cut the ledger over to the state ref');
});

// 20260812-022248 CR1 — one path form for every pathspec. A cwd that reaches
// the repo through a symlink (POSIX twin of Windows 8.3 short names: the CI
// failure mixed RUNNER~1 with git's long-form top-level) must not make
// `path.relative` fabricate ../-climbing pathspecs that git rejects as
// "outside repository".
test('20260812-022248 CR1: a symlinked cwd still cuts over with correct pathspecs', async () => {
  const { cutover } = await import('../src/commands/cutover.mjs');
  const { root } = seedLedgerRepo();
  const link = path.join(
    fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'cl-link-'))),
    'repo',
  );
  fs.symlinkSync(root, link);
  const exit = cutover({}, link, { log: () => {}, warn: () => {} });
  assert.equal(exit, 0);
  const subject = execFileSync('git', ['log', '-1', '--format=%s'], {
    cwd: root,
    env: CLI_ENV,
    encoding: 'utf8',
  }).trim();
  assert.equal(subject, 'chore(state): cut the ledger over to the state ref');
});
