// Fake `ccusage` for the usage-collector suites. Fixtures under
// `test/fixtures/ccusage/` are trimmed, anonymized captures of the real
// `npx --yes ccusage@20.0.26` output (field shapes kept exactly); their
// placeholder `projectPath` values are rewritten per test to the encoding of
// whatever temporary repo the test built, so no test depends on a host path.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATE_REF } from '../../src/state-store.mjs';
import { git } from './state-repo.mjs';

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'ccusage',
);

// Placeholders the captured fixtures carry, in fixture order.
export const PLACEHOLDER = {
  root: '-home-user-repositories-demo',
  worktree: '-home-user-repositories-demo-wt',
  rootFoo: '-home-user-repositories-demo-foo',
  other: '-home-user-repositories-other',
};

export function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
}

// Rewrites each session's placeholder projectPath through `map`
// (placeholder → replacement); unmapped placeholders stay as captured.
export function withProjectPaths(doc, map) {
  return {
    ...doc,
    sessions: doc.sessions.map((s) =>
      Object.hasOwn(map, s.projectPath) ? { ...s, projectPath: map[s.projectPath] } : s,
    ),
  };
}

// A runner with the collector's contract: `(args, { timeoutMs })` →
// spawnSync-shaped `{ status, stdout, stderr, error }`. `responses` maps the
// joined argument string to either a JSON-serializable document (exit 0), a
// `{ status, stdout, stderr, error }` result, or a function returning one.
// Every call is recorded in `runner.calls`.
export function fakeRunner(responses) {
  const calls = [];
  const runner = (args, options) => {
    calls.push({ args: [...args], options });
    const key = args.join(' ');
    let response = responses[key];
    if (typeof response === 'function') response = response(args, options);
    if (response === undefined) {
      return { status: 2, stdout: '', stderr: `Unknown command '${key}'` };
    }
    if (response && typeof response === 'object' && 'status' in response) return response;
    return { status: 0, stdout: `${JSON.stringify(response, null, 2)}\n`, stderr: '' };
  };
  runner.calls = calls;
  return runner;
}

// The default happy path: the source listing names only `claude`, and
// `claude session --json` returns the captured online fixture with its first
// session (two models) rewritten to the given encoded root.
export function claudeRunner(encodedRoot, extra = {}) {
  return fakeRunner({
    'session --json --offline --no-cost': fixture('session-no-cost.json'),
    'claude session --json': withProjectPaths(fixture('claude-session-online.json'), {
      [PLACEHOLDER.root]: encodedRoot,
    }),
    ...extra,
  });
}

// A complete usage record as the collector publishes it (20261002-133728):
// the `schema: 1` record plus `recorded_by`. `extra` overrides any field.
export function usageRecordText(change, at = '2026-10-02T15:32:33Z', extra = {}) {
  const record = {
    schema: 1,
    change,
    at,
    event: 'status',
    from: 'approved',
    to: 'in-progress',
    recorded_by: 'Test User',
    collector: { name: 'ccusage', version: '20.0.26', pricing: 'online' },
    sessions: [],
    excluded: [],
    error: null,
    ...extra,
  };
  return `${JSON.stringify(record, null, 2)}\n`;
}

// Every usage record of `id` the LEDGER holds, in either layout, as
// `{ name, ...record }` sorted by name: the state ref's `usage/` collection when
// the repo is activated, the worktree's `.changeledger/usage/` otherwise.
// `id === undefined` returns every record.
export function ledgerUsageRecords(root, id) {
  const ownsRecord = (name) => id === undefined || name.startsWith(`${id}--`);
  if (isActivated(root)) {
    const listing = git(root, [
      'ls-tree',
      '-r',
      '--name-only',
      STATE_REF,
      '--',
      '.changeledger-state/usage/',
    ]);
    return listing
      .split('\n')
      .filter(Boolean)
      .map((full) => path.posix.basename(full))
      .filter(ownsRecord)
      .sort()
      .map((name) => ({
        name,
        ...JSON.parse(git(root, ['show', `${STATE_REF}:.changeledger-state/usage/${name}`])),
      }));
  }
  const dir = path.join(root, '.changeledger', 'usage');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(ownsRecord)
    .sort()
    .map((name) => ({ name, ...JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) }));
}

function isActivated(root) {
  try {
    git(root, ['rev-parse', '--verify', '--quiet', 'refs/changeledger/activation']);
    return true;
  } catch {
    return false;
  }
}

// The directory the 20261001-155612 collector wrote to, which no longer
// receives records (20261002-133728).
export function gitCommonUsageDir(root) {
  return path.join(
    path.resolve(root, git(root, ['rev-parse', '--git-common-dir'])),
    'changeledger',
  );
}

// `<id>--<instant from the ISO at>-<8 hex>.json`.
export function usageNamePattern(id, at) {
  return new RegExp(`^${id}--${at.replace(/[-:]/g, '')}-[0-9a-f]{8}\\.json$`);
}
