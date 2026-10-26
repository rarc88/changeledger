#!/usr/bin/env node
// Runs `node --test` with a temp root of its own and removes that root when
// the run ends, so the suite leaves nothing in the system temp (20261007-135154).
// The root also holds the throwaway CHANGELEDGER_HOME the child runs against:
// `registryDir()` falls back to os.homedir(), so a test that calls `init()`
// without setting that variable would register its temp repo in the real
// user's registry. Isolating it here rather than per test file means a new
// test cannot forget to; a file that still sets it in-process wins, because
// that assignment happens inside the child.
// os.tmpdir() reads TMPDIR (TEMP/TMP on Windows) and `node --test` children
// inherit the environment, so directories the tests create through os.tmpdir()
// land inside the root. Arguments are forwarded to `node --test`; the exit
// code is the child's, or 128 + signal number when a signal ended the run.
//
// The root is removed after the child exits normally or fails, and after
// SIGINT, SIGTERM, SIGHUP or SIGQUIT is sent to this process. The handlers are
// installed before the root is created and run once the child exists, so a
// signal that arrives before them ends the process before any root exists.
// Not covered: a SIGKILL of this process,
// which cannot be handled and leaves the root behind; directories a test
// creates outside os.tmpdir(); and the failure paths of starting the child or
// removing the root, which no test exercises.
//
// Windows (20261012-212527): Windows has no POSIX signals. Node documents that
// Ctrl+C delivers SIGINT and closing the console delivers SIGHUP there; in the
// CI runs, subprocess.kill() with SIGINT, SIGTERM, SIGHUP and SIGQUIT ended
// this process without running the handlers described above, so the tests for
// those four signals are skipped there. Treat any other forced termination
// (process.kill, taskkill /F) as a SIGKILL that leaves the root. Also not
// covered: Ctrl+Break (SIGBREAK), which those handlers do not listen for.
// Cleanup after a real Ctrl+C on Windows has not been run.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// `node --test` stops its test processes on SIGINT and SIGTERM; a SIGHUP or
// SIGQUIT sent to it alone ends it and leaves a running test process behind,
// so those two reach it as SIGTERM while the exit code names the signal this
// process received.
const forwarded = {
  SIGINT: 'SIGINT',
  SIGTERM: 'SIGTERM',
  SIGHUP: 'SIGTERM',
  SIGQUIT: 'SIGTERM',
};
let root = null;
let received = null;
let removed = false;
const removeRoot = () => {
  if (removed || root === null) return;
  removed = true;
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
};

const finish = (code) => {
  try {
    removeRoot();
  } catch (error) {
    process.stderr.write(`run-tests: could not remove ${root}: ${error}\n`);
    code ||= 1;
  }
  process.exit(code);
};

for (const [signal, forward] of Object.entries(forwarded)) {
  process.on(signal, () => {
    received ??= signal;
    child.kill(forward);
  });
}

root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-test-'));
const home = path.join(root, 'home');
fs.mkdirSync(home);
const child = spawn(process.execPath, ['--test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, TMPDIR: root, TEMP: root, TMP: root, CHANGELEDGER_HOME: home },
});

child.on('error', (error) => {
  process.stderr.write(`run-tests: could not start node --test: ${error}\n`);
  finish(1);
});

child.on('close', (code, signal) => {
  const ended = received ?? signal;
  finish(ended ? 128 + os.constants.signals[ended] : (code ?? 1));
});
