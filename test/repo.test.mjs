import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { findChangeledgerDir, resolveRepoPath } from '../src/config.mjs';
import { loadRepo, resolveChange } from '../src/repo.mjs';
import { initializeStateStore } from '../src/state-store.mjs';

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

test('124231 CR9: legacy discovery stays bounded with hundreds of unrelated refs', () => {
  const root = fixture();
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Repo Test',
    GIT_AUTHOR_EMAIL: 'repo@example.com',
    GIT_COMMITTER_NAME: 'Repo Test',
    GIT_COMMITTER_EMAIL: 'repo@example.com',
  };
  const git = (args, input) =>
    execFileSync('git', args, { cwd: root, env, input, encoding: 'utf8' }).trim();
  git(['init', '-q', '-b', 'dev']);
  git(['add', '.changeledger']);
  git(['commit', '-qm', 'legacy']);
  const head = git(['rev-parse', 'HEAD']);
  git(
    ['update-ref', '--stdin'],
    `${Array.from({ length: 500 }, (_, index) => `create refs/heads/unrelated-${index} ${head}`).join('\n')}\n`,
  );
  const started = performance.now();
  assert.equal(loadRepo(root).changes.length, 1);
  assert.ok(performance.now() - started < 3000, 'legacy discovery exceeded 3 seconds');
});

test('124231 CR2/CR9: active state loads changes from the configured ref', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-state-repo-'));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Repo Test',
    GIT_AUTHOR_EMAIL: 'repo@example.com',
    GIT_COMMITTER_NAME: 'Repo Test',
    GIT_COMMITTER_EMAIL: 'repo@example.com',
  };
  const git = (args) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8' }).trim();
  git(['init', '-q', '-b', 'dev']);
  fs.mkdirSync(path.join(root, '.changeledger', 'changes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'README.md'), '# repo\n');
  git(['add', 'README.md']);
  git(['commit', '-qm', 'initial']);
  const text =
    '---\nid: "20260720-120000"\ntitle: Global\ntype: feature\nstatus: draft\ncreated: 2026-07-20T12:00:00Z\ndepends_on: []\n---\n\n## Request\n';
  const initialized = initializeStateStore({
    repoRoot: root,
    branch: 'changeledger/state',
    projectId: 'project-1',
    integrationBranch: 'dev',
    changes: [{ name: '20260720-120000-global.md', text }],
    gitEnv: env,
  });
  fs.writeFileSync(
    path.join(root, '.changeledger', 'config.yml'),
    `schema_version: 4\nlanguage: en\nchanges_dir: .changeledger/changes\nspecs_dir: .changeledger/specs\ngit:\n  integration_branch: dev\n  change_branch_format: "{type}/{id}"\n  state_branch: changeledger/state\n  state_baseline: ${initialized.head}\ntypes:\n  feature:\n    stages: [request]\n`,
  );

  const loaded = loadRepo(root);
  assert.equal(loaded.changes.length, 1);
  assert.equal(loaded.changes[0].frontmatter.title, 'Global');
  assert.equal(loaded.state.head, initialized.head);
});

test('124231 CR16: a stale legacy checkout detects activated remote authority and fails closed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-remote-authority-'));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Repo Test',
    GIT_AUTHOR_EMAIL: 'repo@example.com',
    GIT_COMMITTER_NAME: 'Repo Test',
    GIT_COMMITTER_EMAIL: 'repo@example.com',
  };
  const git = (args) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8' }).trim();
  git(['init', '-q', '-b', 'dev']);
  fs.mkdirSync(path.join(root, '.changeledger', 'changes'), { recursive: true });
  const text =
    '---\nid: "20260720-120000"\ntitle: Global\ntype: feature\nstatus: draft\ncreated: 2026-07-20T12:00:00Z\ndepends_on: []\n---\n\n## Request\n';
  fs.writeFileSync(path.join(root, '.changeledger', 'changes', '20260720-120000-global.md'), text);
  const configFile = path.join(root, '.changeledger', 'config.yml');
  const baseConfig = `schema_version: 4
language: en
changes_dir: .changeledger/changes
specs_dir: .changeledger/specs
git:
  integration_branch: dev
  change_branch_format: "{type}/{id}"
types:
  feature:
    stages: [request]
project_id: project-1
`;
  fs.writeFileSync(configFile, baseConfig);
  git(['add', '.changeledger']);
  git(['commit', '-qm', 'legacy']);
  const legacy = git(['rev-parse', 'HEAD']);
  const initialized = initializeStateStore({
    repoRoot: root,
    branch: 'changeledger/state',
    projectId: 'project-1',
    integrationBranch: 'dev',
    changes: [{ name: '20260720-120000-global.md', text }],
    gitEnv: env,
  });
  fs.writeFileSync(
    configFile,
    baseConfig.replace(
      '  change_branch_format: "{type}/{id}"\n',
      `  change_branch_format: "{type}/{id}"\n  state_branch: changeledger/state\n  state_baseline: ${initialized.head}\n`,
    ),
  );
  git(['add', configFile]);
  git(['commit', '-qm', 'activate']);
  const activated = git(['rev-parse', 'HEAD']);
  git(['update-ref', 'refs/remotes/origin/dev', activated]);
  git(['update-ref', 'refs/remotes/origin/changeledger/state', initialized.head]);
  git(['update-ref', '-d', 'refs/heads/changeledger/state']);
  git(['reset', '--hard', '-q', legacy]);

  const loaded = loadRepo(root);
  assert.equal(loaded.state.remoteOnly, true);
  assert.equal(loaded.changes[0].frontmatter.title, 'Global');
  assert.throws(
    () => resolveChange(root, '20260720-120000').state.assertWritable(),
    /update integration branch and fetch state branch/,
  );
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
