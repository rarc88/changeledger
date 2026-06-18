import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';
import { resolveProjects } from '../viewer/domain.mjs';
import { createRequestListener, staticFile } from '../viewer/server/router.mjs';
import { hostnameOf, isAuthorizedWrite, isLocalHost } from '../viewer/server/security.mjs';

export { changeStatus, resolveProjects, searchProjects, serialize } from '../viewer/domain.mjs';
export { createRequestListener, hostnameOf, isAuthorizedWrite, isLocalHost, staticFile };

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
