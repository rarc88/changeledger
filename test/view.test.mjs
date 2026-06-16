import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parseChange } from '../src/change.mjs';
import { init } from '../src/commands/init.mjs';
import { newChange } from '../src/commands/new.mjs';
import {
  changeStatus,
  createRequestListener,
  resolveProjects,
  searchProjects,
} from '../src/commands/view.mjs';

const TOKEN = 'test-token';

// Boots the real request listener on an ephemeral loopback port.
async function startServer(cwd, localOnly = true) {
  const server = http.createServer(createRequestListener(cwd, localOnly, TOKEN));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port, address: server.address().address };
}

// http.request gives full header control (Host/Origin are forbidden via fetch).
function request(port, { method = 'GET', path: p = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: p, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => {
        data += c;
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function draftChange(root) {
  const file = newChange(
    { type: 'feature', slug: 'x', title: 'X', now: '2026-06-13T12:00:00Z' },
    root,
  );
  const { id } = parseChange(fs.readFileSync(file, 'utf8')).frontmatter;
  const { current } = resolveProjects(root, true);
  return { file, id, project: current };
}

test('CR1: the server binds to loopback only', async () => {
  isolatedHome();
  const { server, address } = await startServer(newRepo());
  assert.equal(address, '127.0.0.1');
  server.close();
});

test('CR2: a write without the session token is rejected and writes nothing', async () => {
  isolatedHome();
  const root = newRepo();
  const { file, id, project } = draftChange(root);
  const before = fs.readFileSync(file, 'utf8');
  const { server, port } = await startServer(root);

  const res = await request(port, {
    method: 'POST',
    path: '/api/status',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, id, status: 'approved' }),
  });
  assert.equal(res.status, 403);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  server.close();
});

test('CR2: a write from a non-local Origin is rejected even with the token', async () => {
  isolatedHome();
  const root = newRepo();
  const { file, id, project } = draftChange(root);
  const before = fs.readFileSync(file, 'utf8');
  const { server, port } = await startServer(root);

  const res = await request(port, {
    method: 'POST',
    path: '/api/status',
    headers: {
      'Content-Type': 'application/json',
      'x-sl-token': TOKEN,
      Origin: 'http://evil.example.com',
    },
    body: JSON.stringify({ project, id, status: 'approved' }),
  });
  assert.equal(res.status, 403);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  server.close();
});

test('CR2: an authorized write succeeds', async () => {
  isolatedHome();
  const root = newRepo();
  const { file, id, project } = draftChange(root);
  const { server, port } = await startServer(root);

  const res = await request(port, {
    method: 'POST',
    path: '/api/status',
    headers: { 'Content-Type': 'application/json', 'x-sl-token': TOKEN },
    body: JSON.stringify({ project, id, status: 'approved' }),
  });
  assert.equal(res.status, 200);
  assert.equal(parseChange(fs.readFileSync(file, 'utf8')).frontmatter.status, 'approved');
  server.close();
});

test('CR3: a write to an unknown project is a 404, not a fallback', async () => {
  isolatedHome();
  const root = newRepo();
  const { id } = draftChange(root);
  const { server, port } = await startServer(root);

  const res = await request(port, {
    method: 'POST',
    path: '/api/status',
    headers: { 'Content-Type': 'application/json', 'x-sl-token': TOKEN },
    body: JSON.stringify({ project: 'does-not-exist', id, status: 'approved' }),
  });
  assert.equal(res.status, 404);
  server.close();
});

test('CR4: an oversized body is rejected with 413', async () => {
  isolatedHome();
  const { server, port } = await startServer(newRepo());
  const huge = `{"x":"${'a'.repeat(70 * 1024)}"}`;
  const res = await request(port, {
    method: 'POST',
    path: '/api/status',
    headers: { 'Content-Type': 'application/json', 'x-sl-token': TOKEN },
    body: huge,
  });
  assert.equal(res.status, 413);
  server.close();
});

test('CR5: a non-local Host header is rejected and responses carry defensive headers', async () => {
  isolatedHome();
  const { server, port } = await startServer(newRepo());

  const evil = await request(port, {
    path: '/api/projects',
    headers: { Host: 'evil.example.com' },
  });
  assert.equal(evil.status, 403);

  const ok = await request(port, { path: '/api/projects' });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['x-content-type-options'], 'nosniff');
  assert.equal(ok.headers['x-frame-options'], 'DENY');
  server.close();
});

test('CR2: the served page carries the session token', async () => {
  isolatedHome();
  const { server, port } = await startServer(newRepo());
  const res = await request(port, { path: '/' });
  assert.match(res.body, new RegExp(`window.__SL_TOKEN__ = '${TOKEN}'`));
  assert.ok(!res.body.includes('__SL_TOKEN_VALUE__'), 'placeholder fully substituted');
  assert.match(res.body, /"lit-html": "\/vendor\/lit-html\/lit-html\.js"/);
  server.close();
});

test('222618: lit-html vendor modules are served for browser import maps', async () => {
  isolatedHome();
  const { server, port } = await startServer(newRepo());

  const lit = await request(port, { path: '/vendor/lit-html/lit-html.js' });
  assert.equal(lit.status, 200);
  assert.match(lit.body, /export\{/);

  const unsafe = await request(port, { path: '/vendor/lit-html/directives/unsafe-html.js' });
  assert.equal(unsafe.status, 200);
  assert.match(unsafe.body, /unsafeHTML/);
  server.close();
});

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
