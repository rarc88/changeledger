import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parseChange } from '../src/change.mjs';
import { init } from '../src/commands/init.mjs';
import { newChange } from '../src/commands/new.mjs';
import { changeStatus, resolveProjects, searchProjects } from '../src/commands/view.mjs';

function isolatedHome() {
  process.env.SPEC_LEDGER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-home-'));
}

function newRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-proj-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
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

test('searchProjects groups matches and drops projects with none', () => {
  const fakeRepo = (titles) => ({
    changes: titles.map((t, i) => ({
      text: `body ${t}`,
      frontmatter: { id: `2026010${i}-000000`, title: t, type: 'feature', status: 'draft' },
    })),
  });
  const projects = [
    { id: 'a', name: 'A', path: '/a', alive: true },
    { id: 'b', name: 'B', path: '/b', alive: true },
    { id: 'c', name: 'C', path: '/c', alive: false },
  ];
  const load = (p) => fakeRepo(p === '/a' ? ['login flow', 'logout'] : ['unrelated']);
  const groups = searchProjects(projects, 'log', load);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].project.id, 'a');
  assert.equal(groups[0].matches.length, 2);
});

test('searchProjects returns nothing for an empty query', () => {
  assert.deepEqual(
    searchProjects([{ id: 'a', path: '/a', alive: true }], '  ', () => ({})),
    [],
  );
});

test('CR1: changeStatus moves the lifecycle and logs it', () => {
  isolatedHome();
  const root = newRepo();
  const file = newChange(
    { type: 'feature', slug: 'x', title: 'X', now: '2026-06-13T12:00:00Z' },
    root,
  );
  const { id } = parseChange(fs.readFileSync(file, 'utf8')).frontmatter;
  const { projects, current } = resolveProjects(root, false);
  const res = changeStatus(projects, { project: current, id, status: 'approved' });
  assert.equal(res.code, 200);
  assert.equal(parseChange(fs.readFileSync(file, 'utf8')).frontmatter.status, 'approved');
});

test('CR1: changeStatus rejects a non draft→approved move without writing', () => {
  isolatedHome();
  const root = newRepo();
  const file = newChange(
    { type: 'feature', slug: 'x', title: 'X', now: '2026-06-13T12:00:00Z' },
    root,
  );
  const { id } = parseChange(fs.readFileSync(file, 'utf8')).frontmatter;
  const { projects, current } = resolveProjects(root, false);

  // draft → done is the agent's job, not the human's: rejected, no write.
  const before = fs.readFileSync(file, 'utf8');
  const res = changeStatus(projects, { project: current, id, status: 'done' });
  assert.equal(res.code, 403);
  assert.equal(fs.readFileSync(file, 'utf8'), before);

  // and once approved, the viewer cannot push it further.
  changeStatus(projects, { project: current, id, status: 'approved' });
  const res2 = changeStatus(projects, { project: current, id, status: 'in-progress' });
  assert.equal(res2.code, 403);
  assert.equal(parseChange(fs.readFileSync(file, 'utf8')).frontmatter.status, 'approved');
});

test('local mode returns only the current repo', () => {
  isolatedHome();
  newRepo();
  const here = newRepo();
  const { projects } = resolveProjects(here, true);
  assert.equal(projects.length, 1);
  assert.equal(path.resolve(projects[0].path), path.resolve(here));
});
