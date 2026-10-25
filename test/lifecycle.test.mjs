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
    'finding',
  ]);
  assert.deepEqual(Object.keys(LOG_EVENT_PAYLOAD_FORMS), LOG_EVENT_TYPES);
  assert.deepEqual(REVIEW_VERDICTS, ['pass', 'fail']);
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
  const path = ['draft', 'approved', 'in-progress', 'done'];
  for (let i = 0; i < path.length - 1; i++) {
    assert.ok(canTransition(path[i], path[i + 1]), `${path[i]} → ${path[i + 1]}`);
    assert.doesNotThrow(() =>
      assertTransition(path[i], path[i + 1], { kind: 'change', touchesCode: false }),
    );
  }
});

test('20261018-131621 CR4: the reviewed happy path delivers through in-review', () => {
  for (const [from, to] of [
    ['in-progress', 'in-review'],
    ['in-review', 'done'],
  ]) {
    assert.ok(canTransition(from, to), `${from} → ${to}`);
    assert.doesNotThrow(() => assertTransition(from, to, { kind: 'change' }));
  }
});

test('150232 CR4/CR5: done may re-enter normal flow while discarded remains terminal', () => {
  assert.equal(canTransition('done', 'in-progress'), true);
  assert.doesNotThrow(() => assertTransition('done', 'in-progress'));
  assert.throws(() => assertTransition('discarded', 'in-progress'), /invalid lifecycle transition/);
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

// The delivery gate (20261024-121022): whether a change reaches `done` straight
// from `in-progress` is decided by whether its branch touches code, never by
// its type. The caller reads git and hands the answer in as `touchesCode`;
// anything but an explicit `false` keeps the change on the reviewed route.

test('20261024-121022 CR5: a change that touches code cannot skip review', () => {
  assert.throws(
    () => assertTransition('in-progress', 'done', { kind: 'change', touchesCode: true }),
    /^Error: change touches code outside the ledger: move it to in-review and record a verdict$/,
  );
});

test('20261024-121022 CR5: a change that touches only the ledger delivers from in-progress', () => {
  assert.doesNotThrow(() =>
    assertTransition('in-progress', 'done', { kind: 'change', touchesCode: false }),
  );
});

test('20261024-121022 CR6: an undecided change cannot skip review', () => {
  for (const opts of [{ kind: 'change' }, { kind: 'change', touchesCode: undefined }, {}]) {
    assert.throws(
      () => assertTransition('in-progress', 'done', opts),
      /^Error: cannot decide whether the change touches code — move it to in-review and record a verdict$/,
      JSON.stringify(opts),
    );
  }
});

test('20261024-121022 CR6: a change enters review whether it touches code or not', () => {
  for (const touchesCode of [true, false, undefined]) {
    assert.doesNotThrow(() =>
      assertTransition('in-progress', 'in-review', { kind: 'change', touchesCode }),
    );
  }
});

test('20261024-121022 CR7: an epic never enters review', () => {
  assert.throws(
    () => assertTransition('in-progress', 'in-review', { kind: 'epic' }),
    /^Error: epic changes do not enter review — move to done instead$/,
  );
});

test('20261024-121022 CR7: an epic delivers from in-progress without a code decision', () => {
  assert.doesNotThrow(() => assertTransition('in-progress', 'done', { kind: 'epic' }));
});

test('20261024-121022: a kind outside change and epic is refused', () => {
  assert.throws(
    () => assertTransition('in-progress', 'done', { kind: 'feature', touchesCode: false }),
    /^Error: unknown change kind "feature"; valid kinds: change, epic$/,
  );
});

test('CR5: in-review is only reachable from in-progress', () => {
  assert.throws(
    () => assertTransition('approved', 'in-review'),
    /^Error: invalid lifecycle transition: approved → in-review$/,
  );
  assert.doesNotThrow(() => assertTransition('in-progress', 'in-review', { kind: 'change' }));
});

test('CR12: an edge outside the graph is rejected', () => {
  assert.throws(
    () => assertTransition('draft', 'done'),
    /^Error: invalid lifecycle transition: draft → done$/,
  );
});

test('20261018-131621 CR4/CR5: in-review has exactly the two verdict edges', () => {
  assert.doesNotThrow(() => assertTransition('in-review', 'in-progress'));
  assert.doesNotThrow(() => assertTransition('in-review', 'done'));
  assert.throws(() => assertTransition('in-review', 'approved'), /invalid lifecycle transition/);
  assert.throws(() => assertTransition('in-review', 'discarded'), /invalid lifecycle transition/);
});

// 20260615-210508 — `discarded` terminal state.
test('discarded: reachable before delivery, while done stays terminal', () => {
  for (const from of ['draft', 'approved', 'in-progress']) {
    assert.ok(canTransition(from, 'discarded'), `${from} → discarded`);
  }
  assert.ok(!canTransition('done', 'discarded'), 'done is terminal, cannot discard');
  assert.ok(!canTransition('in-review', 'discarded'), 'must leave in-review first');
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
  // `in-validation` is retired as a status, but Logs written while it existed
  // must keep parsing (20261018-131621 CR3): the payload grammar constrains the
  // origin of a typed transition, never the destination's membership.
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

// 20261018-131621 CR10. Acceptance stopped being a status and became a datum
// derived from the merge, but it keeps the `[validation]` event type: `analyze`
// already segments on it, and a brand-new type would have split one concept in
// two. The historical `in-validation → <to>` arm above must keep parsing.
test('20261018-131621 CR10: the validation event carries the merge-derived acceptance', () => {
  assert.deepEqual(
    parseLogEvent('- **2026-10-19T12:00:00Z** `[validation]` accepted (merged abc1234)'),
    {
      at: '2026-10-19T12:00:00Z',
      type: 'validation',
      outcome: 'accepted',
      sha: 'abc1234',
    },
  );
  assert.equal(
    serializeLogEvent({
      at: '2026-10-19T12:00:00Z',
      type: 'validation',
      outcome: 'accepted',
      sha: 'abc1234',
    }),
    '- **2026-10-19T12:00:00Z** `[validation]` accepted (merged abc1234)',
  );
});

test('20261018-131621 CR10: the acceptance arm takes a sha and nothing else', () => {
  for (const payload of [
    'accepted',
    'accepted (merged )',
    'accepted (merged abc123)',
    'accepted (merged ABC1234)',
    'accepted (merged zzzzzzz)',
    'accepted (merged abc1234) extra',
    'accepted (merged abc1234): reason',
  ]) {
    assert.equal(
      parseLogEvent(logLine('validation', payload)),
      null,
      `validation accepted: ${payload}`,
    );
  }
  // The arm is the validation event's alone; it must not leak into the other
  // two transition types.
  for (const type of ['status', 'review']) {
    assert.equal(parseLogEvent(logLine(type, 'accepted (merged abc1234)')), null, type);
    assert.equal(
      serializeLogEvent({
        at: '2026-08-24T16:00:00Z',
        type,
        from: type === 'review' ? 'in-review' : 'draft',
        to: type === 'review' ? 'done' : 'approved',
        outcome: 'accepted',
        sha: 'abc1234',
      }),
      logLine(type, type === 'review' ? 'in-review → done' : 'draft → approved'),
      type,
    );
  }
});

test('20261018-131621 CR10: widening validation leaves the historical arm intact', () => {
  assert.deepEqual(parseLogEvent(logLine('validation', 'in-validation → done')), {
    at: '2026-08-24T16:00:00Z',
    type: 'validation',
    from: 'in-validation',
    to: 'done',
  });
  assert.equal(parseLogEvent(logLine('validation', 'in-progress → done')), null);
  assert.equal(
    serializeLogEvent({
      at: '2026-08-24T16:00:00Z',
      type: 'validation',
      from: 'in-validation',
      to: 'done',
      reason: 'ok',
    }),
    logLine('validation', 'in-validation → done: ok'),
  );
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
      to: 'in-progress',
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

// 20260722-124656 CR3 — the refusal of an unreviewable candidate lives on the
// write path in `src/commands/agent.mjs`, never in the graph. Removing this edge
// would "fix" such a candidate by making every candidate unreachable, so pin it
// here.
test('124656 CR3: the in-review edges stay legal; the review entry gate is not a graph rule', () => {
  assert.doesNotThrow(() => assertTransition('in-progress', 'in-review', { kind: 'change' }));
  // The no-verdict return the contract names is a graph edge, not a review verdict.
  // Only `canTransition` is asserted here: `assertTransition('in-review',
  // 'in-progress')` is already pinned by `20261018-131621 CR4/CR5` above, and this repo
  // keeps one home per truth.
  assert.equal(canTransition('in-review', 'in-progress'), true);
});

// 20261002-181346 CR10, retargeted by 20261024-121022 CR10 — a change that
// integrates into the release branch through its own frontmatter, through the
// spawned CLI on a freshly initialised repo. `dev` carries a commit `main`
// lacks, so the change branch cut from `main` starts only when the guard
// resolves the change's release branch rather than the integration one, and
// its context names `dev` as the branch to bring the result back to.
test('181346 CR10: a release change starts from git.release_branch end to end', () => {
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

  ok('new', 'change', 'prod-outage', 'Prod outage', '--owner', 'Test User');
  const dir = path.join(root, '.changeledger', 'changes');
  const [name] = fs.readdirSync(dir);
  const file = path.join(dir, name);
  const id = name.slice(0, 15);
  fs.writeFileSync(
    file,
    fs
      .readFileSync(file, 'utf8')
      .replace(/^type: change$/m, 'type: change\nintegrates_into: release')
      .replace(
        '## Request\n',
        '## Request\n\nProduction login fails.\n\n### Objective\n\nO\n\n### Frontier\n\nF\n',
      )
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
  git('checkout', '-q', '-b', `change/${id}`, 'main');
  ok('status', id, 'in-progress');
  assert.match(fs.readFileSync(file, 'utf8'), /^status: in-progress$/m);
  const policy = ok('context', id)
    .split('\n')
    .find((line) => line.startsWith('Effective policy:'));
  assert.match(policy, / — integration_branch=main — back_merge_branch=dev /, policy);
});

const FINDING_LINES = {
  open: '- **2026-10-25T10:00:00Z** `[finding]` el ejemplo de ayuda cita un id',
  promoted: '- **2026-10-25T10:00:00Z** `[finding]` 2 promoted #20260101-000000',
  dropped: '- **2026-10-25T10:00:00Z** `[finding]` 1 dropped: ya no aplica',
};
const FINDING_EVENTS = {
  open: {
    at: '2026-10-25T10:00:00Z',
    type: 'finding',
    outcome: 'open',
    text: 'el ejemplo de ayuda cita un id',
  },
  promoted: {
    at: '2026-10-25T10:00:00Z',
    type: 'finding',
    outcome: 'promoted',
    n: 2,
    target: '20260101-000000',
  },
  dropped: {
    at: '2026-10-25T10:00:00Z',
    type: 'finding',
    outcome: 'dropped',
    n: 1,
    reason: 'ya no aplica',
  },
};

test('20261024-202659 CR1: finding parses its three payload arms', () => {
  for (const outcome of ['open', 'promoted', 'dropped']) {
    assert.deepEqual(parseLogEvent(FINDING_LINES[outcome]), FINDING_EVENTS[outcome], outcome);
  }
});

test('20261024-202659 CR1: finding is the tenth, non-transition event type', () => {
  assert.equal(LOG_EVENT_TYPES.length, 10);
  assert.equal(LOG_EVENT_TYPES.at(-1), 'finding');
  assert.equal(LOG_EVENT_DEFINITIONS.finding.transition, false);
  assert.equal(
    LOG_EVENT_DEFINITIONS.finding.form,
    '<text> | <n> promoted #<id> | <n> dropped: <reason>',
  );
});

test('20261024-202659 CR1: malformed finding payloads do not parse', () => {
  for (const payload of ['', '0 promoted #20260101-000000', '2 promoted #x', '1 dropped:']) {
    assert.equal(parseLogEvent(logLine('finding', payload)), null, JSON.stringify(payload));
  }
});

test('20261024-202659 CR1: finding serializes its three arms and refuses an empty open text', () => {
  for (const outcome of ['open', 'promoted', 'dropped']) {
    assert.equal(serializeLogEvent(FINDING_EVENTS[outcome]), FINDING_LINES[outcome], outcome);
  }
  assert.throws(
    () =>
      serializeLogEvent({ at: '2026-10-25T10:00:00Z', type: 'finding', outcome: 'open', text: '' }),
    /^Error: invalid finding Log event$/,
  );
  assert.throws(
    () =>
      serializeLogEvent({
        at: '2026-10-25T10:00:00Z',
        type: 'finding',
        outcome: 'open',
        text: '2 promoted #20260101-000000',
      }),
    /^Error: invalid finding Log event$/,
  );
});
