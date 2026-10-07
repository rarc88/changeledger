#!/usr/bin/env node
// Runs `node --test` with a temp root of its own and removes that root when
// the run ends, so the suite leaves nothing in the system temp (20261007-135154).
// os.tmpdir() reads TMPDIR (TEMP/TMP on Windows) and `node --test` children
// inherit the environment, so everything the tests create under os.tmpdir()
// lands inside the root. Arguments are forwarded to `node --test`; the exit
// code is the child's, or 128 + signal number when a signal ended the run.
//
// A SIGKILL of this wrapper cannot be handled and leaves the root behind.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-test-'));
let removed = false;
const removeRoot = () => {
  if (removed) return;
  removed = true;
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
};

const child = spawn(process.execPath, ['--test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, TMPDIR: root, TEMP: root, TMP: root },
});

let received = null;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    received ??= signal;
    child.kill(signal);
  });
}

const finish = (code) => {
  try {
    removeRoot();
  } catch (error) {
    process.stderr.write(`run-tests: could not remove ${root}: ${error}\n`);
    code ||= 1;
  }
  process.exit(code);
};

child.on('error', (error) => {
  process.stderr.write(`run-tests: could not start node --test: ${error}\n`);
  finish(1);
});

child.on('close', (code, signal) => {
  const ended = signal ?? received;
  finish(ended ? 128 + os.constants.signals[ended] : (code ?? 1));
});
