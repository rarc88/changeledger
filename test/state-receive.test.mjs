import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { STATE_REF } from '../src/ledger-store.mjs';
import { createStateRepo, git, stateConfig } from './helpers/state-repo.mjs';

const BIN = fileURLToPath(new URL('../bin/changeledger.mjs', import.meta.url));
const PACKAGED_HOOK = fileURLToPath(new URL('../hooks/pre-receive', import.meta.url));
const INTEGRATION_REF = 'refs/heads/dev';

function fixture(objectFormat) {
  const configText = stateConfig().replace(
    'statuses:',
    'git:\n  integration_branch: dev\nstatuses:',
  );
  const created = createStateRepo({ objectFormat, configText });
  const authority = path.join(created.root, '.changeledger', 'authority.yml');
  fs.writeFileSync(
    authority,
    `format_version: 2\nstate_ref: ${STATE_REF}\nbaseline: ${created.baseline}\nproject_id: project-1\ninventory_digest: ${'a'.repeat(64)}\nminimum_client_version: 0.13.0\n`,
  );
  git(created.root, ['add', authority]);
  git(created.root, ['commit', '-qm', 'test: activate v2']);
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-receive-'));
  const init = ['init', '--bare', '-q'];
  if (objectFormat === 'sha256') init.push('--object-format=sha256');
  git(remote, init);
  git(created.root, ['push', '-q', remote, INTEGRATION_REF]);
  git(created.root, ['push', '-q', remote, STATE_REF]);
  const hook = path.join(remote, 'hooks', 'pre-receive');
  fs.copyFileSync(PACKAGED_HOOK, hook);
  fs.chmodSync(hook, 0o755);
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-hook-bin-'));
  const shim = path.join(binDir, 'changeledger');
  fs.writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${BIN}" "$@"\n`);
  fs.chmodSync(shim, 0o755);
  return {
    ...created,
    remote,
    hookEnv: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      CHANGELEDGER_INTEGRATION_REF: INTEGRATION_REF,
    },
  };
}

for (const objectFormat of ['sha1', 'sha256']) {
  test(`193104 CR6/CR9: real pre-receive reads quarantine with ${objectFormat}`, () => {
    let created;
    try {
      created = fixture(objectFormat);
    } catch (error) {
      if (objectFormat === 'sha256' && /unknown|unsupported|sha256/i.test(error.message)) return;
      throw error;
    }
    git(created.root, ['checkout', '-q', 'changeledger/state']);
    const file = path.join(created.state, 'changes', '20260721-000000-change.md');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('title: Demo', 'title: Valid'));
    git(created.root, ['add', file]);
    git(created.root, ['commit', '-qm', 'test: valid state']);
    const valid = spawnSync('git', ['push', created.remote, STATE_REF], {
      cwd: created.root,
      encoding: 'utf8',
      env: created.hookEnv,
    });
    assert.equal(valid.status, 0, valid.stderr);

    fs.writeFileSync(path.join(created.state, 'stray.txt'), 'invalid\n');
    git(created.root, ['add', '.changeledger-state']);
    git(created.root, ['commit', '-qm', 'test: invalid state']);
    const invalid = spawnSync('git', ['push', created.remote, STATE_REF], {
      cwd: created.root,
      encoding: 'utf8',
      env: created.hookEnv,
    });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /invalid state path|pre-receive hook declined/);

    git(created.root, ['checkout', '-q', 'dev']);
    fs.mkdirSync(path.join(created.root, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(created.root, 'src', 'hook-valid.mjs'),
      'export const valid = true;\n',
    );
    git(created.root, ['add', 'src/hook-valid.mjs']);
    git(created.root, ['commit', '-qm', 'test: valid integration']);
    const validIntegration = spawnSync('git', ['push', created.remote, INTEGRATION_REF], {
      cwd: created.root,
      encoding: 'utf8',
      env: created.hookEnv,
    });
    assert.equal(validIntegration.status, 0, validIntegration.stderr);
    fs.appendFileSync(path.join(created.root, '.changeledger', 'config.yml'), '\n# forbidden\n');
    git(created.root, ['add', '.changeledger/config.yml']);
    git(created.root, ['commit', '-qm', 'test: invalid integration']);
    const invalidIntegration = spawnSync('git', ['push', created.remote, INTEGRATION_REF], {
      cwd: created.root,
      encoding: 'utf8',
      env: created.hookEnv,
    });
    assert.notEqual(invalidIntegration.status, 0);
    assert.match(invalidIntegration.stderr, /protected path changed|pre-receive hook declined/);
  });
}

test('193104 CR4/CR9: validation help has no actor, override, probe or provider detection', () => {
  const output = execFileSync(process.execPath, [BIN, 'state', 'validate-receive', '--help'], {
    encoding: 'utf8',
  });
  assert.doesNotMatch(output, /--actor|--human-override|--probe|detect-provider/);
  assert.match(output, /--state-ref/);
  assert.match(output, /--integration-ref/);
});

test('203029 CR1: validation success receipts declare project and repository provenance', () => {
  const created = fixture('sha1');
  const args = [
    BIN,
    'state',
    'validate-update',
    created.baseline,
    created.baseline,
    STATE_REF,
    '--state-ref',
    STATE_REF,
    '--integration-ref',
    INTEGRATION_REF,
  ];
  const human = execFileSync(process.execPath, args, { cwd: created.root, encoding: 'utf8' });
  assert.match(human, /"projectId":"project-1"/);
  assert.match(human, /"repositoryPath":"/);

  const updated = JSON.parse(
    execFileSync(process.execPath, [...args, '--json'], { cwd: created.root, encoding: 'utf8' }),
  );
  assert.equal(updated.project_id, 'project-1');
  assert.ok(updated.repository_path);

  const received = spawnSync(
    process.execPath,
    [
      BIN,
      'state',
      'validate-receive',
      '--state-ref',
      STATE_REF,
      '--integration-ref',
      INTEGRATION_REF,
      '--json',
    ],
    {
      cwd: created.root,
      encoding: 'utf8',
      input: `${created.baseline} ${created.baseline} ${STATE_REF}\n`,
    },
  );
  assert.equal(received.status, 0, received.stderr);
  const receipt = JSON.parse(received.stdout);
  assert.equal(receipt.project_id, 'project-1');
  assert.ok(receipt.repository_path);
  assert.equal(receipt.updates[0].project_id, 'project-1');
});

test('193104 correction CR9: validation receipts expose provider, capabilities and observed budgets', () => {
  const created = fixture('sha1');
  const args = [
    BIN,
    'state',
    'validate-update',
    created.baseline,
    created.baseline,
    STATE_REF,
    '--state-ref',
    STATE_REF,
    '--integration-ref',
    INTEGRATION_REF,
  ];
  const human = execFileSync(process.execPath, args, { cwd: created.root, encoding: 'utf8' });
  assert.match(human, /provider: local-validator/);
  assert.match(human, /"capabilities":/);
  const failed = spawnSync(
    process.execPath,
    [...args.slice(0, 4), 'f'.repeat(40), ...args.slice(5), '--json'],
    {
      cwd: created.root,
      encoding: 'utf8',
    },
  );
  assert.notEqual(failed.status, 0);
  const receipt = JSON.parse(failed.stderr);
  assert.equal(receipt.provider, 'local-validator');
  assert.equal(receipt.commits, 0);
  assert.equal(receipt.object_bytes, 0);
  assert.ok(receipt.capabilities);
  assert.equal(receipt.network, false);
  assert.equal(receipt.written, false);
});
