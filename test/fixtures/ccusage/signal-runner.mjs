#!/usr/bin/env node
// Plays the ChangeLedger CLI blocked in one usage call: it runs the default
// ccusage runner against spawn-sleeper.mjs with the limit given in ms, so a
// test can signal this process's group mid-call. Arguments: <pidFile>
// <timeoutMs>. With no arguments, as `node --test` loads every module under
// test/, it does nothing.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [pidFile, timeoutMs] = process.argv.slice(2);
if (pidFile) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const { defaultCcusageRunner } = await import(
    path.resolve(here, '..', '..', '..', 'src', 'usage-collector.mjs')
  );
  defaultCcusageRunner(['session'], {
    timeoutMs: Number(timeoutMs),
    command: [process.execPath, path.join(here, 'spawn-sleeper.mjs'), pidFile],
  });
}
