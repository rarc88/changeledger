#!/usr/bin/env node
// Stand-in for a hanging ccusage behind `npx`: it starts a long-sleeping child
// (the "grandchild" of the runner), records `{ sleeper, grandchild }` pids as
// JSON in the file named by its first argument, and then hangs while writing
// a line every 100 ms. With no arguments, as
// `node --test` loads every module under test/, it does nothing.

import { spawn } from 'node:child_process';
import fs from 'node:fs';

const pidFile = process.argv[2];
if (pidFile) {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
    stdio: 'ignore',
  });
  fs.writeFileSync(pidFile, JSON.stringify({ sleeper: process.pid, grandchild: child.pid }));
  // Keeps writing, as a ccusage producing output would, so a broken relay
  // pipe shows up.
  setInterval(() => process.stdout.write('tick\n'), 100);
  setTimeout(() => {}, 60_000);
}
