// The registry had no seat outside the viewer: when the viewer was unusable the
// only recourse was editing `.registry.json` by hand. These cover the command
// that lists the registry and prunes its confirmed absences, reusing the probe
// and the mutation the viewer already uses.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { init } from '../src/commands/init.mjs';
import { inspectProjects, projectsCommand } from '../src/commands/projects.mjs';
import { loadConfig } from '../src/config.mjs';
import { readRegistry, register, registryPath, writeRegistry } from '../src/registry.mjs';
import { STATE_REF, writeActivation } from '../src/state-store.mjs';
import { initGitFixture, sanitizedEnv } from './helpers/git-env.mjs';
import { buildTree, commitTree, updateRef } from './helpers/state-repo.mjs';

function isolatedHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  process.env.CHANGELEDGER_HOME = home;
  return home;
}

function repoWithConfig(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `changeledger-${label}-`));
  fs.mkdirSync(path.join(root, '.changeledger'), { recursive: true });
  fs.writeFileSync(path.join(root, '.changeledger', 'config.yml'), `project_id: "${label}"\n`);
  return root;
}

function gonePath(label) {
  const dir = path.join(os.tmpdir(), `changeledger-gone-${label}-${process.pid}`);
  fs.rmSync(dir, { recursive: true, force: true });
  return dir;
}

// `alpha` available, `gone` absent, `denied` unreadable through an ancestor
// whose permissions deny the probe.
function mixedRegistry(t) {
  isolatedHome();
  const alpha = repoWithConfig('alpha');
  const gone = gonePath('mixed');
  const deniedParent = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-denied-'));
  const denied = path.join(deniedParent, 'repo');
  fs.mkdirSync(path.join(denied, '.changeledger'), { recursive: true });
  fs.writeFileSync(path.join(denied, '.changeledger', 'config.yml'), 'project_id: "denied"\n');
  fs.chmodSync(deniedParent, 0o000);
  t.after(() => {
    fs.chmodSync(deniedParent, 0o700);
    fs.rmSync(deniedParent, { recursive: true, force: true });
  });
  register({ id: 'alpha', name: 'Alpha', path: alpha });
  register({ id: 'gone', name: 'Gone', path: gone });
  register({ id: 'denied', name: 'Denied', path: denied });
  return { alpha, gone, denied };
}

const byId = (projects) => Object.fromEntries(projects.map((item) => [item.id, item]));

test('the listing names every registered project with its path and health', (t) => {
  const { alpha, gone, denied } = mixedRegistry(t);
  const listed = byId(inspectProjects());

  assert.deepEqual(Object.keys(listed).sort(), ['alpha', 'denied', 'gone']);
  assert.equal(listed.alpha.path, alpha);
  assert.equal(listed.gone.path, gone);
  assert.equal(listed.denied.path, denied);
  assert.equal(listed.alpha.health, 'available');
  assert.equal(listed.gone.health, 'missing');
  assert.equal(listed.denied.health, 'unreadable');
});

test('the cleanup removes only the confirmed absence', (t) => {
  const { alpha, denied } = mixedRegistry(t);
  const result = projectsCommand({ cleanMissing: true });

  assert.deepEqual(result.removedIds, ['gone']);
  assert.equal(result.removed, 1);
  assert.equal(result.skipped, 1);
  const registry = readRegistry();
  assert.equal(registry.gone, undefined);
  assert.equal(registry.alpha.path, alpha);
  assert.equal(registry.denied.path, denied);
});

test('a dry run names the candidates and writes nothing', (t) => {
  mixedRegistry(t);
  const before = fs.readFileSync(registryPath(), 'utf8');
  const result = projectsCommand({ cleanMissing: true, dryRun: true });

  assert.equal(result.dryRun, true);
  assert.deepEqual(
    result.candidates.map((item) => item.id),
    ['gone'],
  );
  assert.equal(result.removed, 0);
  assert.equal(fs.readFileSync(registryPath(), 'utf8'), before);
});

// An activation whose state ref was deleted is what makes `listProjects`
// fail closed, which is the trap this seat must not inherit: a broken repo is
// one of the reasons someone reaches the CLI in the first place.
function activatedWithMissingStateRef() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-broken-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  init(root);
  const id = loadConfig(path.join(root, '.changeledger')).project_id;
  initGitFixture(root);
  const tree = buildTree(root, {
    '.changeledger-state/manifest.yml': `format_version: 1\nproject_id: ${id}\n`,
    '.changeledger-state/config.yml': `project_id: ${id}\nproject_name: ref-name\n`,
  });
  updateRef(root, STATE_REF, commitTree(root, tree));
  writeActivation(root, { stateRef: STATE_REF });
  execFileSync('git', ['update-ref', '-d', STATE_REF], { cwd: root, env: sanitizedEnv() });
  return root;
}

test('an uninspectable project neither blocks the listing nor the cleanup', () => {
  isolatedHome();
  const broken = activatedWithMissingStateRef();
  const gone = gonePath('broken');
  register({ id: 'broken', name: 'Broken', path: broken });
  register({ id: 'gone', name: 'Gone', path: gone });

  const listed = byId(inspectProjects());
  assert.ok(listed.broken, 'the uninspectable project vanished from the listing');
  assert.equal(listed.broken.health, 'unreadable');
  assert.ok(listed.broken.reason, 'the listing gave no reason for the uninspectable project');

  const result = projectsCommand({ cleanMissing: true });
  assert.deepEqual(result.removedIds, ['gone']);
  assert.equal(readRegistry().broken.path, broken);
});

test('a registry too dirty for the viewer is cleaned in one go', () => {
  isolatedHome();
  const alive = repoWithConfig('alive');
  // Seeded in one write: a thousand locked `register` calls would dominate the
  // suite's runtime and prove nothing this test is about.
  const seeded = { alive: { name: 'Alive', path: alive } };
  for (let index = 0; index < 1000; index += 1) {
    seeded[`gone-${index}`] = {
      name: `Gone ${index}`,
      path: path.join(os.tmpdir(), `changeledger-bulk-${process.pid}-${index}`),
    };
  }
  writeRegistry(seeded);

  const result = projectsCommand({ cleanMissing: true });
  assert.equal(result.removed, 1000);
  assert.deepEqual(Object.keys(readRegistry()), ['alive']);
});

test('a dry run without a cleanup is refused instead of ignored', () => {
  isolatedHome();
  assert.throws(
    () => projectsCommand({ dryRun: true }),
    /^Error: --dry-run only applies to --clean-missing$/,
  );
});
