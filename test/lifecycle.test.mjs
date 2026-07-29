import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertTransition,
  canTransition,
  parseLogEvent,
  serializeLogEvent,
} from '../src/lifecycle.mjs';

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
