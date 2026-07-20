import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { status } from '../src/commands/agent.mjs';
import { init } from '../src/commands/init.mjs';
import { newChange } from '../src/commands/new.mjs';
import { initReleaseHistory } from '../src/commands/release.mjs';
import { syncState } from '../src/commands/state.mjs';
import { loadRepo } from '../src/repo.mjs';
import { initializeStateStore, publishStateStore } from '../src/state-store.mjs';
import { serialize } from '../src/viewer/domain.mjs';

process.env.CHANGELEDGER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-future-home-'));

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-future-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  init(root);
  const change = newChange(
    { type: 'feature', slug: 'future', title: 'Future', now: '2026-07-20T12:00:00Z' },
    root,
  );
  const configFile = path.join(root, '.changeledger', 'config.yml');
  fs.writeFileSync(
    configFile,
    fs.readFileSync(configFile, 'utf8').replace('schema_version: 4', 'schema_version: 5'),
  );
  return { root, change, configFile };
}

test('124231 CR17: future config blocks change, lifecycle and release writes', () => {
  const { root, change, configFile } = repo();
  const changeBefore = fs.readFileSync(change, 'utf8');
  const configBefore = fs.readFileSync(configFile, 'utf8');
  const expected = /schema 5 is newer than supported schema 4.*update ChangeLedger/;

  assert.throws(
    () =>
      newChange(
        { type: 'feature', slug: 'second', title: 'Second', now: '2026-07-20T12:00:01Z' },
        root,
      ),
    expected,
  );
  assert.throws(() => status('20260720-120000', 'approved', root), expected);
  assert.throws(() => initReleaseHistory('1.0.0', root), expected);

  assert.equal(fs.readFileSync(change, 'utf8'), changeBefore);
  assert.equal(fs.readFileSync(configFile, 'utf8'), configBefore);
  assert.equal(fs.existsSync(path.join(root, '.changeledger', 'releases')), false);
});

test('124231 CR17: future state manifest permits queries and blocks mutation families', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-future-state-'));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Future Test',
    GIT_AUTHOR_EMAIL: 'future@example.com',
    GIT_COMMITTER_NAME: 'Future Test',
    GIT_COMMITTER_EMAIL: 'future@example.com',
  };
  const git = (args) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8' }).trim();
  git(['init', '-q', '-b', 'dev']);
  fs.mkdirSync(path.join(root, '.changeledger', 'changes'), { recursive: true });
  const changeText = `---
id: "20260720-120000"
title: Future state
type: feature
status: draft
created: 2026-07-20T12:00:00Z
depends_on: []
---

## Request
`;
  const configFile = path.join(root, '.changeledger', 'config.yml');
  const baseConfig = `schema_version: 4
language: en
changes_dir: .changeledger/changes
specs_dir: .changeledger/specs
git:
  integration_branch: dev
  change_branch_format: "{type}/{id}"
statuses: [draft, approved, in-progress, in-review, in-validation, blocked, done, discarded]
stages: [request]
types:
  feature:
    stages: [request]
project_id: project-1
project_name: future
`;
  fs.writeFileSync(configFile, baseConfig);
  fs.writeFileSync(
    path.join(root, '.changeledger', 'changes', '20260720-120000-future.md'),
    changeText,
  );
  git(['add', '.changeledger']);
  git(['commit', '-qm', 'legacy']);
  const initialized = initializeStateStore({
    repoRoot: root,
    branch: 'changeledger/state',
    projectId: 'project-1',
    integrationBranch: 'dev',
    changes: [{ name: '20260720-120000-future.md', text: changeText }],
    gitEnv: env,
  });
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-future-state-origin-'));
  git(['init', '--bare', '-q', bare]);
  git(['remote', 'add', 'origin', bare]);
  publishStateStore(root, 'changeledger/state', { gitEnv: env });
  fs.writeFileSync(
    configFile,
    baseConfig.replace(
      '  change_branch_format: "{type}/{id}"\n',
      `  change_branch_format: "{type}/{id}"\n  state_branch: changeledger/state\n  state_baseline: ${initialized.head}\n`,
    ),
  );
  git(['add', configFile]);
  git(['commit', '-qm', 'activate']);
  git(['switch', '-q', 'changeledger/state']);
  const manifest = path.join(root, '.changeledger-state', 'manifest.yml');
  fs.writeFileSync(
    manifest,
    fs.readFileSync(manifest, 'utf8').replace('schema_version: 1', 'schema_version: 2'),
  );
  git(['add', manifest]);
  git(['commit', '-qm', 'future manifest']);
  git(['switch', '-q', 'dev']);

  const loaded = loadRepo(root);
  assert.equal(loaded.changes.length, 1);
  assert.deepEqual(serialize(loaded).state_store, {
    active: true,
    branch: 'changeledger/state',
    baseline: initialized.head,
    head: git(['rev-parse', 'refs/heads/changeledger/state']),
    freshness: 'read-only',
    pending: false,
    pending_changes: [],
    read_only: true,
    minimum_version: 2,
  });
  const expected = /state manifest schema 2.*update ChangeLedger/;
  assert.throws(() => status('20260720-120000', 'approved', root), expected);
  assert.throws(
    () =>
      newChange(
        { type: 'feature', slug: 'second', title: 'Second', now: '2026-07-20T12:00:01Z' },
        root,
      ),
    expected,
  );
  assert.throws(() => initReleaseHistory('1.0.0', root), expected);
  assert.throws(() => syncState(root, { gitEnv: env }), expected);
  assert.equal(git(['rev-parse', 'refs/remotes/origin/changeledger/state']), initialized.head);
});
