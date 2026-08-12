import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';
import { init } from '../src/commands/init.mjs';
import { registerRepo } from '../src/commands/register.mjs';
import { loadConfig } from '../src/config.mjs';
import {
  listProjects,
  readRegistry,
  register,
  registryDir,
  registryPath,
  remove,
  update,
} from '../src/registry.mjs';
import { ACTIVATION_REF, STATE_REF, writeActivation } from '../src/state-store.mjs';
import { initGitFixture, sanitizedEnv } from './helpers/git-env.mjs';
import { buildTree, buildTreeEntries, commitTree, updateRef } from './helpers/state-repo.mjs';

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

test('20260809-113242 CR5: listProjects uses project_name from an activated state ref', () => {
  isolatedHome();
  const root = newRepo();
  init(root);
  const configFile = path.join(root, '.changeledger', 'config.yml');
  const original = fs.readFileSync(configFile, 'utf8');
  const id = loadConfig(path.join(root, '.changeledger')).project_id;
  fs.writeFileSync(configFile, original.replace(/^project_name:.*$/m, 'project_name: stale-name'));
  initGitFixture(root);
  const tree = buildTree(root, {
    '.changeledger-state/manifest.yml': `format_version: 1\nproject_id: ${id}\n`,
    '.changeledger-state/config.yml': original.replace(
      /^project_name:.*$/m,
      'project_name: ref-name',
    ),
  });
  const revision = commitTree(root, tree);
  updateRef(root, STATE_REF, revision);
  writeActivation(root, { stateRef: STATE_REF });

  assert.equal(listProjects().find((project) => project.id === id).name, 'ref-name');
});

test('20260809-113242 CR12: listProjects fails closed when an activated state ref is missing', () => {
  isolatedHome();
  const root = newRepo();
  init(root);
  const id = loadConfig(path.join(root, '.changeledger')).project_id;
  initGitFixture(root);
  const tree = buildTree(root, {
    '.changeledger-state/manifest.yml': `format_version: 1\nproject_id: ${id}\n`,
    '.changeledger-state/config.yml': `project_id: ${id}\nproject_name: ref-name\n`,
  });
  const revision = commitTree(root, tree);
  updateRef(root, STATE_REF, revision);
  writeActivation(root, { stateRef: STATE_REF });
  execFileSync('git', ['update-ref', '-d', STATE_REF], { cwd: root, env: sanitizedEnv() });

  assert.throws(() => listProjects(), /state is not initialized/);
});

test('20260809-113242 CR12: missing and inactive project paths retain their cached names', () => {
  isolatedHome();
  register({ id: 'missing', name: 'missing-cache', path: '/path/that/does/not/exist' });
  const inactive = newRepo();
  fs.mkdirSync(path.join(inactive, '.changeledger'));
  fs.writeFileSync(path.join(inactive, '.changeledger', 'config.yml'), 'statuses: [\n');
  register({ id: 'inactive', name: 'inactive-cache', path: inactive });

  assert.deepEqual(listProjects(), [
    { id: 'missing', name: 'missing-cache', path: '/path/that/does/not/exist' },
    { id: 'inactive', name: 'inactive-cache', path: inactive },
  ]);
});

test('20260809-113242 CR12 correction: a deleted path below a Git worktree retains its cached name', () => {
  isolatedHome();
  const gitRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-registry-parent-'));
  initGitFixture(gitRoot);
  const deleted = path.join(gitRoot, 'projects', 'deleted');
  fs.mkdirSync(deleted, { recursive: true });
  register({ id: 'deleted', name: 'deleted-cache', path: deleted });
  fs.rmSync(path.join(gitRoot, 'projects'), { recursive: true });

  assert.deepEqual(listProjects(), [{ id: 'deleted', name: 'deleted-cache', path: deleted }]);
});

test('20260809-113242 CR12 correction: a path replaced by a file below a Git worktree retains its cached name', () => {
  isolatedHome();
  const gitRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-registry-file-'));
  initGitFixture(gitRoot);
  const replaced = path.join(gitRoot, 'projects', 'replaced');
  fs.mkdirSync(replaced, { recursive: true });
  register({ id: 'replaced', name: 'replaced-cache', path: replaced });
  fs.rmSync(replaced, { recursive: true });
  fs.writeFileSync(replaced, 'not a directory\n');

  assert.deepEqual(listProjects(), [{ id: 'replaced', name: 'replaced-cache', path: replaced }]);
});

// An unreadable ancestor makes every probe on the entry's path throw EACCES:
// `statSync` first, and `repoIsActivated` right after it. Neither can tell us
// anything about a path we are not allowed to look at, so the entry degrades to
// its cached name instead of taking the whole listing down with it.
test('194234 CR3: an unprobeable path keeps its cached name and the listing completes', () => {
  isolatedHome();
  const locked = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-registry-locked-'));
  const entry = path.join(locked, 'project');
  fs.mkdirSync(entry);
  register({ id: 'locked', name: 'locked-cache', path: entry });
  const readable = newRepo();
  init(readable);
  const readableId = loadConfig(path.join(readable, '.changeledger')).project_id;
  fs.chmodSync(locked, 0o000);

  try {
    assert.deepEqual(listProjects(), [
      { id: 'locked', name: 'locked-cache', path: entry },
      { id: readableId, name: path.basename(readable), path: path.resolve(readable) },
    ]);
  } finally {
    fs.chmodSync(locked, 0o700);
  }
});

// A legacy (pre-anchor) activation is a real, readable Git ref — not an
// unusable registered path — so it must not fall into the same tolerance as
// a missing/locked/replaced path (CR12 and 194234 CR3 below): the entry
// keeps its cached name (the path is still a project) but also reports why
// activation could not be resolved, distinct from an ordinary inactive repo.
test('20260810-180434: listProjects reports an unreadable legacy activation instead of silently listing inactive', () => {
  isolatedHome();
  const root = newRepo();
  init(root);
  const id = loadConfig(path.join(root, '.changeledger')).project_id;
  initGitFixture(root);
  const tree = buildTreeEntries(root, [
    { path: 'authority.yml', text: `format_version: 1\nstate_ref: ${STATE_REF}\n` },
  ]);
  const revision = commitTree(root, tree, { message: 'chore: activation' });
  updateRef(root, ACTIVATION_REF, revision);

  const entry = listProjects().find((project) => project.id === id);
  assert.equal(entry.name, path.basename(root));
  assert.match(entry.activationError, /ledger_dir/);
  assert.match(entry.activationError, /changeledger activate/);
});

test('111218 CR6: update repairs one registered project without replacing siblings', () => {
  isolatedHome();
  register({ id: 'aaa', name: 'alpha', path: '/old/alpha' });
  register({ id: 'bbb', name: 'beta', path: '/repos/beta' });

  update('aaa', { name: 'alpha moved', path: '/repos/alpha' });

  assert.deepEqual(readRegistry(), {
    aaa: { name: 'alpha moved', path: '/repos/alpha' },
    bbb: { name: 'beta', path: '/repos/beta' },
  });
});

test('111218 CR6: update rejects an unknown registry id without creating it', () => {
  isolatedHome();
  register({ id: 'aaa', name: 'alpha', path: '/repos/alpha' });
  assert.throws(() => update('missing', { path: '/tmp/x' }), /no registered project/);
  assert.deepEqual(Object.keys(readRegistry()), ['aaa']);
});

test('161656 CR3: update and remove preserve an entry rebound after its path was observed', () => {
  isolatedHome();
  register({ id: 'aaa', name: 'alpha rebound', path: '/new/alpha' });

  assert.throws(
    () => update('aaa', { path: '/replacement/alpha' }, { expectedPath: '/old/alpha' }),
    /^Error: project registry changed; reload before writing$/,
  );
  assert.deepEqual(readRegistry().aaa, { name: 'alpha rebound', path: '/new/alpha' });

  assert.throws(
    () => remove('aaa', { expectedPath: '/old/alpha' }),
    /^Error: project registry changed; reload before writing$/,
  );
  assert.deepEqual(readRegistry().aaa, { name: 'alpha rebound', path: '/new/alpha' });
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
