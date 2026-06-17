import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
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
import { publicDir } from '../src/paths.mjs';
import { loadRepoAsync } from '../src/repo.mjs';

const TOKEN = 'test-token';

// Boots the real request listener on an ephemeral loopback port.
async function startServer(cwd, localOnly = true) {
  const server = http.createServer(createRequestListener(cwd, localOnly, TOKEN));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, port: server.address().port, address: server.address().address };
}

function memoryRequest(
  cwd,
  { method = 'GET', path: p = '/', headers = {}, body, localOnly = true } = {},
) {
  const listener = createRequestListener(cwd, localOnly, TOKEN);
  const req = new EventEmitter();
  req.method = method;
  req.url = p;
  req.headers = { host: '127.0.0.1', ...lowerHeaders(headers) };
  req.destroy = () => {
    req.destroyed = true;
  };
  const res = {
    statusCode: 200,
    headers: {},
    writeHead(code, responseHeaders) {
      this.statusCode = code;
      this.headers = lowerHeaders(responseHeaders);
    },
    end(data = '') {
      resolveResponse({
        status: this.statusCode,
        headers: this.headers,
        body: Buffer.isBuffer(data) ? data.toString('utf8') : String(data),
      });
    },
  };

  let resolveResponse;
  const done = new Promise((resolve) => {
    resolveResponse = resolve;
  });
  listener(req, res);
  queueMicrotask(() => {
    if (body !== undefined && !req.destroyed) req.emit('data', body);
    if (!req.destroyed) req.emit('end');
  });
  return done;
}

function lowerHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
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
  let server;
  let address;
  try {
    ({ server, address } = await startServer(newRepo()));
  } catch (e) {
    if (e.code === 'EPERM' || e.code === 'EACCES') return;
    throw e;
  }
  assert.equal(address, '127.0.0.1');
  server.close();
});

test('CR2: a write without the session token is rejected and writes nothing', async () => {
  isolatedHome();
  const root = newRepo();
  const { file, id, project } = draftChange(root);
  const before = fs.readFileSync(file, 'utf8');

  const res = await memoryRequest(root, {
    method: 'POST',
    path: '/api/status',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, id, status: 'approved' }),
  });
  assert.equal(res.status, 403);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('CR2: a write from a non-local Origin is rejected even with the token', async () => {
  isolatedHome();
  const root = newRepo();
  const { file, id, project } = draftChange(root);
  const before = fs.readFileSync(file, 'utf8');

  const res = await memoryRequest(root, {
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
});

test('CR2: an authorized write succeeds', async () => {
  isolatedHome();
  const root = newRepo();
  const { file, id, project } = draftChange(root);

  const res = await memoryRequest(root, {
    method: 'POST',
    path: '/api/status',
    headers: { 'Content-Type': 'application/json', 'x-sl-token': TOKEN },
    body: JSON.stringify({ project, id, status: 'approved' }),
  });
  assert.equal(res.status, 200);
  assert.equal(parseChange(fs.readFileSync(file, 'utf8')).frontmatter.status, 'approved');
});

test('CR3: a write to an unknown project is a 404, not a fallback', async () => {
  isolatedHome();
  const root = newRepo();
  const { id } = draftChange(root);

  const res = await memoryRequest(root, {
    method: 'POST',
    path: '/api/status',
    headers: { 'Content-Type': 'application/json', 'x-sl-token': TOKEN },
    body: JSON.stringify({ project: 'does-not-exist', id, status: 'approved' }),
  });
  assert.equal(res.status, 404);
});

test('CR4: an oversized body is rejected with 413', async () => {
  isolatedHome();
  const root = newRepo();
  const huge = `{"x":"${'a'.repeat(70 * 1024)}"}`;
  const res = await memoryRequest(root, {
    method: 'POST',
    path: '/api/status',
    headers: { 'Content-Type': 'application/json', 'x-sl-token': TOKEN },
    body: huge,
  });
  assert.equal(res.status, 413);
});

test('CR5: a non-local Host header is rejected and responses carry defensive headers', async () => {
  isolatedHome();
  const root = newRepo();

  const evil = await memoryRequest(root, {
    path: '/api/projects',
    headers: { Host: 'evil.example.com' },
  });
  assert.equal(evil.status, 403);

  const ok = await memoryRequest(root, { path: '/api/projects' });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['x-content-type-options'], 'nosniff');
  assert.equal(ok.headers['x-frame-options'], 'DENY');
});

test('CR2: the served page carries the session token', async () => {
  isolatedHome();
  const res = await memoryRequest(newRepo(), { path: '/' });
  assert.match(res.body, new RegExp(`window.__SL_TOKEN__ = '${TOKEN}'`));
  assert.ok(!res.body.includes('__SL_TOKEN_VALUE__'), 'placeholder fully substituted');
  assert.match(res.body, /"lit-html": "\/vendor\/lit-html\/lit-html\.js"/);
});

test('222618: lit-html vendor modules are served for browser import maps', async () => {
  isolatedHome();
  const root = newRepo();

  const lit = await memoryRequest(root, { path: '/vendor/lit-html/lit-html.js' });
  assert.equal(lit.status, 200);
  assert.match(lit.body, /export\{/);

  const unsafe = await memoryRequest(root, { path: '/vendor/lit-html/directives/unsafe-html.js' });
  assert.equal(unsafe.status, 200);
  assert.match(unsafe.body, /unsafeHTML/);
});

test('151234 CR1: encoded traversal does not read outside public assets', async () => {
  isolatedHome();
  const secret = path.join(publicDir, '..', 'public-sibling-secret.txt');
  fs.writeFileSync(secret, 'outside-public');
  const root = newRepo();
  try {
    const res = await memoryRequest(root, { path: '/..%2Fpublic-sibling-secret.txt' });
    assert.equal(res.status, 404);
    assert.ok(!res.body.includes('outside-public'));
  } finally {
    fs.rmSync(secret, { force: true });
  }
});

test('151234 CR2: sibling paths with a shared prefix are not served', async () => {
  isolatedHome();
  const sibling = path.join(publicDir, '..', 'public-sibling-secret.txt');
  fs.writeFileSync(sibling, 'prefix escape');
  const root = newRepo();
  try {
    const res = await memoryRequest(root, { path: '/../public-sibling-secret.txt' });
    assert.equal(res.status, 404);
    assert.ok(!res.body.includes('prefix escape'));
  } finally {
    fs.rmSync(sibling, { force: true });
  }
});

test('151234 CR3: valid static assets are still served with MIME', async () => {
  isolatedHome();
  const res = await memoryRequest(newRepo(), { path: '/app.js' });
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'text/javascript; charset=utf-8');
  assert.match(res.body, /render/);
});

test('174429: /api/repo returns serialized data through the async loader path', async () => {
  isolatedHome();
  const root = newRepo();
  const file = newChange(
    { type: 'bug', slug: 'async-api', title: 'Async API', now: '2026-06-13T12:00:00Z' },
    root,
  );
  const specsDir = path.join(root, '.sl', 'specs');
  fs.mkdirSync(specsDir, { recursive: true });
  fs.writeFileSync(
    path.join(specsDir, 'viewer.md'),
    `---
title: Viewer
updated: 2026-06-13T12:00:00Z
tags: [viewer]
---

# Viewer

The viewer serializes specs.
`,
  );
  const { id } = parseChange(fs.readFileSync(file, 'utf8')).frontmatter;
  const { current } = resolveProjects(root, true);

  const res = await memoryRequest(root, { path: `/api/repo?project=${current}` });
  const body = JSON.parse(res.body);
  assert.equal(res.status, 200);
  assert.equal(body.changes.length, 1);
  assert.equal(body.changes[0].id, id);
  assert.equal(body.changes[0].title, 'Async API');
  assert.equal(body.specs.length, 1);
  assert.equal(body.specs[0].name, 'viewer.md');
  assert.equal(body.specs[0].title, 'Viewer');
  assert.match(body.specs[0].body, /serializes specs/);
});

test('190009 CR3: getRepo rejects when server returns 404', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  try {
    const { getRepo } = await import('../src/viewer/public/api.js');
    await assert.rejects(() => getRepo('proj'), /HTTP 404/);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('190009 CR3: getRepo rejects when server returns 410', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 410 });
  try {
    const { getRepo } = await import('../src/viewer/public/api.js');
    await assert.rejects(() => getRepo('proj'), /HTTP 410/);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('190005 CR2: loadRepoAsync on a repo with no changes/specs dir returns empty arrays', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-proj-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  init(root);
  // no changes created — changesDir does not exist yet
  const result = await loadRepoAsync(root);
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.specs, []);
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
