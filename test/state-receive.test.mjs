import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { status } from '../src/commands/agent.mjs';
import { initializeStateStore, readStateStore } from '../src/state-store.mjs';

const BIN = fileURLToPath(new URL('../bin/changeledger.mjs', import.meta.url));
const BRANCH = 'changeledger/state';
const STATE_REF = `refs/heads/${BRANCH}`;

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Receive Test',
  GIT_AUTHOR_EMAIL: 'receive@example.com',
  GIT_COMMITTER_NAME: 'Receive Test',
  GIT_COMMITTER_EMAIL: 'receive@example.com',
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

const CHANGE = `---
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

- [ ] Implement state

## Log
`;

function workingRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-receive-work-'));
  git(root, ['init', '-q', '-b', 'dev']);
  fs.mkdirSync(path.join(root, '.changeledger', 'changes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'README.md'), '# repo\n');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '-qm', 'initial']);
  const initialized = initializeStateStore({
    repoRoot: root,
    branch: BRANCH,
    projectId: 'project-1',
    integrationBranch: 'dev',
    changes: [{ name: '20260720-120000-state.md', text: CHANGE }],
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
project_name: receive
`,
  );
  git(root, ['add', '.changeledger/config.yml']);
  git(root, ['commit', '-qm', 'configure']);
  return { root, initialHead: initialized.head };
}

// Bare remote whose pre-receive hook runs the built CLI, exactly as an
// administrator would install it on a managed server. `dev` and the state
// baseline are pushed before the hook is installed: the validator must read the
// canonical integration config from `dev`, and the provenance-bearing root
// commit is established out of band so the hook can be exercised on the
// incremental updates that a live push actually validates.
function bareRemoteWithHook(root, baseline) {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-receive-bare-'));
  git(bare, ['init', '--bare', '-q']);
  git(root, ['push', '-q', bare, 'dev:refs/heads/dev']);
  git(root, ['push', '-q', bare, `${baseline}:${STATE_REF}`]);
  const hook = path.join(bare, 'hooks', 'pre-receive');
  fs.writeFileSync(
    hook,
    `#!/bin/sh\nexec "${process.execPath}" "${BIN}" state validate-receive --branch ${BRANCH}\n`,
  );
  fs.chmodSync(hook, 0o755);
  return bare;
}

function pushState(root, bare, spec) {
  return spawnSync('git', ['push', bare, spec], { cwd: root, env: ENV, encoding: 'utf8' });
}

function remoteStateHead(bare) {
  try {
    return git(bare, ['rev-parse', '--verify', STATE_REF]);
  } catch {
    return undefined;
  }
}

// CR1/CR3: a valid state push clears the real hook while Git's object quarantine
// is active; an invalid one is rejected against the real push outcome.
test('223228 CR1/CR3: real pre-receive hook validates quarantined objects on push', () => {
  const { root, initialHead } = workingRepo();
  const bare = bareRemoteWithHook(root, initialHead);
  assert.equal(remoteStateHead(bare), initialHead);

  // Valid: a fast-forward mutation carrying full traceability is accepted, and
  // the hook could only validate it by reading the pushed commit from Git's
  // object quarantine.
  status('20260720-120000', 'approved', root, { actor: 'human', owner: 'ana' });
  const mutationHead = readStateStore(root, BRANCH, { gitEnv: ENV }).head;
  assert.notEqual(mutationHead, initialHead);
  const forward = pushState(root, bare, `${mutationHead}:${STATE_REF}`);
  assert.equal(forward.status, 0, forward.stderr);
  assert.equal(remoteStateHead(bare), mutationHead);

  // Invalid: a commit that adds a file outside the state layout is rejected and
  // the remote head is left untouched.
  const strayBlob = execFileSync('git', ['hash-object', '-w', '--stdin'], {
    cwd: root,
    env: ENV,
    input: 'stray\n',
    encoding: 'utf8',
  }).trim();
  const baseTree = git(root, ['rev-parse', `${mutationHead}^{tree}`]);
  const invalidTree = execFileSync('git', ['mktree'], {
    cwd: root,
    env: ENV,
    input: `${git(root, ['ls-tree', baseTree])}\n100644 blob ${strayBlob}\tstray.txt\n`,
    encoding: 'utf8',
  }).trim();
  const invalidCommit = execFileSync(
    'git',
    ['commit-tree', invalidTree, '-p', mutationHead, '-m', 'invalid state'],
    { cwd: root, env: ENV, encoding: 'utf8' },
  ).trim();
  const rejected = pushState(root, bare, `${invalidCommit}:${STATE_REF}`);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /outside the state layout|pre-receive hook declined/);
  assert.equal(remoteStateHead(bare), mutationHead);

  // The strong-protection handshake is also exercised through the real hook:
  // only this validator emits a nonce and its configured branch after seeing
  // the intentionally invalid probe object in the receive quarantine.
  const nonce = 'a'.repeat(32);
  const probeBlob = execFileSync('git', ['hash-object', '-w', '--stdin'], {
    cwd: root,
    env: ENV,
    input: 'probe\n',
    encoding: 'utf8',
  }).trim();
  const probeTree = execFileSync('git', ['mktree'], {
    cwd: root,
    env: ENV,
    input: `100644 blob ${probeBlob}\tchangeledger-protection-probe-${nonce}.txt\n`,
    encoding: 'utf8',
  }).trim();
  const probeCommit = execFileSync('git', ['commit-tree', probeTree, '-m', 'protection probe'], {
    cwd: root,
    env: ENV,
    encoding: 'utf8',
  }).trim();
  const probe = pushState(root, bare, `${probeCommit}:refs/changeledger/protection-probe/${nonce}`);
  assert.notEqual(probe.status, 0);
  assert.match(probe.stderr, new RegExp(`CHANGELEDGER_PROTECTION_ATTESTATION ${nonce} ${BRANCH}`));

  // Sanity: the working store still resolves the mutated head locally.
  assert.equal(readStateStore(root, BRANCH, { gitEnv: ENV }).head, mutationHead);
});
