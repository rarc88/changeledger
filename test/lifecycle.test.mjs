import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  assertTransition,
  canTransition,
  LOG_EVENT_DEFINITIONS,
  LOG_EVENT_PAYLOAD_FORMS,
  LOG_EVENT_TYPES,
  parseLogEvent,
  REVIEW_VERDICTS,
  serializeLogEvent,
  TASK_ACTIONS,
  VALIDATION_VERDICTS,
} from '../src/lifecycle.mjs';
import { initGitFixture, sanitizedEnv } from './helpers/git-env.mjs';

const LOG_AT = '- **2026-08-24T16:00:00Z**';
const logLine = (type, payload) => `${LOG_AT} \`[${type}]\` ${payload}`;

test('20260824-134716 CR1/CR2: closed lifecycle domains have one executable authority', () => {
  assert.deepEqual(LOG_EVENT_TYPES, [
    'status',
    'review',
    'validation',
    'owner',
    'branch',
    'graduation',
    'archive',
    'note',
    'version',
  ]);
  assert.deepEqual(Object.keys(LOG_EVENT_PAYLOAD_FORMS), LOG_EVENT_TYPES);
  assert.deepEqual(REVIEW_VERDICTS, ['pass', 'fail']);
  assert.deepEqual(VALIDATION_VERDICTS, ['pass', 'fail']);
  assert.deepEqual(TASK_ACTIONS, ['done', 'block']);
});

test('20260824-134716 CR1 correction: documented canonical payloads are the parser grammar', () => {
  assert.deepEqual(Object.keys(LOG_EVENT_DEFINITIONS), LOG_EVENT_TYPES);
  for (const [type, definition] of Object.entries(LOG_EVENT_DEFINITIONS)) {
    const parsed = parseLogEvent(logLine(type, definition.canonicalPayload));
    assert.ok(parsed, `${type} rejects documented payload: ${definition.canonicalPayload}`);
    assert.equal(definition.form, LOG_EVENT_PAYLOAD_FORMS[type]);
    if (definition.transition) {
      assert.equal(typeof parsed.from, 'string');
      assert.equal(typeof parsed.to, 'string');
    } else {
      assert.equal('from' in parsed, false, `${type} is not a transition event`);
      assert.equal('to' in parsed, false, `${type} is not a transition event`);
    }
  }
});

test('20260824-134716 CR1 correction: transition payloads contain exactly one transition', () => {
  for (const type of ['status', 'review', 'validation']) {
    const canonical = LOG_EVENT_DEFINITIONS[type].canonicalPayload;
    assert.equal(
      parseLogEvent(logLine(type, `${canonical} → done`)),
      null,
      `${type} accepted two transitions`,
    );
  }
});

test('20261001-155216 CR8: version events accept the SemVer grammar min_cli_version uses', () => {
  const accepted = [
    ['0.18.0', { version: '0.18.0' }],
    ['0.18.0-dev', { version: '0.18.0-dev' }],
    ['1.0.0-rc.1+build.5', { version: '1.0.0-rc.1+build.5' }],
    ['0.17.0 → 0.18.0', { previous: '0.17.0', version: '0.18.0' }],
    ['0.17.0 → 0.18.0-dev+abc.1', { previous: '0.17.0', version: '0.18.0-dev+abc.1' }],
    ['0.18.1 → 0.18.0', { previous: '0.18.1', version: '0.18.0' }],
  ];
  for (const [payload, expected] of accepted) {
    assert.deepEqual(
      parseLogEvent(logLine('version', payload)),
      { at: '2026-08-24T16:00:00Z', type: 'version', ...expected },
      payload,
    );
  }
  for (const payload of [
    '',
    'latest',
    '0.17',
    '0.17 → 0.18.0',
    '0.17.0 → latest',
    '01.0.0',
    '0.17.0 → 0.18.0 → 0.19.0',
    '0.17.0 → ',
    '0.17.0 -> 0.18.0',
    '0.18.0 (auto)',
  ]) {
    assert.equal(parseLogEvent(logLine('version', payload)), null, `accepted: ${payload}`);
  }
});

test('20261001-155216 CR8: version is not a transition event and serializes both forms', () => {
  assert.equal(LOG_EVENT_DEFINITIONS.version.transition, false);
  assert.equal(
    serializeLogEvent({ at: '2026-08-24T16:00:00Z', type: 'version', version: '0.18.0' }),
    '- **2026-08-24T16:00:00Z** `[version]` 0.18.0',
  );
  assert.equal(
    serializeLogEvent({
      at: '2026-08-24T16:00:00Z',
      type: 'version',
      previous: '0.17.0',
      version: '0.18.0-dev',
    }),
    '- **2026-08-24T16:00:00Z** `[version]` 0.17.0 → 0.18.0-dev',
  );
  assert.throws(
    () => serializeLogEvent({ at: '2026-08-24T16:00:00Z', type: 'version', version: 'latest' }),
    /invalid version Log event/,
  );
  assert.throws(
    () =>
      serializeLogEvent({
        at: '2026-08-24T16:00:00Z',
        type: 'version',
        previous: '0.17',
        version: '0.18.0',
      }),
    /invalid version Log event/,
  );
});

test('CR1: the happy path is allowed at every step', () => {
  const path = ['draft', 'approved', 'in-progress', 'in-validation', 'done'];
  for (let i = 0; i < path.length - 1; i++) {
    assert.ok(canTransition(path[i], path[i + 1]), `${path[i]} → ${path[i + 1]}`);
    assert.doesNotThrow(() => assertTransition(path[i], path[i + 1]));
  }
});

test('150232 CR4/CR5: done may re-enter normal flow while discarded remains terminal', () => {
  assert.equal(canTransition('done', 'in-progress'), true);
  assert.doesNotThrow(() => assertTransition('done', 'in-progress'));
  assert.throws(() => assertTransition('discarded', 'in-progress'), /invalid lifecycle transition/);
});

test('CR2: blocked is a reversible detour from in-progress', () => {
  assert.doesNotThrow(() => assertTransition('in-progress', 'blocked'));
  assert.doesNotThrow(() => assertTransition('blocked', 'in-progress'));
});

test('CR3: skips, regressions and self-loops are rejected', () => {
  for (const [from, to] of [
    ['draft', 'done'],
    ['draft', 'in-progress'],
    ['approved', 'draft'],
    ['in-progress', 'in-progress'],
  ]) {
    assert.throws(() => assertTransition(from, to), /(invalid lifecycle transition|already)/);
  }
});

test('custom (non-canonical) statuses keep enum-only behavior', () => {
  assert.doesNotThrow(() => assertTransition('draft', 'archived-custom'));
  assert.doesNotThrow(() => assertTransition('custom', 'done'));
});

// Review gate (change 20260615-150510): in-review sits between in-progress and
// done for review_required types.

test('171002 CR1: a review_required type cannot skip review before validation', () => {
  assert.throws(
    () =>
      assertTransition('in-progress', 'in-validation', {
        type: 'feature',
        reviewRequired: true,
      }),
    /^Error: feature changes must be reviewed before validation — move to in-review first$/,
  );
});

test('162616 CR3: an empty type does not deform the review-required message with a double space', () => {
  assert.throws(
    () =>
      assertTransition('in-progress', 'in-validation', {
        type: '',
        reviewRequired: true,
      }),
    /^Error: changes must be reviewed before validation — move to in-review first$/,
  );
});

test('171002 CR5: a non-review_required type goes from in-progress to validation', () => {
  assert.doesNotThrow(() =>
    assertTransition('in-progress', 'in-validation', { type: 'chore', reviewRequired: false }),
  );
  assert.throws(() => assertTransition('in-progress', 'done'), /invalid lifecycle transition/);
});

// 20260711-103756 CR2: the `quick` lane has no review gate — same shape as any
// other non-review_required type, proven explicitly for `quick`.
test('103756 CR2: a quick change goes from in-progress to validation without review', () => {
  assert.doesNotThrow(() =>
    assertTransition('in-progress', 'in-validation', { type: 'quick', reviewRequired: false }),
  );
});

test('CR5: in-review is only reachable from in-progress', () => {
  assert.throws(
    () => assertTransition('approved', 'in-review'),
    /^Error: invalid lifecycle transition: approved → in-review$/,
  );
  assert.doesNotThrow(() =>
    assertTransition('in-progress', 'in-review', { type: 'feature', reviewRequired: true }),
  );
});

// 20260726-141120 — the review gate closes on entry too: a type that does not
// declare `review_required` activates neither `specification` nor `plan`, so a
// reviewer dispatched against it has no criterion and no task to inspect.

test('141120 CR1: a type without review cannot enter in-review', () => {
  assert.throws(
    () => assertTransition('in-progress', 'in-review', { type: 'audit', reviewRequired: false }),
    /^Error: audit changes do not require review — move to in-validation instead$/,
  );
});

test('141120: a typeless document gets a named cause instead of "undefined"', () => {
  assert.throws(
    () => assertTransition('in-progress', 'in-review', { reviewRequired: false }),
    /^Error: cannot decide review entry: the change declares no type$/,
  );
});

test('141120 CR3: the lightweight type keeps its legitimate route to validation', () => {
  assert.doesNotThrow(() =>
    assertTransition('in-progress', 'in-validation', { type: 'audit', reviewRequired: false }),
  );
});

test('141120 CR4: feature and bug keep both review edges', () => {
  for (const type of ['feature', 'bug']) {
    assert.doesNotThrow(() =>
      assertTransition('in-progress', 'in-review', { type, reviewRequired: true }),
    );
    assert.throws(
      () => assertTransition('in-progress', 'in-validation', { type, reviewRequired: true }),
      new RegExp(
        `^Error: ${type} changes must be reviewed before validation — move to in-review first$`,
      ),
    );
  }
});

test('CR12: an edge outside the graph is rejected', () => {
  assert.throws(
    () => assertTransition('draft', 'done'),
    /^Error: invalid lifecycle transition: draft → done$/,
  );
});

test('171002 CR1/CR3: review and validation have distinct edges', () => {
  assert.doesNotThrow(() => assertTransition('in-review', 'in-progress'));
  assert.doesNotThrow(() => assertTransition('in-review', 'blocked'));
  assert.doesNotThrow(() => assertTransition('in-review', 'in-validation'));
  assert.doesNotThrow(() => assertTransition('in-validation', 'in-progress'));
  assert.doesNotThrow(() => assertTransition('in-validation', 'done'));
  assert.throws(() => assertTransition('in-review', 'done'), /invalid lifecycle transition/);
});

// 20260615-210508 — `discarded` terminal state.
test('discarded: reachable before closing gates, while done/validation stay terminal', () => {
  for (const from of ['draft', 'approved', 'in-progress', 'blocked']) {
    assert.ok(canTransition(from, 'discarded'), `${from} → discarded`);
  }
  assert.ok(!canTransition('done', 'discarded'), 'done is terminal, cannot discard');
  assert.ok(!canTransition('in-review', 'discarded'), 'must leave in-review first');
  assert.ok(!canTransition('in-validation', 'discarded'), 'must validate or reject first');
  assert.ok(!canTransition('discarded', 'in-progress'), 'discarded has no outgoing');
  assert.throws(
    () => assertTransition('discarded', 'in-progress'),
    /invalid lifecycle transition: discarded → in-progress/,
  );
});

// 20260630-225210 — shared Log event parser (CR2/CR5).
test('225210 CR2/CR5: parseLogEvent extracts explicit and implied origins', () => {
  assert.deepEqual(parseLogEvent('- **2026-06-30T10:36:01Z** `[status]` in-progress → in-review'), {
    at: '2026-06-30T10:36:01Z',
    type: 'status',
    from: 'in-progress',
    to: 'in-review',
  });
  assert.deepEqual(
    parseLogEvent(
      '- **2026-06-30T10:48:03Z** `[review]` in-review → in-validation (delegated subagent, clean context)',
    ),
    {
      at: '2026-06-30T10:48:03Z',
      type: 'review',
      from: 'in-review',
      to: 'in-validation',
      detail: 'delegated subagent, clean context',
    },
  );
  assert.deepEqual(
    parseLogEvent(
      '- **2026-06-30T15:28:42Z** `[validation]` in-validation → done (human accepted)',
    ),
    {
      at: '2026-06-30T15:28:42Z',
      type: 'validation',
      from: 'in-validation',
      to: 'done',
      detail: 'human accepted',
    },
  );
  assert.deepEqual(
    parseLogEvent(
      '- **2026-06-30T15:28:42Z** `[status]` in-progress → discarded: superseded — duplicate',
    ),
    {
      at: '2026-06-30T15:28:42Z',
      type: 'status',
      from: 'in-progress',
      to: 'discarded',
      reason: 'superseded — duplicate',
    },
  );
  assert.deepEqual(parseLogEvent('- **2026-06-30T15:28:42Z** `[owner]` set: ana (auto)'), {
    at: '2026-06-30T15:28:42Z',
    type: 'owner',
    owner: 'ana',
    automatic: true,
  });
  assert.deepEqual(parseLogEvent('- **2026-08-05T05:27:41Z** `[branch]` set: feature/x (auto)'), {
    at: '2026-08-05T05:27:41Z',
    type: 'branch',
    branch: 'feature/x',
    automatic: true,
  });
  assert.deepEqual(parseLogEvent('- **2026-08-05T05:27:41Z** `[branch]` set: hotfix/y'), {
    at: '2026-08-05T05:27:41Z',
    type: 'branch',
    branch: 'hotfix/y',
  });
  assert.deepEqual(parseLogEvent('- **2026-08-05T05:27:41Z** `[branch]` cleared'), {
    at: '2026-08-05T05:27:41Z',
    type: 'branch',
    branch: null,
  });
  assert.deepEqual(parseLogEvent('- **2026-06-30T15:28:42Z** `[graduation]` spec: `x.md`'), {
    at: '2026-06-30T15:28:42Z',
    type: 'graduation',
    outcome: 'spec',
    spec: 'x.md',
  });
  assert.equal(parseLogEvent('- plain decision note'), null);
});

test('125007 CR7: typed log text payloads round-trip without delimiter parsing', () => {
  for (const event of [
    {
      at: '2026-07-20T10:00:00Z',
      type: 'note',
      message: 'status: draft → done — [graduation] | x:y',
    },
    {
      at: '2026-07-20T10:00:01Z',
      type: 'review',
      from: 'in-review',
      to: 'blocked',
      reason: 'evidence — platform | [status]: missing',
    },
  ]) {
    const line = serializeLogEvent(event);
    assert.deepEqual(parseLogEvent(line), event);
    assert.equal(serializeLogEvent(parseLogEvent(line)), line);
  }
});

// 20260730-183807 CR6 — `changeledger log <id> "[note] msg"` must not
// duplicate the `[note]` tag the renderer already prepends.

test('183807 CR6: a message already prefixed with "[note] " is not duplicated', () => {
  const line = serializeLogEvent({
    at: '2026-07-30T18:00:00Z',
    type: 'note',
    message: '[note] this is a manual note',
  });
  assert.equal(line, '- **2026-07-30T18:00:00Z** `[note]` this is a manual note');
});

test('183807 CR6: a doubled "[note] [note] " prefix strips exactly one occurrence', () => {
  const line = serializeLogEvent({
    at: '2026-07-30T18:00:00Z',
    type: 'note',
    message: '[note] [note] x',
  });
  assert.equal(line, '- **2026-07-30T18:00:00Z** `[note]` [note] x');
});

test('183807 CR6: a message without the prefix is kept verbatim', () => {
  const line = serializeLogEvent({
    at: '2026-07-30T18:00:00Z',
    type: 'note',
    message: 'this is a manual note',
  });
  assert.equal(line, '- **2026-07-30T18:00:00Z** `[note]` this is a manual note');
});

test('183807 CR6: an interior "[note]" is ordinary text and is preserved', () => {
  const line = serializeLogEvent({
    at: '2026-07-30T18:00:00Z',
    type: 'note',
    message: 'saw a [note] in the middle',
  });
  assert.equal(line, '- **2026-07-30T18:00:00Z** `[note]` saw a [note] in the middle');
});

// 20260722-124656 CR3 — the readiness refusal lives on the write path in
// `src/commands/agent.mjs`, never in the graph. Removing this edge would "fix"
// an unready candidate by making every candidate unreachable, so pin it here.
test('124656 CR3: the in-review edges stay legal; readiness is not a graph rule', () => {
  assert.doesNotThrow(() =>
    assertTransition('in-progress', 'in-review', { type: 'feature', reviewRequired: true }),
  );
  // The no-verdict return the contract names is a graph edge, not a review verdict.
  // Only `canTransition` is asserted here: `assertTransition('in-review',
  // 'in-progress')` is already pinned by `171002 CR1/CR3` above, and this repo
  // keeps one home per truth.
  assert.equal(canTransition('in-review', 'in-progress'), true);
});

// 20261002-113320 CR8 — first real use of the `documentation` type, through the
// spawned CLI on a freshly initialised repo: a change with one criterion and no
// Plan walks approve → in-progress → in-review → review pass. The review gate of
// a tdd-off type is still honoured: `review` is what reaches validation.
test('113320 CR8: a documentation change without a Plan reaches in-validation', () => {
  const bin = fileURLToPath(new URL('../bin/changeledger.mjs', import.meta.url));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-doc-e2e-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  initGitFixture(root);
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  const cli = (...args) => {
    try {
      return {
        code: 0,
        out: execFileSync('node', [bin, ...args], { cwd: root, env, encoding: 'utf8' }),
      };
    } catch (e) {
      return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  };
  const ok = (...args) => {
    const result = cli(...args);
    assert.equal(result.code, 0, `${args.join(' ')}: ${result.out}`);
    return result.out;
  };

  ok('init');
  ok('new', 'documentation', 'auth-truth', 'Auth truth', '--owner', 'Test User');
  const dir = path.join(root, '.changeledger', 'changes');
  const [name] = fs.readdirSync(dir);
  const file = path.join(dir, name);
  const id = name.slice(0, 15);
  const text = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(text, /## Plan/);
  fs.writeFileSync(
    file,
    text
      .replace('## Request\n', '## Request\n\nDocument authentication.\n')
      .replace(
        '## Investigation\n',
        '## Investigation\n\n`src/auth.mjs` `login` is the entry point.\n',
      )
      .replace(
        '## Specification\n',
        '## Specification\n\n### CR1 — Login claim\n- **Given** `src/auth.mjs` `login`\n- **When** it is read\n- **Then** the spec states what it does\n',
      ),
  );

  ok('approve', id);
  execFileSync('git', ['checkout', '-q', '-b', `documentation/${id}`], {
    cwd: root,
    env: sanitizedEnv(),
  });
  ok('status', id, 'in-progress');
  const skipped = cli('status', id, 'in-validation');
  assert.notEqual(skipped.code, 0);
  assert.match(skipped.out, /must be reviewed before validation — move to in-review first/);
  ok('status', id, 'in-review');
  ok('review', id, 'pass');
  assert.match(fs.readFileSync(file, 'utf8'), /^status: in-validation$/m);
});

// 20261002-152555 CR8 — first use of `graduation-review`, through the spawned CLI
// on a freshly initialised repo: a feature change reaches `done`, the orchestrator
// corrects the body of an existing spec, takes the role's skeleton and capsule,
// records the review outcome and only then links the spec with `--into`.
test('152555 CR8: a graduation review is recorded before the first --into of a done feature', () => {
  const bin = fileURLToPath(new URL('../bin/changeledger.mjs', import.meta.url));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-gradrev-e2e-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  initGitFixture(root);
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  const ok = (...args) => {
    try {
      return execFileSync('node', [bin, ...args], { cwd: root, env, encoding: 'utf8' });
    } catch (e) {
      assert.fail(`${args.join(' ')} exited ${e.status}: ${e.stdout ?? ''}${e.stderr ?? ''}`);
    }
  };

  ok('init');
  const specFile = path.join(root, '.changeledger', 'specs', 'auth.md');
  fs.mkdirSync(path.dirname(specFile), { recursive: true });
  fs.writeFileSync(
    specFile,
    '---\ntitle: Authentication\nupdated: 2026-10-01T10:00:00Z\ntags: []\ngraduated_from: []\n---\n\n`src/auth.mjs` `login` returns a token.\n',
  );
  ok('new', 'feature', 'auth-session', 'Auth session', '--owner', 'Test User');
  const dir = path.join(root, '.changeledger', 'changes');
  const [name] = fs.readdirSync(dir);
  const file = path.join(dir, name);
  const id = name.slice(0, 15);
  fs.writeFileSync(
    file,
    fs
      .readFileSync(file, 'utf8')
      .replace('## Request\n', '## Request\n\nLogin must return a session.\n')
      .replace(
        '## Investigation\n',
        '## Investigation\n\n`src/auth.mjs` `login` returns a token.\n',
      )
      .replace('## Proposal\n', '## Proposal\n\nReturn a session.\n')
      .replace(
        '## Specification\n',
        '## Specification\n\n### CR1 — Session\n- **Given** valid credentials\n- **When** `login` runs\n- **Then** it returns a session\n',
      )
      .replace(
        '## Plan\n',
        '## Plan\n\n- [ ] Return a session\n  - **Target:** `src/auth.mjs`\n  - **Verify:** `node --test test/auth.test.mjs`\n  - **Criteria:** CR1\n',
      ),
  );

  ok('approve', id);
  execFileSync('git', ['checkout', '-q', '-b', `feature/${id}`], {
    cwd: root,
    env: sanitizedEnv(),
  });
  ok('status', id, 'in-progress');
  ok('task', id, 'done', '1');
  ok('status', id, 'in-review');
  ok('review', id, 'pass');
  ok('validation', id, 'pass');
  assert.match(fs.readFileSync(file, 'utf8'), /^status: done$/m);

  // The closure corrects the existing spec's body, then has it reviewed.
  fs.writeFileSync(
    specFile,
    fs.readFileSync(specFile, 'utf8').replace('returns a token', 'returns a session'),
  );
  assert.match(
    ok('agent-prompt', 'graduation-review'),
    /^===== CHANGELEDGER AGENT PROMPT BEGIN — role: graduation-review — v/,
  );
  assert.match(
    ok('agent-context', 'graduation-review', id),
    new RegExp(
      `^===== CHANGELEDGER AGENT CONTEXT BEGIN — role: graduation-review — change: #${id} — v`,
    ),
  );
  const outcome = 'graduation-review: apply — no findings';
  ok('log', id, outcome);
  ok('graduate', id, 'auth', '--into');

  const events = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => parseLogEvent(line))
    .filter(Boolean);
  const note = events.findIndex((e) => e.type === 'note' && e.message === outcome);
  const graduation = events.findIndex((e) => e.type === 'graduation' && e.spec === 'auth.md');
  assert.notEqual(note, -1, 'the review outcome is not in the Log');
  assert.notEqual(graduation, -1, 'the graduation event is not in the Log');
  assert.ok(note < graduation, 'the review outcome is not logged before the graduation');
  assert.match(fs.readFileSync(specFile, 'utf8'), /`login` returns a session\./);
});

// 20261002-181346 CR10 — first use of a type that integrates into the release
// branch, through the spawned CLI on a freshly initialised repo. `dev` carries
// a commit `main` lacks, so the change branch cut from `main` starts only when
// the guard resolves the type's release branch rather than the integration one.
test('181346 CR10: a release-type change starts from git.release_branch end to end', () => {
  const bin = fileURLToPath(new URL('../bin/changeledger.mjs', import.meta.url));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-release-e2e-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  initGitFixture(root, { args: ['-b', 'main'] });
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  const git = (...args) => execFileSync('git', args, { cwd: root, env: sanitizedEnv() });
  const ok = (...args) => {
    try {
      return execFileSync('node', [bin, ...args], { cwd: root, env, encoding: 'utf8' });
    } catch (e) {
      assert.fail(`${args.join(' ')} exited ${e.status}: ${e.stdout ?? ''}${e.stderr ?? ''}`);
    }
  };

  ok('init');
  const configFile = path.join(root, '.changeledger', 'config.yml');
  const config = parseYaml(fs.readFileSync(configFile, 'utf8'));
  config.git = { ...config.git, integration_branch: 'dev', release_branch: 'main' };
  config.types.fix = { ...config.types.bug, integrates_into: 'release' };
  config.release.impacts.fix = 'patch';
  fs.writeFileSync(configFile, stringifyYaml(config));
  ok('check');
  git('config', 'commit.gpgsign', 'false');
  git('add', '.');
  git('commit', '-q', '-m', 'chore: baseline');
  git('checkout', '-q', '-b', 'dev');
  fs.writeFileSync(path.join(root, 'UNRELEASED'), 'work\n');
  git('add', 'UNRELEASED');
  git('commit', '-q', '-m', 'feat: unreleased work');
  git('checkout', '-q', 'main');

  ok('new', 'fix', 'prod-outage', 'Prod outage', '--owner', 'Test User');
  const dir = path.join(root, '.changeledger', 'changes');
  const [name] = fs.readdirSync(dir);
  const file = path.join(dir, name);
  const id = name.slice(0, 15);
  fs.writeFileSync(
    file,
    fs
      .readFileSync(file, 'utf8')
      .replace('## Request\n', '## Request\n\nProduction login fails.\n')
      .replace('## Investigation\n', '## Investigation\n\n`src/auth.mjs` `login` throws.\n')
      .replace(
        '## Specification\n',
        '## Specification\n\n### CR1 — Login\n- **Given** valid credentials\n- **When** `login` runs\n- **Then** it returns a session\n',
      )
      .replace(
        '## Plan\n',
        '## Plan\n\n- [ ] Fix login\n  - **Target:** `src/auth.mjs`\n  - **Verify:** `node --test test/auth.test.mjs`\n  - **Criteria:** CR1\n',
      ),
  );

  ok('approve', id);
  git('checkout', '-q', '-b', `fix/${id}`, 'main');
  ok('status', id, 'in-progress');
  assert.match(fs.readFileSync(file, 'utf8'), /^status: in-progress$/m);
  const policy = ok('context', id)
    .split('\n')
    .find((line) => line.startsWith('Effective policy:'));
  assert.match(policy, / — integration_branch=main /, policy);
});

// 20261002-181428 CR6 — first use of the shipped `hotfix` type, through the
// spawned CLI on a freshly initialised repo whose template is left as generated
// except for the two branches: the change starts from `main` and its context
// names `dev` as the branch to bring the integrated result back to.
test('181428 CR6: a hotfix change publishes its release branch and back_merge_branch end to end', () => {
  const bin = fileURLToPath(new URL('../bin/changeledger.mjs', import.meta.url));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-hotfix-e2e-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  initGitFixture(root, { args: ['-b', 'main'] });
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  const git = (...args) => execFileSync('git', args, { cwd: root, env: sanitizedEnv() });
  const ok = (...args) => {
    try {
      return execFileSync('node', [bin, ...args], { cwd: root, env, encoding: 'utf8' });
    } catch (e) {
      assert.fail(`${args.join(' ')} exited ${e.status}: ${e.stdout ?? ''}${e.stderr ?? ''}`);
    }
  };

  ok('init');
  const configFile = path.join(root, '.changeledger', 'config.yml');
  const config = parseYaml(fs.readFileSync(configFile, 'utf8'));
  config.git = { ...config.git, integration_branch: 'dev', release_branch: 'main' };
  fs.writeFileSync(configFile, stringifyYaml(config));
  ok('check');
  git('config', 'commit.gpgsign', 'false');
  git('add', '.');
  git('commit', '-q', '-m', 'chore: baseline');
  git('branch', 'dev');

  ok('new', 'hotfix', 'prod-outage', 'Prod outage', '--owner', 'Test User');
  const dir = path.join(root, '.changeledger', 'changes');
  const [name] = fs.readdirSync(dir);
  const file = path.join(dir, name);
  const id = name.slice(0, 15);
  fs.writeFileSync(
    file,
    fs
      .readFileSync(file, 'utf8')
      .replace('## Request\n', '## Request\n\nProduction login fails.\n')
      .replace('## Investigation\n', '## Investigation\n\n`src/auth.mjs` `login` throws.\n')
      .replace(
        '## Specification\n',
        '## Specification\n\n### CR1 — Login\n- **Given** valid credentials\n- **When** `login` runs\n- **Then** it returns a session\n',
      )
      .replace(
        '## Plan\n',
        '## Plan\n\n- [ ] Fix login\n  - **Target:** `src/auth.mjs`\n  - **Verify:** `node --test test/auth.test.mjs`\n  - **Criteria:** CR1\n',
      ),
  );

  ok('approve', id);
  git('checkout', '-q', '-b', `hotfix/${id}`, 'main');
  ok('status', id, 'in-progress');
  assert.match(fs.readFileSync(file, 'utf8'), /^status: in-progress$/m);
  const policy = ok('context', id)
    .split('\n')
    .find((line) => line.startsWith('Effective policy:'));
  assert.match(policy, / — integration_branch=main — back_merge_branch=dev /, policy);
});
