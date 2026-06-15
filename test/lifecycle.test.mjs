import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertTransition, canTransition } from '../src/lifecycle.mjs';

test('CR1: the happy path is allowed at every step', () => {
  const path = ['draft', 'approved', 'in-progress', 'done'];
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

test('CR3: a review_required type cannot jump from in-progress to done', () => {
  assert.throws(
    () => assertTransition('in-progress', 'done', { type: 'feature', reviewRequired: true }),
    /^Error: feature changes must be reviewed before done — move to in-review first$/,
  );
});

test('CR4: a non-review_required type goes from in-progress to done', () => {
  assert.doesNotThrow(() =>
    assertTransition('in-progress', 'done', { type: 'chore', reviewRequired: false }),
  );
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

test('review rejection edges are allowed: in-review → in-progress | blocked | done', () => {
  assert.doesNotThrow(() => assertTransition('in-review', 'in-progress'));
  assert.doesNotThrow(() => assertTransition('in-review', 'blocked'));
  assert.doesNotThrow(() => assertTransition('in-review', 'done'));
});

// 20260615-210508 — `discarded` terminal state.
test('discarded: reachable from active states, not from done/in-review, terminal', () => {
  for (const from of ['draft', 'approved', 'in-progress', 'blocked']) {
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
