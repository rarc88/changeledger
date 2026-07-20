import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { previewStateMigration } from '../src/state-migration.mjs';

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Migration Test',
  GIT_AUTHOR_EMAIL: 'migration@example.com',
  GIT_COMMITTER_NAME: 'Migration Test',
  GIT_COMMITTER_EMAIL: 'migration@example.com',
};

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
