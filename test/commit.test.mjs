import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { commit } from '../src/commands/commit.mjs';

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

function writeChange(root, id, status) {
  const file = path.join(root, '.changeledger', 'changes', `${id}-x.md`);
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

test('CR1: a single in-progress change auto-resolves the marker', () => {
  const root = gitRepo();
  writeChange(root, '20260711-000001', 'in-progress');
  stageFile(root, 'a.txt', 'x');

  const subject = commit({ message: 'feat(cli): add helper' }, root);

  assert.equal(subject, 'feat(cli): add helper [#20260711-000001]');
  assert.equal(lastSubject(root), 'feat(cli): add helper [#20260711-000001]');
});

test('CR2: ambiguity without --id creates no commit and lists candidates', () => {
  const root = gitRepo();
  writeChange(root, '20260711-000001', 'in-progress');
  writeChange(root, '20260711-000002', 'in-progress');
  stageFile(root, 'a.txt', 'x');

  assert.throws(
    () => commit({ message: 'fix(x): y' }, root),
    /Ambiguous.*20260711-000001.*20260711-000002/s,
  );
  assert.equal(commitCount(root), 0);
});

test('225638 CR2: multiple --id keep a clean subject and put markers in the body', () => {
  const root = gitRepo();
  stageFile(root, 'a.txt', 'x');

  const subject = commit({ message: 'feat(x): y', ids: ['A', 'B'] }, root);

  assert.equal(subject, 'feat(x): y');
  assert.equal(lastSubject(root), 'feat(x): y');
  assert.equal(lastBody(root), 'ChangeLedger: [#A] [#B]');
});

test('CR1 (20260711-204419): a git commit failure surfaces git stderr in the error', () => {
  const root = gitRepo();
  writeChange(root, '20260711-000001', 'in-progress');
  // nothing staged — git commit will fail with a diagnostic on its output

  assert.throws(
    () => commit({ message: 'fix(x): algo' }, root),
    (e) => /nothing (added )?to commit|no changes added/i.test(e.message),
    'error message must carry the git diagnostic, not just "Command failed"',
  );
  assert.equal(commitCount(root), 0);
});

test('CR4: a non-conventional subject creates no commit', () => {
  const root = gitRepo();
  stageFile(root, 'a.txt', 'x');

  assert.throws(() => commit({ message: 'arreglos varios' }, root), /type\(scope\): description/);
  assert.equal(commitCount(root), 0);
});

test('CR1 (20260726-141124): a staged change document not declared aborts the commit', () => {
  const root = gitRepo();
  const foreign = writeChange(root, '20260711-999999', 'draft');
  git(root, ['add', foreign]);
  stageFile(root, 'a.txt', 'x');

  assert.throws(
    () => commit({ message: 'fix(x): y', ids: ['20260711-000001'] }, root),
    /Staged change document\(s\) not declared for this commit: \.changeledger\/changes\/20260711-999999-x\.md \(declared: 20260711-000001\)$/,
  );
  assert.equal(commitCount(root), 0);
});

test('CR2 (20260726-141124): declaring the staged id allows the commit', () => {
  const root = gitRepo();
  const declared = writeChange(root, '20260711-999999', 'draft');
  git(root, ['add', declared]);

  const subject = commit({ message: 'fix(x): y', ids: ['20260711-999999'] }, root);

  assert.equal(subject, 'fix(x): y [#20260711-999999]');
  assert.equal(commitCount(root), 1);
});

test('CR3 (20260726-141124): a code file staged alone never triggers the guard', () => {
  const root = gitRepo();
  writeChange(root, '20260711-000001', 'in-progress');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  stageFile(root, 'src/app.mjs', 'x');

  const subject = commit({ message: 'feat(x): y' }, root);

  assert.equal(subject, 'feat(x): y [#20260711-000001]');
});

test('CR4 (20260726-141124): the staged path list is logged before the commit', () => {
  const root = gitRepo();
  const declared = writeChange(root, '20260711-000001', 'draft');
  git(root, ['add', declared]);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  stageFile(root, 'src/app.mjs', 'y');
  const calls = [];
  const log = (msg) => calls.push(msg);

  const subject = commit({ message: 'feat(x): y', ids: ['20260711-000001'] }, root, undefined, log);

  assert.equal(subject, 'feat(x): y [#20260711-000001]');
  assert.deepEqual(calls, ['Staged: .changeledger/changes/20260711-000001-x.md, src/app.mjs']);
});
