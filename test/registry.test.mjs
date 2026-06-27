import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';
import { init } from '../src/commands/init.mjs';
import { registerRepo } from '../src/commands/register.mjs';
import { loadConfig } from '../src/config.mjs';
import { readRegistry, register, registryDir, registryPath } from '../src/registry.mjs';

function isolatedHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  process.env.CHANGELEDGER_HOME = home;
  return home;
}

function newRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-proj-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  return root;
}

test('init gives the repo identity and registers its path', () => {
  isolatedHome();
  const repo = newRepo();
  init(repo);

  const config = loadConfig(path.join(repo, '.changeledger'));
  assert.match(String(config.project_id), /^[0-9a-f]{10}$/);
  assert.equal(config.project_name, path.basename(repo));

  const reg = readRegistry();
  assert.equal(reg[config.project_id].path, path.resolve(repo));
});

test('ChangeLedger migration ignores the retired registry override (CR5)', () => {
  const current = process.env.CHANGELEDGER_HOME;
  const retired = process.env.SPEC_LEDGER_HOME;
  try {
    delete process.env.CHANGELEDGER_HOME;
    process.env.SPEC_LEDGER_HOME = path.join(os.tmpdir(), 'retired-changeledger-home');
    assert.equal(registryDir(), path.join(os.homedir(), '.changeledger'));
  } finally {
    if (current === undefined) delete process.env.CHANGELEDGER_HOME;
    else process.env.CHANGELEDGER_HOME = current;
    if (retired === undefined) delete process.env.SPEC_LEDGER_HOME;
    else process.env.SPEC_LEDGER_HOME = retired;
  }
});

test('register relinks the path for the same project_id without duplicating', () => {
  isolatedHome();
  const repo = newRepo();
  init(repo);
  const id = loadConfig(path.join(repo, '.changeledger')).project_id;

  // Simulate moving/cloning: copy .changeledger to a new path, register there.
  const moved = newRepo();
  fs.cpSync(path.join(repo, '.changeledger'), path.join(moved, '.changeledger'), {
    recursive: true,
  });
  registerRepo(moved);

  const reg = readRegistry();
  assert.equal(Object.keys(reg).length, 1);
  assert.equal(reg[id].path, path.resolve(moved));
});

test('init refuses an existing .changeledger and points to register', () => {
  isolatedHome();
  const repo = newRepo();
  init(repo);
  assert.throws(() => init(repo), /changeledger register/);
});

test('162027 CR1: corrupt registry JSON fails loudly', () => {
  isolatedHome();
  fs.mkdirSync(path.dirname(registryPath()), { recursive: true });
  fs.writeFileSync(registryPath(), 'not-json');

  assert.throws(() => readRegistry(), /^Error: \.registry\.json is not valid JSON$/);
});

test('162027 CR2: register does not overwrite a corrupt registry', () => {
  isolatedHome();
  fs.mkdirSync(path.dirname(registryPath()), { recursive: true });
  fs.writeFileSync(registryPath(), 'not-json');

  assert.throws(
    () => register({ id: 'abc', name: 'repo', path: '/tmp/repo' }),
    /^Error: \.registry\.json is not valid JSON$/,
  );
  assert.equal(fs.readFileSync(registryPath(), 'utf8'), 'not-json');
});

test('162027 CR3: missing registry still starts empty', () => {
  isolatedHome();
  assert.deepEqual(readRegistry(), {});
});

function runWorker(script, workerData) {
  return new Promise((resolve, reject) => {
    const w = new Worker(script, { workerData });
    w.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`worker exited with code ${code}`)),
    );
    w.on('error', reject);
  });
}

test('231423 CR1: concurrent register preserves both entries', async () => {
  isolatedHome();
  const home = process.env.CHANGELEDGER_HOME;
  const registryMjsUrl = new URL('../src/registry.mjs', import.meta.url).href;

  const script = path.join(os.tmpdir(), `changeledger-reg-worker-${process.pid}.mjs`);
  fs.writeFileSync(
    script,
    `import { register } from ${JSON.stringify(registryMjsUrl)};
import { workerData } from 'node:worker_threads';
process.env.CHANGELEDGER_HOME = workerData.home;
register({ id: workerData.id, name: workerData.id, path: '/tmp/' + workerData.id });
`,
  );

  try {
    await Promise.all([
      runWorker(script, { home, id: 'aaa' }),
      runWorker(script, { home, id: 'bbb' }),
    ]);
    const reg = readRegistry();
    assert.ok('aaa' in reg, 'project aaa must be preserved');
    assert.ok('bbb' in reg, 'project bbb must be preserved');
  } finally {
    fs.rmSync(script, { force: true });
  }
});

test('231423 CR2: concurrent remove+register preserves both operations', async () => {
  isolatedHome();
  const home = process.env.CHANGELEDGER_HOME;
  register({ id: 'aaa', name: 'a', path: '/tmp/aaa' });
  register({ id: 'bbb', name: 'b', path: '/tmp/bbb' });

  const registryMjsUrl = new URL('../src/registry.mjs', import.meta.url).href;

  const removeScript = path.join(os.tmpdir(), `changeledger-remove-${process.pid}.mjs`);
  const registerScript = path.join(os.tmpdir(), `changeledger-register-${process.pid}.mjs`);
  fs.writeFileSync(
    removeScript,
    `import { remove } from ${JSON.stringify(registryMjsUrl)};
import { workerData } from 'node:worker_threads';
process.env.CHANGELEDGER_HOME = workerData.home;
remove(workerData.id);
`,
  );
  fs.writeFileSync(
    registerScript,
    `import { register } from ${JSON.stringify(registryMjsUrl)};
import { workerData } from 'node:worker_threads';
process.env.CHANGELEDGER_HOME = workerData.home;
register({ id: workerData.id, name: workerData.id, path: '/tmp/' + workerData.id });
`,
  );

  try {
    await Promise.all([
      runWorker(removeScript, { home, id: 'aaa' }),
      runWorker(registerScript, { home, id: 'ccc' }),
    ]);
    const reg = readRegistry();
    assert.ok(!('aaa' in reg), 'aaa must be removed');
    assert.ok('bbb' in reg, 'bbb must survive');
    assert.ok('ccc' in reg, 'ccc must be registered');
  } finally {
    fs.rmSync(removeScript, { force: true });
    fs.rmSync(registerScript, { force: true });
  }
});

test('231423 CR3: corrupt registry does not get overwritten by register', () => {
  isolatedHome();
  fs.mkdirSync(path.dirname(registryPath()), { recursive: true });
  fs.writeFileSync(registryPath(), 'not-json');

  assert.throws(
    () => register({ id: 'x', name: 'x', path: '/tmp/x' }),
    /^Error: \.registry\.json is not valid JSON$/,
  );
  assert.equal(fs.readFileSync(registryPath(), 'utf8'), 'not-json');
});
