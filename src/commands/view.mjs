import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { publicDir } from '../paths.mjs';
import { loadRepo } from '../repo.mjs';

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
    changes: repo.changes.map((c) => ({
      id: c.frontmatter.id,
      title: c.frontmatter.title,
      type: c.frontmatter.type,
      status: c.frontmatter.status,
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

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type });
  res.end(body);
}

export async function view(args = [], cwd = process.cwd()) {
  loadRepo(cwd); // fail fast if this is not a Spec Ledger repo

  const server = http.createServer((req, res) => {
    try {
      if (req.url.split('?')[0] === '/api/repo') {
        // Re-read on every request so the viewer is always live.
        send(res, 200, MIME['.json'], JSON.stringify(serialize(loadRepo(cwd))));
        return;
      }
      const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
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

  const port = await listen(server, Number(args[0]) || 4040);
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
