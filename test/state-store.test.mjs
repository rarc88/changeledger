import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateReceive } from '../src/commands/state.mjs';
import {
  addStateChange,
  initializeStateStore,
  mutateStateChange,
  publishStateStore,
  readStateStore,
  StateConflictError,
  stateTraceabilityErrors,
  syncStateStore,
  validateStateRange,
} from '../src/state-store.mjs';

const BIN = fileURLToPath(new URL('../bin/changeledger.mjs', import.meta.url));

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
  fs.mkdirSync(path.join(root, '.changeledger'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.changeledger', 'config.yml'),
    `schema_version: 4
language: en
changes_dir: .changeledger/changes
specs_dir: .changeledger/specs
git:
  integration_branch: dev
  change_branch_format: "{type}/{id}"
statuses: [draft, approved, in-progress, in-review, in-validation, blocked, done, discarded]
stages: [request, log]
types:
  feature:
    stages: [request, log]
project_id: project-1
project_name: state
`,
  );
  fs.writeFileSync(path.join(root, 'README.md'), '# repo\n');
  git(root, ['add', 'README.md', '.changeledger/config.yml']);
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

## Log
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

test('124231 CR4/CR5: sync conflicts on the same id under different filenames', () => {
  const root = repo();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-state-id-conflict-'));
  git(bare, ['init', '--bare', '-q']);
  git(root, ['remote', 'add', 'origin', bare]);
  git(root, ['push', '-q', '-u', 'origin', 'dev']);
  const baseline = initializeStateStore({
    repoRoot: root,
    branch: 'changeledger/state',
    projectId: 'project-1',
    integrationBranch: 'dev',
    changes: [],
    gitEnv: GIT_ENV,
  });
  assert.equal(publishStateStore(root, 'changeledger/state', { gitEnv: GIT_ENV }).confirmed, true);

  const second = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-state-id-conflict-clone-'));
  git(second, ['clone', '-q', bare, '.']);
  git(second, [
    'update-ref',
    'refs/heads/changeledger/state',
    'refs/remotes/origin/changeledger/state',
  ]);

  const published = addStateChange({
    repoRoot: root,
    branch: 'changeledger/state',
    expectedHead: baseline.head,
    name: '20260720-120000-alpha.md',
    text: change('20260720-120000', 'Alpha'),
    actor: 'ana',
    gitEnv: GIT_ENV,
  });
  assert.equal(published.confirmed, true);
  const pending = addStateChange({
    repoRoot: second,
    branch: 'changeledger/state',
    expectedHead: baseline.head,
    name: '20260720-120000-beta.md',
    text: change('20260720-120000', 'Beta'),
    actor: 'luis',
    gitEnv: GIT_ENV,
  });
  assert.equal(pending.pending, true);

  assert.throws(
    () => syncStateStore(second, 'changeledger/state', { gitEnv: GIT_ENV }),
    (error) => {
      assert.ok(error instanceof StateConflictError);
      assert.equal(error.id, '20260720-120000');
      assert.equal(error.expectedHead, baseline.head);
      assert.equal(error.currentHead, published.head);
      return true;
    },
  );
  assert.equal(git(bare, ['rev-parse', 'refs/heads/changeledger/state']), published.head);
  const remote = readStateStore(root, 'changeledger/state', { gitEnv: GIT_ENV });
  assert.deepEqual(
    remote.changes.map((item) => item.name),
    ['20260720-120000-alpha.md'],
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

  git(root, ['rm', '-q', 'unexpected.txt']);
  fs.mkdirSync(path.join(root, 'xchangeledger-state', 'changes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'xchangeledger-state', 'changes', 'evil.md'), 'no\n');
  git(root, ['add', 'xchangeledger-state']);
  git(root, ['commit', '-qm', 'invalid dotted layout']);
  const dotted = git(root, ['rev-parse', 'HEAD']);
  assert.throws(
    () => validateStateRange(root, { oldHead: invalid, newHead: dotted, gitEnv: GIT_ENV }),
    /outside the state layout/,
  );
});

test('124231 CR3/CR8/CR11: receive validation requires state mutation trailers', () => {
  const root = repo();
  const baseline = initializeStateStore({
    repoRoot: root,
    branch: 'changeledger/state',
    projectId: 'project-1',
    integrationBranch: 'dev',
    changes: [{ name: '20260720-120000-a.md', text: change('20260720-120000', 'A') }],
    gitEnv: GIT_ENV,
  });
  git(root, ['switch', '-q', 'changeledger/state']);
  const file = path.join(root, '.changeledger-state', 'changes', '20260720-120000-a.md');
  fs.appendFileSync(file, '\nmissing trace\n');
  git(root, ['add', file]);
  git(root, ['commit', '-qm', 'state mutation without trailers']);
  const untraced = git(root, ['rev-parse', 'HEAD']);

  assert.throws(
    () =>
      validateStateRange(root, {
        oldHead: baseline.head,
        newHead: untraced,
        gitEnv: GIT_ENV,
      }),
    /exactly one non-empty Change-Id/,
  );
});

test('124231 CR7: reads reject a local rewind behind the last confirmed global head', () => {
  const root = repo();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-state-confirmed-'));
  git(bare, ['init', '--bare', '-q']);
  git(root, ['remote', 'add', 'origin', bare]);
  const baseline = initializeStateStore({
    repoRoot: root,
    branch: 'changeledger/state',
    projectId: 'project-1',
    integrationBranch: 'dev',
    changes: [{ name: '20260720-120000-a.md', text: change('20260720-120000', 'A') }],
    gitEnv: GIT_ENV,
  });
  publishStateStore(root, 'changeledger/state', { gitEnv: GIT_ENV });
  const advanced = mutateStateChange({
    repoRoot: root,
    branch: 'changeledger/state',
    id: '20260720-120000',
    expectedHead: baseline.head,
    operation: 'advance',
    actor: 'ana',
    mutate: (text) => `${text}\nadvanced\n`,
    gitEnv: GIT_ENV,
  });

  git(root, ['update-ref', 'refs/changeledger/pending/changeledger/state', advanced.head]);
  git(root, ['update-ref', 'refs/heads/changeledger/state', baseline.head]);
  assert.throws(
    () => readStateStore(root, 'changeledger/state', { gitEnv: GIT_ENV }),
    /last confirmed global head/,
  );
});

test('124231 CR7/CR16: a known remote rewind is rejected instead of republished', () => {
  const root = repo();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-state-remote-rewind-'));
  git(bare, ['init', '--bare', '-q']);
  git(root, ['remote', 'add', 'origin', bare]);
  const baseline = initializeStateStore({
    repoRoot: root,
    branch: 'changeledger/state',
    projectId: 'project-1',
    integrationBranch: 'dev',
    changes: [{ name: '20260720-120000-a.md', text: change('20260720-120000', 'A') }],
    gitEnv: GIT_ENV,
  });
  publishStateStore(root, 'changeledger/state', { gitEnv: GIT_ENV });
  const advanced = mutateStateChange({
    repoRoot: root,
    branch: 'changeledger/state',
    id: '20260720-120000',
    expectedHead: baseline.head,
    operation: 'note',
    actor: 'ana',
    mutate: (text) => `${text}\nadvanced\n`,
    gitEnv: GIT_ENV,
  });
  assert.equal(advanced.confirmed, true);

  git(bare, ['update-ref', 'refs/heads/changeledger/state', baseline.head, advanced.head]);
  git(root, [
    'fetch',
    '-q',
    'origin',
    '+refs/heads/changeledger/state:refs/remotes/origin/changeledger/state',
  ]);
  assert.throws(
    () => readStateStore(root, 'changeledger/state', { gitEnv: GIT_ENV }),
    /remote state head.*does not descend from last confirmed global head/,
  );
  assert.throws(
    () => syncStateStore(root, 'changeledger/state', { gitEnv: GIT_ENV }),
    /remote state head.*does not descend from last confirmed global head/,
  );
  assert.equal(git(bare, ['rev-parse', 'refs/heads/changeledger/state']), baseline.head);
});

test('124231 CR7: pending state with a known remote requires an explicit confirmed base', () => {
  const root = repo();
  const baseline = initializeStateStore({
    repoRoot: root,
    branch: 'changeledger/state',
    projectId: 'project-1',
    integrationBranch: 'dev',
    changes: [{ name: '20260720-120000-a.md', text: change('20260720-120000', 'A') }],
    gitEnv: GIT_ENV,
  });
  const pending = mutateStateChange({
    repoRoot: root,
    branch: 'changeledger/state',
    id: '20260720-120000',
    expectedHead: baseline.head,
    operation: 'pending',
    actor: 'ana',
    mutate: (text) => `${text}\npending\n`,
    gitEnv: GIT_ENV,
  });
  const tree = git(root, ['rev-parse', `${pending.head}^{tree}`]);
  const remoteHead = git(root, ['commit-tree', tree, '-p', pending.head, '-m', 'remote advance']);
  git(root, ['update-ref', 'refs/remotes/origin/changeledger/state', remoteHead]);

  assert.throws(
    () => readStateStore(root, 'changeledger/state', { gitEnv: GIT_ENV }),
    /pending state has no confirmed global base/,
  );
});

test('124231 CR11/CR13: receive validation enforces config and owner commit by commit', () => {
  const root = repo();
  const owned = change('20260720-120000', 'A').replace(
    'status: draft',
    'status: approved\nowner: ana',
  );
  const baseline = initializeStateStore({
    repoRoot: root,
    branch: 'changeledger/state',
    projectId: 'project-1',
    integrationBranch: 'dev',
    changes: [{ name: '20260720-120000-a.md', text: owned }],
    gitEnv: GIT_ENV,
  });
  const transfer = mutateStateChange({
    repoRoot: root,
    branch: 'changeledger/state',
    id: '20260720-120000',
    expectedHead: baseline.head,
    operation: 'owner',
    actor: 'ana',
    mutate: (text) =>
      `${text.replace('owner: ana', 'owner: luis')}- **2026-07-20T12:10:00Z** \`[owner]\` set: luis\n- **2026-07-20T12:10:00Z** \`[note]\` ownership transferred: ana → luis by ana via cli\n`,
    gitEnv: GIT_ENV,
  });
  const illegal = mutateStateChange({
    repoRoot: root,
    branch: 'changeledger/state',
    id: '20260720-120000',
    expectedHead: transfer.head,
    operation: 'task',
    actor: 'ana',
    mutate: (text) => `${text}\ncontinued by ana\n`,
    gitEnv: GIT_ENV,
  });
  assert.throws(
    () =>
      validateStateRange(root, {
        oldHead: baseline.head,
        newHead: illegal.head,
        actor: 'ana',
        gitEnv: GIT_ENV,
      }),
    /current owner is "luis"/,
  );

  const missingConfig = initializeStateStore({
    repoRoot: root,
    branch: 'changeledger/invalid-config',
    projectId: 'project-1',
    integrationBranch: 'missing',
    changes: [{ name: '20260720-120001-b.md', text: change('20260720-120001', 'B') }],
    gitEnv: GIT_ENV,
  });
  assert.throws(
    () =>
      validateStateRange(root, {
        oldHead: '0'.repeat(40),
        newHead: missingConfig.head,
        gitEnv: GIT_ENV,
      }),
    /canonical integration config/,
  );
});

test('124231 CR11/CR13: receive validation preserves active owner and transfer audit', () => {
  const root = repo();
  const owned = change('20260720-120000', 'A').replace(
    'status: draft',
    'status: approved\nowner: ana',
  );
  const baseline = initializeStateStore({
    repoRoot: root,
    branch: 'changeledger/state',
    projectId: 'project-1',
    integrationBranch: 'dev',
    changes: [{ name: '20260720-120000-a.md', text: owned }],
    gitEnv: GIT_ENV,
  });
  const cleared = mutateStateChange({
    repoRoot: root,
    branch: 'changeledger/state',
    id: '20260720-120000',
    expectedHead: baseline.head,
    operation: 'owner',
    actor: 'ana',
    mutate: (text) => text.replace('\nowner: ana', ''),
    gitEnv: GIT_ENV,
  });
  assert.throws(
    () =>
      validateStateRange(root, {
        oldHead: baseline.head,
        newHead: cleared.head,
        actor: 'ana',
        gitEnv: GIT_ENV,
      }),
    /active change #20260720-120000 requires an owner/,
  );

  git(root, ['update-ref', 'refs/heads/changeledger/state', baseline.head]);
  const unaudited = mutateStateChange({
    repoRoot: root,
    branch: 'changeledger/state',
    id: '20260720-120000',
    expectedHead: baseline.head,
    operation: 'owner',
    actor: 'ana',
    mutate: (text) => text.replace('owner: ana', 'owner: luis'),
    gitEnv: GIT_ENV,
  });
  assert.throws(
    () =>
      validateStateRange(root, {
        oldHead: baseline.head,
        newHead: unaudited.head,
        actor: 'ana',
        gitEnv: GIT_ENV,
      }),
    /ownership transfer.*missing its audited Log event/,
  );
});

test('124231 CR11/CR12/CR13: receive validation parses complete new Log evidence', () => {
  const root = repo();
  const baseline = initializeStateStore({
    repoRoot: root,
    branch: 'changeledger/state',
    projectId: 'project-1',
    integrationBranch: 'dev',
    changes: [{ name: '20260720-120000-a.md', text: change('20260720-120000', 'A') }],
    gitEnv: GIT_ENV,
  });
  const incompleteApproval = mutateStateChange({
    repoRoot: root,
    branch: 'changeledger/state',
    id: '20260720-120000',
    expectedHead: baseline.head,
    operation: 'status:approved',
    actor: 'human',
    mutate: (text) =>
      `${text.replace('status: draft', 'status: approved\nowner: ana')}- **2026-07-20T12:10:00Z** \`[owner]\` set: ana\n`,
    gitEnv: GIT_ENV,
  });
  assert.throws(
    () =>
      validateStateRange(root, {
        oldHead: baseline.head,
        newHead: incompleteApproval.head,
        humanOverride: true,
        gitEnv: GIT_ENV,
      }),
    /approval.*draft → approved Log event/,
  );

  git(root, ['update-ref', 'refs/heads/changeledger/state', baseline.head]);
  const owned = mutateStateChange({
    repoRoot: root,
    branch: 'changeledger/state',
    id: '20260720-120000',
    expectedHead: baseline.head,
    operation: 'status:approved',
    actor: 'human',
    mutate: (text) =>
      `${text.replace('status: draft', 'status: approved\nowner: Roberto Ruiz')}- **2026-07-20T12:10:00Z** \`[owner]\` set: Roberto Ruiz\n- **2026-07-20T12:10:00Z** \`[status]\` draft → approved\n`,
    gitEnv: GIT_ENV,
  });
  const validTransfer = mutateStateChange({
    repoRoot: root,
    branch: 'changeledger/state',
    id: '20260720-120000',
    expectedHead: owned.head,
    operation: 'owner',
    actor: 'Roberto Ruiz',
    mutate: (text) =>
      `${text.replace('owner: Roberto Ruiz', 'owner: Luis Pérez')}- **2026-07-20T12:11:00Z** \`[owner]\` set: Luis Pérez\n- **2026-07-20T12:11:00Z** \`[note]\` ownership transferred: Roberto Ruiz → Luis Pérez by Roberto Ruiz via cli\n`,
    gitEnv: GIT_ENV,
  });
  assert.equal(
    validateStateRange(root, {
      oldHead: owned.head,
      newHead: validTransfer.head,
      actor: 'Roberto Ruiz',
      gitEnv: GIT_ENV,
    }).ok,
    true,
  );

  git(root, ['update-ref', 'refs/heads/changeledger/state', owned.head]);
  const misplaced = mutateStateChange({
    repoRoot: root,
    branch: 'changeledger/state',
    id: '20260720-120000',
    expectedHead: owned.head,
    operation: 'owner',
    actor: 'Roberto Ruiz',
    mutate: (text) =>
      `${text
        .replace('owner: Roberto Ruiz', 'owner: Luis Pérez')
        .replace(
          '## Log',
          '- **2026-07-20T12:11:00Z** `[note]` ownership transferred: Roberto Ruiz → Luis Pérez by Roberto Ruiz via cli\n\n## Log',
        )}- **2026-07-20T12:11:00Z** \`[owner]\` set: Luis Pérez\n`,
    gitEnv: GIT_ENV,
  });
  assert.throws(
    () =>
      validateStateRange(root, {
        oldHead: owned.head,
        newHead: misplaced.head,
        actor: 'Roberto Ruiz',
        gitEnv: GIT_ENV,
      }),
    /ownership transfer.*missing its audited Log event/,
  );

  const preowned = change('20260720-120001', 'Preowned').replace(
    'depends_on: []',
    'depends_on: []\nowner: ana',
  );
  const preownedBaseline = initializeStateStore({
    repoRoot: root,
    branch: 'changeledger/preowned',
    projectId: 'project-1',
    integrationBranch: 'dev',
    changes: [{ name: '20260720-120001-preowned.md', text: preowned }],
    gitEnv: GIT_ENV,
  });
  const silentApproval = mutateStateChange({
    repoRoot: root,
    branch: 'changeledger/preowned',
    id: '20260720-120001',
    expectedHead: preownedBaseline.head,
    operation: 'status:approved',
    actor: 'human',
    mutate: (text) => text.replace('status: draft', 'status: approved'),
    gitEnv: GIT_ENV,
  });
  assert.throws(
    () =>
      validateStateRange(root, {
        oldHead: preownedBaseline.head,
        newHead: silentApproval.head,
        humanOverride: true,
        gitEnv: GIT_ENV,
      }),
    /approval.*draft → approved Log event/,
  );

  git(root, ['update-ref', 'refs/heads/changeledger/state', owned.head]);
  const suffixedAudit = mutateStateChange({
    repoRoot: root,
    branch: 'changeledger/state',
    id: '20260720-120000',
    expectedHead: owned.head,
    operation: 'owner',
    actor: 'Roberto Ruiz',
    mutate: (text) =>
      `${text.replace('owner: Roberto Ruiz', 'owner: Luis Pérez')}- **2026-07-20T12:12:00Z** \`[owner]\` set: Luis Pérez\n- **2026-07-20T12:12:00Z** \`[note]\` ownership transferred: Roberto Ruiz → Luis Pérez by Roberto Ruiz via cli EXTRA-NO-AUDIT\n`,
    gitEnv: GIT_ENV,
  });
  assert.throws(
    () =>
      validateStateRange(root, {
        oldHead: owned.head,
        newHead: suffixedAudit.head,
        actor: 'Roberto Ruiz',
        gitEnv: GIT_ENV,
      }),
    /ownership transfer.*missing its audited Log event/,
  );
});

test('124231 CR13: receive validation accepts an explicit human ownership override', () => {
  const root = repo();
  const owned = change('20260720-120000', 'A').replace(
    'status: draft',
    'status: approved\nowner: ana',
  );
  const baseline = initializeStateStore({
    repoRoot: root,
    branch: 'changeledger/state',
    projectId: 'project-1',
    integrationBranch: 'dev',
    changes: [{ name: '20260720-120000-a.md', text: owned }],
    gitEnv: GIT_ENV,
  });
  const transferred = mutateStateChange({
    repoRoot: root,
    branch: 'changeledger/state',
    id: '20260720-120000',
    expectedHead: baseline.head,
    operation: 'owner',
    actor: 'admin',
    mutate: (text) =>
      `${text.replace('owner: ana', 'owner: luis')}- **2026-07-20T12:10:00Z** \`[owner]\` set: luis\n- **2026-07-20T12:10:00Z** \`[note]\` ownership transferred: ana → luis by admin via hook\n`,
    gitEnv: GIT_ENV,
  });
  const input = `${baseline.head} ${transferred.head} refs/heads/changeledger/state\n`;

  assert.throws(
    () => validateReceive(input, root, { actor: 'admin', gitEnv: GIT_ENV }),
    /current owner is "ana"/,
  );
  assert.equal(
    validateReceive(input, root, {
      actor: 'admin',
      humanOverride: true,
      gitEnv: GIT_ENV,
    })[0].ok,
    true,
  );
});

test('124231 CR13: receive validation declares unavailable owner enforcement', () => {
  const root = repo();
  const baseline = initializeStateStore({
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
    expectedHead: baseline.head,
    operation: 'note',
    actor: 'ana',
    mutate: (text) => `${text}\nadvanced\n`,
    gitEnv: GIT_ENV,
  });

  const result = validateStateRange(root, {
    oldHead: baseline.head,
    newHead: advanced.head,
    gitEnv: GIT_ENV,
  });
  assert.equal(result.owner_enforcement, 'unavailable');

  const cli = spawnSync(process.execPath, [BIN, 'state', 'validate-receive'], {
    cwd: root,
    env: GIT_ENV,
    encoding: 'utf8',
    input: `${baseline.head} ${advanced.head} refs/heads/changeledger/state\n`,
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stderr, /identity is unavailable.*owner exclusivity was not enforced/);
});

test('124231 CR8/CR11: traced lifecycle operations require code revision and branch', () => {
  const root = repo();
  const baseline = initializeStateStore({
    repoRoot: root,
    branch: 'changeledger/state',
    projectId: 'project-1',
    integrationBranch: 'dev',
    changes: [{ name: '20260720-120000-a.md', text: change('20260720-120000', 'A') }],
    gitEnv: GIT_ENV,
  });
  const untraced = mutateStateChange({
    repoRoot: root,
    branch: 'changeledger/state',
    id: '20260720-120000',
    expectedHead: baseline.head,
    operation: 'status:in-progress',
    actor: 'ana',
    mutate: (text) => `${text}\nstarted\n`,
    gitEnv: GIT_ENV,
  });

  assert.throws(
    () =>
      validateStateRange(root, {
        oldHead: baseline.head,
        newHead: untraced.head,
        gitEnv: GIT_ENV,
      }),
    /code traceability requires exactly one Code-Revision and Code-Branch/,
  );
});

test('124231 CR8: traceability rejects a revision incompatible with its change and branch', () => {
  const root = repo();
  git(root, ['switch', '-qc', 'feature/other']);
  fs.writeFileSync(path.join(root, 'other.txt'), 'other\n');
  git(root, ['add', 'other.txt']);
  git(root, ['commit', '-qm', 'feat: other [#20260720-999999]']);
  const codeRevision = git(root, ['rev-parse', 'HEAD']);
  git(root, ['switch', '-q', 'dev']);
  const baseline = initializeStateStore({
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
    expectedHead: baseline.head,
    operation: 'implementation',
    actor: 'ana',
    codeRevision,
    codeBranch: 'dev',
    mutate: (text) => `${text}\nimplemented\n`,
    gitEnv: GIT_ENV,
  });
  const messages = stateTraceabilityErrors(root, advanced.head, { gitEnv: GIT_ENV }).map(
    (error) => error.message,
  );
  assert.ok(messages.some((message) => /change marker/.test(message)));
  assert.ok(messages.some((message) => /branch/.test(message)));

  const tree = git(root, ['rev-parse', `${advanced.head}^{tree}`]);
  const duplicate = git(root, [
    'commit-tree',
    tree,
    '-p',
    advanced.head,
    '-m',
    `duplicate trace

Change-Id: 20260720-120000
Code-Revision: ${codeRevision}
Code-Revision: deadbeef
Code-Branch: dev`,
  ]);
  const duplicateErrors = stateTraceabilityErrors(root, duplicate, { gitEnv: GIT_ENV });
  assert.ok(duplicateErrors.some((error) => /multiple Code-Revision/.test(error.message)));
  assert.throws(
    () =>
      validateStateRange(root, {
        oldHead: advanced.head,
        newHead: duplicate,
        gitEnv: GIT_ENV,
      }),
    /multiple Code-Revision/,
  );

  const malformed = git(root, [
    'commit-tree',
    tree,
    '-p',
    advanced.head,
    '-m',
    `malformed trace

Change-Id:
Code-Revision: NOT_HEX
Code-Branch:`,
  ]);
  const malformedErrors = stateTraceabilityErrors(root, malformed, { gitEnv: GIT_ENV });
  assert.ok(malformedErrors.some((error) => /invalid Code-Revision/.test(error.message)));
  assert.ok(malformedErrors.some((error) => /exactly one non-empty Change-Id/.test(error.message)));
  assert.throws(
    () =>
      validateStateRange(root, {
        oldHead: advanced.head,
        newHead: malformed,
        gitEnv: GIT_ENV,
      }),
    /invalid Code-Revision/,
  );
});

test('124231 CR17: sync refuses a future remote manifest before replaying pending state', () => {
  const root = repo();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-state-future-remote-'));
  git(bare, ['init', '--bare', '-q']);
  git(root, ['remote', 'add', 'origin', bare]);
  const baseline = initializeStateStore({
    repoRoot: root,
    branch: 'changeledger/state',
    projectId: 'project-1',
    integrationBranch: 'dev',
    changes: [{ name: '20260720-120000-a.md', text: change('20260720-120000', 'A') }],
    gitEnv: GIT_ENV,
  });
  publishStateStore(root, 'changeledger/state', { gitEnv: GIT_ENV });

  git(root, ['switch', '-q', 'changeledger/state']);
  const manifest = path.join(root, '.changeledger-state', 'manifest.yml');
  fs.writeFileSync(
    manifest,
    fs.readFileSync(manifest, 'utf8').replace('schema_version: 1', 'schema_version: 2'),
  );
  git(root, ['add', manifest]);
  git(root, ['commit', '-qm', 'future remote']);
  const future = git(root, ['rev-parse', 'HEAD']);
  git(root, ['push', '-q', 'origin', `HEAD:refs/heads/changeledger/state`]);
  git(root, ['reset', '--hard', '-q', baseline.head]);
  git(root, ['switch', '-q', 'dev']);

  mutateStateChange({
    repoRoot: root,
    branch: 'changeledger/state',
    id: '20260720-120000',
    expectedHead: baseline.head,
    operation: 'pending-local',
    actor: 'ana',
    mutate: (text) => `${text}\nlocal pending\n`,
    gitEnv: GIT_ENV,
  });
  assert.throws(
    () => syncStateStore(root, 'changeledger/state', { gitEnv: GIT_ENV }),
    /state schema 2 is newer than supported/,
  );
  assert.equal(git(bare, ['rev-parse', 'refs/heads/changeledger/state']), future);
});

test('124231 CR17: a future manifest remains queryable but is read-only', () => {
  const root = repo();
  const baseline = initializeStateStore({
    repoRoot: root,
    branch: 'changeledger/state',
    projectId: 'project-1',
    integrationBranch: 'dev',
    changes: [{ name: '20260720-120000-a.md', text: change('20260720-120000', 'A') }],
    gitEnv: GIT_ENV,
  });
  git(root, ['switch', '-q', 'changeledger/state']);
  const manifest = path.join(root, '.changeledger-state', 'manifest.yml');
  fs.writeFileSync(
    manifest,
    fs.readFileSync(manifest, 'utf8').replace('schema_version: 1', 'schema_version: 2'),
  );
  git(root, ['add', manifest]);
  git(root, ['commit', '-qm', 'future state schema']);
  const loaded = readStateStore(root, 'changeledger/state', { gitEnv: GIT_ENV });
  assert.equal(loaded.readOnly, true);
  assert.equal(loaded.changes.length, 1);
  assert.throws(
    () =>
      mutateStateChange({
        repoRoot: root,
        branch: 'changeledger/state',
        id: '20260720-120000',
        expectedHead: loaded.head,
        operation: 'write',
        actor: 'ana',
        mutate: (text) => text,
        gitEnv: GIT_ENV,
      }),
    /newer than supported/,
  );
  assert.notEqual(loaded.head, baseline.head);
});
