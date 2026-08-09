import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { commit } from '../src/commands/commit.mjs';
import { STATE_REF, writeActivation } from '../src/state-store.mjs';
import { buildTree, commitTree, updateRef } from './helpers/state-repo.mjs';

// This suite may itself run inside this repo's own pre-commit hook, which
// exports GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE for the outer repo. Left
// inherited, every git call below would silently operate on the outer repo
// instead of the scratch fixture — strip them so tests are hook-safe.
const GIT_ENV = { ...process.env };
for (const key of [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CEILING_DIRECTORIES',
]) {
  delete GIT_ENV[key];
}
function git(root, args) {
  return execFileSync('git', args, { cwd: root, env: GIT_ENV, encoding: 'utf8' });
}

// A scratch repo that is both a real git repo and a minimal ChangeLedger repo
// (commit.mjs resolves the active change via loadRepo).
function gitRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-commit-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  fs.mkdirSync(path.join(root, '.changeledger', 'changes'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.changeledger', 'config.yml'),
    'changes_dir: .changeledger/changes\n',
  );
  return root;
}

function activatedGitRepo() {
  const root = gitRepo();
  const id = '20260809-113242';
  const tree = buildTree(root, {
    '.changeledger-state/manifest.yml': 'format_version: 1\nproject_id: demo\n',
    '.changeledger-state/config.yml': 'project_id: demo\nchanges_dir: .changeledger/changes\n',
    '.changeledger-state/changes/ref-only.md': `---\nid: "${id}"\ntitle: Ref only\ntype: feature\nstatus: in-progress\ncreated: 2026-08-09T00:00:00Z\ndepends_on: []\n---\n\n## Request\n`,
  });
  const revision = commitTree(root, tree);
  updateRef(root, STATE_REF, revision);
  writeActivation(root, { stateRef: STATE_REF });
  fs.rmSync(path.join(root, '.changeledger', 'changes'), { recursive: true });
  return { root, id };
}

function writeChange(root, id, status) {
  return writeChangeNamed(root, `${id}-x.md`, id, status);
}

// A change document under a caller-chosen filename, for the cases where the name
// itself is the subject (non-ASCII, quote characters) rather than the id.
function writeChangeNamed(root, name, id, status) {
  const file = path.join(root, '.changeledger', 'changes', name);
  fs.writeFileSync(
    file,
    `---\nid: "${id}"\ntitle: X\ntype: feature\nstatus: ${status}\ncreated: 2026-07-11T00:00:00Z\ndepends_on: []\n---\n\n## Request\n`,
  );
  return file;
}

function stageFile(root, name, content) {
  fs.writeFileSync(path.join(root, name), content);
  git(root, ['add', name]);
}

// Stages `relPath` straight into the index, with no file in the worktree. This is
// the only way to reproduce a staged entry whose ancestor component does not
// exist on disk — the shape that let a path named like a change document travel
// into a commit while the guard still classified path strings.
function stageViaIndex(root, relPath, content) {
  const sha = execFileSync('git', ['hash-object', '-w', '--stdin'], {
    cwd: root,
    env: GIT_ENV,
    encoding: 'utf8',
    input: content,
  }).trim();
  git(root, ['update-index', '--add', '--cacheinfo', `100644,${sha},${relPath}`]);
}

function commitCount(root) {
  try {
    return Number(git(root, ['rev-list', '--count', 'HEAD']).trim());
  } catch {
    return 0;
  }
}

function lastSubject(root) {
  return git(root, ['log', '-1', '--pretty=%s']).trim();
}

function lastBody(root) {
  return git(root, ['log', '-1', '--pretty=%b']).trim();
}

// Most tests below don't exercise CR4's logging directly and would otherwise
// leak `Staged: …` to test stdout via the default `console.log`.
const noop = () => {};

// A git repo whose ChangeLedger ledger lives below the git root (at `pkg/`),
// reproducing the coordinate mismatch CR6 covers: `git diff --name-only`
// paths are relative to the git top-level regardless of where `.changeledger`
// sits.
function gitRepoWithNestedLedger() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-commit-nested-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  const pkg = path.join(root, 'pkg');
  fs.mkdirSync(path.join(pkg, '.changeledger', 'changes'), { recursive: true });
  fs.writeFileSync(
    path.join(pkg, '.changeledger', 'config.yml'),
    'changes_dir: .changeledger/changes\n',
  );
  return { root, pkg };
}

// A `run` double that answers `commit()`'s three git invocations without a real
// index, so the pinned index-read invocation and its failure attribution can be
// asserted without depending on the host's git version.
function recordingRun(root, stagedOut) {
  const calls = [];
  const run = (args, cwd) => {
    calls.push({ args, cwd });
    if (args.includes('--show-prefix')) {
      const prefix = path.relative(fs.realpathSync(root), cwd).split(path.sep).join('/');
      return prefix ? `${prefix}/\n` : '\n';
    }
    if (args[0] === 'rev-parse' && args[1] === '--absolute-git-dir') {
      return `${path.join(fs.realpathSync(root), '.git')}\n`;
    }
    if (args[0] === 'rev-parse') return `${fs.realpathSync(root)}\n`;
    if (args.includes('diff')) {
      if (typeof stagedOut === 'function') return stagedOut(args, cwd);
      return stagedOut;
    }
    return '';
  };
  return { run, calls };
}

// The pinned, config-proof invocation `commit()`'s guard must use to read the
// index (CR9). Every flag neutralizes one repo-configurable axis of git's
// default presentation.
const PINNED_STAGED_ARGS = [
  '-c',
  'core.quotePath=false',
  'diff',
  '--cached',
  '-z',
  '--no-renames',
  '--no-relative',
  '--ignore-submodules=none',
  '--name-only',
];

// A git repo whose `.changeledger` is a symlink to an in-repo directory —
// accepted by resolveRepoPath, and the shape CR9 covers: git reports paths
// through the link target while `changes_dir` names the link.
function gitRepoWithSymlinkedLedger() {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-commit-symlink-')),
  );
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  fs.mkdirSync(path.join(root, 'ledger', 'changes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'ledger', 'config.yml'), 'changes_dir: .changeledger/changes\n');
  fs.symlinkSync('ledger', path.join(root, '.changeledger'));
  return root;
}

// A real nested Git repository can sit at either the ledger path itself or the
// internal target of a symlinked ledger. The outer index can still carry an
// entry below it (for example after a history operation), so the guard must
// derive its boundary from the outer repository rather than rediscovering the
// nested one from changes_dir.
function gitRepoWithNestedGitLedger({ symlink = false } = {}) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-commit-nested-git-')),
  );
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  const ledgerName = symlink ? 'ledger' : '.changeledger';
  const ledger = path.join(root, ledgerName);
  fs.mkdirSync(path.join(ledger, 'changes'), { recursive: true });
  fs.writeFileSync(path.join(ledger, 'config.yml'), 'changes_dir: .changeledger/changes\n');
  git(ledger, ['init', '-q']);
  if (symlink) fs.symlinkSync(ledgerName, path.join(root, '.changeledger'));
  return { root, ledgerName };
}

// The two Unicode forms of `añadir`. macOS stores what it is given but git
// precomposes to NFC before recording a path, so a declared document's own name
// can reach the guard in a different form than `readdir` reports (CR10).
const NFC_NAME = `20260711-000001-a\u00f1adir.md`;
const NFD_NAME = `20260711-000001-an\u0303adir.md`;

test('CR1: a single in-progress change auto-resolves the marker', () => {
  const root = gitRepo();
  writeChange(root, '20260711-000001', 'in-progress');
  stageFile(root, 'a.txt', 'x');

  const subject = commit({ message: 'feat(cli): add helper' }, root, undefined, noop);

  assert.equal(subject, 'feat(cli): add helper [#20260711-000001]');
  assert.equal(lastSubject(root), 'feat(cli): add helper [#20260711-000001]');
});

test('20260809-113242 CR7: activated commit resolves the marker without a worktree staged guard', () => {
  const { root, id } = activatedGitRepo();
  stageFile(root, 'a.txt', 'x');
  const calls = [];
  const run = (args, cwd) => {
    calls.push(args);
    return execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' });
  };

  const subject = commit({ message: 'feat(core): x' }, root, run, noop);

  assert.equal(subject, `feat(core): x [#${id}]`);
  assert.equal(lastSubject(root), subject);
  assert.equal(
    calls.some((args) => args.includes('--show-prefix')),
    true,
    'activated commits still derive the effective changes_dir boundary for the staged guard',
  );
});

test('20260809-113242 CR13: activated commit rejects a foreign staged change document', () => {
  const { root } = activatedGitRepo();
  stageFile(root, 'a.txt', 'x');
  fs.mkdirSync(path.join(root, '.changeledger', 'changes'), { recursive: true });
  stageFile(root, '.changeledger/changes/foreign.md', 'foreign');

  assert.throws(
    () => commit({ message: 'feat(core): x' }, root, undefined, noop),
    (error) =>
      error.message ===
      'Staged path(s) under the changes directory not declared for this commit: .changeledger/changes/foreign.md',
  );
  assert.equal(commitCount(root), 0);
});

test('20260809-113242 CR13: activated commit retains the .gitkeep exception', () => {
  const { root, id } = activatedGitRepo();
  stageFile(root, 'a.txt', 'x');
  fs.mkdirSync(path.join(root, '.changeledger', 'changes'), { recursive: true });
  stageFile(root, '.changeledger/changes/.gitkeep', '');

  const subject = commit({ message: 'feat(core): x' }, root, undefined, noop);

  assert.equal(subject, `feat(core): x [#${id}]`);
  assert.equal(commitCount(root), 1);
});

test('CR2: ambiguity without --id creates no commit and lists candidates', () => {
  const root = gitRepo();
  writeChange(root, '20260711-000001', 'in-progress');
  writeChange(root, '20260711-000002', 'in-progress');
  stageFile(root, 'a.txt', 'x');

  assert.throws(
    () => commit({ message: 'fix(x): y' }, root, undefined, noop),
    /Ambiguous.*20260711-000001.*20260711-000002/s,
  );
  assert.equal(commitCount(root), 0);
});

test('225638 CR2: multiple --id keep a clean subject and put markers in the body', () => {
  const root = gitRepo();
  stageFile(root, 'a.txt', 'x');

  const subject = commit({ message: 'feat(x): y', ids: ['A', 'B'] }, root, undefined, noop);

  assert.equal(subject, 'feat(x): y');
  assert.equal(lastSubject(root), 'feat(x): y');
  assert.equal(lastBody(root), 'ChangeLedger: [#A] [#B]');
});

test('CR1 (20260711-204419): a git commit failure surfaces git stderr in the error', () => {
  const root = gitRepo();
  writeChange(root, '20260711-000001', 'in-progress');
  // nothing staged — git commit will fail with a diagnostic on its output

  assert.throws(
    () => commit({ message: 'fix(x): algo' }, root, undefined, noop),
    (e) => /nothing (added )?to commit|no changes added/i.test(e.message),
    'error message must carry the git diagnostic, not just "Command failed"',
  );
  assert.equal(commitCount(root), 0);
});

test('CR4: a non-conventional subject creates no commit', () => {
  const root = gitRepo();
  stageFile(root, 'a.txt', 'x');

  assert.throws(
    () => commit({ message: 'arreglos varios' }, root, undefined, noop),
    /type\(scope\): description/,
  );
  assert.equal(commitCount(root), 0);
});

test('CR1 (20260726-141124): a staged path under changes_dir that is not an expected path aborts', () => {
  const root = gitRepo();
  const foreign = writeChange(root, '20260711-999999', 'draft');
  git(root, ['add', foreign]);
  stageFile(root, 'a.txt', 'x');

  assert.throws(
    () => commit({ message: 'fix(x): y', ids: ['20260711-000001'] }, root, undefined, noop),
    (e) =>
      e.message ===
      'Staged path(s) under the changes directory not declared for this commit: .changeledger/changes/20260711-999999-x.md (declared: 20260711-000001)',
  );
  assert.equal(commitCount(root), 0);
});

test('CR2 (20260726-141124): the declared change document is byte-identical to an expected path and is allowed', () => {
  const root = gitRepo();
  const declared = writeChange(root, '20260711-999999', 'draft');
  git(root, ['add', declared]);

  const subject = commit({ message: 'fix(x): y', ids: ['20260711-999999'] }, root, undefined, noop);

  assert.equal(subject, 'fix(x): y [#20260711-999999]');
  assert.equal(commitCount(root), 1);
});

test('CR3 (20260726-141124): staged paths outside changes_dir are not judged', () => {
  const root = gitRepo();
  writeChange(root, '20260711-000001', 'in-progress');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  stageFile(root, 'src/app.mjs', 'x');
  stageFile(root, '.changeledger/config.yml', 'changes_dir: .changeledger/changes\n');

  const subject = commit({ message: 'feat(x): y' }, root, undefined, noop);

  assert.equal(subject, 'feat(x): y [#20260711-000001]');
  assert.equal(commitCount(root), 1);
});

test('CR4 (20260726-141124): the staged path list is logged before the guard is evaluated', () => {
  const root = gitRepo();
  const foreign = writeChange(root, '20260711-999999', 'draft');
  git(root, ['add', foreign]);
  stageFile(root, 'src-app.mjs', 'y');
  const calls = [];
  const log = (msg) => calls.push(msg);

  assert.throws(() =>
    commit({ message: 'feat(x): y', ids: ['20260711-000001'] }, root, undefined, log),
  );

  assert.deepEqual(calls, ['Staged: .changeledger/changes/20260711-999999-x.md, src-app.mjs']);
});

test('CR5 (20260726-141124): .gitkeep directly in changes_dir is the one exempt name', () => {
  const root = gitRepo();
  stageFile(root, '.changeledger/changes/.gitkeep', '');

  const subject = commit(
    { message: 'chore(x): y', ids: ['20260711-000001'] },
    root,
    undefined,
    noop,
  );

  assert.equal(subject, 'chore(x): y [#20260711-000001]');
  assert.equal(commitCount(root), 1);
});

test('CR5 (20260726-141124): an unexpected non-document under changes_dir aborts and is named', () => {
  const root = gitRepo();
  stageFile(root, '.changeledger/changes/.DS_Store', 'binary-ish');
  stageFile(
    root,
    '.changeledger/changes/.20260711-000002-x.md.12345.1690000000000.0.tmp',
    'leftover atomic-write temp file',
  );

  assert.throws(
    () => commit({ message: 'feat(x): y', ids: ['20260711-000001'] }, root, undefined, noop),
    (e) =>
      e.message ===
      'Staged path(s) under the changes directory not declared for this commit: .changeledger/changes/.20260711-000002-x.md.12345.1690000000000.0.tmp, .changeledger/changes/.DS_Store (declared: 20260711-000001)',
  );
  assert.equal(commitCount(root), 0);
});

test('CR6 (20260726-141124): a staged path whose ancestor is named like a change document aborts', () => {
  const root = gitRepo();
  stageViaIndex(root, '.changeledger/changes/20260711-999999-x.md/inner', 'x');

  assert.throws(
    () => commit({ message: 'fix(x): y', ids: ['20260711-000001'] }, root, undefined, noop),
    (e) =>
      e.message ===
      'Staged path(s) under the changes directory not declared for this commit: .changeledger/changes/20260711-999999-x.md/inner (declared: 20260711-000001)',
  );
  assert.equal(commitCount(root), 0);
});

test('CR7 (20260726-141124): a quoted filename outside changes_dir is not a path form and never aborts', () => {
  const root = gitRepo();
  writeChange(root, '20260711-000001', 'in-progress');
  const { run, calls } = recordingRun(root, '"quoted.mjs"\0');

  const subject = commit({ message: 'feat(x): y' }, root, run, noop);

  assert.equal(subject, 'feat(x): y [#20260711-000001]');
  assert.equal(
    calls.some((call) => call.args[0] === 'commit'),
    true,
    'the outside path must reach the commit invocation',
  );
});

test('CR7 (20260726-141124): a quoted filename under changes_dir aborts as undeclared, named verbatim', () => {
  const root = gitRepo();
  const { run } = recordingRun(root, '.changeledger/changes/"20260711-999999-x.md"\0');

  assert.throws(
    () => commit({ message: 'fix(x): y', ids: ['20260711-000001'] }, root, run, noop),
    (e) =>
      e.message ===
      'Staged path(s) under the changes directory not declared for this commit: .changeledger/changes/"20260711-999999-x.md" (declared: 20260711-000001)',
  );
  assert.equal(commitCount(root), 0);
});

test("CR8 (20260726-141124): expected paths are computed in git's own top-level coordinates", () => {
  const { root, pkg } = gitRepoWithNestedLedger();
  fs.writeFileSync(
    path.join(pkg, '.changeledger', 'changes', '20260711-999999-x.md'),
    '---\nid: "20260711-999999"\n---\n',
  );
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'app.mjs'), 'x');
  git(root, ['add', '-A']);

  assert.throws(
    () => commit({ message: 'fix(x): y', ids: ['20260711-000001'] }, pkg, undefined, noop),
    (e) =>
      e.message ===
      'Staged path(s) under the changes directory not declared for this commit: pkg/.changeledger/changes/20260711-999999-x.md (declared: 20260711-000001)',
  );
  assert.equal(commitCount(root), 0);
});

test('CR9 (20260726-141124): a symlinked .changeledger keeps the guard active', () => {
  const root = gitRepoWithSymlinkedLedger();
  fs.writeFileSync(
    path.join(root, 'ledger', 'changes', '20260711-999999-x.md'),
    '---\nid: "20260711-999999"\n---\n',
  );
  git(root, ['add', '-A']);

  assert.throws(
    () => commit({ message: 'fix(x): y', ids: ['20260711-000001'] }, root, undefined, noop),
    (e) =>
      e.message ===
      'Staged path(s) under the changes directory not declared for this commit: ledger/changes/20260711-999999-x.md (declared: 20260711-000001)',
  );
  assert.equal(commitCount(root), 0);
});

test('CR10 (20260726-141124): a declared document is allowed in either Unicode form', () => {
  const root = gitRepo();
  writeChangeNamed(root, NFD_NAME, '20260711-000001', 'in-progress');
  git(root, ['add', '-A']);
  const reported = git(root, ['diff', '--cached', '--name-only']);
  assert.match(reported, /changes\//, 'fixture must stage the document');

  const subject = commit(
    { message: 'feat(x): y', ids: ['20260711-000001'] },
    root,
    undefined,
    noop,
  );

  assert.equal(subject, 'feat(x): y [#20260711-000001]');
  assert.equal(commitCount(root), 1);
  assert.notEqual(
    NFC_NAME,
    NFD_NAME,
    'the two Unicode forms must differ for this to mean anything',
  );
});

test('CR10 (20260726-141124): a non-ASCII changes_dir keeps the boundary byte-exact', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-commit-nfd-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  // Git may report the decomposed directory in a platform-configured Unicode
  // form, so the byte-exact diagnostic must follow the pinned index output.
  const dirNfd = `cambio\u0301s`;
  fs.mkdirSync(path.join(root, '.changeledger', dirNfd), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.changeledger', 'config.yml'),
    `changes_dir: .changeledger/${dirNfd}\n`,
  );
  fs.writeFileSync(
    path.join(root, '.changeledger', dirNfd, '20260711-999999-x.md'),
    '---\nid: "20260711-999999"\n---\n',
  );
  git(root, ['add', '-A']);
  const foreignPath = git(root, PINNED_STAGED_ARGS)
    .split('\0')
    .find((stagedPath) => stagedPath.endsWith('/20260711-999999-x.md'));
  assert.ok(foreignPath, 'fixture must stage the foreign change document');

  assert.throws(
    () => commit({ message: 'fix(x): y', ids: ['20260711-000001'] }, root, undefined, noop),
    (e) =>
      e.message ===
      `Staged path(s) under the changes directory not declared for this commit: ${foreignPath} (declared: 20260711-000001)`,
  );
  assert.equal(commitCount(root), 0);
});

test('CR10 (20260726-141124): a raw-byte platform (core.precomposeunicode=false) with a mixed-composition changes_dir does not hide a foreign document', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-commit-raw-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['config', 'core.precomposeunicode', 'false']);
  // Mixed composition: 'o' is precomposed (U+00F3) while 'n' is decomposed
  // (U+006E U+0303) — a form that is byte-identical to neither this string's
  // own NFC nor its own NFD normalization, and thus enrolled by neither.
  const dirMixed = `cambiós-añadir`;
  fs.mkdirSync(path.join(root, '.changeledger', dirMixed), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.changeledger', 'config.yml'),
    `changes_dir: .changeledger/${dirMixed}\n`,
  );
  fs.writeFileSync(
    path.join(root, '.changeledger', dirMixed, '20260711-999999-f.md'),
    '---\nid: "20260711-999999"\n---\n',
  );
  git(root, ['add', '-A']);

  assert.throws(
    () => commit({ message: 'fix(x): y', ids: ['20260711-000001'] }, root, undefined, noop),
    (e) =>
      e.message ===
      `Staged path(s) under the changes directory not declared for this commit: .changeledger/${dirMixed}/20260711-999999-f.md (declared: 20260711-000001)`,
  );
  assert.equal(commitCount(root), 0);
});

test('CR10 (20260726-141124): a raw-byte platform (core.precomposeunicode=false) with a mixed-composition document name is not falsely aborted', () => {
  const root = gitRepo();
  git(root, ['config', 'core.precomposeunicode', 'false']);
  // Mixed composition: 'e' is precomposed (U+00E9) while 'n' is decomposed
  // (U+006E U+0303) — differs from both this string's own NFC and NFD forms.
  const nameMixed = `20260711-000001-café-añadir.md`;
  writeChangeNamed(root, nameMixed, '20260711-000001', 'in-progress');
  git(root, ['add', '-A']);

  const subject = commit(
    { message: 'feat(x): y', ids: ['20260711-000001'] },
    root,
    undefined,
    noop,
  );

  assert.equal(subject, 'feat(x): y [#20260711-000001]');
  assert.equal(commitCount(root), 1);
});

test('CR11 (20260726-141124): the staged index is read through a fully pinned invocation', () => {
  const root = gitRepo();
  const { run, calls } = recordingRun(root, '');

  commit({ message: 'fix(x): y', ids: ['20260711-000001'] }, root, run, noop);

  const staged = calls.find((c) => c.args.includes('diff'));
  assert.deepEqual(staged.args, PINNED_STAGED_ARGS);
  assert.equal(staged.cwd, fs.realpathSync(root));
});

test('220545 CR2: changes_dir boundary comes from git prefix coordinates', () => {
  const root = gitRepo();
  const staged = '.changeledger/changes/20260711-999999-x.md';
  const { run, calls } = recordingRun(root, `${staged}\0`);

  assert.throws(
    () => commit({ message: 'fix(x): y', ids: ['20260711-000001'] }, root, run, noop),
    (error) =>
      error.message ===
      `Staged path(s) under the changes directory not declared for this commit: ${staged} (declared: 20260711-000001)`,
  );

  const prefixReads = calls.filter((call) => call.args.includes('--show-prefix'));
  assert.deepEqual(prefixReads, [
    {
      args: [
        `--git-dir=${path.join(fs.realpathSync(root), '.git')}`,
        `--work-tree=${fs.realpathSync(root)}`,
        'rev-parse',
        '--show-prefix',
      ],
      cwd: fs.realpathSync(path.join(root, '.changeledger', 'changes')),
    },
  ]);
});

test('220545 CR1/CR2: a real nested Git ledger cannot move the outer-index boundary', () => {
  const { root, ledgerName } = gitRepoWithNestedGitLedger();
  const staged = `${ledgerName}/changes/20260711-999999-x.md`;
  stageViaIndex(root, staged, 'foreign');

  assert.throws(
    () => commit({ message: 'fix(x): y', ids: ['20260711-000001'] }, root, undefined, noop),
    (error) =>
      error.message ===
      `Staged path(s) under the changes directory not declared for this commit: ${staged} (declared: 20260711-000001)`,
  );
  assert.equal(commitCount(root), 0);
});

test('220545 CR2: an internal symlink to a nested Git ledger keeps outer-index coordinates', () => {
  const { root, ledgerName } = gitRepoWithNestedGitLedger({ symlink: true });
  const staged = `${ledgerName}/changes/20260711-999999-x.md`;
  stageViaIndex(root, staged, 'foreign');

  assert.throws(
    () => commit({ message: 'fix(x): y', ids: ['20260711-000001'] }, root, undefined, noop),
    (error) =>
      error.message ===
      `Staged path(s) under the changes directory not declared for this commit: ${staged} (declared: 20260711-000001)`,
  );
  assert.equal(commitCount(root), 0);
});

test('CR11 (20260726-141124): a staged filename containing a newline stays one entry', () => {
  const root = gitRepo();
  const { run } = recordingRun(root, '.changeledger/changes/20260711-999999-a\nb.md\0');

  assert.throws(
    () => commit({ message: 'fix(x): y', ids: ['20260711-000001'] }, root, run, noop),
    (e) =>
      e.message ===
      'Staged path(s) under the changes directory not declared for this commit: .changeledger/changes/20260711-999999-a\nb.md (declared: 20260711-000001)',
  );
  assert.equal(commitCount(root), 0);
});

test('CR12 (20260726-141124): core.quotePath and diff.relative cannot make the guard inert', () => {
  const { root, pkg } = gitRepoWithNestedLedger();
  git(root, ['config', 'core.quotePath', 'true']);
  git(root, ['config', 'diff.relative', 'true']);
  fs.writeFileSync(
    path.join(pkg, '.changeledger', 'changes', `20260711-999999-añadir.md`),
    '---\nid: "20260711-999999"\n---\n',
  );
  git(root, ['add', '-A']);

  assert.throws(
    () => commit({ message: 'fix(x): y', ids: ['20260711-000001'] }, pkg, undefined, noop),
    (e) =>
      e.message ===
      `Staged path(s) under the changes directory not declared for this commit: pkg/.changeledger/changes/20260711-999999-añadir.md (declared: 20260711-000001)`,
  );
  assert.equal(commitCount(root), 0);
});

test('CR13 (20260726-141124): a rename-hidden deletion of a foreign change document aborts', () => {
  const root = gitRepo();
  const foreignBody = [
    '---',
    'id: "20260711-999999"',
    'title: X',
    'type: feature',
    'status: draft',
    'created: 2026-07-11T00:00:00Z',
    'depends_on: []',
    '---',
    '',
    '## Request',
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Lorem ipsum dolor sit amet.',
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Lorem ipsum dolor sit amet.',
    '',
  ].join('\n');
  const foreign = path.join(root, '.changeledger', 'changes', '20260711-999999-x.md');
  fs.writeFileSync(foreign, foreignBody);
  git(root, ['add', foreign]);
  git(root, ['commit', '-m', 'chore: add foreign change']);

  // Leave the foreign document's deletion staged alongside the declared
  // document's addition, with near-identical (boilerplate-heavy) content, so
  // git's default rename detection collapses the pair into a single R09x entry
  // pointing only at the destination — the shape a failed pre-commit leaves.
  fs.rmSync(foreign);
  fs.writeFileSync(
    path.join(root, '.changeledger', 'changes', '20260711-000001-x.md'),
    foreignBody.replace('20260711-999999', '20260711-000001'),
  );
  git(root, ['add', '-A']);
  const status = git(root, ['diff', '--cached', '--name-status']);
  assert.match(status, /^R\d{3}\s/m, 'fixture must reproduce a detected rename');

  assert.throws(
    () => commit({ message: 'fix(x): y', ids: ['20260711-000001'] }, root, undefined, noop),
    (e) =>
      e.message ===
      'Staged path(s) under the changes directory not declared for this commit: .changeledger/changes/20260711-999999-x.md (declared: 20260711-000001)',
  );
  assert.equal(commitCount(root), 1);
});

test('CR14 (20260726-141124): the changes_dir boundary is exact, not a loose prefix', () => {
  const root = gitRepo();
  writeChange(root, '20260711-000001', 'in-progress');
  fs.mkdirSync(path.join(root, '.changeledger', 'changes-old'), { recursive: true });
  stageFile(root, '.changeledger/changes-old/20260711-999999-x.md', 'x');

  const subject = commit({ message: 'feat(x): y' }, root, undefined, noop);
  assert.equal(subject, 'feat(x): y [#20260711-000001]');

  writeChangeNamed(root, '20260711-999999-y.md', '20260711-999999', 'draft');
  git(root, ['add', '.changeledger/changes/20260711-999999-y.md']);
  assert.throws(
    () => commit({ message: 'fix(x): y', ids: ['20260711-000001'] }, root, undefined, noop),
    (e) =>
      e.message ===
      'Staged path(s) under the changes directory not declared for this commit: .changeledger/changes/20260711-999999-y.md (declared: 20260711-000001)',
  );
  assert.equal(commitCount(root), 1);
});

test('CR15 (20260726-141124): an old git is attributed to the version floor', () => {
  const root = gitRepo();
  const { run, calls } = recordingRun(root, () => {
    throw new Error("error: unknown option `no-relative'");
  });

  assert.throws(
    () => commit({ message: 'fix(x): y', ids: ['20260711-000001'] }, root, run, noop),
    (e) =>
      e.message ===
      "Cannot read the staged index; git >= 2.28 is required for --no-relative: error: unknown option `no-relative'",
  );
  assert.equal(
    calls.some((c) => c.args[0] === 'commit'),
    false,
    'no git commit invocation may be issued',
  );
});

test('CR15 (20260726-141124): any other index-read failure is reported as itself and still fails closed', () => {
  const root = gitRepo();
  const { run, calls } = recordingRun(root, () => {
    throw new Error('fatal: index file smaller than expected');
  });

  assert.throws(
    () => commit({ message: 'fix(x): y', ids: ['20260711-000001'] }, root, run, noop),
    (e) => e.message === 'Cannot read the staged index: fatal: index file smaller than expected',
  );
  assert.equal(
    calls.some((c) => c.args[0] === 'commit'),
    false,
    'no git commit invocation may be issued',
  );
});

// --- 20260729-162616 CR8/CR9: the commit guard's whitelist and its own
// changes_dir boundary must never be bypassable or muted ---

test('162616 CR8: a mis-cased changes_dir path injected via the index is judged like the canonical path', () => {
  const root = gitRepo();
  writeChange(root, '20260711-000001', 'in-progress');
  // The real vector (see stageViaIndex above): a normal `git add` cannot
  // fabricate this on APFS since git folds casing. An index entry with a
  // different case for the changes directory component is reachable only
  // through a direct index write (update-index) or a rebase/cherry-pick that
  // carries a mis-cased tree entry.
  stageViaIndex(root, '.Changeledger/changes/injected-different-case.md', 'x');

  assert.throws(
    () => commit({ message: 'fix(x): y', ids: ['20260711-000001'] }, root, undefined, noop),
    (e) =>
      e.message ===
      'Staged path(s) under the changes directory not declared for this commit: .Changeledger/changes/injected-different-case.md (declared: 20260711-000001)',
  );
  assert.equal(commitCount(root), 0);
});

test('162616 CR8: a mis-cased twin of a declared document is rejected, never whitelisted', () => {
  const root = gitRepo();
  writeChange(root, '20260711-000001', 'in-progress');
  // Lowercasing may widen only the guard's judged scope (fail-closed). The
  // whitelist stays exact: on a case-sensitive filesystem this twin is a
  // distinct file with arbitrary content, and only the lowercase document is
  // declared — folding the expected set would silently accept it.
  stageViaIndex(root, '.changeledger/changes/20260711-000001-X.md', 'arbitrary payload');

  assert.throws(
    () => commit({ message: 'fix(x): y', ids: ['20260711-000001'] }, root, undefined, noop),
    (e) =>
      e.message ===
      'Staged path(s) under the changes directory not declared for this commit: .changeledger/changes/20260711-000001-X.md (declared: 20260711-000001)',
  );
  assert.equal(commitCount(root), 0);
});

test('162616 CR9: changes_dir resolving to the repo root aborts naming the collapse instead of muting the guard', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-commit-collapsed-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  fs.mkdirSync(path.join(root, '.changeledger'), { recursive: true });
  fs.writeFileSync(path.join(root, '.changeledger', 'config.yml'), 'changes_dir: .\n');
  stageFile(root, 'leftover.tmp', 'not declared anywhere');

  assert.throws(
    () => commit({ message: 'fix(x): y', ids: ['20260711-000001'] }, root, undefined, noop),
    /changes_dir ".*" resolves to the repo root; the commit guard cannot judge staged paths/,
  );
  assert.equal(commitCount(root), 0);
});

test('162616 CR9: a normal subdirectory changes_dir config is unaffected', () => {
  const root = gitRepo();
  writeChange(root, '20260711-000001', 'in-progress');
  stageFile(root, 'a.txt', 'x');

  const subject = commit({ message: 'feat(x): y' }, root, undefined, noop);

  assert.equal(subject, 'feat(x): y [#20260711-000001]');
  assert.equal(commitCount(root), 1);
});
