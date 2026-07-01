import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';
import { resolveProjects } from '../viewer/domain.mjs';
import { createRequestListener, staticFile } from '../viewer/server/router.mjs';
import { hostnameOf, isAuthorizedWrite, isLocalHost } from '../viewer/server/security.mjs';

export {
  applyConfigMigration,
  changeStatus,
  patchProjectConfig,
  previewConfigMigration,
  readProjectConfig,
  readProjectConfigStructured,
  repairProjectPath,
  resolveProjects,
  saveProjectConfig,
  searchProjects,
  serialize,
  unregisterProject,
} from '../viewer/domain.mjs';
export { createRequestListener, hostnameOf, isAuthorizedWrite, isLocalHost, staticFile };

// Explicit grammar: `.` selects local-only mode, a bare integer selects the
// port (default 4040), both may combine, and anything else is rejected
// instead of being silently ignored.
function parseViewArgs(args) {
  let localOnly = false;
  let port = 4040;
  const unknown = [];
  for (const a of args) {
    if (a === '.') localOnly = true;
    else if (/^\d+$/.test(a)) port = Number(a);
    else unknown.push(a);
  }
  if (unknown.length) {
    throw new Error(
      `Unknown argument(s) for "changeledger view": ${unknown.join(', ')} — usage: changeledger view [.] [port]`,
    );
  }
  return { localOnly, port };
}

export async function view(args = [], cwd = process.cwd()) {
  const { localOnly, port: requestedPort } = parseViewArgs(args);
  resolveProjects(cwd, localOnly); // fail fast if local mode outside a repo

  const token = crypto.randomBytes(16).toString('hex');
  const server = http.createServer(createRequestListener(cwd, localOnly, token));
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;

  const host = '127.0.0.1';
  const port = await listen(server, host, requestedPort);
  const url = `http://${host}:${port}`;
  console.log(`ChangeLedger viewer → ${url}  (Ctrl+C to stop)`);
  openBrowser(url);
  return server;
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
