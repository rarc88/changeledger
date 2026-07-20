import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  abortState,
  activateState,
  initState,
  previewState,
  recoverState,
} from '../src/commands/state.mjs';
import { loadConfig } from '../src/config.mjs';
import { mutateStateChange, readStateStore } from '../src/state-store.mjs';

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Command Test',
  GIT_AUTHOR_EMAIL: 'command@example.com',
  GIT_COMMITTER_NAME: 'Command Test',
  GIT_COMMITTER_EMAIL: 'command@example.com',
};

function git(root, args) {
  return execFileSync('git', args, { cwd: root, env: ENV, encoding: 'utf8' }).trim();
}

function root() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-state-command-'));
  git(dir, ['init', '-q', '-b', 'dev']);
  fs.mkdirSync(path.join(dir, '.changeledger', 'changes'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.changeledger', 'specs'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.changeledger', 'config.yml'),
    `schema_version: 4
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
project_name: command
`,
  );
  fs.writeFileSync(
    path.join(dir, '.changeledger', 'changes', '20260720-120000-state.md'),
    `---
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

## Log
`,
  );
  fs.writeFileSync(path.join(dir, '.changeledger', 'specs', 'truth.md'), 'durable truth\n');
  git(dir, ['add', '.changeledger']);
  git(dir, ['commit', '-qm', 'initial']);
  return dir;
}

test('124231 CR1/CR9/CR10: init creates an inactive candidate without touching config', () => {
  const dir = root();
  const before = fs.readFileSync(path.join(dir, '.changeledger', 'config.yml'), 'utf8');
  const preview = previewState({ refs: ['dev'] }, dir, { gitEnv: ENV });
  assert.deepEqual(preview.conflicts, []);
  const result = initState({ refs: ['dev'] }, dir, { gitEnv: ENV });

  assert.match(result.head, /^[0-9a-f]{40}$/);
  assert.equal(fs.readFileSync(path.join(dir, '.changeledger', 'config.yml'), 'utf8'), before);
  assert.equal(readStateStore(dir, 'changeledger/state').changes.length, 1);
  assert.throws(() => initState({ refs: ['dev'] }, dir, { gitEnv: ENV }), /already exists/);
});

test('124231 CR16/CR19: activate records ref and baseline together and removes only changes', () => {
  const dir = root();
  const initialized = initState({ refs: ['dev'] }, dir, { gitEnv: ENV });
  assert.throws(() => activateState({}, dir, { gitEnv: ENV }), /--advisory/);

  const activated = activateState({ advisoryReason: 'temporary server without hooks' }, dir, {
    gitEnv: ENV,
  });
  const config = loadConfig(path.join(dir, '.changeledger'));
  assert.equal(config.git.state_branch, 'changeledger/state');
  assert.equal(config.git.state_baseline, initialized.head);
  assert.equal(activated.baseline, initialized.head);
  assert.equal(
    fs.existsSync(path.join(dir, '.changeledger', 'changes', '20260720-120000-state.md')),
    false,
  );
  assert.equal(fs.existsSync(path.join(dir, '.changeledger', 'changes', 'STATE_MOVED')), true);
  assert.equal(
    fs.readFileSync(path.join(dir, '.changeledger', 'specs', 'truth.md'), 'utf8'),
    'durable truth\n',
  );
});

test('124231 CR16: activation refuses a candidate that does not match the working documents', () => {
  const dir = root();
  initState({ refs: ['dev'] }, dir, { gitEnv: ENV });
  fs.appendFileSync(
    path.join(dir, '.changeledger', 'changes', '20260720-120000-state.md'),
    '\nlocal divergence\n',
  );
  assert.throws(
    () => activateState({ advisoryReason: 'temporary server without hooks' }, dir, { gitEnv: ENV }),
    /changed after the state baseline/,
  );
});

test('124231 CR18: abort restores legacy files only before state advances', () => {
  const dir = root();
  const initialized = initState({ refs: ['dev'] }, dir, { gitEnv: ENV });
  activateState({ advisoryReason: 'test' }, dir, { gitEnv: ENV });
  const aborted = abortState(dir, { gitEnv: ENV });
  assert.equal(aborted.baseline, initialized.head);
  assert.equal(
    fs.existsSync(path.join(dir, '.changeledger', 'changes', '20260720-120000-state.md')),
    true,
  );
  const config = loadConfig(path.join(dir, '.changeledger'));
  assert.equal(config.git.state_branch, undefined);
  assert.equal(config.git.state_baseline, undefined);
});

test('124231 CR18: advanced state exports recovery instead of selecting legacy copies', () => {
  const dir = root();
  const initialized = initState({ refs: ['dev'] }, dir, { gitEnv: ENV });
  activateState({ advisoryReason: 'test' }, dir, { gitEnv: ENV });
  const advanced = mutateStateChange({
    repoRoot: dir,
    branch: 'changeledger/state',
    id: '20260720-120000',
    expectedHead: initialized.head,
    operation: 'note',
    actor: 'ana',
    mutate: (text) => `${text}\nadvanced\n`,
    gitEnv: ENV,
  });
  assert.throws(() => abortState(dir, { gitEnv: ENV }), /state has advanced/);
  const recovered = recoverState({ branch: 'changeledger/recovery-test' }, dir, { gitEnv: ENV });
  assert.equal(recovered.head, advanced.head);
  assert.equal(git(dir, ['rev-parse', 'refs/heads/changeledger/recovery-test']), advanced.head);
  assert.equal(loadConfig(path.join(dir, '.changeledger')).git.state_branch, 'changeledger/state');
});
