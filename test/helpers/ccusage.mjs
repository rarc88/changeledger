// Fake `ccusage` for the usage-collector suites. Fixtures under
// `test/fixtures/ccusage/` are trimmed, anonymized captures of the real
// `npx --yes ccusage@20.0.26` output (field shapes kept exactly); their
// placeholder `projectPath` values are rewritten per test to the encoding of
// whatever temporary repo the test built, so no test depends on a host path.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
