import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertTransition, canTransition, parseLogEvent } from '../src/lifecycle.mjs';

test('CR1: the happy path is allowed at every step', () => {
  const path = ['draft', 'approved', 'in-progress', 'in-validation', 'done'];
  for (let i = 0; i < path.length - 1; i++) {
    assert.ok(canTransition(path[i], path[i + 1]), `${path[i]} → ${path[i + 1]}`);
    assert.doesNotThrow(() => assertTransition(path[i], path[i + 1]));
  }
});

test('CR2: blocked is a reversible detour from in-progress', () => {
  assert.doesNotThrow(() => assertTransition('in-progress', 'blocked'));
  assert.doesNotThrow(() => assertTransition('blocked', 'in-progress'));
});

test('CR3: skips, regressions and self-loops are rejected', () => {
  for (const [from, to] of [
    ['draft', 'done'],
    ['draft', 'in-progress'],
    ['done', 'in-progress'],
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

test('171002 CR5: a non-review_required type goes from in-progress to validation', () => {
  assert.doesNotThrow(() =>
    assertTransition('in-progress', 'in-validation', { type: 'chore', reviewRequired: false }),
  );
  assert.throws(() => assertTransition('in-progress', 'done'), /invalid lifecycle transition/);
});

test('CR5: in-review is only reachable from in-progress', () => {
  assert.throws(
    () => assertTransition('approved', 'in-review'),
    /^Error: invalid lifecycle transition: approved → in-review$/,
  );
  assert.doesNotThrow(() => assertTransition('in-progress', 'in-review'));
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
  assert.deepEqual(parseLogEvent('- **2026-06-30T10:36:01Z** — status: in-progress → in-review'), {
    at: '2026-06-30T10:36:01Z',
    from: 'in-progress',
    to: 'in-review',
    explicit: true,
  });
  assert.deepEqual(
    parseLogEvent(
      '- **2026-06-30T10:48:03Z** — review → in-validation (delegated subagent, clean context)',
    ),
    { at: '2026-06-30T10:48:03Z', from: 'in-review', to: 'in-validation', explicit: false },
  );
  assert.deepEqual(
    parseLogEvent('- **2026-06-30T15:28:42Z** — validation → done (human accepted)'),
    { at: '2026-06-30T15:28:42Z', from: 'in-validation', to: 'done', explicit: false },
  );
  assert.deepEqual(
    parseLogEvent('- **2026-06-30T15:28:42Z** — status: in-progress → discarded: superseded'),
    { at: '2026-06-30T15:28:42Z', from: 'in-progress', to: 'discarded', explicit: true },
  );
  assert.equal(parseLogEvent('- **2026-06-30T15:28:42Z** — owner → ana (auto)'), null);
  assert.equal(parseLogEvent('- **2026-06-30T15:28:42Z** — graduado a spec `x.md`'), null);
  assert.equal(parseLogEvent('- plain decision note'), null);
});
