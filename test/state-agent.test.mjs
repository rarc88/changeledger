import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { owner, status, task } from '../src/commands/agent.mjs';
import { newChange } from '../src/commands/new.mjs';
import { initializeStateStore, readStateStore } from '../src/state-store.mjs';

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'State Agent',
  GIT_AUTHOR_EMAIL: 'agent@example.com',
  GIT_COMMITTER_NAME: 'State Agent',
  GIT_COMMITTER_EMAIL: 'agent@example.com',
};

function git(root, args) {
  return execFileSync('git', args, { cwd: root, env: ENV, encoding: 'utf8' }).trim();
}

function setup() {
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
  assert.throws(
    () => task('20260720-120000', 'done', 1, undefined, root, { actorHandle: () => 'luis' }),
    /owned by "ana"/,
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
