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
  fs.writeFileSync(
    hook,
    `#!/bin/sh\nexec "${process.execPath}" "${BIN}" state validate-receive --state-ref "${STATE_REF}" --integration-ref "${INTEGRATION_REF}"\n`,
  );
  fs.chmodSync(hook, 0o755);
  return { ...created, remote };
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
    });
    assert.equal(valid.status, 0, valid.stderr);

    fs.writeFileSync(path.join(created.state, 'stray.txt'), 'invalid\n');
    git(created.root, ['add', '.changeledger-state']);
    git(created.root, ['commit', '-qm', 'test: invalid state']);
    const invalid = spawnSync('git', ['push', created.remote, STATE_REF], {
      cwd: created.root,
      encoding: 'utf8',
    });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /invalid state path|pre-receive hook declined/);
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
