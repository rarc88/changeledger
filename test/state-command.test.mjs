import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  abortState,
  activateState,
  doctorState,
  initState,
  previewState,
  publishState,
  recoverState,
  validateReceive,
} from '../src/commands/state.mjs';
import { loadConfig } from '../src/config.mjs';
import { mutateStateChange, readStateStore } from '../src/state-store.mjs';

const BIN = fileURLToPath(new URL('../bin/changeledger.mjs', import.meta.url));

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

function publishCandidate(dir) {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-state-command-origin-'));
  git(bare, ['init', '--bare', '-q']);
  git(dir, ['remote', 'add', 'origin', bare]);
  const published = publishState({}, dir, { gitEnv: ENV });
  assert.equal(published.confirmed, true);
  return bare;
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

test('124231 CR14/CR15: init persists the selected legacy implementation branch', () => {
  const dir = root();
  const file = path.join(dir, '.changeledger', 'changes', '20260720-120000-state.md');
  fs.writeFileSync(
    file,
    fs.readFileSync(file, 'utf8').replace('status: draft', 'status: in-progress\nowner: ana'),
  );
  git(dir, ['add', file]);
  git(dir, ['commit', '-qm', 'in progress']);
  git(dir, ['branch', 'work/20260720-120000']);

  initState({ refs: ['dev', 'work/20260720-120000'] }, dir, { gitEnv: ENV });
  assert.deepEqual(readStateStore(dir, 'changeledger/state').manifest.legacy_branches, {
    '20260720-120000': 'work/20260720-120000',
  });
});

test('124231 CR16/CR19: activate records ref and baseline together and removes only changes', () => {
  const dir = root();
  const initialized = initState({ refs: ['dev'] }, dir, { gitEnv: ENV });
  assert.throws(() => activateState({}, dir, { gitEnv: ENV }), /--advisory/);
  assert.throws(
    () => activateState({ advisoryReason: 'temporary server without hooks' }, dir, { gitEnv: ENV }),
    /published and confirmed/,
  );
  publishCandidate(dir);

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

test('124231 CR16: provider-neutral activation never claims unverifiable remote protection', () => {
  const dir = root();
  initState({ refs: ['dev'] }, dir, { gitEnv: ENV });
  publishCandidate(dir);
  assert.throws(() => activateState({ remoteProtected: true }, dir, { gitEnv: ENV }), /--advisory/);
  const result = activateState(
    { advisoryReason: 'provider protection is externally managed' },
    dir,
    {
      gitEnv: ENV,
    },
  );
  assert.equal(result.advisory, true);
  assert.match(
    fs.readFileSync(path.join(dir, '.changeledger', 'changes', 'STATE_MOVED'), 'utf8'),
    /Advisory cutover: provider protection is externally managed/,
  );
  assert.equal(doctorState({}, dir, { gitEnv: ENV }).remote_protection, 'unverified');
});

test('124231 CR11: doctor validates the complete inactive candidate layout', () => {
  const dir = root();
  initState({ refs: ['dev'] }, dir, { gitEnv: ENV });
  git(dir, ['switch', '-q', 'changeledger/state']);
  fs.writeFileSync(path.join(dir, 'unexpected.txt'), 'invalid\n');
  git(dir, ['add', 'unexpected.txt']);
  git(dir, ['commit', '-qm', 'invalid candidate']);
  git(dir, ['switch', '-q', 'dev']);
  assert.throws(
    () => doctorState({ branch: 'changeledger/state' }, dir, { gitEnv: ENV }),
    /outside the state layout/,
  );
});

test('124231 CR16: receive validation blocks legacy writes after cutover', () => {
  const dir = root();
  initState({ refs: ['dev'] }, dir, { gitEnv: ENV });
  publishCandidate(dir);
  activateState({ advisoryReason: 'test hook enforcement' }, dir, { gitEnv: ENV });
  const beforeCutover = git(dir, ['rev-parse', 'HEAD']);
  git(dir, ['add', '.changeledger']);
  git(dir, ['commit', '-qm', 'activate state']);
  const cutover = git(dir, ['rev-parse', 'HEAD']);
  assert.doesNotThrow(() =>
    validateReceive(`${beforeCutover} ${cutover} refs/heads/dev\n`, dir, {
      branch: 'changeledger/state',
      integrationBranch: 'dev',
      gitEnv: ENV,
    }),
  );

  abortState(dir, { gitEnv: ENV });
  git(dir, ['add', '.changeledger']);
  git(dir, ['commit', '-qm', 'abort state before first mutation']);
  const rollback = git(dir, ['rev-parse', 'HEAD']);
  assert.doesNotThrow(() =>
    validateReceive(`${cutover} ${rollback} refs/heads/dev\n`, dir, {
      branch: 'changeledger/state',
      integrationBranch: 'dev',
      gitEnv: ENV,
    }),
  );
  fs.copyFileSync(
    path.join(dir, '.changeledger', 'changes', '20260720-120000-state.md'),
    path.join(dir, '.changeledger', 'changes', '20260720-120000-copy.md'),
  );
  git(dir, ['add', '.changeledger']);
  git(dir, ['commit', '-qm', 'duplicate rollback']);
  const duplicateRollback = git(dir, ['rev-parse', 'HEAD']);
  assert.throws(
    () =>
      validateReceive(`${cutover} ${duplicateRollback} refs/heads/dev\n`, dir, {
        branch: 'changeledger/state',
        integrationBranch: 'dev',
        gitEnv: ENV,
      }),
    /does not exactly restore the state baseline/,
  );
  git(dir, ['reset', '--hard', '-q', cutover]);

  const configFile = path.join(dir, '.changeledger', 'config.yml');
  fs.writeFileSync(
    configFile,
    fs
      .readFileSync(configFile, 'utf8')
      .replace('changes_dir: .changeledger/changes', 'changes_dir: .changeledger/legacy-changes'),
  );
  git(dir, ['add', configFile]);
  git(dir, ['commit', '-qm', 'attempt legacy path bypass']);
  const bypass = git(dir, ['rev-parse', 'HEAD']);
  assert.throws(
    () =>
      validateReceive(`${cutover} ${bypass} refs/heads/dev\n`, dir, {
        branch: 'changeledger/state',
        integrationBranch: 'dev',
        gitEnv: ENV,
      }),
    /changes_dir cannot change/,
  );
  git(dir, ['reset', '--hard', '-q', cutover]);

  git(dir, ['switch', '-qc', 'stale-client', beforeCutover]);
  const legacy = path.join(dir, '.changeledger', 'changes', '20260720-120000-state.md');
  fs.appendFileSync(legacy, '\nstale mutation\n');
  git(dir, ['add', legacy]);
  git(dir, ['commit', '-qm', 'stale legacy mutation']);
  const stale = git(dir, ['rev-parse', 'HEAD']);
  assert.throws(
    () =>
      validateReceive(`${beforeCutover} ${stale} refs/heads/stale-client\n`, dir, {
        branch: 'changeledger/state',
        integrationBranch: 'dev',
        gitEnv: ENV,
      }),
    /legacy change state.*read-only/,
  );
});

test('124231 CR11/CR16: receive validation revalidates a pre-published cutover candidate', () => {
  const dir = root();
  const initialized = initState({ refs: ['dev'] }, dir, { gitEnv: ENV });
  publishCandidate(dir);
  git(dir, ['switch', '-q', 'changeledger/state']);
  fs.writeFileSync(path.join(dir, 'unexpected.txt'), 'invalid\n');
  git(dir, ['add', 'unexpected.txt']);
  git(dir, ['commit', '-qm', 'invalid candidate']);
  git(dir, ['switch', '-q', 'dev']);
  const beforeCutover = git(dir, ['rev-parse', 'HEAD']);
  const configFile = path.join(dir, '.changeledger', 'config.yml');
  fs.writeFileSync(
    configFile,
    fs
      .readFileSync(configFile, 'utf8')
      .replace(
        '  change_branch_format: "{type}/{id}"\n',
        `  change_branch_format: "{type}/{id}"\n  state_branch: changeledger/state\n  state_baseline: ${initialized.head}\n`,
      ),
  );
  fs.rmSync(path.join(dir, '.changeledger', 'changes', '20260720-120000-state.md'));
  fs.writeFileSync(
    path.join(dir, '.changeledger', 'changes', 'STATE_MOVED'),
    `Changes moved to refs/heads/changeledger/state at ${initialized.head}.\nAdvisory cutover: test\n`,
  );
  git(dir, ['add', '.changeledger']);
  git(dir, ['commit', '-qm', 'manual invalid cutover']);
  const cutover = git(dir, ['rev-parse', 'HEAD']);
  assert.throws(
    () =>
      validateReceive(`${beforeCutover} ${cutover} refs/heads/dev\n`, dir, {
        branch: 'changeledger/state',
        integrationBranch: 'dev',
        gitEnv: ENV,
      }),
    /outside the state layout/,
  );
});

test('124231 CR16: receive validation requires the canonical cutover marker', () => {
  const dir = root();
  const initialized = initState({ refs: ['dev'] }, dir, { gitEnv: ENV });
  publishCandidate(dir);
  const beforeCutover = git(dir, ['rev-parse', 'HEAD']);
  const configFile = path.join(dir, '.changeledger', 'config.yml');
  fs.writeFileSync(
    configFile,
    fs
      .readFileSync(configFile, 'utf8')
      .replace(
        '  change_branch_format: "{type}/{id}"\n',
        `  change_branch_format: "{type}/{id}"\n  state_branch: changeledger/state\n  state_baseline: ${initialized.head}\n`,
      ),
  );
  fs.rmSync(path.join(dir, '.changeledger', 'changes', '20260720-120000-state.md'));
  git(dir, ['add', '.changeledger']);
  git(dir, ['commit', '-qm', 'cutover without marker']);
  const cutover = git(dir, ['rev-parse', 'HEAD']);
  assert.throws(
    () =>
      validateReceive(`${beforeCutover} ${cutover} refs/heads/dev\n`, dir, {
        branch: 'changeledger/state',
        integrationBranch: 'dev',
        gitEnv: ENV,
      }),
    /STATE_MOVED/,
  );
});

test('124231 CR16: CLI publishes an inactive candidate before activation', () => {
  const dir = root();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-state-command-cli-origin-'));
  git(bare, ['init', '--bare', '-q']);
  git(dir, ['remote', 'add', 'origin', bare]);

  const initializedOutput = execFileSync(process.execPath, [BIN, 'state', 'init', '--ref', 'dev'], {
    cwd: dir,
    env: ENV,
    encoding: 'utf8',
  });
  const initialized = readStateStore(dir, 'changeledger/state');
  assert.match(
    initializedOutput,
    new RegExp(`Initialized changeledger/state at ${initialized.head}`),
  );

  const published = execFileSync(process.execPath, [BIN, 'state', 'publish'], {
    cwd: dir,
    env: ENV,
    encoding: 'utf8',
  });
  assert.match(published, new RegExp(`State candidate confirmed at ${initialized.head}`));
  execFileSync(process.execPath, [BIN, 'state', 'activate', '--advisory', 'test'], {
    cwd: dir,
    env: ENV,
  });
  const config = loadConfig(path.join(dir, '.changeledger'));
  assert.equal(config.git.state_branch, 'changeledger/state');
  assert.equal(config.git.state_baseline, initialized.head);
});

test('124231 CR16: activation refreshes and rejects a concurrently advanced remote head', () => {
  const dir = root();
  const initialized = initState({ refs: ['dev'] }, dir, { gitEnv: ENV });
  const bare = publishCandidate(dir);
  const tree = git(dir, ['rev-parse', `${initialized.head}^{tree}`]);
  const advanced = git(dir, [
    'commit-tree',
    tree,
    '-p',
    initialized.head,
    '-m',
    'concurrent remote advance',
  ]);
  git(dir, ['push', '-q', bare, `${advanced}:refs/heads/changeledger/state`]);

  assert.throws(
    () => activateState({ advisoryReason: 'test' }, dir, { gitEnv: ENV }),
    /published and confirmed.*remote head/,
  );
  assert.equal(loadConfig(path.join(dir, '.changeledger')).git.state_branch, undefined);
});

test('124231 CR16: activation refuses a candidate that does not match the working documents', () => {
  const dir = root();
  initState({ refs: ['dev'] }, dir, { gitEnv: ENV });
  publishCandidate(dir);
  fs.appendFileSync(
    path.join(dir, '.changeledger', 'changes', '20260720-120000-state.md'),
    '\nlocal divergence\n',
  );
  assert.throws(
    () => activateState({ advisoryReason: 'temporary server without hooks' }, dir, { gitEnv: ENV }),
    /changed after the state baseline/,
  );
});

test('124231 CR11/CR16: advisory activation validates the complete candidate', () => {
  const dir = root();
  initState({ refs: ['dev'] }, dir, { gitEnv: ENV });
  git(dir, ['switch', '-q', 'changeledger/state']);
  fs.writeFileSync(path.join(dir, 'unexpected.txt'), 'invalid\n');
  git(dir, ['add', 'unexpected.txt']);
  git(dir, ['commit', '-qm', 'invalid candidate']);
  git(dir, ['switch', '-q', 'dev']);
  publishCandidate(dir);

  assert.throws(
    () => activateState({ advisoryReason: 'test' }, dir, { gitEnv: ENV }),
    /outside the state layout/,
  );
  assert.equal(loadConfig(path.join(dir, '.changeledger')).git.state_branch, undefined);
});

test('124231 CR10/CR16: advisory activation requires verifiable baseline origins', () => {
  const dir = root();
  const initialized = initState({ refs: ['dev'] }, dir, { gitEnv: ENV });
  const tree = git(dir, ['rev-parse', `${initialized.head}^{tree}`]);
  const unproven = git(dir, ['commit-tree', tree, '-m', 'baseline without origins']);
  git(dir, ['update-ref', 'refs/heads/changeledger/state', unproven]);
  publishCandidate(dir);

  assert.throws(
    () => activateState({ advisoryReason: 'test' }, dir, { gitEnv: ENV }),
    /baseline.*Change-Origin/,
  );
  assert.equal(loadConfig(path.join(dir, '.changeledger')).git.state_branch, undefined);
});

test('124231 CR10/CR16: advisory activation verifies each baseline origin ref', () => {
  const dir = root();
  const initialized = initState({ refs: ['dev'] }, dir, { gitEnv: ENV });
  const tree = git(dir, ['rev-parse', `${initialized.head}^{tree}`]);
  const message = git(dir, ['show', '-s', '--format=%B', initialized.head]).replace(
    /^Change-Origin: (\S+) \S+ /m,
    'Change-Origin: $1 refs/heads/does-not-exist ',
  );
  const unproven = git(dir, ['commit-tree', tree, '-m', message]);
  git(dir, ['update-ref', 'refs/heads/changeledger/state', unproven]);
  publishCandidate(dir);

  assert.throws(
    () => activateState({ advisoryReason: 'test' }, dir, { gitEnv: ENV }),
    /Change-Origin ref.*does-not-exist/,
  );
});

test('124231 CR10/CR16: advisory activation rejects orphan origin trailers', () => {
  const dir = root();
  const initialized = initState({ refs: ['dev'] }, dir, { gitEnv: ENV });
  const tree = git(dir, ['rev-parse', `${initialized.head}^{tree}`]);
  const dev = git(dir, ['rev-parse', 'dev']);
  const configBlob = git(dir, ['rev-parse', 'dev:.changeledger/config.yml']);
  const message = `${git(dir, ['show', '-s', '--format=%B', initialized.head])}\nChange-Origin: bogus dev ${dev} ${configBlob}`;
  const orphaned = git(dir, ['commit-tree', tree, '-m', message]);
  git(dir, ['update-ref', 'refs/heads/changeledger/state', orphaned]);
  publishCandidate(dir);

  assert.throws(
    () => activateState({ advisoryReason: 'test' }, dir, { gitEnv: ENV }),
    /Change-Origin.*bogus.*does not match a baseline change/,
  );
});

test('124231 CR10/CR16: empty baseline rejects orphan origin trailers', () => {
  const dir = root();
  const changeFile = path.join(dir, '.changeledger', 'changes', '20260720-120000-state.md');
  fs.rmSync(changeFile);
  git(dir, ['add', changeFile]);
  git(dir, ['commit', '-qm', 'remove legacy change']);
  const initialized = initState({ refs: ['dev'] }, dir, { gitEnv: ENV });
  const tree = git(dir, ['rev-parse', `${initialized.head}^{tree}`]);
  const dev = git(dir, ['rev-parse', 'dev']);
  const configBlob = git(dir, ['rev-parse', 'dev:.changeledger/config.yml']);
  const message = `${git(dir, ['show', '-s', '--format=%B', initialized.head])}\nChange-Origin: bogus dev ${dev} ${configBlob}`;
  const orphaned = git(dir, ['commit-tree', tree, '-m', message]);
  git(dir, ['update-ref', 'refs/heads/changeledger/state', orphaned]);
  publishCandidate(dir);

  assert.throws(
    () => activateState({ advisoryReason: 'test' }, dir, { gitEnv: ENV }),
    /Change-Origin.*bogus.*does not match a baseline change/,
  );
});

test('124231 CR10/CR16: activation matches identical changes by Change-Id, not filename', () => {
  const dir = root();
  git(dir, ['branch', 'aaa-copy']);
  git(dir, ['switch', '-q', 'aaa-copy']);
  git(dir, [
    'mv',
    '.changeledger/changes/20260720-120000-state.md',
    '.changeledger/changes/20260720-120000-renamed.md',
  ]);
  git(dir, ['commit', '-qm', 'rename state document']);
  git(dir, ['switch', '-q', 'dev']);

  initState({ refs: ['aaa-copy', 'dev'] }, dir, { gitEnv: ENV });
  publishCandidate(dir);
  assert.doesNotThrow(() => activateState({ advisoryReason: 'test' }, dir, { gitEnv: ENV }));
  assert.equal(
    fs.existsSync(path.join(dir, '.changeledger', 'changes', '20260720-120000-state.md')),
    false,
  );
});

test('124231 CR10/CR16: activation accepts imported changes absent from integration', () => {
  const dir = root();
  git(dir, ['switch', '-qc', 'feature/extra-state']);
  const extra = path.join(dir, '.changeledger', 'changes', '20260720-120001-extra.md');
  fs.writeFileSync(
    extra,
    `---
id: "20260720-120001"
title: Extra
type: feature
status: draft
created: 2026-07-20T12:00:01Z
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
  git(dir, ['add', extra]);
  git(dir, ['commit', '-qm', 'extra state']);
  git(dir, ['switch', '-q', 'dev']);

  initState({ refs: ['dev', 'feature/extra-state'] }, dir, { gitEnv: ENV });
  publishCandidate(dir);
  assert.doesNotThrow(() =>
    activateState({ advisoryReason: 'temporary server without hooks' }, dir, { gitEnv: ENV }),
  );
  assert.equal(readStateStore(dir, 'changeledger/state').changes.length, 2);
  assert.equal(fs.existsSync(extra), false);
});

test('124231 CR18: abort restores legacy files only before state advances', () => {
  const dir = root();
  const initialized = initState({ refs: ['dev'] }, dir, { gitEnv: ENV });
  publishCandidate(dir);
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
  publishCandidate(dir);
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

test('124231 CR18: abort and recovery refresh the remote state head', () => {
  const dir = root();
  const initialized = initState({ refs: ['dev'] }, dir, { gitEnv: ENV });
  publishCandidate(dir);
  activateState({ advisoryReason: 'test' }, dir, { gitEnv: ENV });
  const advanced = mutateStateChange({
    repoRoot: dir,
    branch: 'changeledger/state',
    id: '20260720-120000',
    expectedHead: initialized.head,
    operation: 'note',
    actor: 'ana',
    mutate: (text) => `${text}\nremote advance\n`,
    gitEnv: ENV,
  });
  git(dir, ['update-ref', 'refs/heads/changeledger/state', initialized.head]);
  git(dir, ['update-ref', 'refs/changeledger/confirmed/changeledger/state', initialized.head]);
  git(dir, ['update-ref', 'refs/remotes/origin/changeledger/state', initialized.head]);

  assert.throws(() => abortState(dir, { gitEnv: ENV }), /state has advanced/);
  const recovered = recoverState({ branch: 'changeledger/recovery-remote' }, dir, { gitEnv: ENV });
  assert.equal(recovered.head, advanced.head);
});
