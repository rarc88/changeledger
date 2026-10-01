// Usage collector (20261001-155612): the `ccusage` snapshot taken after a
// lifecycle event lands. Every case drives an injected runner fed by the
// captured fixtures — no test reaches the network or the real `ccusage`.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  CCUSAGE_TIMEOUT_MS,
  collectUsage,
  defaultCcusageRunner,
  encodeProjectPath,
  snapshotUsage,
  usageDir,
} from '../src/usage-collector.mjs';
import {
  claudeRunner,
  fakeRunner,
  fixture,
  PLACEHOLDER,
  withProjectPaths,
} from './helpers/ccusage.mjs';
import { initGitFixture } from './helpers/git-env.mjs';
import { git } from './helpers/state-repo.mjs';

const CONFIG = { usage: { collector: 'ccusage' } };

function gitRepo() {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-usage-')),
  );
  initGitFixture(root);
  fs.writeFileSync(path.join(root, 'README.md'), 'x\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'seed']);
  return root;
}

function commonDir(root) {
  return path.resolve(root, git(root, ['rev-parse', '--git-common-dir']));
}

function records(root, id) {
  const dir = path.join(commonDir(root), 'changeledger', 'usage', id);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .sort()
    .map((name) => ({ name, record: JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) }));
}

const statusEvent = (at = '2026-10-01T16:56:41Z') => ({
  change: '20261001-155612',
  event: 'status',
  from: 'approved',
  to: 'in-progress',
  at,
});

function snapshot(root, runner, { events = [statusEvent()], config = CONFIG } = {}) {
  const warnings = [];
  snapshotUsage({
    config,
    repoRoot: root,
    events,
    usage: { runner, warn: (l) => warnings.push(l) },
  });
  return warnings;
}

test('encodeProjectPath replaces every non-alphanumeric character with "-"', () => {
  assert.equal(
    encodeProjectPath('/home/u/repositories/my.repo_x'),
    '-home-u-repositories-my-repo-x',
  );
  assert.equal(encodeProjectPath('C:\\Users\\a b'), 'C--Users-a-b');
});

test('CR3: a snapshot writes one complete record keyed by the event instant', () => {
  const root = gitRepo();
  const runner = claudeRunner(encodeProjectPath(root));
  const warnings = snapshot(root, runner);

  const found = records(root, '20261001-155612');
  assert.deepEqual(
    found.map((r) => r.name),
    ['20261001T165641Z-1.json'],
  );
  const { record } = found[0];
  const online = fixture('claude-session-online.json').sessions[0];
  assert.deepEqual(record, {
    schema: 1,
    change: '20261001-155612',
    at: '2026-10-01T16:56:41Z',
    event: 'status',
    from: 'approved',
    to: 'in-progress',
    collector: { name: 'ccusage', version: '20.0.26', pricing: 'online' },
    sessions: [
      {
        source: 'claude',
        session_id: online.sessionId,
        project_path: encodeProjectPath(root),
        first_activity: online.firstActivity,
        last_activity: online.lastActivity,
        models: online.modelBreakdowns.map((b) => ({
          model: b.modelName,
          input_tokens: b.inputTokens,
          output_tokens: b.outputTokens,
          cache_read_tokens: b.cacheReadTokens,
          cache_write_tokens: b.cacheCreationTokens,
          cost_usd: b.cost,
        })),
      },
    ],
    excluded: [],
    error: null,
  });
  assert.equal(record.sessions[0].models.length, 2);
  assert.deepEqual(warnings, []);
  // Every call is bounded by the 10 s limit.
  assert.ok(runner.calls.length >= 2);
  for (const call of runner.calls) assert.equal(call.options.timeoutMs, CCUSAGE_TIMEOUT_MS);
  assert.equal(CCUSAGE_TIMEOUT_MS, 10_000);
});

test('CR3: a second record at the same instant takes the next free number', () => {
  const root = gitRepo();
  const runner = claudeRunner(encodeProjectPath(root));
  snapshot(root, runner, { events: [statusEvent(), statusEvent()] });
  snapshot(root, runner);
  assert.deepEqual(
    records(root, '20261001-155612').map((r) => r.name),
    ['20261001T165641Z-1.json', '20261001T165641Z-2.json', '20261001T165641Z-3.json'],
  );
});

test('CR5: only sessions of the repo root and its worktrees count, by equality', () => {
  const root = gitRepo();
  const worktree = `${root}-wt`;
  git(root, ['worktree', 'add', '-q', worktree]);
  const runner = claudeRunner(null, {
    'claude session --json': withProjectPaths(fixture('claude-session-online.json'), {
      [PLACEHOLDER.root]: encodeProjectPath(root),
      [PLACEHOLDER.worktree]: encodeProjectPath(worktree),
      [PLACEHOLDER.rootFoo]: `${encodeProjectPath(root)}-foo`,
    }),
  });
  snapshot(root, runner);
  const [{ record }] = records(root, '20261001-155612');
  assert.deepEqual(
    record.sessions.map((s) => s.project_path),
    [encodeProjectPath(root), encodeProjectPath(worktree)],
  );
});

test('CR5: no matching session leaves sessions [] and warns', () => {
  const root = gitRepo();
  const runner = claudeRunner('-somewhere-else');
  const warnings = snapshot(root, runner);
  const [{ record }] = records(root, '20261001-155612');
  assert.deepEqual(record.sessions, []);
  assert.equal(record.error, null);
  assert.deepEqual(warnings, ['usage: no sessions matched this repository']);
});

// No gemini sessions existed on the capture machine, so its documents are
// derived from the captured unified listing: the same per-session shape that
// carries `agent`/`metadata`/`period` and no `projectPath`.
function geminiListing() {
  const listing = fixture('session-no-cost.json');
  return {
    ...listing,
    session: listing.session.map((s, i) => (i < 2 ? { ...s, agent: 'gemini' } : s)),
  };
}

function geminiSessions() {
  const listing = fixture('session-no-cost.json');
  const { totals } = listing;
  return {
    sessions: listing.session.slice(0, 2).map(({ agent: _agent, ...rest }) => rest),
    totals,
  };
}

test('CR6: a source whose sessions lack projectPath is excluded with a warning', () => {
  const root = gitRepo();
  const runner = claudeRunner(encodeProjectPath(root), {
    'session --json --offline --no-cost': geminiListing(),
    'gemini session --json': geminiSessions(),
  });
  const warnings = snapshot(root, runner);
  const [{ record }] = records(root, '20261001-155612');
  assert.deepEqual(record.excluded, [{ source: 'gemini', sessions: 2 }]);
  assert.deepEqual(
    record.sessions.map((s) => s.source),
    ['claude'],
  );
  assert.deepEqual(warnings, ['usage: excluded gemini (2 sessions without projectPath)']);
});

test('CR7: online failure falls back to offline prices and never invents a zero', () => {
  const root = gitRepo();
  const offline = withProjectPaths(fixture('claude-session-offline.json'), {
    [PLACEHOLDER.root]: encodeProjectPath(root),
  });
  assert.ok(offline.totals.unpricedModels.includes('claude-sonnet-5-5'));
  const runner = claudeRunner(null, {
    'claude session --json': { status: 1, stdout: '', stderr: 'fetch failed' },
    'claude session --json --offline': offline,
  });
  const warnings = snapshot(root, runner);
  const [{ record }] = records(root, '20261001-155612');
  assert.equal(record.collector.pricing, 'offline');
  const models = Object.fromEntries(record.sessions[0].models.map((m) => [m.model, m]));
  assert.equal(models['claude-sonnet-5-5'].cost_usd, null);
  assert.equal(models['claude-opus-5-5'].cost_usd, offline.sessions[0].modelBreakdowns[0].cost);
  assert.deepEqual(warnings, ['usage: online pricing unavailable; used ccusage offline prices']);
});

const FAILURES = {
  'npx absent': () => ({
    status: null,
    stdout: '',
    stderr: '',
    error: Object.assign(new Error('spawnSync npx ENOENT'), { code: 'ENOENT' }),
  }),
  timeout: () => ({
    status: null,
    signal: 'SIGTERM',
    stdout: '',
    stderr: '',
    error: Object.assign(new Error('spawnSync npx ETIMEDOUT'), { code: 'ETIMEDOUT' }),
  }),
  'non-zero exit': () => ({ status: 1, stdout: '', stderr: 'boom' }),
  'invalid JSON': () => ({ status: 0, stdout: '{"sessions": [', stderr: '' }),
};

for (const [name, response] of Object.entries(FAILURES)) {
  test(`CR8: ${name} leaves a visible gap record and a warning`, () => {
    const root = gitRepo();
    const runner = fakeRunner({
      'session --json --offline --no-cost': fixture('session-no-cost.json'),
      'claude session --json': response,
      'claude session --json --offline': response,
    });
    const warnings = snapshot(root, runner);
    const [{ record }] = records(root, '20261001-155612');
    assert.deepEqual(record.sessions, []);
    assert.equal(typeof record.error, 'string');
    assert.ok(record.error.length > 0);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /^usage: snapshot failed: /);
  });

  test(`CR8: ${name} on the source listing is a failure too`, () => {
    const root = gitRepo();
    const warnings = snapshot(root, fakeRunner({ 'session --json --offline --no-cost': response }));
    const [{ record }] = records(root, '20261001-155612');
    assert.deepEqual(record.sessions, []);
    assert.notEqual(record.error, null);
    assert.match(warnings[0], /^usage: snapshot failed: /);
  });
}

test('CR8: the real runner bounds a call with its timeout and reports a missing binary', () => {
  const slow = defaultCcusageRunner(['session'], {
    timeoutMs: 200,
    command: [process.execPath, '-e', 'setTimeout(() => {}, 5000)'],
  });
  assert.equal(slow.error?.code, 'ETIMEDOUT');
  const missing = defaultCcusageRunner(['session'], {
    timeoutMs: 200,
    command: ['changeledger-no-such-binary-xyz'],
  });
  assert.equal(missing.error?.code, 'ENOENT');

  const timedOut = collectUsage({
    projectPaths: ['/x'],
    runner: (args, options) =>
      defaultCcusageRunner(args, {
        ...options,
        timeoutMs: 200,
        command: [process.execPath, '-e', 'setTimeout(() => {}, 5000)'],
      }),
  });
  assert.match(timedOut.error, /timed out/);
});

test('CR1: without the usage key no process runs and nothing is written', () => {
  const root = gitRepo();
  const runner = claudeRunner(encodeProjectPath(root));
  const gitCalls = [];
  const warnings = [];
  snapshotUsage({
    config: {},
    repoRoot: root,
    events: [statusEvent()],
    usage: {
      runner,
      gitRun: (args) => gitCalls.push(args),
      warn: (l) => warnings.push(l),
    },
  });
  assert.equal(runner.calls.length, 0);
  assert.equal(gitCalls.length, 0);
  assert.deepEqual(warnings, []);
  assert.equal(fs.existsSync(usageDir(commonDir(root))), false);
});

test('a directory outside git writes no record and warns without throwing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-usage-nogit-'));
  const runner = claudeRunner(encodeProjectPath(root));
  const warnings = snapshot(root, runner);
  assert.equal(runner.calls.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^usage: snapshot failed: /);
});

test('an invalid usage key at transition time skips the snapshot with a warning', () => {
  const root = gitRepo();
  const runner = claudeRunner(encodeProjectPath(root));
  const warnings = snapshot(root, runner, { config: { usage: { collector: 'other' } } });
  assert.equal(runner.calls.length, 0);
  assert.deepEqual(warnings, [
    'usage: snapshot skipped: config "usage.collector" must be "ccusage"',
  ]);
  assert.equal(fs.existsSync(usageDir(commonDir(root))), false);
});
