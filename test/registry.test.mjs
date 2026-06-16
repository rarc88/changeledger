import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { init } from '../src/commands/init.mjs';
import { registerRepo } from '../src/commands/register.mjs';
import { loadConfig } from '../src/config.mjs';
import { readRegistry, register, registryPath } from '../src/registry.mjs';

function isolatedHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-home-'));
  process.env.SPEC_LEDGER_HOME = home;
  return home;
}

function newRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-proj-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  return root;
}

test('init gives the repo identity and registers its path', () => {
  isolatedHome();
  const repo = newRepo();
  init(repo);

  const config = loadConfig(path.join(repo, '.sl'));
  assert.match(String(config.project_id), /^[0-9a-f]{10}$/);
  assert.equal(config.project_name, path.basename(repo));

  const reg = readRegistry();
  assert.equal(reg[config.project_id].path, path.resolve(repo));
});

test('register relinks the path for the same project_id without duplicating', () => {
  isolatedHome();
  const repo = newRepo();
  init(repo);
  const id = loadConfig(path.join(repo, '.sl')).project_id;

  // Simulate moving/cloning: copy .sl to a new path, register there.
  const moved = newRepo();
  fs.cpSync(path.join(repo, '.sl'), path.join(moved, '.sl'), { recursive: true });
  registerRepo(moved);

  const reg = readRegistry();
  assert.equal(Object.keys(reg).length, 1);
  assert.equal(reg[id].path, path.resolve(moved));
});

test('init refuses an existing .sl and points to register', () => {
  isolatedHome();
  const repo = newRepo();
  init(repo);
  assert.throws(() => init(repo), /sl register/);
});

test('162027 CR1: corrupt registry JSON fails loudly', () => {
  isolatedHome();
  fs.mkdirSync(path.dirname(registryPath()), { recursive: true });
  fs.writeFileSync(registryPath(), 'not-json');

  assert.throws(() => readRegistry(), /^Error: registry\.json is not valid JSON$/);
});

test('162027 CR2: register does not overwrite a corrupt registry', () => {
  isolatedHome();
  fs.mkdirSync(path.dirname(registryPath()), { recursive: true });
  fs.writeFileSync(registryPath(), 'not-json');

  assert.throws(
    () => register({ id: 'abc', name: 'repo', path: '/tmp/repo' }),
    /^Error: registry\.json is not valid JSON$/,
  );
  assert.equal(fs.readFileSync(registryPath(), 'utf8'), 'not-json');
});

test('162027 CR3: missing registry still starts empty', () => {
  isolatedHome();
  assert.deepEqual(readRegistry(), {});
});
