import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { gitRefs } from '../../git.mjs';
import { publicDir } from '../../paths.mjs';
import { loadRepoAsync } from '../../repo.mjs';
import { changeStatus, resolveProjects, searchProjects, serialize } from '../domain.mjs';
import { isAuthorizedWrite, isLocalHost } from './security.mjs';

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

// Defensive headers for a local-only UI: never sniff types, never cache, and
// forbid embedding in a frame (clickjacking).
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store',
};

const MAX_BODY = 64 * 1024; // a status payload is tiny; cap to stay defensive

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, ...SECURITY_HEADERS });
  res.end(body);
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
        const rawId = params.get('id');
        if (rawId && !/^[0-9]{8}-[0-9]{6}$/.test(rawId)) {
          send(res, 400, MIME['.json'], JSON.stringify({ error: 'invalid id' }));
          return;
        }
        const { projects } = resolveProjects(cwd, localOnly);
        const proj = projects.find((p) => p.id === params.get('project'));
        if (!proj?.alive) {
          send(res, 200, MIME['.json'], JSON.stringify({ commits: [], branches: [] }));
          return;
        }
        send(res, 200, MIME['.json'], JSON.stringify(gitRefs(proj.path, rawId)));
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
      process.stderr.write(`[sl-viewer] ${e.message}\n`);
      send(res, 500, MIME['.json'], JSON.stringify({ error: 'Internal server error' }));
    }
  };
}

export function staticFile(route) {
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
