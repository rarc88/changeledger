import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { owner, status, task } from '../src/commands/agent.mjs';
import { newChange } from '../src/commands/new.mjs';
import { initializeStateStore, publishStateStore, readStateStore } from '../src/state-store.mjs';

const BIN = fileURLToPath(new URL('../bin/changeledger.mjs', import.meta.url));

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'State Agent',
  GIT_AUTHOR_EMAIL: 'agent@example.com',
  GIT_COMMITTER_NAME: 'State Agent',
  GIT_COMMITTER_EMAIL: 'agent@example.com',
};
// A parent process (e.g. a git hook) may export these; inheriting them here
// would redirect this test's git init at a fresh tmpdir onto the real repo.
for (const key of [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CEILING_DIRECTORIES',
]) {
  delete ENV[key];
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, env: ENV, encoding: 'utf8' }).trim();
}

function setup({ legacyBranches = {}, withRemote = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-state-agent-'));
  git(root, ['init', '-q', '-b', 'dev']);
  fs.mkdirSync(path.join(root, '.changeledger', 'changes'), { recursive: true });
  const text = `---
id: "20260720-120000"
title: State
type: feature
status: draft
created: 2026-07-20T12:00:00Z
depends_on: []
---

## Request

## Investigation

## Proposal

## Specification

## Plan

- [ ] Implement state (CR1)

## Log
`;
  fs.writeFileSync(path.join(root, 'README.md'), '# repo\n');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '-qm', 'initial']);
  const initialized = initializeStateStore({
    repoRoot: root,
    branch: 'changeledger/state',
    projectId: 'project-1',
    integrationBranch: 'dev',
    changes: [{ name: '20260720-120000-state.md', text }],
    legacyBranches,
    gitEnv: ENV,
  });
  fs.writeFileSync(
    path.join(root, '.changeledger', 'config.yml'),
    `schema_version: 4
language: en
changes_dir: .changeledger/changes
specs_dir: .changeledger/specs
git:
  integration_branch: dev
  change_branch_format: "{type}/{id}"
  state_branch: changeledger/state
  state_baseline: ${initialized.head}
statuses: [draft, approved, in-progress, in-review, in-validation, blocked, done, discarded]
stages: [request, investigation, proposal, specification, plan, log]
types:
  feature:
    stages: [request, investigation, proposal, specification, plan, log]
    review_required: true
project_id: project-1
project_name: agent
`,
  );
  git(root, ['add', '.changeledger/config.yml']);
  git(root, ['commit', '-qm', 'activate']);
  if (withRemote) {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-state-agent-origin-'));
    git(bare, ['init', '--bare', '-q']);
    git(root, ['remote', 'add', 'origin', bare]);
    publishStateStore(root, 'changeledger/state', { gitEnv: ENV });
  }
  return root;
}

function stored(root) {
  return readStateStore(root, 'changeledger/state').changes[0];
}

test('124231 CR12: global approval requires and atomically records an explicit owner', () => {
  const root = setup();
  const before = readStateStore(root, 'changeledger/state').head;
  assert.throws(
    () => status('20260720-120000', 'approved', root, { actor: 'human' }),
    /draft → approved requires an owner/,
  );
  assert.equal(readStateStore(root, 'changeledger/state').head, before);

  status('20260720-120000', 'approved', root, { actor: 'human', owner: 'ana' });
  assert.equal(stored(root).frontmatter.status, 'approved');
  assert.equal(stored(root).frontmatter.owner, 'ana');
});

test('124231 CR13/CR14: only owner starts on the configured implementation branch', () => {
  const root = setup();
  status('20260720-120000', 'approved', root, { actor: 'human', owner: 'ana' });
  git(root, ['switch', '-qc', 'feature/20260720-120000']);
  assert.throws(
    () => status('20260720-120000', 'in-progress', root, { ownerHandle: () => 'luis' }),
    /owned by "ana"/,
  );
  status('20260720-120000', 'in-progress', root, { ownerHandle: () => 'ana' });
  assert.equal(stored(root).frontmatter.status, 'in-progress');
  const trace = git(root, ['show', '-s', '--format=%B', 'refs/heads/changeledger/state']);
  assert.match(trace, /^Change-Operation: status:in-progress$/m);
  assert.match(trace, new RegExp(`^Code-Revision: ${git(root, ['rev-parse', 'HEAD'])}$`, 'm'));
  assert.match(trace, /^Code-Branch: feature\/20260720-120000$/m);
  assert.throws(
    () => task('20260720-120000', 'done', 1, undefined, root, { actorHandle: () => 'luis' }),
    /owned by "ana"/,
  );
});

test('124231 CR14: an imported in-progress change keeps its registered legacy branch', () => {
  const root = setup({
    legacyBranches: { '20260720-120000': 'legacy/custom-work' },
  });
  status('20260720-120000', 'approved', root, { actor: 'human', owner: 'ana' });
  git(root, ['switch', '-qc', 'legacy/custom-work']);
  assert.doesNotThrow(() =>
    status('20260720-120000', 'in-progress', root, { ownerHandle: () => 'ana' }),
  );
});

test('124231 CR13: transfer requires current owner or explicit human override', () => {
  const root = setup();
  status('20260720-120000', 'approved', root, { actor: 'human', owner: 'ana' });
  assert.throws(
    () => owner('20260720-120000', 'luis', root, { actorHandle: () => 'luis' }),
    /owned by "ana"/,
  );
  owner('20260720-120000', 'luis', root, { actorHandle: () => 'ana' });
  assert.equal(stored(root).frontmatter.owner, 'luis');
});

test('124231 CR13: an active global change cannot clear its owner', () => {
  const root = setup();
  status('20260720-120000', 'approved', root, { actor: 'human', owner: 'ana' });

  assert.throws(
    () => owner('20260720-120000', '-', root, { actorHandle: () => 'ana' }),
    /cannot clear the owner.*approved/,
  );
  assert.equal(stored(root).frontmatter.owner, 'ana');
});

test('124231 CR2/CR9: new writes only to the active global store', () => {
  const root = setup();
  const file = newChange(
    {
      type: 'feature',
      slug: 'shared-state',
      title: 'Shared state',
      now: '2026-07-20T12:00:01Z',
    },
    root,
  );

  assert.equal(path.basename(file), '20260720-120001-shared-state.md');
  assert.equal(fs.existsSync(file), false);
  assert.equal(
    readStateStore(root, 'changeledger/state').changes.some(
      (change) => change.frontmatter.id === '20260720-120001',
    ),
    true,
  );
});

test('124231 CR6: CLI reports a locally saved mutation whose push was rejected', () => {
  const root = setup({ withRemote: false });
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-state-agent-remote-'));
  git(bare, ['init', '--bare', '-q']);
  git(root, ['remote', 'add', 'origin', bare]);
  assert.equal(publishStateStore(root, 'changeledger/state', { gitEnv: ENV }).confirmed, true);
  const hook = path.join(bare, 'hooks', 'pre-receive');
  fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n');
  fs.chmodSync(hook, 0o755);

  const result = spawnSync(
    process.execPath,
    [BIN, 'approve', '20260720-120000', '--owner', 'ana'],
    { cwd: root, env: ENV, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /approved/);
  assert.match(result.stderr, /Pending:/);
  assert.match(result.stderr, /state sync/);

  const blocked = spawnSync(
    process.execPath,
    [BIN, 'owner', '20260720-120000', 'luis', '--human'],
    { cwd: root, env: ENV, encoding: 'utf8' },
  );
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /pending unpublished state/);
});

test('124231 CR3/CR6: no remote leaves state pending and blocks another human decision', () => {
  const root = setup({ withRemote: false });
  status('20260720-120000', 'approved', root, { actor: 'human', owner: 'ana' });
  const pending = readStateStore(root, 'changeledger/state').pending;
  assert.equal(pending.pending, true);
  assert.deepEqual(pending.ids, ['20260720-120000']);
  assert.throws(
    () => owner('20260720-120000', 'luis', root, { actor: 'human' }),
    /pending unpublished state/,
  );
});
