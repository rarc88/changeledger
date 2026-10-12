// A copy of this checkout's CLI that reports another version, so a test can
// run two "installed" versions against the same repo (20261001-155216). Only
// package.json differs: the copy runs the checkout's own code, with the
// dependencies symlinked, so the version is the one fact that changes.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizedEnv } from './git-env.mjs';

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const installs = new Map();

export function installCli(version) {
  if (installs.has(version)) return installs.get(version);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `changeledger-cli-${version}-`));
  for (const entry of ['bin', 'src', 'templates']) {
    fs.cpSync(path.join(checkout, entry), path.join(dir, entry), { recursive: true });
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(checkout, 'package.json'), 'utf8'));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    `${JSON.stringify({ ...manifest, version }, null, 2)}\n`,
  );
  fs.symlinkSync(path.join(checkout, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  const bin = path.join(dir, 'bin', 'changeledger.mjs');
  const cli = (args, { cwd, home }) => {
    const result = spawnSync(process.execPath, [bin, ...args], {
      cwd,
      encoding: 'utf8',
      env: sanitizedEnv({ CHANGELEDGER_HOME: home, CHANGELEDGER_NO_GH: '1' }),
    });
    return { code: result.status, out: result.stdout, err: result.stderr };
  };
  installs.set(version, cli);
  return cli;
}
