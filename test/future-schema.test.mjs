import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { status } from '../src/commands/agent.mjs';
import { init } from '../src/commands/init.mjs';
import { newChange } from '../src/commands/new.mjs';
import { initReleaseHistory } from '../src/commands/release.mjs';

process.env.CHANGELEDGER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-future-home-'));

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-future-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  init(root);
  const change = newChange(
    { type: 'feature', slug: 'future', title: 'Future', now: '2026-07-20T12:00:00Z' },
    root,
  );
  const configFile = path.join(root, '.changeledger', 'config.yml');
  fs.writeFileSync(
    configFile,
    fs.readFileSync(configFile, 'utf8').replace('schema_version: 4', 'schema_version: 5'),
  );
  return { root, change, configFile };
}

test('124231 CR17: future config blocks change, lifecycle and release writes', () => {
  const { root, change, configFile } = repo();
  const changeBefore = fs.readFileSync(change, 'utf8');
  const configBefore = fs.readFileSync(configFile, 'utf8');
  const expected = /schema 5 is newer than supported schema 4.*update ChangeLedger/;

  assert.throws(
    () =>
      newChange(
        { type: 'feature', slug: 'second', title: 'Second', now: '2026-07-20T12:00:01Z' },
        root,
      ),
    expected,
  );
  assert.throws(() => status('20260720-120000', 'approved', root), expected);
  assert.throws(() => initReleaseHistory('1.0.0', root), expected);

  assert.equal(fs.readFileSync(change, 'utf8'), changeBefore);
  assert.equal(fs.readFileSync(configFile, 'utf8'), configBefore);
  assert.equal(fs.existsSync(path.join(root, '.changeledger', 'releases')), false);
});
