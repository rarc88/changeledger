import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { commit } from '../src/commands/commit.mjs';
import { findChangeledgerDir, resolveRepoPath } from '../src/config.mjs';
import { loadRepo } from '../src/repo.mjs';

function fixture(changesDir = '.changeledger/changes') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-'));
  const changes = path.join(root, '.changeledger', 'changes');
  fs.mkdirSync(changes, { recursive: true });
  fs.writeFileSync(
    path.join(root, '.changeledger', 'config.yml'),
    `language: en\nchanges_dir: ${changesDir}\ntypes:\n  feature:\n    stages: [request, plan]\n`,
  );
  fs.writeFileSync(
    path.join(changes, '0001-x.md'),
    '---\nid: "0001"\ntitle: X\ntype: feature\nstatus: draft\ncreated: 2026-06-13T00:00:00Z\ndepends_on: []\n---\n\n## Request\n\nHi.\n',
  );
  return root;
}

test('loadRepo finds .changeledger, reads config and changes', () => {
  const root = fixture();
  const repo = loadRepo(root);
  assert.equal(repo.config.language, 'en');
  assert.equal(repo.changes.length, 1);
  assert.equal(repo.changes[0].frontmatter.id, '0001');
});

test('loadRepo walks up from a subdirectory', () => {
  const root = fixture();
  const sub = path.join(root, 'src', 'deep');
  fs.mkdirSync(sub, { recursive: true });
  const repo = loadRepo(sub);
  assert.equal(repo.changes.length, 1);
});

test('loadRepo throws outside a ChangeLedger repo', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-empty-'));
  assert.throws(() => loadRepo(empty), /Run `changeledger init`/);
});

test('103625: project discovery ignores a global home and finds only configured repos', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-tree-'));
  const globalState = path.join(home, '.changeledger');
  fs.mkdirSync(globalState);
  fs.writeFileSync(path.join(globalState, '.registry.json'), '{}\n');

  const tempRoot = path.join(home, 'AppData', 'Local', 'Temp');
  const outside = path.join(tempRoot, 'outside');
  fs.mkdirSync(outside, { recursive: true });

  assert.equal(findChangeledgerDir(outside), null);
  assert.throws(() => loadRepo(outside), /no \.changeledger\/ found/);

  const repoRoot = path.join(tempRoot, 'repo');
  const projectState = path.join(repoRoot, '.changeledger');
  const nested = path.join(repoRoot, 'src', 'nested');
  fs.mkdirSync(projectState, { recursive: true });
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(
    path.join(projectState, 'config.yml'),
    'changes_dir: .changeledger/changes\ntypes:\n  feature:\n    stages: [request]\n',
  );

  assert.equal(findChangeledgerDir(nested), projectState);
  assert.equal(loadRepo(nested).repoRoot, repoRoot);
});

test('ChangeLedger migration does not discover the retired project directory (CR3, CR9)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-retired-'));
  fs.mkdirSync(path.join(root, '.sl'), { recursive: true });
  fs.writeFileSync(path.join(root, '.sl', 'config.yml'), 'language: en\n');
  assert.throws(() => loadRepo(root), /no \.changeledger\/ found/);
});

test('CR1: a traversal changes_dir is rejected and reads nothing outside', () => {
  const root = fixture('../outside');
  assert.throws(() => loadRepo(root), /changes_dir.*escapes the repo root/);
});

test('CR2: an absolute changes_dir is rejected before any IO', () => {
  const root = fixture(path.join(os.tmpdir(), 'changeledger-abs-target'));
  assert.throws(() => loadRepo(root), /changes_dir.*must be relative/);
});

test('CR3: a configured dir symlinked outside the repo is rejected', () => {
  const root = fixture('.changeledger/changes');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-ext-'));
  const link = path.join(root, 'escape');
  fs.symlinkSync(outside, link);
  assert.throws(() => resolveRepoPath(root, 'escape', 'specs_dir'), /specs_dir.*symlink/);
});

test('CR4: default and normalized internal paths keep working', () => {
  assert.equal(loadRepo(fixture()).changes.length, 1);
  assert.equal(loadRepo(fixture('./.changeledger/changes')).changes.length, 1);
});

// 20260615-175731 — an intermediate ancestor is a symlink and the final target
// does not exist yet. The shape check passes and existsSync(resolved) is false,
// so the realpath guard must inspect the nearest existing ancestor.
test('175731 CR1: an external intermediate symlink with a non-existent target is rejected', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-'));
  fs.mkdirSync(path.join(root, '.changeledger'), { recursive: true });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-ext-'));
  fs.symlinkSync(outside, path.join(root, '.changeledger', 'escape'));
  assert.throws(
    () => resolveRepoPath(root, '.changeledger/escape/newdir', 'changes_dir'),
    /changes_dir.*symlink/,
  );
  assert.ok(!fs.existsSync(path.join(outside, 'newdir')), 'must not create in the external target');
});

test('175731 CR2: an internal intermediate symlink is accepted for a non-existent target', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-'));
  const real = path.join(root, '.changeledger', 'real');
  fs.mkdirSync(real, { recursive: true });
  fs.symlinkSync(real, path.join(root, '.changeledger', 'link'));
  const resolved = resolveRepoPath(root, '.changeledger/link/newdir', 'changes_dir');
  assert.equal(resolved, path.join(root, '.changeledger', 'link', 'newdir'));
});

// 20260730-183807 CR4 — loadRepo must never let a raw fs or parse error reach
// the caller unattributed when a consumer repo's changes_dir contains a
// directory that merely looks like a document, or a symlink to a file with no
// frontmatter block.

test('183807 CR4: a directory named like a change document gets a named error, never raw EISDIR', () => {
  const root = fixture();
  const changes = path.join(root, '.changeledger', 'changes');
  const offender = path.join(changes, '0002-looks-like-a-doc.md');
  fs.mkdirSync(offender);

  assert.throws(
    () => loadRepo(root),
    (e) =>
      e.message === `${offender}: expected a change document but found a directory` &&
      e.code !== 'EISDIR',
  );
});

test('183807 CR4: a symlink to a file without frontmatter gets a named error with its path', () => {
  const root = fixture();
  const changes = path.join(root, '.changeledger', 'changes');
  const target = path.join(root, 'no-frontmatter-target.md');
  fs.writeFileSync(target, 'no frontmatter here, just prose\n');
  const offender = path.join(changes, '0002-symlink.md');
  fs.symlinkSync(target, offender);

  assert.throws(
    () => loadRepo(root),
    (e) => e.message === `${offender}: Change is missing its frontmatter block`,
  );
});

// 20260730-183807 CR5 — a `changes_dir` that collapses to the repo root must
// be diagnosed as the collapse itself, not left to die on the first ordinary
// markdown file (e.g. AGENTS.md) with the raw frontmatter error. The message
// stays consistent with the commit guard's own diagnosis of the same collapse
// (162616 CR9), since loadRepo is now the first thing `commit` calls.

test('183807 CR5: a collapsed changes_dir aborts naming the collapse, not the frontmatter error', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-collapsed-'));
  fs.mkdirSync(path.join(root, '.changeledger'), { recursive: true });
  fs.writeFileSync(path.join(root, '.changeledger', 'config.yml'), 'changes_dir: "."\n');
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');

  assert.throws(
    () => loadRepo(root),
    /changes_dir "\." resolves to the repo root; the commit guard cannot judge staged paths/,
  );
});

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

test('183807 CR5: the realistic `commit` route reaches the collapse message, not the frontmatter one', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-collapsed-commit-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  fs.mkdirSync(path.join(root, '.changeledger'), { recursive: true });
  fs.writeFileSync(path.join(root, '.changeledger', 'config.yml'), 'changes_dir: "."\n');
  // An ordinary consumer markdown file — before CR5 this is exactly what
  // `loadRepo` tried to parse as a change document and died on, raw.
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  fs.writeFileSync(path.join(root, 'leftover.tmp'), 'not declared anywhere');
  git(root, ['add', '-A']);

  assert.throws(
    () => commit({ message: 'fix(x): y', ids: ['20260711-000001'] }, root, undefined, () => {}),
    (e) =>
      e.message ===
        'changes_dir "." resolves to the repo root; the commit guard cannot judge staged paths — configure changes_dir to a subdirectory' &&
      !e.message.includes('frontmatter'),
  );
});
