import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  addStateChange,
  initializeStateStore,
  mutateStateChange,
  publishStateStore,
  readStateStore,
  StateConflictError,
  syncStateStore,
  validateStateRange,
} from '../src/state-store.mjs';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'State Test',
  GIT_AUTHOR_EMAIL: 'state@example.com',
  GIT_COMMITTER_NAME: 'State Test',
  GIT_COMMITTER_EMAIL: 'state@example.com',
};

function git(root, args) {
  return execFileSync('git', args, { cwd: root, env: GIT_ENV, encoding: 'utf8' }).trim();
}

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-state-store-'));
  git(root, ['init', '-q', '-b', 'dev']);
  fs.writeFileSync(path.join(root, 'README.md'), '# repo\n');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '-qm', 'initial']);
  return root;
}

const change = (id, title = 'State') => `---
id: "${id}"
title: ${title}
type: feature
status: draft
created: 2026-07-20T12:00:00Z
depends_on: []
---

## Request
`;

test('124231 CR1/CR2: initialization creates an independent readable state ref', () => {
  const root = repo();
  const worktreeBefore = git(root, ['status', '--porcelain=v1']);
  const currentBefore = git(root, ['branch', '--show-current']);

  const created = initializeStateStore({
    repoRoot: root,
    branch: 'changeledger/state',
    projectId: 'project-1',
    integrationBranch: 'dev',
    changes: [{ name: '20260720-120000-state.md', text: change('20260720-120000') }],
    gitEnv: GIT_ENV,
  });

  assert.match(created.head, /^[0-9a-f]{40}$/);
  assert.equal(git(root, ['branch', '--show-current']), currentBefore);
  assert.equal(git(root, ['status', '--porcelain=v1']), worktreeBefore);
  const loaded = readStateStore(root, 'changeledger/state');
  assert.equal(loaded.head, created.head);
  assert.deepEqual(loaded.manifest, {
    schema_version: 1,
    project_id: 'project-1',
    integration_branch: 'dev',
  });
  assert.equal(loaded.changes.length, 1);
  assert.equal(loaded.changes[0].frontmatter.id, '20260720-120000');
  assert.throws(
    () =>
      initializeStateStore({
        repoRoot: root,
        branch: 'changeledger/state',
        projectId: 'project-1',
        integrationBranch: 'dev',
        changes: [],
        gitEnv: GIT_ENV,
      }),
    /already exists/,
  );
});

test('124231 CR4: a stale mutation retries when its target change is untouched', () => {
  const root = repo();
  const first = initializeStateStore({
    repoRoot: root,
    branch: 'changeledger/state',
    projectId: 'project-1',
    integrationBranch: 'dev',
    changes: [
      { name: '20260720-120000-a.md', text: change('20260720-120000', 'A') },
      { name: '20260720-120001-b.md', text: change('20260720-120001', 'B') },
    ],
    gitEnv: GIT_ENV,
  });

  mutateStateChange({
    repoRoot: root,
    branch: 'changeledger/state',
    id: '20260720-120000',
    expectedHead: first.head,
    operation: 'note-a',
    actor: 'ana',
    mutate: (text) => `${text}\nA changed\n`,
    gitEnv: GIT_ENV,
  });
  const second = mutateStateChange({
    repoRoot: root,
    branch: 'changeledger/state',
    id: '20260720-120001',
    expectedHead: first.head,
    operation: 'note-b',
    actor: 'luis',
    mutate: (text) => `${text}\nB changed\n`,
    gitEnv: GIT_ENV,
  });

  assert.equal(second.retried, true);
  const loaded = readStateStore(root, 'changeledger/state');
  assert.match(
    loaded.changes.find((item) => item.frontmatter.id === '20260720-120000').text,
    /A changed/,
  );
  assert.match(
    loaded.changes.find((item) => item.frontmatter.id === '20260720-120001').text,
    /B changed/,
  );
});

test('124231 CR5: a stale mutation of the same change reports exact revisions', () => {
  const root = repo();
  const first = initializeStateStore({
    repoRoot: root,
    branch: 'changeledger/state',
    projectId: 'project-1',
    integrationBranch: 'dev',
    changes: [{ name: '20260720-120000-a.md', text: change('20260720-120000', 'A') }],
    gitEnv: GIT_ENV,
  });
  const advanced = mutateStateChange({
    repoRoot: root,
    branch: 'changeledger/state',
    id: '20260720-120000',
    expectedHead: first.head,
    operation: 'first',
    actor: 'ana',
    mutate: (text) => `${text}\nfirst\n`,
    gitEnv: GIT_ENV,
  });

  assert.throws(
    () =>
      mutateStateChange({
        repoRoot: root,
        branch: 'changeledger/state',
        id: '20260720-120000',
        expectedHead: first.head,
        operation: 'second',
        actor: 'luis',
        mutate: (text) => `${text}\nsecond\n`,
        gitEnv: GIT_ENV,
      }),
    (error) => {
      assert.ok(error instanceof StateConflictError);
      assert.equal(error.id, '20260720-120000');
      assert.equal(error.expectedHead, first.head);
      assert.equal(error.currentHead, advanced.head);
      return true;
    },
  );
});

test('124231 CR3/CR9: a new document is added through the state ref only', () => {
  const root = repo();
  const first = initializeStateStore({
    repoRoot: root,
    branch: 'changeledger/state',
    projectId: 'project-1',
    integrationBranch: 'dev',
    changes: [],
    gitEnv: GIT_ENV,
  });
  const text = change('20260720-120002', 'New global change');

  const created = addStateChange({
    repoRoot: root,
    branch: 'changeledger/state',
    expectedHead: first.head,
    name: '20260720-120002-new-global-change.md',
    text,
    actor: 'ana',
    gitEnv: GIT_ENV,
  });

  const loaded = readStateStore(root, 'changeledger/state', { gitEnv: GIT_ENV });
  assert.equal(loaded.head, created.head);
  assert.equal(loaded.changes[0].frontmatter.id, '20260720-120002');
  assert.equal(
    fs.existsSync(path.join(root, '.changeledger/changes/20260720-120002-new-global-change.md')),
    false,
  );
});

test('124231 CR3/CR4/CR6: rejected push stays pending and sync replays disjoint changes', () => {
  const root = repo();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-state-remote-'));
  git(bare, ['init', '--bare', '-q']);
  git(root, ['remote', 'add', 'origin', bare]);
  git(root, ['push', '-q', '-u', 'origin', 'dev']);
  const first = initializeStateStore({
    repoRoot: root,
    branch: 'changeledger/state',
    projectId: 'project-1',
    integrationBranch: 'dev',
    changes: [
      { name: '20260720-120000-a.md', text: change('20260720-120000', 'A') },
      { name: '20260720-120001-b.md', text: change('20260720-120001', 'B') },
    ],
    gitEnv: GIT_ENV,
  });
  assert.equal(publishStateStore(root, 'changeledger/state', { gitEnv: GIT_ENV }).confirmed, true);

  const second = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-state-clone-'));
  git(second, ['clone', '-q', bare, '.']);
  git(second, [
    'update-ref',
    'refs/heads/changeledger/state',
    'refs/remotes/origin/changeledger/state',
  ]);

  const published = mutateStateChange({
    repoRoot: root,
    branch: 'changeledger/state',
    id: '20260720-120000',
    expectedHead: first.head,
    operation: 'first',
    actor: 'ana',
    mutate: (text) => `${text}\nA remote\n`,
    gitEnv: GIT_ENV,
  });
  assert.equal(published.confirmed, true);
  const pending = mutateStateChange({
    repoRoot: second,
    branch: 'changeledger/state',
    id: '20260720-120001',
    expectedHead: first.head,
    operation: 'second',
    actor: 'luis',
    mutate: (text) => `${text}\nB pending\n`,
    gitEnv: GIT_ENV,
  });
  assert.equal(pending.pending, true);

  const synced = syncStateStore(second, 'changeledger/state', { gitEnv: GIT_ENV });
  assert.equal(synced.confirmed, true);
  assert.equal(synced.replayed, 1);
  const loaded = readStateStore(second, 'changeledger/state', { gitEnv: GIT_ENV });
  assert.match(
    loaded.changes.find((item) => item.frontmatter.id === '20260720-120000').text,
    /A remote/,
  );
  assert.match(
    loaded.changes.find((item) => item.frontmatter.id === '20260720-120001').text,
    /B pending/,
  );
});

test('124231 CR7/CR11: receive validation rejects non append-only or extra-layout trees', () => {
  const root = repo();
  const first = initializeStateStore({
    repoRoot: root,
    branch: 'changeledger/state',
    projectId: 'project-1',
    integrationBranch: 'dev',
    changes: [{ name: '20260720-120000-a.md', text: change('20260720-120000', 'A') }],
    gitEnv: GIT_ENV,
  });
  const next = mutateStateChange({
    repoRoot: root,
    branch: 'changeledger/state',
    id: '20260720-120000',
    expectedHead: first.head,
    operation: 'note',
    actor: 'ana',
    mutate: (text) => `${text}\nnote\n`,
    gitEnv: GIT_ENV,
  });
  assert.equal(
    validateStateRange(root, { oldHead: first.head, newHead: next.head, gitEnv: GIT_ENV }).ok,
    true,
  );
  assert.throws(
    () => validateStateRange(root, { oldHead: next.head, newHead: first.head, gitEnv: GIT_ENV }),
    /not a fast-forward/,
  );

  git(root, ['switch', '-q', 'changeledger/state']);
  fs.writeFileSync(path.join(root, 'unexpected.txt'), 'no\n');
  git(root, ['add', 'unexpected.txt']);
  git(root, ['commit', '-qm', 'invalid layout']);
  const invalid = git(root, ['rev-parse', 'HEAD']);
  assert.throws(
    () => validateStateRange(root, { oldHead: next.head, newHead: invalid, gitEnv: GIT_ENV }),
    /outside the state layout/,
  );
});
