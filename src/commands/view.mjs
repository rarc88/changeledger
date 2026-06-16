import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { findSpecDir, loadConfig } from '../config.mjs';
import { gitRefs } from '../git.mjs';
import { computeMetrics } from '../metrics.mjs';
import { nowUtc, publicDir } from '../paths.mjs';
import { listProjects } from '../registry.mjs';
import { loadRepo, loadRepoAsync } from '../repo.mjs';
import { status as applyStatusCmd } from './agent.mjs';

const require = createRequire(import.meta.url);

// Browser builds of the markdown/diagram libs, resolved from node_modules
// (installed as dependencies) and served under /vendor/*.
function vendorFile(route) {
  try {
    if (route === '/vendor/marked.min.js') {
      return path.join(path.dirname(require.resolve('marked/package.json')), 'lib/marked.umd.js');
    }
    if (route === '/vendor/mermaid.min.js') {
      return require.resolve('mermaid/dist/mermaid.min.js');
    }
    if (route === '/vendor/purify.min.js') {
      return require.resolve('dompurify/dist/purify.min.js');
    }
    if (route.startsWith('/vendor/lit-html/')) {
      const subpath = route.slice('/vendor/lit-html/'.length);
      if (subpath === 'lit-html.js') return require.resolve('lit-html');
      return require.resolve(`lit-html/${subpath}`);
    }
  } catch {
    return null;
  }
  return null;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

// Serializes a loaded repo into the flat shape the UI consumes.
function serialize(repo) {
  return {
    language: repo.config.language ?? 'en',
    statuses: repo.config.statuses ?? [],
    types: Object.keys(repo.config.types ?? {}),
    metrics: computeMetrics(repo.changes, { now: nowUtc() }),
    changes: repo.changes.map((c) => ({
      id: c.frontmatter.id,
      title: c.frontmatter.title,
      type: c.frontmatter.type,
      status: c.frontmatter.status,
      owner: c.frontmatter.owner ?? null,
      archived: c.frontmatter.archived === true,
      created: c.frontmatter.created,
      depends_on: c.frontmatter.depends_on ?? [],
      stages: c.stages,
      tasks: c.tasks,
      progress: c.progress,
    })),
    specs: (repo.specs ?? []).map((s) => ({
      name: s.name,
      title: s.frontmatter.title,
      updated: s.frontmatter.updated,
      tags: s.frontmatter.tags ?? [],
      body: s.body,
    })),
  };
}

const isAlive = (p) => fs.existsSync(path.join(p, '.sl', 'config.yml'));

// The project list and which one is "current" (the repo the command ran in).
export function resolveProjects(cwd, localOnly) {
  const specDir = findSpecDir(cwd);
  const repoRoot = specDir ? path.dirname(specDir) : null;

  if (localOnly) {
    if (!repoRoot) throw new Error('Not a Spec Ledger repo. Run `sl init` first.');
    const config = loadConfig(specDir);
    const id = config.project_id ?? 'local';
    const name = config.project_name ?? path.basename(repoRoot);
    return { projects: [{ id, name, path: repoRoot, alive: true }], current: id };
  }

  const projects = listProjects().map((p) => ({ ...p, alive: isAlive(p.path) }));
  let current = null;
  if (repoRoot) {
    const match = projects.find((p) => path.resolve(p.path) === repoRoot);
    if (match) current = match.id;
  }
  return { projects, current };
}

// Full-text search across the given (alive) projects. `load` maps a project path
// to a loaded repo (loadRepo by default). Returns groups with at least one match.
export function searchProjects(projects, q, load = loadRepo) {
  const needle = String(q ?? '')
    .trim()
    .toLowerCase();
  if (!needle) return [];
  const groups = [];
  for (const p of projects) {
    if (!p.alive) continue;
    let repo;
    try {
      repo = load(p.path);
    } catch {
      continue;
    }
    const matches = repo.changes
      .filter((c) => `${c.text ?? ''} ${c.frontmatter?.title ?? ''}`.toLowerCase().includes(needle))
      .map((c) => ({
        id: c.frontmatter.id,
        title: c.frontmatter.title,
        type: c.frontmatter.type,
        status: c.frontmatter.status,
      }));
    if (matches.length) groups.push({ project: { id: p.id, name: p.name }, matches });
  }
  return groups;
}

// Applies a status move requested from the viewer. Returns { code, body } so the
// HTTP handler stays thin and the logic is testable. Reuses the `status` command
// (enum validation + setStatus + appendLog).
export function changeStatus(projects, { project, id, status }) {
  // A write must target an exact project; never silently fall back to the first
  // registered one.
  const proj = projects.find((p) => p.id === project);
  if (!proj) return { code: 404, body: { error: `no project "${project}"` } };
  if (!proj.alive) return { code: 410, body: { error: 'project path is gone' } };
  if (!id || !status) return { code: 400, body: { error: 'id and status are required' } };

  // The viewer is the human's surface, and the only lifecycle move that belongs
  // to the human is approval: draft → approved. The rest of the cycle is the
  // agent's job (via `sl status`). Enforce it here — the UI is bypassable.
  let current;
  try {
    const change = loadRepo(proj.path).changes.find((c) => String(c.frontmatter.id) === String(id));
    if (!change) return { code: 404, body: { error: `no change with id "${id}"` } };
    current = change.frontmatter.status;
  } catch (e) {
    return { code: 400, body: { error: e.message } };
  }
  if (current !== 'draft' || status !== 'approved') {
    return {
      code: 403,
      body: { error: 'the viewer only allows the draft → approved transition' },
    };
  }

  try {
    applyStatusCmd(id, status, proj.path);
    return { code: 200, body: { ok: true, id, status } };
  } catch (e) {
    return { code: 400, body: { error: e.message } };
  }
}

// Defensive headers for a local-only UI: never sniff types, never cache, and
// forbid embedding in a frame (clickjacking).
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store',
};

const MAX_BODY = 64 * 1024; // a status payload is tiny; cap to stay defensive
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, ...SECURITY_HEADERS });
  res.end(body);
}

// Bare hostname from a Host/Origin authority, dropping the port and IPv6
// brackets. '' when absent.
function hostnameOf(authority) {
  if (!authority) return '';
  const m = String(authority).match(/^(\[[^\]]+\]|[^:]+)(?::\d+)?$/);
  const host = m ? m[1] : authority;
  return host.replace(/^\[|\]$/g, '');
}

// The request must be addressed to the loopback host. This (with the loopback
// bind) defends against DNS-rebinding: a rebinding attack reaches the socket but
// carries the attacker's domain in Host.
function isLocalHost(req) {
  return LOOPBACK.has(hostnameOf(req.headers.host));
}

// A write must come from the viewer's own page: a same-origin Origin (when the
// browser sends one) and the per-process token the page was given. A
// cross-origin attacker cannot read the token, so it cannot forge the header.
function isAuthorizedWrite(req, token) {
  if (req.headers['x-sl-token'] !== token) return false;
  const origin = req.headers.origin;
  if (origin && !LOOPBACK.has(hostnameOf(new URL(origin).host))) return false;
  return true;
}

// Injects the per-process write token into the served page so same-origin JS can
// read it; cross-origin pages cannot, by the same-origin policy.
function serveIndex(res, token) {
  const html = fs
    .readFileSync(path.join(publicDir, 'index.html'), 'utf8')
    .replace('__SL_TOKEN_VALUE__', token);
  send(res, 200, MIME['.html'], html);
}

// Builds the HTTP request listener. Exposed (with an injectable token) so the
// security boundary is testable over real HTTP without opening a browser.
export function createRequestListener(cwd, localOnly, token) {
  return async (req, res) => {
    try {
      if (!isLocalHost(req)) {
        send(res, 403, MIME['.json'], JSON.stringify({ error: 'non-local host rejected' }));
        return;
      }
      const url = new URL(req.url, 'http://127.0.0.1');
      const route = url.pathname;
      const params = url.searchParams;

      if (req.method === 'POST' && route === '/api/status') {
        if (!isAuthorizedWrite(req, token)) {
          send(res, 403, MIME['.json'], JSON.stringify({ error: 'unauthorized write' }));
          req.destroy();
          return;
        }
        let raw = '';
        let aborted = false;
        req.on('data', (chunk) => {
          if (aborted) return;
          raw += chunk;
          if (raw.length > MAX_BODY) {
            aborted = true;
            send(res, 413, MIME['.json'], JSON.stringify({ error: 'body too large' }));
            req.destroy();
          }
        });
        req.on('end', () => {
          if (aborted) return;
          let payload;
          try {
            payload = JSON.parse(raw || '{}');
          } catch {
            send(res, 400, MIME['.json'], JSON.stringify({ error: 'invalid JSON body' }));
            return;
          }
          const { projects } = resolveProjects(cwd, localOnly);
          const { code, body } = changeStatus(projects, payload);
          send(res, code, MIME['.json'], JSON.stringify(body));
        });
        return;
      }

      if (route === '/api/projects') {
        send(res, 200, MIME['.json'], JSON.stringify(resolveProjects(cwd, localOnly)));
        return;
      }
      if (route === '/api/git') {
        const { projects } = resolveProjects(cwd, localOnly);
        const proj = projects.find((p) => p.id === params.get('project'));
        if (!proj?.alive) {
          send(res, 200, MIME['.json'], JSON.stringify({ commits: [], branches: [] }));
          return;
        }
        send(res, 200, MIME['.json'], JSON.stringify(gitRefs(proj.path, params.get('id'))));
        return;
      }
      if (route === '/api/search') {
        const { projects } = resolveProjects(cwd, localOnly);
        send(res, 200, MIME['.json'], JSON.stringify(searchProjects(projects, params.get('q'))));
        return;
      }
      if (route === '/api/repo') {
        const { projects } = resolveProjects(cwd, localOnly);
        const proj = projects.find((p) => p.id === params.get('project'));
        if (!proj) {
          send(res, 404, MIME['.json'], JSON.stringify({ error: 'no project' }));
          return;
        }
        if (!proj.alive) {
          send(res, 410, MIME['.json'], JSON.stringify({ error: 'project path is gone' }));
          return;
        }
        send(res, 200, MIME['.json'], JSON.stringify(serialize(await loadRepoAsync(proj.path))));
        return;
      }

      const vendor = vendorFile(route);
      if (vendor) {
        if (fs.existsSync(vendor)) send(res, 200, MIME['.js'], fs.readFileSync(vendor));
        else send(res, 404, 'text/plain', 'vendor lib not installed');
        return;
      }

      if (route === '/' || route === '/index.html') {
        serveIndex(res, token);
        return;
      }
      const file = staticFile(route);
      if (file) {
        send(res, 200, MIME[path.extname(file)] ?? 'text/plain', fs.readFileSync(file));
      } else {
        send(res, 404, 'text/plain', 'Not found');
      }
    } catch (e) {
      send(res, 500, MIME['.json'], JSON.stringify({ error: e.message }));
    }
  };
}

function staticFile(route) {
  let decoded;
  try {
    decoded = decodeURIComponent(route);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;

  const rel = decoded.replace(/^\/+/, '');
  const file = path.resolve(publicDir, rel);
  if (!isInsidePath(publicDir, file)) return null;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;

  const realPublic = fs.realpathSync(publicDir);
  const realFile = fs.realpathSync(file);
  if (!isInsidePath(realPublic, realFile)) return null;
  return file;
}

function isInsidePath(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

export async function view(args = [], cwd = process.cwd()) {
  const localOnly = args.includes('.');
  resolveProjects(cwd, localOnly); // fail fast if local mode outside a repo

  const token = crypto.randomBytes(16).toString('hex');
  const server = http.createServer(createRequestListener(cwd, localOnly, token));
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;

  const host = '127.0.0.1';
  const port = await listen(server, host, Number(args.find((a) => /^\d+$/.test(a))) || 4040);
  const url = `http://${host}:${port}`;
  console.log(`Spec Ledger viewer → ${url}  (Ctrl+C to stop)`);
  openBrowser(url);
}

function listen(server, host, port, attempts = 10) {
  return new Promise((resolve, reject) => {
    const tryPort = (p, left) => {
      server.once('error', (e) => {
        if (e.code === 'EADDRINUSE' && left > 0) tryPort(p + 1, left - 1);
        else reject(e);
      });
      server.listen(p, host, () => resolve(p));
    };
    tryPort(port, attempts);
  });
}

function openBrowser(url) {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(cmd, [url], {
      stdio: 'ignore',
      detached: true,
      shell: process.platform === 'win32',
    }).unref();
  } catch {
    // best-effort; the URL is printed above
  }
}
