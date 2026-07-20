import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { previewStateMigration } from '../src/state-migration.mjs';
import { initializeStateStore, validateStateRange } from '../src/state-store.mjs';

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Migration Test',
  GIT_AUTHOR_EMAIL: 'migration@example.com',
  GIT_COMMITTER_NAME: 'Migration Test',
  GIT_COMMITTER_EMAIL: 'migration@example.com',
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

function config() {
  return `schema_version: 4
language: en
changes_dir: .changeledger/changes
specs_dir: .changeledger/specs
git:
  integration_branch: dev
  change_branch_format: "{type}/{id}"
statuses: [draft, approved, in-progress, in-review, in-validation, blocked, done, discarded]
stages: [request, investigation, proposal, specification, plan, log]
types:
  feature:
    stages: [request, investigation, proposal, specification, plan, log]
project_id: project-1
project_name: migration
`;
}

function change(id, { status = 'draft', owner, note = '' } = {}) {
  return `---
id: "${id}"
title: State
type: feature
status: ${status}
created: 2026-07-20T12:00:00Z
depends_on: []
${owner ? `owner: ${owner}\n` : ''}---

## Request

${note}

## Investigation

## Proposal

## Specification

## Plan

## Log
`;
}

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-state-migration-'));
  git(root, ['init', '-q', '-b', 'dev']);
  fs.mkdirSync(path.join(root, '.changeledger', 'changes'), { recursive: true });
  fs.writeFileSync(path.join(root, '.changeledger', 'config.yml'), config());
  fs.writeFileSync(
    path.join(root, '.changeledger', 'changes', '20260720-120000-state.md'),
    change('20260720-120000'),
  );
  git(root, ['add', '.changeledger']);
  git(root, ['commit', '-qm', 'dev state']);
  return root;
}

test('124231 CR10/CR15: preview deduplicates identical documents and records origins', () => {
  const root = repo();
  git(root, ['branch', 'feature/20260720-120000']);
  const result = previewStateMigration(root, {
    refs: ['dev', 'feature/20260720-120000'],
    gitEnv: ENV,
  });

  assert.deepEqual(result.refs, ['dev', 'feature/20260720-120000']);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.changes.length, 1);
  assert.equal(result.origins.length, 2);
  assert.ok(result.origins.every((origin) => /^[0-9a-f]{40}$/.test(origin.commit)));
  assert.ok(result.origins.every((origin) => /^[0-9a-f]{40}$/.test(origin.blob)));
});

test('124231 CR15: divergent content and missing active owner block the candidate', () => {
  const root = repo();
  git(root, ['switch', '-qc', 'feature/20260720-120000']);
  fs.writeFileSync(
    path.join(root, '.changeledger', 'changes', '20260720-120000-state.md'),
    change('20260720-120000', { status: 'in-progress', note: 'different' }),
  );
  git(root, ['add', '.changeledger']);
  git(root, ['commit', '-qm', 'divergent']);

  const result = previewStateMigration(root, {
    refs: ['dev', 'feature/20260720-120000'],
    gitEnv: ENV,
  });
  assert.ok(result.conflicts.some((item) => item.kind === 'divergent-content'));
  assert.ok(result.conflicts.some((item) => item.kind === 'missing-owner'));
});

test('124231 CR15: approved without owner blocks while terminal changes need no retrofit', () => {
  const root = repo();
  const file = path.join(root, '.changeledger', 'changes', '20260720-120000-state.md');
  fs.writeFileSync(file, change('20260720-120000', { status: 'approved' }));
  git(root, ['add', file]);
  git(root, ['commit', '-qm', 'approved']);
  assert.ok(
    previewStateMigration(root, { refs: ['dev'], gitEnv: ENV }).conflicts.some(
      (item) => item.kind === 'missing-owner',
    ),
  );

  fs.writeFileSync(file, change('20260720-120000', { status: 'done' }));
  git(root, ['add', file]);
  git(root, ['commit', '-qm', 'done']);
  assert.deepEqual(previewStateMigration(root, { refs: ['dev'], gitEnv: ENV }).conflicts, []);
});

test('124231 CR14/CR15: preview records one logical legacy branch and deduplicates aliases', () => {
  const root = repo();
  const file = path.join(root, '.changeledger', 'changes', '20260720-120000-state.md');
  fs.writeFileSync(file, change('20260720-120000', { status: 'in-progress', owner: 'ana' }));
  git(root, ['add', file]);
  git(root, ['commit', '-qm', 'in progress']);
  git(root, ['branch', 'work/20260720-120000']);
  git(root, [
    'update-ref',
    'refs/remotes/origin/work/20260720-120000',
    'refs/heads/work/20260720-120000',
  ]);

  const result = previewStateMigration(root, {
    refs: ['dev', 'work/20260720-120000', 'refs/remotes/origin/work/20260720-120000'],
    gitEnv: ENV,
  });

  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.legacyBranches, {
    '20260720-120000': 'work/20260720-120000',
  });
});

test('124231 CR10: remote-tracking provenance is portable to a bare receive hook', () => {
  const root = repo();
  git(root, ['update-ref', 'refs/remotes/origin/dev', 'refs/heads/dev']);
  const preview = previewStateMigration(root, {
    refs: ['dev', 'refs/remotes/origin/dev'],
    gitEnv: ENV,
  });
  assert.deepEqual(preview.conflicts, []);
  assert.equal(preview.origins.length, 1);
  assert.equal(preview.origins[0].ref, 'refs/heads/dev');
  const state = initializeStateStore({
    repoRoot: root,
    branch: 'changeledger/state',
    projectId: 'project-1',
    integrationBranch: 'dev',
    changes: preview.changes,
    origins: preview.origins,
    gitEnv: ENV,
  });
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-state-origin-bare-'));
  git(bare, ['init', '--bare', '-q']);
  git(root, ['push', '-q', bare, 'dev:refs/heads/dev']);
  git(root, ['push', '-q', bare, `${state.head}:refs/heads/changeledger/state`]);
  assert.doesNotThrow(() =>
    validateStateRange(bare, {
      oldHead: '0'.repeat(state.head.length),
      newHead: state.head,
      humanOverride: true,
      gitEnv: ENV,
    }),
  );
});

test('124231 CR15: a ref merely containing the id is not an implementation branch', () => {
  const root = repo();
  const file = path.join(root, '.changeledger', 'changes', '20260720-120000-state.md');
  fs.writeFileSync(file, change('20260720-120000', { status: 'in-progress', owner: 'ana' }));
  git(root, ['add', file]);
  git(root, ['commit', '-qm', 'in progress']);
  git(root, ['branch', 'backup-20260720-120000-copy']);

  const result = previewStateMigration(root, {
    refs: ['dev', 'backup-20260720-120000-copy'],
    gitEnv: ENV,
  });
  assert.ok(result.conflicts.some((item) => item.kind === 'ambiguous-branch'));
});

test('124231 CR15: an implementation branch must descend from integration', () => {
  const root = repo();
  const file = path.join(root, '.changeledger', 'changes', '20260720-120000-state.md');
  fs.writeFileSync(file, change('20260720-120000', { status: 'in-progress', owner: 'ana' }));
  git(root, ['add', file]);
  git(root, ['commit', '-qm', 'in progress']);
  const tree = git(root, ['rev-parse', 'dev^{tree}']);
  const unrelated = git(root, ['commit-tree', tree, '-m', 'unrelated root']);
  git(root, ['update-ref', 'refs/heads/work/20260720-120000', unrelated]);

  const result = previewStateMigration(root, {
    refs: ['dev', 'work/20260720-120000'],
    gitEnv: ENV,
  });
  assert.ok(result.conflicts.some((item) => item.kind === 'invalid-branch-baseline'));
});
