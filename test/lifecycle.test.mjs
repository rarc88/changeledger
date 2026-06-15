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
