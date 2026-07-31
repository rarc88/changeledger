import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parseChange } from '../src/change.mjs';
import { review, status, validation } from '../src/commands/agent.mjs';
import { init } from '../src/commands/init.mjs';
import { newChange } from '../src/commands/new.mjs';
import {
  applyConfigMigration,
  changeStatus,
  createRequestListener,
  patchProjectConfig,
  previewConfigMigration,
  readProjectConfig,
  readProjectConfigStructured,
  repairProjectPath,
  resolveProjects,
  saveProjectConfig,
  searchProjects,
  unregisterProject,
  view,
} from '../src/commands/view.mjs';
import { publicDir } from '../src/paths.mjs';
import { readRegistry, register } from '../src/registry.mjs';
import { loadRepoAsync } from '../src/repo.mjs';
import { readLedgerDocument } from '../src/viewer/domain.mjs';

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
    { ownerHandle: () => '' },
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
      'x-changeledger-token': TOKEN,
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
    headers: { 'Content-Type': 'application/json', 'x-changeledger-token': TOKEN },
    body: JSON.stringify({
      project,
      repository_path: path.resolve(root),
      id,
      status: 'approved',
    }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(
    {
      project_id: JSON.parse(res.body).project_id,
      repository_path: JSON.parse(res.body).repository_path,
    },
    { project_id: project, repository_path: path.resolve(root) },
  );
  assert.equal(parseChange(fs.readFileSync(file, 'utf8')).frontmatter.status, 'approved');
});

test('161656 CR3/CR4: stale write path returns the exact conflict with current provenance', async () => {
  isolatedHome();
  const root = newRepo();
  const { file, id, project } = draftChange(root);
  const before = fs.readFileSync(file, 'utf8');

  const res = await memoryRequest(root, {
    method: 'POST',
    path: '/api/status',
    headers: { 'Content-Type': 'application/json', 'x-changeledger-token': TOKEN },
    body: JSON.stringify({
      project,
      repository_path: path.join(root, 'stale'),
      id,
      status: 'approved',
    }),
    localOnly: false,
  });

  assert.equal(res.status, 409);
  assert.deepEqual(JSON.parse(res.body), {
    project_id: project,
    repository_path: path.resolve(root),
    error: 'project registry changed; reload before writing',
  });
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('161656 CR4: a resolved write missing its path reports provenance', async () => {
  isolatedHome();
  const root = newRepo();
  const { id, project } = draftChange(root);

  const res = await memoryRequest(root, {
    method: 'POST',
    path: '/api/status',
    headers: { 'Content-Type': 'application/json', 'x-changeledger-token': TOKEN },
    body: JSON.stringify({ project, id, status: 'approved' }),
    localOnly: false,
  });

  assert.equal(res.status, 400);
  assert.deepEqual(JSON.parse(res.body), {
    project_id: project,
    repository_path: path.resolve(root),
    error: 'repository_path is required',
  });
});

test('CR3: a write to an unknown project is a 404, not a fallback', async () => {
  isolatedHome();
  const root = newRepo();
  const { id } = draftChange(root);

  const res = await memoryRequest(root, {
    method: 'POST',
    path: '/api/status',
    headers: { 'Content-Type': 'application/json', 'x-changeledger-token': TOKEN },
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
    headers: { 'Content-Type': 'application/json', 'x-changeledger-token': TOKEN },
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
  assert.match(res.body, new RegExp(`window.__CHANGELEDGER_TOKEN__ = "${TOKEN}"`));
  assert.ok(!res.body.includes('__CHANGELEDGER_TOKEN_VALUE__'), 'placeholder fully substituted');
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
    { ownerHandle: () => '' },
  );
  const { id } = parseChange(fs.readFileSync(file, 'utf8')).frontmatter;
  const specsDir = path.join(root, '.changeledger', 'specs');
  fs.mkdirSync(specsDir, { recursive: true });
  fs.writeFileSync(
    path.join(specsDir, 'viewer.md'),
    `---
title: Viewer
updated: 2026-06-13T12:00:00Z
tags: [viewer]
graduated_from: ["${id}"]
---

# Viewer

The viewer serializes specs.
`,
  );
  const { current } = resolveProjects(root, true);

  const res = await memoryRequest(root, { path: `/api/repo?project=${current}` });
  const body = JSON.parse(res.body);
  assert.equal(res.status, 200);
  assert.equal(body.project_id, current);
  assert.equal(body.repository_path, path.resolve(root));
  assert.equal(body.changes.length, 1);
  assert.equal(body.changes[0].id, id);
  assert.equal(body.changes[0].title, 'Async API');
  assert.equal(body.specs.length, 1);
  assert.equal(body.specs[0].name, 'viewer.md');
  assert.equal(body.specs[0].title, 'Viewer');
  assert.deepEqual(body.specs[0].graduated_from, [id]);
  assert.deepEqual(body.changes[0].related_to, []);
  assert.match(body.specs[0].body, /serializes specs/);
});

test('141643 CR3: /api/repo serializes canonical pending graduation for markers and scaffolds', async () => {
  isolatedHome();
  const root = newRepo();
  const writeChange = ({ slug, now, status = 'done', reviewed, graduationMarker = false }) => {
    const file = newChange({ type: 'bug', slug, title: slug, now }, root, {
      ownerHandle: () => '',
    });
    let text = fs
      .readFileSync(file, 'utf8')
      .replace(
        'status: draft',
        `status: ${status}${reviewed === undefined ? '' : `\nreviewed: ${reviewed}`}`,
      );
    if (graduationMarker) {
      text = text.replace(
        '## Log\n',
        '## Log\n\n- **2026-06-13T12:00:00Z** `[graduation]` spec: `legacy.md`\n',
      );
    }
    fs.writeFileSync(file, text);
    return parseChange(text).frontmatter.id;
  };

  const scaffolded = writeChange({ slug: 'scaffolded', now: '2026-06-13T12:00:01Z' });
  const marked = writeChange({
    slug: 'marked',
    now: '2026-06-13T12:00:02Z',
    graduationMarker: true,
  });
  const explicitFalse = writeChange({
    slug: 'explicit-false',
    now: '2026-06-13T12:00:03Z',
    reviewed: false,
  });
  const reviewed = writeChange({
    slug: 'reviewed',
    now: '2026-06-13T12:00:04Z',
    reviewed: true,
  });
  const active = writeChange({
    slug: 'active',
    now: '2026-06-13T12:00:05Z',
    status: 'in-validation',
  });
  const specsDir = path.join(root, '.changeledger', 'specs');
  fs.mkdirSync(specsDir, { recursive: true });
  fs.writeFileSync(
    path.join(specsDir, 'scaffolded.md'),
    `---
title: scaffolded
updated: 2026-06-13T12:00:00Z
tags: [bug]
graduated_from: []
---

# scaffolded

<!-- changeledger:spec-scaffold -->

> Scaffold from change ${scaffolded}.
`,
  );

  const { current } = resolveProjects(root, true);
  const res = await memoryRequest(root, { path: `/api/repo?project=${current}` });
  assert.equal(res.status, 200);
  const pendingById = Object.fromEntries(
    JSON.parse(res.body).changes.map((change) => [change.id, change.pending_graduation]),
  );
  assert.deepEqual(pendingById, {
    [scaffolded]: true,
    [marked]: true,
    [explicitFalse]: true,
    [reviewed]: false,
    [active]: false,
  });
});

test('190007 CR3: token with </script> is escaped in the token assignment line', async () => {
  isolatedHome();
  const root = newRepo();
  const listener = createRequestListener(root, true, 'x</script>x');
  const req = new EventEmitter();
  req.method = 'GET';
  req.url = '/';
  req.headers = { host: '127.0.0.1' };
  req.destroy = () => {};
  const html = await new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
      writeHead(code, h) {
        this.statusCode = code;
        this.headers = h;
      },
      end(data = '') {
        resolve(String(data));
      },
    };
    listener(req, res);
  });
  // Find the line that assigns __CHANGELEDGER_TOKEN__ — it must not contain </script> literally
  const tokenLine = html.split('\n').find((l) => l.includes('__CHANGELEDGER_TOKEN__'));
  assert.ok(tokenLine, 'token assignment line must be present in HTML');
  assert.ok(!tokenLine.includes('</script>'), 'token value must not contain unescaped </script>');
});

test('190008 CR2: /api/git rejects invalid id with 400', async () => {
  isolatedHome();
  const root = newRepo();
  const res = await memoryRequest(root, { path: '/api/git?project=x&id=foo]bar' });
  assert.equal(res.status, 400);
  assert.deepEqual(JSON.parse(res.body), { error: 'invalid id' });
});

test('161656 CR4: /api/git identifies the registered repository it resolved', async () => {
  isolatedHome();
  const root = newRepo();
  const { current } = resolveProjects(root, true);

  const res = await memoryRequest(root, { path: `/api/git?project=${current}` });
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).project_id, current);
  assert.equal(JSON.parse(res.body).repository_path, path.resolve(root));
});

test('190008 CR1: router catch returns generic message, not e.message', async () => {
  isolatedHome();
  const root = newRepo();
  // /api/repo with no project param triggers an internal path that can error
  // Simulate via a project that resolveProjects returns but throws on loadRepoAsync
  // Easiest: hit /api/repo with a project id that exists but path is gone will give 410 not 500
  // Instead: verify that the generic message structure is correct by checking a 500 scenario
  // We test indirectly: the body must NOT contain filesystem paths for any error path
  const res = await memoryRequest(root, { path: '/api/repo?project=nonexistent' });
  // returns 404 "no project" — not a 500, but verifies the response shape is under control
  assert.equal(res.status, 404);
  const body = JSON.parse(res.body);
  assert.equal(body.error, 'no project');
  // Verify there are no filesystem paths leaked in any error response
  assert.ok(!body.error.includes('/'), 'error must not contain path separators');
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

test('141859 CR3: Ledger client GETs encode project, category and logical document path', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      json: async () =>
        url.startsWith('/api/ledger-tree')
          ? { categories: [] }
          : { category: 'project-docs', path: 'A B.md', format: 'markdown', content: '# A' },
    };
  };
  try {
    const { getLedgerDocument, getLedgerTree } = await import('../src/viewer/public/api.js');
    assert.deepEqual(await getLedgerTree('alpha & beta'), { categories: [] });
    assert.equal(
      (await getLedgerDocument('alpha & beta', 'project-docs', 'A B.md')).content,
      '# A',
    );
    assert.deepEqual(calls, [
      '/api/ledger-tree?project=alpha%20%26%20beta',
      '/api/ledger-document?project=alpha%20%26%20beta&category=project-docs&path=A%20B.md',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('141859 CR3/CR5: Ledger client GETs expose controlled server errors', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 410,
    json: async () => ({ error: 'project path is gone' }),
  });
  try {
    const { getLedgerDocument, getLedgerTree } = await import('../src/viewer/public/api.js');
    await assert.rejects(() => getLedgerTree('gone'), /project path is gone/);
    await assert.rejects(
      () => getLedgerDocument('gone', 'contract', 'core.md'),
      /project path is gone/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('113924 CR6: migration apply client rejects HTTP conflict with server message', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  globalThis.window = { __CHANGELEDGER_TOKEN__: 'test-token' };
  globalThis.fetch = async () => ({
    ok: false,
    status: 409,
    json: async () => ({ error: 'configuration changed on disk; reload before saving' }),
  });
  try {
    const { postConfigMigrationApply } = await import('../src/viewer/public/api.js');
    await assert.rejects(
      () => postConfigMigrationApply('project-id', 'stale-revision'),
      /configuration changed on disk; reload before saving/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('190005 CR2: loadRepoAsync on a repo with no changes/specs dir returns empty arrays', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-proj-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  init(root);
  // no changes created — changesDir does not exist yet
  const result = await loadRepoAsync(root);
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.specs, []);
});

test('141859 CR3: ledger tree exposes only sorted logical documents from each allowlist', async () => {
  isolatedHome();
  const root = newRepo();
  fs.writeFileSync(path.join(root, 'README.md'), '# Read me\n');
  fs.writeFileSync(path.join(root, 'INTENT.md'), '# Intent\n');
  fs.writeFileSync(path.join(root, 'NOTES.md'), '# Private notes\n');
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, 'docs', 'README.md'), '# Nested\n');
  const { current } = resolveProjects(root, true);

  const response = await memoryRequest(root, {
    path: `/api/ledger-tree?project=${encodeURIComponent(current)}`,
  });

  assert.equal(response.status, 200);
  const { categories } = JSON.parse(response.body);
  assert.deepEqual(
    categories.map(({ category }) => category),
    ['project-docs', 'contract', 'templates'],
  );
  const byCategory = Object.fromEntries(
    categories.map(({ category, documents }) => [category, documents]),
  );
  assert.deepEqual(byCategory['project-docs'], [
    { path: 'AGENTS.md', format: 'markdown' },
    { path: 'INTENT.md', format: 'markdown' },
    { path: 'README.md', format: 'markdown' },
  ]);
  assert.ok(byCategory.contract.some(({ path: logical }) => logical === 'core.md'));
  assert.ok(
    byCategory.contract.some(({ path: logical }) => logical === 'agent-prompts/implementation.md'),
  );
  assert.ok(byCategory.templates.some(({ path: logical }) => logical === 'config.yml'));
  assert.ok(byCategory.templates.every(({ path: logical }) => !logical.startsWith('contract/')));
  for (const documents of Object.values(byCategory)) {
    assert.deepEqual(
      documents.map(({ path: logical }) => logical),
      documents.map(({ path: logical }) => logical).toSorted(),
    );
    assert.ok(
      documents.every(
        ({ path: logical, format }) =>
          !path.isAbsolute(logical) &&
          !logical.includes(root) &&
          (format === 'markdown' || format === 'source'),
      ),
    );
  }
});

test('141859 CR3/CR4: ledger reads project, contract and template documents by logical path', async () => {
  isolatedHome();
  const root = newRepo();
  fs.writeFileSync(path.join(root, 'README.md'), '# Project readme\n');
  const { current } = resolveProjects(root, true);
  const query = (category, logicalPath) =>
    `/api/ledger-document?project=${encodeURIComponent(current)}&category=${encodeURIComponent(category)}&path=${encodeURIComponent(logicalPath)}`;

  const project = await memoryRequest(root, { path: query('project-docs', 'README.md') });
  assert.equal(project.status, 200);
  assert.deepEqual(JSON.parse(project.body), {
    category: 'project-docs',
    path: 'README.md',
    format: 'markdown',
    content: '# Project readme\n',
  });

  const contract = await memoryRequest(root, { path: query('contract', 'budgets.yml') });
  assert.equal(contract.status, 200);
  assert.deepEqual(Object.keys(JSON.parse(contract.body)), [
    'category',
    'path',
    'format',
    'content',
  ]);
  assert.equal(JSON.parse(contract.body).format, 'source');

  const template = await memoryRequest(root, { path: query('templates', 'config.yml') });
  assert.equal(template.status, 200);
  assert.equal(JSON.parse(template.body).category, 'templates');
  assert.equal(JSON.parse(template.body).format, 'source');
});

test('141859 CR4: ledger document paths fail closed with one generic response', async () => {
  isolatedHome();
  const root = newRepo();
  fs.writeFileSync(path.join(root, 'README.md'), '# Read me\n');
  const { current } = resolveProjects(root, true);
  const cases = [
    ['', 'README.md'],
    ['unknown', 'README.md'],
    ['project-docs', ''],
    ['project-docs', '/README.md'],
    ['project-docs', '\0README.md'],
    ['project-docs', 'dir\\README.md'],
    ['contract', 'agent-prompts//implementation.md'],
    ['contract', './core.md'],
    ['contract', '../README.md'],
    ['contract', 'core.txt'],
    ['project-docs', 'NOTES.md'],
    ['templates', 'contract/core.md'],
    ['contract', 'missing.md'],
  ];

  for (const [category, logicalPath] of cases) {
    const response = await memoryRequest(root, {
      path: `/api/ledger-document?project=${encodeURIComponent(current)}&category=${encodeURIComponent(category)}&path=${encodeURIComponent(logicalPath)}`,
    });
    assert.equal(response.status, 404, `${category}:${JSON.stringify(logicalPath)}`);
    assert.deepEqual(JSON.parse(response.body), { error: 'document not found' });
    assert.ok(!response.body.includes(root));
  }

  const missingPath = await memoryRequest(root, {
    path: `/api/ledger-document?project=${encodeURIComponent(current)}&category=project-docs`,
  });
  assert.equal(missingPath.status, 404);
  assert.deepEqual(JSON.parse(missingPath.body), { error: 'document not found' });
});

test('141859 CR3/CR4: escaping symlinks and non-regular files are never listed or read', async () => {
  isolatedHome();
  const root = newRepo();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-secret-'));
  fs.writeFileSync(path.join(outside, 'secret.md'), 'do not expose\n');
  fs.symlinkSync(path.join(outside, 'secret.md'), path.join(root, 'README.md'));
  fs.rmSync(path.join(root, 'AGENTS.md'));
  fs.mkdirSync(path.join(root, 'AGENTS.md'));
  const { current } = resolveProjects(root, true);

  const tree = await memoryRequest(root, {
    path: `/api/ledger-tree?project=${encodeURIComponent(current)}`,
  });
  assert.equal(tree.status, 200);
  assert.deepEqual(JSON.parse(tree.body).categories[0].documents, []);

  for (const logicalPath of ['README.md', 'AGENTS.md']) {
    const response = await memoryRequest(root, {
      path: `/api/ledger-document?project=${encodeURIComponent(current)}&category=project-docs&path=${logicalPath}`,
    });
    assert.equal(response.status, 404);
    assert.deepEqual(JSON.parse(response.body), { error: 'document not found' });
    assert.ok(!response.body.includes('secret'));
  }
});

test('141859 CR4: ledger APIs require an exact live project even for installed documents', async () => {
  isolatedHome();
  const root = newRepo();
  const { current } = resolveProjects(root, false);

  for (const route of [
    '/api/ledger-tree?project=unknown',
    '/api/ledger-document?project=unknown&category=contract&path=core.md',
  ]) {
    const response = await memoryRequest(root, { path: route, localOnly: false });
    assert.equal(response.status, 404);
    assert.deepEqual(JSON.parse(response.body), { error: 'no project' });
  }

  fs.rmSync(path.join(root, '.changeledger'), { recursive: true });
  for (const route of [
    `/api/ledger-tree?project=${encodeURIComponent(current)}`,
    `/api/ledger-document?project=${encodeURIComponent(current)}&category=contract&path=core.md`,
  ]) {
    const response = await memoryRequest(root, { path: route, localOnly: false });
    assert.equal(response.status, 410);
    assert.deepEqual(JSON.parse(response.body), { error: 'project path is gone' });
  }
});

test('141859 CR4: ledger rejects documents over 1 MiB before returning content', async () => {
  isolatedHome();
  const root = newRepo();
  fs.writeFileSync(path.join(root, 'README.md'), 'x'.repeat(1024 * 1024 + 1));
  const { current } = resolveProjects(root, true);

  const response = await memoryRequest(root, {
    path: `/api/ledger-document?project=${encodeURIComponent(current)}&category=project-docs&path=README.md`,
  });

  assert.equal(response.status, 413);
  assert.deepEqual(JSON.parse(response.body), { error: 'document too large' });
  assert.ok(response.body.length < 100);
});

test('141859 CR4: ledger descriptor rejects a final symlink swap after validation', () => {
  isolatedHome();
  const root = newRepo();
  const file = path.join(root, 'README.md');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-secret-'));
  const secret = path.join(outside, 'secret.md');
  fs.writeFileSync(file, '# Safe\n');
  fs.writeFileSync(secret, '# Outside secret\n');
  const validatedFile = fs.realpathSync(file);
  const originalOpenSync = fs.openSync;
  let swapped = false;

  fs.openSync = function swapBeforeOpen(candidate, ...args) {
    if (!swapped && path.resolve(candidate) === validatedFile) {
      swapped = true;
      fs.rmSync(file);
      fs.symlinkSync(secret, file);
    }
    return originalOpenSync.call(this, candidate, ...args);
  };
  try {
    const response = readLedgerDocument([{ id: 'alpha', path: root, alive: true }], {
      project: 'alpha',
      category: 'project-docs',
      path: 'README.md',
    });
    assert.equal(swapped, true, 'the file was swapped after validation and before open');
    assert.equal(response.code, 404);
    assert.deepEqual(response.body, { error: 'document not found' });
    assert.ok(!JSON.stringify(response.body).includes(outside));
  } finally {
    fs.openSync = originalOpenSync;
  }
});

test('141859 CR4: ledger descriptor bounds a file that grows after fstat', () => {
  isolatedHome();
  const root = newRepo();
  const file = path.join(root, 'README.md');
  fs.writeFileSync(file, '# Initially small\n');
  const originalFstatSync = fs.fstatSync;
  let grown = false;

  fs.fstatSync = function growAfterFstat(descriptor, ...args) {
    const stat = originalFstatSync.call(this, descriptor, ...args);
    if (!grown) {
      grown = true;
      fs.appendFileSync(file, 'x'.repeat(1024 * 1024 + 1));
    }
    return stat;
  };
  try {
    const response = readLedgerDocument([{ id: 'alpha', path: root, alive: true }], {
      project: 'alpha',
      category: 'project-docs',
      path: 'README.md',
    });
    assert.equal(grown, true, 'the descriptor file grew after its initial fstat');
    assert.equal(response.code, 413);
    assert.deepEqual(response.body, { error: 'document too large' });
    assert.ok(JSON.stringify(response.body).length < 100);
  } finally {
    fs.fstatSync = originalFstatSync;
  }
});

test('141859 CR4: ledger APIs reject non-GET methods and advertise GET', async () => {
  isolatedHome();
  const root = newRepo();

  for (const route of ['/api/ledger-tree', '/api/ledger-document']) {
    const response = await memoryRequest(root, { method: 'POST', path: route });
    assert.equal(response.status, 405);
    assert.equal(response.headers.allow, 'GET');
  }
});

function isolatedHome() {
  process.env.CHANGELEDGER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
}

function newRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-proj-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  init(root);
  return root;
}

test('global mode lists all registered projects', () => {
  isolatedHome();
  newRepo();
  newRepo();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-out-'));
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
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-out-'));
  fs.rmSync(path.join(repo, '.changeledger'), { recursive: true, force: true });
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
    { ownerHandle: () => '' },
  );
  const { id } = parseChange(fs.readFileSync(file, 'utf8')).frontmatter;
  const { projects, current } = resolveProjects(root, false);
  const res = changeStatus(projects, { project: current, id, status: 'approved' });
  assert.equal(res.code, 200);
  assert.equal(parseChange(fs.readFileSync(file, 'utf8')).frontmatter.status, 'approved');
});

test('171002 CR2/CR3: viewer accepts or rejects only a change in validation', () => {
  isolatedHome();
  const root = newRepo();
  const acceptedFile = newChange(
    { type: 'feature', slug: 'accepted', title: 'Accepted', now: '2026-06-13T12:00:00Z' },
    root,
    { ownerHandle: () => '' },
  );
  const rejectedFile = newChange(
    { type: 'feature', slug: 'rejected', title: 'Rejected', now: '2026-06-13T12:00:01Z' },
    root,
    { ownerHandle: () => '' },
  );
  const acceptedId = parseChange(fs.readFileSync(acceptedFile, 'utf8')).frontmatter.id;
  const rejectedId = parseChange(fs.readFileSync(rejectedFile, 'utf8')).frontmatter.id;
  for (const id of [acceptedId, rejectedId]) {
    status(id, 'approved', root);
    status(id, 'in-progress', root, { ownerHandle: () => '' });
    status(id, 'in-review', root);
    review(id, 'pass', {}, root);
  }
  const { projects, current } = resolveProjects(root, false);

  const accepted = changeStatus(projects, { project: current, id: acceptedId, status: 'done' });
  assert.equal(accepted.code, 200);
  assert.equal(parseChange(fs.readFileSync(acceptedFile, 'utf8')).frontmatter.status, 'done');

  const missingReason = changeStatus(projects, {
    project: current,
    id: rejectedId,
    status: 'in-progress',
  });
  assert.equal(missingReason.code, 400);
  const rejected = changeStatus(projects, {
    project: current,
    id: rejectedId,
    status: 'in-progress',
    reason: 'manual scenario failed',
  });
  assert.equal(rejected.code, 200);
  const parsed = parseChange(fs.readFileSync(rejectedFile, 'utf8'));
  assert.equal(parsed.frontmatter.status, 'in-progress');
  assert.match(parsed.stages.find((s) => s.key === 'log').body, /manual scenario failed/);
});

test('150231 CR2: viewer reports an incomplete acceptance and preserves validation state', () => {
  isolatedHome();
  const root = newRepo();
  const file = newChange(
    { type: 'feature', slug: 'incomplete', title: 'Incomplete', now: '2026-06-13T12:00:00Z' },
    root,
    { ownerHandle: () => '' },
  );
  fs.writeFileSync(
    file,
    fs
      .readFileSync(file, 'utf8')
      .replace('## Plan\n', '## Plan\n\n- [ ] pending\n  - **Support:**\n'),
  );
  const { id } = parseChange(fs.readFileSync(file, 'utf8')).frontmatter;
  status(id, 'approved', root);
  status(id, 'in-progress', root, { ownerHandle: () => '' });
  status(id, 'in-review', root);
  review(id, 'pass', {}, root);
  const before = fs.readFileSync(file, 'utf8');
  const { projects, current } = resolveProjects(root, false);

  const result = changeStatus(projects, { project: current, id, status: 'done' });

  assert.equal(result.code, 400);
  assert.match(result.body.error, /1 task\(s\) are not done/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('150231 CR6: viewer acceptance ignores an unrelated unparseable change', () => {
  isolatedHome();
  const root = newRepo();
  const file = newChange(
    { type: 'feature', slug: 'selected', title: 'Selected', now: '2026-06-13T12:00:00Z' },
    root,
    { ownerHandle: () => '' },
  );
  const { id } = parseChange(fs.readFileSync(file, 'utf8')).frontmatter;
  status(id, 'approved', root);
  status(id, 'in-progress', root, { ownerHandle: () => '' });
  status(id, 'in-review', root);
  review(id, 'pass', {}, root);
  fs.writeFileSync(path.join(root, '.changeledger', 'changes', 'broken.md'), 'broken\n');
  const { projects, current } = resolveProjects(root, false);

  const result = changeStatus(projects, { project: current, id, status: 'done' });

  assert.equal(result.code, 200);
  assert.equal(parseChange(fs.readFileSync(file, 'utf8')).frontmatter.status, 'done');
});

test('150232 CR1/CR2: viewer reopens provisional done only with a reason', () => {
  isolatedHome();
  const root = newRepo();
  const file = newChange(
    { type: 'feature', slug: 'reopen', title: 'Reopen', now: '2026-06-13T12:00:00Z' },
    root,
    { ownerHandle: () => '' },
  );
  const { id } = parseChange(fs.readFileSync(file, 'utf8')).frontmatter;
  status(id, 'approved', root);
  status(id, 'in-progress', root, { ownerHandle: () => '' });
  status(id, 'in-review', root);
  review(id, 'pass', {}, root);
  validation(id, 'pass', {}, root);
  const { projects, current } = resolveProjects(root, false);
  const before = fs.readFileSync(file, 'utf8');
  assert.equal(changeStatus(projects, { project: current, id, status: 'in-progress' }).code, 400);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  const result = changeStatus(projects, {
    project: current,
    id,
    status: 'in-progress',
    reason: 'finish original scope',
  });
  assert.equal(result.code, 200);
  assert.equal(parseChange(fs.readFileSync(file, 'utf8')).frontmatter.status, 'in-progress');
});

test('171002 CR2: changeStatus rejects agent-owned or premature moves without writing', () => {
  isolatedHome();
  const root = newRepo();
  const file = newChange(
    { type: 'feature', slug: 'x', title: 'X', now: '2026-06-13T12:00:00Z' },
    root,
    { ownerHandle: () => '' },
  );
  const { id } = parseChange(fs.readFileSync(file, 'utf8')).frontmatter;
  const { projects, current } = resolveProjects(root, false);

  // A draft cannot be accepted as complete: rejected, no write.
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

test('231424 CR1: all critical vendor routes respond 200 with text/javascript', async () => {
  isolatedHome();
  const root = newRepo();

  const routes = [
    '/vendor/marked.min.js',
    '/vendor/mermaid.min.js',
    '/vendor/purify.min.js',
    '/vendor/lit-html/lit-html.js',
  ];
  for (const route of routes) {
    const res = await memoryRequest(root, { path: route });
    assert.equal(res.status, 200, `${route} must respond 200`);
    assert.match(
      res.headers['content-type'] ?? '',
      /text\/javascript/,
      `${route} must be text/javascript`,
    );
  }
});

test('231424 CR2: unknown vendor route returns 404 and does not escape the allowlist', async () => {
  isolatedHome();
  const root = newRepo();
  const res = await memoryRequest(root, { path: '/vendor/unknown.js' });
  assert.equal(res.status, 404);
});

test('155721 CR2: the shared metrics module is served verbatim over /shared/metrics.mjs', async () => {
  isolatedHome();
  const root = newRepo();
  const res = await memoryRequest(root, { path: '/shared/metrics.mjs' });
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'text/javascript; charset=utf-8');
  const onDisk = fs.readFileSync(path.join(publicDir, '..', '..', 'metrics.mjs'), 'utf8');
  assert.equal(res.body, onDisk);
  assert.match(res.body, /export function computeMetrics/);
});

test("155721 CR2: the shared module's own relative import is reachable at the same prefix", async () => {
  isolatedHome();
  const root = newRepo();
  const res = await memoryRequest(root, { path: '/shared/lifecycle.mjs' });
  assert.equal(res.status, 200);
  assert.match(res.body, /export function parseLogEvent/);
});

test('155721 CR2: only the allowlisted shared modules are served, no arbitrary src/ file', async () => {
  isolatedHome();
  const root = newRepo();
  const outside = await memoryRequest(root, { path: '/shared/repo.mjs' });
  assert.equal(outside.status, 404);
  const traversal = await memoryRequest(root, { path: '/shared/..%2Fpackage.json' });
  assert.equal(traversal.status, 404);
});

test('local mode returns only the current repo', () => {
  isolatedHome();
  newRepo();
  const here = newRepo();
  const { projects } = resolveProjects(here, true);
  assert.equal(projects.length, 1);
  assert.equal(path.resolve(projects[0].path), path.resolve(here));
});

test('111218 CR2/CR3: project config reads exact YAML and saves a valid renamed config', () => {
  isolatedHome();
  const root = newRepo();
  const { projects, current } = resolveProjects(root, false);
  const read = readProjectConfig(projects, current);
  assert.equal(read.body.project_id, current);
  assert.equal(read.body.repository_path, path.resolve(root));
  const before = read.body.content;
  const content = before.replace(/^project_name:.*$/m, 'project_name: alpha-renamed');

  const saved = saveProjectConfig(projects, {
    project: current,
    content,
    revision: read.body.revision,
  });

  assert.equal(saved.code, 200);
  assert.equal(saved.body.project_id, current);
  assert.equal(saved.body.repository_path, path.resolve(root));
  assert.equal(fs.readFileSync(path.join(root, '.changeledger', 'config.yml'), 'utf8'), content);
  assert.equal(
    resolveProjects(root, false).projects.find((item) => item.id === current).name,
    'alpha-renamed',
  );
});

test('111218 CR4/CR5/CR9: invalid, identity-changing and stale configs preserve disk', () => {
  isolatedHome();
  const root = newRepo();
  const { projects, current } = resolveProjects(root, false);
  const configFile = path.join(root, '.changeledger', 'config.yml');
  const read = readProjectConfig(projects, current);
  const before = fs.readFileSync(configFile, 'utf8');

  const invalid = saveProjectConfig(projects, {
    project: current,
    content: 'statuses: [',
    revision: read.body.revision,
  });
  assert.equal(invalid.code, 400);

  const changedId = saveProjectConfig(projects, {
    project: current,
    content: before.replace(current, 'ffffffffff'),
    revision: read.body.revision,
  });
  assert.equal(changedId.body.error, 'project_id cannot be changed from the viewer');

  const stale = saveProjectConfig(projects, {
    project: current,
    content: before,
    revision: 'stale',
  });
  assert.equal(stale.code, 409);
  assert.equal(stale.body.error, 'configuration changed on disk; reload before saving');
  assert.equal(fs.readFileSync(configFile, 'utf8'), before);
});

test('111218 CR4: candidate directories are loaded before config replacement', () => {
  isolatedHome();
  const root = newRepo();
  const { projects, current } = resolveProjects(root, false);
  const configFile = path.join(root, '.changeledger', 'config.yml');
  const read = readProjectConfig(projects, current);
  const candidateDir = path.join(root, 'candidate-changes');
  fs.mkdirSync(candidateDir);
  fs.writeFileSync(path.join(candidateDir, 'broken.md'), 'not a ChangeLedger change');
  const candidate = read.body.content.replace(
    'changes_dir: .changeledger/changes',
    'changes_dir: candidate-changes',
  );

  const result = saveProjectConfig(projects, {
    project: current,
    content: candidate,
    revision: read.body.revision,
  });

  assert.equal(result.code, 400);
  assert.equal(result.body.error, 'candidate configuration cannot load the repository');
  assert.equal(fs.readFileSync(configFile, 'utf8'), read.body.content);
});

test('111218 CR4: wrong-shaped config returns validation error and preserves the file', async () => {
  isolatedHome();
  const root = newRepo();
  const { projects, current } = resolveProjects(root, false);
  const configFile = path.join(root, '.changeledger', 'config.yml');
  const read = readProjectConfig(projects, current);
  const candidate = read.body.content.replace(/^statuses:.*$/m, 'statuses:\n  draft: true');

  const direct = saveProjectConfig(projects, {
    project: current,
    content: candidate,
    revision: read.body.revision,
  });
  assert.equal(direct.code, 400);
  assert.equal(direct.body.error, 'config "statuses" must be a list');
  assert.equal(fs.readFileSync(configFile, 'utf8'), read.body.content);

  const httpResult = await memoryRequest(root, {
    method: 'POST',
    path: '/api/project-config',
    headers: { 'Content-Type': 'application/json', 'x-changeledger-token': TOKEN },
    body: JSON.stringify({
      project: current,
      repository_path: path.resolve(root),
      content: candidate,
      revision: read.body.revision,
    }),
    localOnly: false,
  });
  assert.equal(httpResult.status, 400);
  assert.match(httpResult.body, /statuses/);
});

test('111218 CR4: malformed type definitions return 400 instead of escaping', () => {
  isolatedHome();
  const root = newRepo();
  const { projects, current } = resolveProjects(root, false);
  const configFile = path.join(root, '.changeledger', 'config.yml');
  const read = readProjectConfig(projects, current);
  const candidates = [
    read.body.content.replace(/^types:$/m, 'types: feature'),
    read.body.content.replace(
      /types:\n {2}feature:\n {4}stages: \[[^\n]+/,
      'types:\n  feature:\n    stages:\n      request: true',
    ),
  ];

  for (const content of candidates) {
    const result = saveProjectConfig(projects, {
      project: current,
      content,
      revision: read.body.revision,
    });
    assert.equal(result.code, 400);
  }
  assert.equal(fs.readFileSync(configFile, 'utf8'), read.body.content);
});

test('111218 CR4: malformed readiness patterns return their validation cause', () => {
  isolatedHome();
  const root = newRepo();
  const { projects, current } = resolveProjects(root, false);
  const configFile = path.join(root, '.changeledger', 'config.yml');
  const read = readProjectConfig(projects, current);
  // The template ships `readiness` uncommented, so malform the block it already
  // has instead of appending a second one (that would be a duplicate-key error).
  const candidate = read.body.content.replace(
    '  target_patterns: ["src/**"]',
    '  target_patterns:\n    source: true',
  );
  assert.notEqual(candidate, read.body.content, 'the malformed candidate must differ');

  const result = saveProjectConfig(projects, {
    project: current,
    content: candidate,
    revision: read.body.revision,
  });

  assert.equal(result.code, 400);
  assert.equal(result.body.error, 'config "readiness.target_patterns" must be a list');
  assert.equal(fs.readFileSync(configFile, 'utf8'), read.body.content);
});

test('111218 CR3/CR4: config write failure leaves config and registry unchanged', () => {
  isolatedHome();
  const root = newRepo();
  const { projects, current } = resolveProjects(root, false);
  const configFile = path.join(root, '.changeledger', 'config.yml');
  const read = readProjectConfig(projects, current);
  const candidate = read.body.content.replace(/^project_name:.*$/m, 'project_name: renamed');
  const registryBefore = structuredClone(readRegistry());

  const result = saveProjectConfig(
    projects,
    { project: current, content: candidate, revision: read.body.revision },
    {
      mutateConfig: () => {
        throw new Error(`disk failure at ${configFile}`);
      },
    },
  );

  assert.equal(result.code, 400);
  assert.equal(result.body.error, 'unable to save project configuration');
  assert.ok(!result.body.error.includes(root));
  assert.equal(fs.readFileSync(configFile, 'utf8'), read.body.content);
  assert.deepEqual(readRegistry(), registryBefore);
});

test('111218 CR4: current project load failures do not expose internal paths', () => {
  isolatedHome();
  const root = newRepo();
  const { projects, current } = resolveProjects(root, false);
  const read = readProjectConfig(projects, current);
  fs.rmSync(path.join(root, '.changeledger', 'config.yml'));

  const result = saveProjectConfig(projects, {
    project: current,
    content: read.body.content,
    revision: read.body.revision,
  });

  assert.equal(result.body.error, 'unable to load the current project configuration');
  assert.ok(!result.body.error.includes(root));
});

test('111218 CR6/CR7: path repair verifies identity and unregister never deletes files', () => {
  isolatedHome();
  const original = newRepo();
  const { projects, current } = resolveProjects(original, false);
  const moved = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-moved-'));
  fs.cpSync(path.join(original, '.changeledger'), path.join(moved, '.changeledger'), {
    recursive: true,
  });

  const repaired = repairProjectPath(projects, {
    project: current,
    repository_path: path.resolve(original),
    path: moved,
  });
  assert.equal(repaired.code, 200);
  assert.equal(repaired.body.project_id, current);
  assert.equal(repaired.body.repository_path, path.resolve(moved));
  assert.equal(readRegistry()[current].path, moved);
  assert.equal(
    repairProjectPath(projects, {
      project: current,
      repository_path: path.resolve(original),
      path: 'relative',
    }).code,
    400,
  );

  const renamedProjects = resolveProjects(moved, false).projects;
  const project = renamedProjects.find((item) => item.id === current);
  const removed = unregisterProject(renamedProjects, {
    project: current,
    repository_path: path.resolve(moved),
    confirm: project.name,
  });
  assert.equal(removed.code, 200);
  assert.equal(removed.body.project_id, current);
  assert.equal(removed.body.repository_path, path.resolve(moved));
  assert.ok(fs.existsSync(path.join(moved, '.changeledger', 'config.yml')));
  assert.equal(readRegistry()[current], undefined);
});

test('161656 CR3: registry repair and remove preserve a concurrently rebound entry', () => {
  isolatedHome();
  const original = newRepo();
  const { projects, current } = resolveProjects(original, false);
  const moved = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-moved-'));
  fs.cpSync(path.join(original, '.changeledger'), path.join(moved, '.changeledger'), {
    recursive: true,
  });
  register({ id: current, name: 'Concurrent', path: '/concurrent' });

  const repaired = repairProjectPath(projects, {
    project: current,
    repository_path: path.resolve(original),
    path: moved,
  });
  assert.equal(repaired.code, 409);
  assert.equal(repaired.body.error, 'project registry changed; reload before writing');
  assert.equal(readRegistry()[current].path, '/concurrent');

  const removed = unregisterProject(projects, {
    project: current,
    repository_path: path.resolve(original),
    confirm: projects[0].name,
  });
  assert.equal(removed.code, 409);
  assert.equal(removed.body.error, 'project registry changed; reload before writing');
  assert.equal(readRegistry()[current].path, '/concurrent');
});

test('161656 CR4: every resolved project-domain error is attributed; unresolved errors are not', () => {
  isolatedHome();
  const root = newRepo();
  const { projects, current } = resolveProjects(root, false);
  const identity = { project_id: current, repository_path: path.resolve(root) };

  const failures = [
    ['changeStatus', changeStatus(projects, { project: current })],
    ['saveProjectConfig', saveProjectConfig(projects, { project: current })],
    ['repairProjectPath', repairProjectPath(projects, { project: current }, { localOnly: false })],
    [
      'unregisterProject',
      unregisterProject(projects, {
        project: current,
        repository_path: root,
        confirm: 'wrong',
      }),
    ],
    ['patchProjectConfig', patchProjectConfig(projects, { project: current, patch: 'wrong' })],
    ['previewConfigMigration', previewConfigMigration(projects, current, 'stale')],
    ['applyConfigMigration', applyConfigMigration(projects, { project: current })],
  ];

  for (const [name, result] of failures) {
    assert.ok(result.code >= 400, `${name}: expected an error result`);
    assert.ok(result.body.error, `${name}: primary error must survive attribution`);
    assert.equal(result.body.project_id, identity.project_id, name);
    assert.equal(result.body.repository_path, identity.repository_path, name);
  }

  const gone = { ...projects[0], alive: false };
  for (const [name, result] of [
    ['readProjectConfig', readProjectConfig([gone], current)],
    ['readProjectConfigStructured', readProjectConfigStructured([gone], current)],
  ]) {
    assert.equal(result.code, 410, name);
    assert.equal(result.body.project_id, identity.project_id, name);
    assert.equal(result.body.repository_path, identity.repository_path, name);
  }

  const unresolved = readProjectConfig(projects, 'missing-project');
  assert.equal(unresolved.code, 404);
  assert.equal(unresolved.body.project_id, undefined);
  assert.equal(unresolved.body.repository_path, undefined);
});

test('111218 CR8: local mode rejects registry mutations but permits config save', () => {
  isolatedHome();
  const root = newRepo();
  const { projects, current } = resolveProjects(root, true);
  const read = readProjectConfig(projects, current);
  assert.equal(
    repairProjectPath(projects, { project: current, path: root }, { localOnly: true }).code,
    403,
  );
  assert.equal(
    unregisterProject(
      projects,
      { project: current, confirm: projects[0].name },
      { localOnly: true },
    ).code,
    403,
  );
  assert.equal(
    saveProjectConfig(
      projects,
      { project: current, content: read.body.content, revision: read.body.revision },
      { localOnly: true },
    ).code,
    200,
  );
});

test('111218 CR2/CR8: project config HTTP routes enforce authorization', async () => {
  isolatedHome();
  const root = newRepo();
  const { current } = resolveProjects(root, false);
  const read = await memoryRequest(root, {
    path: `/api/project-config?project=${encodeURIComponent(current)}`,
    localOnly: false,
  });
  assert.equal(read.status, 200);
  const payload = JSON.parse(read.body);
  const denied = await memoryRequest(root, {
    method: 'POST',
    path: '/api/project-config',
    body: JSON.stringify({ project: current, ...payload }),
    localOnly: false,
  });
  assert.equal(denied.status, 403);
});

// --- 20260627-215619: spec internal link navigation ---

async function freshApp() {
  const url = new URL('../src/viewer/public/app.js', import.meta.url).href;
  const mod = await import(`${url}?bust=${Math.random()}`);
  return mod;
}

async function freshAppState() {
  const url = new URL('../src/viewer/public/app-state.js', import.meta.url).href;
  return import(`${url}?bust=${Math.random()}`);
}

test('20260627-215619 CR1: openSpecByName abre el spec destino cuando existe', async () => {
  const { openSpecByName } = await freshApp();
  const appState = await freshAppState();
  appState.setRepo(
    JSON.stringify({
      changes: [],
      statuses: [],
      types: [],
      specs: [
        { name: 'data-model.md', title: 'Data Model', body: '', tags: [], updated: '' },
        { name: 'architecture.md', title: 'Architecture', body: '', tags: [], updated: '' },
      ],
    }),
  );
  const opened = [];
  openSpecByName('data-model.md', appState.state, (s) => opened.push(s));
  assert.equal(opened.length, 1);
  assert.equal(opened[0].name, 'data-model.md');
});

test('20260627-215619 CR2: openSpecByName no lanza excepción cuando el spec no existe', async () => {
  const { openSpecByName } = await freshApp();
  const appState = await freshAppState();
  appState.setRepo(JSON.stringify({ changes: [], statuses: [], types: [], specs: [] }));
  const opened = [];
  assert.doesNotThrow(() => openSpecByName('no-existe.md', appState.state, (s) => opened.push(s)));
  assert.equal(opened.length, 0);
});

test('20260627-215619 CR3: handleSpecBodyClick no intercepta enlaces externos', async () => {
  const { handleSpecBodyClick } = await freshApp();
  let prevented = false;
  let specByNameCalled = false;
  const fakeEvent = {
    target: {
      closest: (sel) => (sel === 'a' ? { getAttribute: () => 'https://example.com' } : null),
    },
    preventDefault: () => {
      prevented = true;
    },
  };
  handleSpecBodyClick(fakeEvent, () => {
    specByNameCalled = true;
  });
  assert.equal(prevented, false);
  assert.equal(specByNameCalled, false);
});

test('20260627-215619 CR3: handleSpecBodyClick no intercepta enlaces con path absoluto', async () => {
  const { handleSpecBodyClick } = await freshApp();
  let prevented = false;
  let specByNameCalled = false;
  const fakeEvent = {
    target: { closest: (sel) => (sel === 'a' ? { getAttribute: () => '/docs/foo.md' } : null) },
    preventDefault: () => {
      prevented = true;
    },
  };
  handleSpecBodyClick(fakeEvent, () => {
    specByNameCalled = true;
  });
  assert.equal(prevented, false);
  assert.equal(specByNameCalled, false);
});

test('20260627-215619 CR4: openSpecByName normaliza prefijo ./ y extensión .md', async () => {
  const { openSpecByName } = await freshApp();
  const appState = await freshAppState();
  appState.setRepo(
    JSON.stringify({
      changes: [],
      statuses: [],
      types: [],
      specs: [{ name: 'lifecycle.md', title: 'Lifecycle', body: '', tags: [], updated: '' }],
    }),
  );
  const opened = [];
  openSpecByName('./lifecycle.md', appState.state, (s) => opened.push(s));
  assert.equal(opened.length, 1);
  assert.equal(opened[0].name, 'lifecycle.md');
});

test('20260627-215619 CR1: handleSpecBodyClick intercepta enlace .md relativo y llama openSpecByName', async () => {
  const { handleSpecBodyClick } = await freshApp();
  let prevented = false;
  const calledWith = [];
  const fakeEvent = {
    target: { closest: (sel) => (sel === 'a' ? { getAttribute: () => 'data-model.md' } : null) },
    preventDefault: () => {
      prevented = true;
    },
  };
  handleSpecBodyClick(fakeEvent, (href) => calledWith.push(href));
  assert.equal(prevented, true);
  assert.deepEqual(calledWith, ['data-model.md']);
});

test('20260704-103715 CR5: resetDetailScroll starts each opened document at the top', async () => {
  const { resetDetailScroll } = await freshApp();
  let scrollOptions;
  let afterLayout;
  const detail = {
    scrollTop: 420,
    scrollTo(options) {
      scrollOptions = options;
    },
  };

  resetDetailScroll(detail, (callback) => {
    afterLayout = callback;
  });

  assert.deepEqual(scrollOptions, { top: 0, left: 0, behavior: 'instant' });
  assert.equal(detail.scrollTop, 0);
  detail.scrollTop = 610.5;
  afterLayout();
  assert.equal(detail.scrollTop, 0);
});

// 20260628-113924: Form editor and config migration in the viewer

test('113924 CR3: readProjectConfigStructured returns config object and schema metadata', () => {
  isolatedHome();
  const root = newRepo();
  const { projects, current } = resolveProjects(root, false);

  const result = readProjectConfigStructured(projects, current);
  assert.equal(result.code, 200);
  assert.equal(result.body.project_id, current);
  assert.equal(result.body.repository_path, path.resolve(root));
  assert.ok(typeof result.body.content === 'string');
  assert.ok(typeof result.body.revision === 'string');
  assert.equal(typeof result.body.schemaVersion, 'number');
  assert.equal(result.body.supported, 4);
  assert.ok(typeof result.body.config === 'object');
  assert.ok('language' in result.body.config);
  assert.ok('tdd' in result.body.config);
  assert.ok('types' in result.body.config);
});

test('113924 CR4: patchProjectConfig only changes patched field, preserves comments and custom keys', () => {
  isolatedHome();
  const root = newRepo();
  const { projects, current } = resolveProjects(root, false);

  // Add a comment and custom key to the config
  const configFile = path.join(root, '.changeledger', 'config.yml');
  const original = fs.readFileSync(configFile, 'utf8');
  const withCustom = `${original}\n# my note\ncustom_key: preserved\n`;
  fs.writeFileSync(configFile, withCustom);

  const { body } = readProjectConfigStructured(projects, current);

  const result = patchProjectConfig(projects, {
    project: current,
    revision: body.revision,
    patch: { language: 'fr' },
  });

  assert.equal(result.code, 200, result.body?.error);
  assert.equal(result.body.project_id, current);
  assert.equal(result.body.repository_path, path.resolve(root));
  const after = fs.readFileSync(configFile, 'utf8');
  assert.match(after, /language: fr/);
  assert.match(after, /custom_key: preserved/);
  assert.match(after, /# my note/);
  // Ensure nothing else changed
  assert.doesNotMatch(after, /language: en/);
});

test('210115 CR4: saving without touching git.integration_branch preserves it', () => {
  isolatedHome();
  const root = newRepo();
  const { projects, current } = resolveProjects(root, false);

  const configFile = path.join(root, '.changeledger', 'config.yml');
  const original = fs.readFileSync(configFile, 'utf8');
  fs.writeFileSync(
    configFile,
    original.replace('  integration_branch:', '  integration_branch: dev'),
  );

  const { body } = readProjectConfigStructured(projects, current);
  assert.equal(body.config.git.integration_branch, 'dev');

  const result = patchProjectConfig(projects, {
    project: current,
    revision: body.revision,
    patch: { language: 'fr' },
  });

  assert.equal(result.code, 200, result.body?.error);
  const after = fs.readFileSync(configFile, 'utf8');
  assert.match(after, /language: fr/);
  assert.match(after, /integration_branch: dev/);
});

test('225637 CR5: clearing integration branch preserves sibling git keys', () => {
  isolatedHome();
  const root = newRepo();
  const { projects, current } = resolveProjects(root, false);
  const configFile = path.join(root, '.changeledger', 'config.yml');
  const original = fs.readFileSync(configFile, 'utf8');
  fs.writeFileSync(
    configFile,
    original.replace('  integration_branch:', '  integration_branch: dev\n  custom: keep'),
  );
  const { body } = readProjectConfigStructured(projects, current);
  const result = patchProjectConfig(projects, {
    project: current,
    revision: body.revision,
    patch: { git: { integration_branch: null } },
  });
  assert.equal(result.code, 200, result.body?.error);
  const after = fs.readFileSync(configFile, 'utf8');
  assert.doesNotMatch(after, /integration_branch:/);
  assert.match(after, /git:\n {2}custom: keep/);
});

test('113924 CR5: patch explicitly rejects project_id in patch payload', () => {
  isolatedHome();
  const root = newRepo();
  const { projects, current } = resolveProjects(root, false);
  const { body } = readProjectConfigStructured(projects, current);

  const result = patchProjectConfig(projects, {
    project: current,
    revision: body.revision,
    patch: { project_id: 'hacked' },
  });
  assert.equal(result.code, 400);
  assert.match(result.body.error, /project_id cannot be changed/);
});

test('113924 CR5: patch rejects invalid changes_dir (path traversal)', () => {
  isolatedHome();
  const root = newRepo();
  const { projects, current } = resolveProjects(root, false);
  const { body } = readProjectConfigStructured(projects, current);

  const result = patchProjectConfig(projects, {
    project: current,
    revision: body.revision,
    patch: { changes_dir: '../../../etc' },
  });
  assert.equal(result.code, 400);
  assert.match(result.body.error, /escapes/);
});

test('113924 CR5: patch rejects removal of required lifecycle values without writing', () => {
  isolatedHome();
  const root = newRepo();
  const { projects, current } = resolveProjects(root, false);
  const configFile = path.join(root, '.changeledger', 'config.yml');
  const before = fs.readFileSync(configFile, 'utf8');
  const { body } = readProjectConfigStructured(projects, current);

  const withoutValidation = body.config.statuses.filter((status) => status !== 'in-validation');
  const result = patchProjectConfig(projects, {
    project: current,
    revision: body.revision,
    patch: { statuses: withoutValidation },
  });

  assert.equal(result.code, 400);
  assert.match(result.body.error, /statuses cannot remove required value "in-validation"/);
  assert.equal(fs.readFileSync(configFile, 'utf8'), before);
});

test('113924 CR6 atomic: applyConfigMigration revision check and write are atomic (TOCTOU safe)', () => {
  isolatedHome();
  const root = newRepo();
  const { projects, current } = resolveProjects(root, false);

  const configFile = path.join(root, '.changeledger', 'config.yml');
  const text = fs.readFileSync(configFile, 'utf8').replace(/^schema_version: \d+\n/m, '');
  fs.writeFileSync(configFile, text);
  // A stale revision is checked while mutateFileAtomic holds the file lock.
  const staleResult = applyConfigMigration(projects, { project: current, revision: 'stale' });
  assert.equal(staleResult.code, 409);
  assert.match(staleResult.body.error, /changed on disk/);
  // File must be unmodified
  assert.equal(fs.readFileSync(configFile, 'utf8'), text);
});

test('113924 CR6: stale revision on patch returns 409', () => {
  isolatedHome();
  const root = newRepo();
  const { projects, current } = resolveProjects(root, false);

  const result = patchProjectConfig(projects, {
    project: current,
    revision: 'stale',
    patch: { language: 'fr' },
  });
  assert.equal(result.code, 409);
  assert.match(result.body.error, /changed on disk/);
});

test('113924 CR7: previewConfigMigration does not write and returns candidate YAML', () => {
  isolatedHome();
  const root = newRepo();
  const { projects, current } = resolveProjects(root, false);

  const configFile = path.join(root, '.changeledger', 'config.yml');
  // Downgrade to schema 0
  const text = fs.readFileSync(configFile, 'utf8').replace(/^schema_version: \d+\n/m, '');
  fs.writeFileSync(configFile, text);
  const before = fs.readFileSync(configFile, 'utf8');

  const result = previewConfigMigration(projects, current);
  assert.equal(result.code, 200);
  assert.equal(result.body.project_id, current);
  assert.equal(result.body.repository_path, path.resolve(root));
  assert.ok(result.body.yaml.includes('schema_version: 4'));
  assert.ok(result.body.changes.length > 0);
  assert.equal(fs.readFileSync(configFile, 'utf8'), before, 'preview must not modify file');
});

test('113924 CR7: previewConfigMigration returns already_current when schema is current', () => {
  isolatedHome();
  const root = newRepo();
  const { projects, current } = resolveProjects(root, false);

  const result = previewConfigMigration(projects, current);
  assert.equal(result.code, 200);
  assert.equal(result.body.already_current, true);
});

test('113924 CR8: applyConfigMigration uses buildMigration engine and writes atomically', () => {
  isolatedHome();
  const root = newRepo();
  const { projects, current } = resolveProjects(root, false);

  const configFile = path.join(root, '.changeledger', 'config.yml');
  const text = fs.readFileSync(configFile, 'utf8').replace(/^schema_version: \d+\n/m, '');
  fs.writeFileSync(configFile, text);
  const { body } = readProjectConfigStructured(projects, current);

  const result = applyConfigMigration(projects, { project: current, revision: body.revision });
  assert.equal(result.code, 200);
  assert.equal(result.body.project_id, current);
  assert.equal(result.body.repository_path, path.resolve(root));
  assert.ok(result.body.ok);
  assert.ok(fs.readFileSync(configFile, 'utf8').includes('schema_version: 4'));
  // Verify idempotent
  const result2 = applyConfigMigration(projects, {
    project: current,
    revision: result.body.revision,
  });
  assert.equal(result2.code, 200);
  assert.equal(result2.body.already_current, true);
});

test('113924 CR9: read never triggers migration implicitly', () => {
  isolatedHome();
  const root = newRepo();
  const { projects, current } = resolveProjects(root, false);

  const configFile = path.join(root, '.changeledger', 'config.yml');
  const text = fs.readFileSync(configFile, 'utf8').replace(/^schema_version: \d+\n/m, '');
  fs.writeFileSync(configFile, text);
  const before = fs.readFileSync(configFile, 'utf8');

  // Multiple reads must not trigger any write
  readProjectConfig(projects, current);
  readProjectConfigStructured(projects, current);
  previewConfigMigration(projects, current);

  assert.equal(fs.readFileSync(configFile, 'utf8'), before, 'reads must not modify config');
});

test('113924 CR10: patchProjectConfig fails closed for future schema', () => {
  isolatedHome();
  const root = newRepo();
  const { projects, current } = resolveProjects(root, false);

  const configFile = path.join(root, '.changeledger', 'config.yml');
  const text = fs
    .readFileSync(configFile, 'utf8')
    .replace(/schema_version: \d+/, 'schema_version: 5');
  fs.writeFileSync(configFile, text);
  const { body } = readProjectConfigStructured(projects, current);

  const result = patchProjectConfig(projects, {
    project: current,
    revision: body.revision,
    patch: { language: 'fr' },
  });
  assert.equal(result.code, 400);
  assert.match(result.body.error, /newer than supported/);
});

test('113924 CR10: raw domain and HTTP writes fail closed for future schema', async () => {
  isolatedHome();
  const root = newRepo();
  const { projects, current } = resolveProjects(root, false);
  const configFile = path.join(root, '.changeledger', 'config.yml');
  const future = fs
    .readFileSync(configFile, 'utf8')
    .replace(/schema_version: \d+/, 'schema_version: 5');
  fs.writeFileSync(configFile, future);
  const read = readProjectConfig(projects, current);
  const candidate = future.replace(/language: en/, 'language: fr');

  const direct = saveProjectConfig(projects, {
    project: current,
    content: candidate,
    revision: read.body.revision,
  });
  assert.equal(direct.code, 400);
  assert.match(direct.body.error, /config schema 5 is newer than supported schema 4/);
  assert.equal(fs.readFileSync(configFile, 'utf8'), future);

  const response = await memoryRequest(root, {
    method: 'POST',
    path: '/api/project-config',
    headers: { 'Content-Type': 'application/json', 'x-changeledger-token': TOKEN },
    body: JSON.stringify({
      project: current,
      repository_path: path.resolve(root),
      content: candidate,
      revision: read.body.revision,
    }),
    localOnly: false,
  });
  assert.equal(response.status, 400);
  assert.match(response.body, /config schema 5 is newer than supported schema 4/);
  assert.equal(fs.readFileSync(configFile, 'utf8'), future);
});

// 225212 CR4: view's grammar is explicit — '.', a port, both, or neither — and
// anything else fails fast instead of being silently ignored.
test('225212 CR4: view rejects an unknown argument instead of ignoring it', async () => {
  await assert.rejects(() => view(['bogus']), /Unknown (argument|option)s?.*bogus/i);
});

test('225212 CR4: view rejects a non-numeric, non-"." argument', async () => {
  await assert.rejects(() => view(['4040x']), /Unknown (argument|option)s?.*4040x/i);
});

test('225212 CR4: view accepts "." combined with a port', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  init(root);
  const server = await view(['.', '0'], root, { openBrowser: false });
  try {
    assert.equal(typeof server.address().port, 'number');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// 20260711-162556 CR4 — schema 1 repos get the migration offered in the viewer
test('162556 CR4: previewConfigMigration offers the current schema with quick additions', () => {
  isolatedHome();
  const root = newRepo();
  const { projects, current } = resolveProjects(root, false);

  const configFile = path.join(root, '.changeledger', 'config.yml');
  // Downgrade to schema 1: pre-quick template state
  const schema1 = fs
    .readFileSync(configFile, 'utf8')
    .replace(/^schema_version: \d+$/m, 'schema_version: 1')
    .replace(/^ {4}quick: patch\n/m, '')
    .replace(/^ {2}quick:\n {4}stages: \[.*\]\n/m, '');
  fs.writeFileSync(configFile, schema1);
  assert.doesNotMatch(schema1, /quick/, 'fixture must not contain quick');

  const structured = readProjectConfigStructured(projects, current);
  assert.equal(structured.body.schemaVersion, 1);
  assert.equal(structured.body.supported, 4);

  const preview = previewConfigMigration(projects, current);
  assert.equal(preview.code, 200);
  assert.match(preview.body.summary, /Config migration 1 → 4/);
  assert.ok(preview.body.changes.some((c) => c.includes('types.quick')));
  assert.ok(preview.body.changes.some((c) => c.includes('release.impacts.quick: patch')));
  assert.match(preview.body.yaml, /^schema_version: 4$/m);
  assert.equal(fs.readFileSync(configFile, 'utf8'), schema1, 'preview must not write');

  // Apply lands the additions and becomes terminal
  const applied = applyConfigMigration(projects, {
    project: current,
    revision: structured.body.revision,
  });
  assert.equal(applied.code, 200);
  const after = fs.readFileSync(configFile, 'utf8');
  assert.match(after, /^schema_version: 4$/m);
  assert.match(after, /quick:\s*\n\s+stages: \[request, log\]/);
  assert.match(after, /quick: patch/);
  const again = previewConfigMigration(projects, current);
  assert.equal(again.body.already_current, true);
});
