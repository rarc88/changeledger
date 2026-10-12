#!/usr/bin/env node
// Local stand-in for `npx --yes ccusage@20.0.26`, wired through
// CHANGELEDGER_USAGE_COMMAND by CLI-level and in-process suites. It answers
// from the captured fixtures beside it and never touches the network.
//
//   FAKE_CCUSAGE_LOG   file that receives one line per call (the arguments)
//   FAKE_CCUSAGE_ROOT  encoded projectPath substituted for the fixtures' root
//   FAKE_CCUSAGE_MODE  ok (default) | fail | invalid | sleep

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
// `node --test` also loads every module under test/ with no arguments; that
// run is not a ccusage call, so it answers nothing and succeeds.
if (!args.length) process.exit(0);
if (process.env.FAKE_CCUSAGE_LOG) {
  fs.appendFileSync(process.env.FAKE_CCUSAGE_LOG, `${args.join(' ')}\n`);
}

const mode = process.env.FAKE_CCUSAGE_MODE ?? 'ok';
if (mode === 'fail') {
  process.stderr.write('fake ccusage failure\n');
  process.exit(1);
}
if (mode === 'invalid') {
  process.stdout.write('{"sessions": [');
  process.exit(0);
}
if (mode === 'sleep') {
  setTimeout(() => {}, 60_000);
} else {
  const read = (name) => JSON.parse(fs.readFileSync(path.join(here, name), 'utf8'));
  const key = args.join(' ');
  let doc;
  if (key === 'session --json --offline --no-cost') doc = read('session-no-cost.json');
  else if (key === 'claude session --json') doc = read('claude-session-online.json');
  else if (key === 'claude session --json --offline') doc = read('claude-session-offline.json');
  if (!doc) {
    process.stderr.write(`Unknown command '${key}'\n`);
    process.exit(2);
  }
  const root = process.env.FAKE_CCUSAGE_ROOT;
  if (root && Array.isArray(doc.sessions)) {
    doc.sessions = doc.sessions.map((s) =>
      s.projectPath === '-home-user-repositories-demo' ? { ...s, projectPath: root } : s,
    );
  }
  process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
}
