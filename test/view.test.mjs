import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { init } from '../src/commands/init.mjs';
import { resolveProjects } from '../src/commands/view.mjs';

function isolatedHome() {
  process.env.SPEC_LEDGER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-home-'));
}

function newRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-proj-'));
  init(root);
  return root;
}

test('global mode lists all registered projects', () => {
  isolatedHome();
  newRepo();
  newRepo();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-out-'));
  const { projects, current } = resolveProjects(outside, false);
  assert.equal(projects.length, 2);
  assert.ok(projects.every((p) => p.alive));
  assert.equal(current, null);
});

test('current project is the repo the command runs in', () => {
  isolatedHome();
  newRepo();
  const here = newRepo();
  const { current } = resolveProjects(here, false);
  assert.ok(current);
  assert.equal(
    resolveProjects(here, false).projects.find((p) => p.id === current).path,
    path.resolve(here),
  );
});

test('a project whose path is gone is marked not alive', () => {
  isolatedHome();
  const repo = newRepo();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-out-'));
  fs.rmSync(path.join(repo, '.sl'), { recursive: true, force: true });
  const { projects } = resolveProjects(outside, false);
  assert.equal(projects[0].alive, false);
});

test('local mode returns only the current repo', () => {
  isolatedHome();
  newRepo();
  const here = newRepo();
  const { projects } = resolveProjects(here, true);
  assert.equal(projects.length, 1);
  assert.equal(path.resolve(projects[0].path), path.resolve(here));
});
