import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { findSpecDir, loadConfig } from '../config.mjs';
import { computeMetrics } from '../metrics.mjs';
import { publicDir } from '../paths.mjs';
import { listProjects } from '../registry.mjs';
import { loadRepo } from '../repo.mjs';

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
    metrics: computeMetrics(repo.changes),
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

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type });
  res.end(body);
}

export async function view(args = [], cwd = process.cwd()) {
  const localOnly = args.includes('.');
  resolveProjects(cwd, localOnly); // fail fast if local mode outside a repo

  const server = http.createServer((req, res) => {
    try {
      const [route, query] = req.url.split('?');
      const params = new URLSearchParams(query);

      if (route === '/api/projects') {
        send(res, 200, MIME['.json'], JSON.stringify(resolveProjects(cwd, localOnly)));
        return;
      }
      if (route === '/api/search') {
        const { projects } = resolveProjects(cwd, localOnly);
        send(res, 200, MIME['.json'], JSON.stringify(searchProjects(projects, params.get('q'))));
        return;
      }
      if (route === '/api/repo') {
        const { projects } = resolveProjects(cwd, localOnly);
        const proj = projects.find((p) => p.id === params.get('project')) ?? projects[0];
        if (!proj) {
          send(res, 404, MIME['.json'], JSON.stringify({ error: 'no project' }));
          return;
        }
        if (!proj.alive) {
          send(res, 410, MIME['.json'], JSON.stringify({ error: 'project path is gone' }));
          return;
        }
        send(res, 200, MIME['.json'], JSON.stringify(serialize(loadRepo(proj.path))));
        return;
      }

      const vendor = vendorFile(route);
      if (vendor) {
        if (fs.existsSync(vendor)) send(res, 200, MIME['.js'], fs.readFileSync(vendor));
        else send(res, 404, 'text/plain', 'vendor lib not installed');
        return;
      }

      const urlPath = route === '/' ? '/index.html' : route;
      const file = path.join(publicDir, path.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, ''));
      if (file.startsWith(publicDir) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        send(res, 200, MIME[path.extname(file)] ?? 'text/plain', fs.readFileSync(file));
      } else {
        send(res, 404, 'text/plain', 'Not found');
      }
    } catch (e) {
      send(res, 500, MIME['.json'], JSON.stringify({ error: e.message }));
    }
  });

  const port = await listen(server, Number(args.find((a) => /^\d+$/.test(a))) || 4040);
  const url = `http://localhost:${port}`;
  console.log(`Spec Ledger viewer → ${url}  (Ctrl+C to stop)`);
  openBrowser(url);
}

function listen(server, port, attempts = 10) {
  return new Promise((resolve, reject) => {
    const tryPort = (p, left) => {
      server.once('error', (e) => {
        if (e.code === 'EADDRINUSE' && left > 0) tryPort(p + 1, left - 1);
        else reject(e);
      });
      server.listen(p, () => resolve(p));
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
