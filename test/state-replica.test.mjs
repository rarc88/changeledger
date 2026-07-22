import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pathsOverlap, planReplicaSync } from '../src/state-replica.mjs';

const ancestry = new Set([
  'S1:S1',
  'S1:S2',
  'S1:P1',
  'S1:R1',
  'S1:R2',
  'S1:P2',
  'S2:S2',
  'S2:R1',
  'S2:R2',
  'P1:P1',
  'P1:R2',
  'P2:P2',
  'R1:R1',
  'R2:R2',
]);
const isAncestor = (ancestor, descendant) => ancestry.has(`${ancestor}:${descendant}`);

test('193102 CR1-CR6: replica planner covers every ref relationship', () => {
  const cases = [
    {
      name: 'nothing observed or confirmed',
      refs: {},
      action: 'unavailable',
    },
    {
      name: 'first observation initializes a clean clone',
      refs: { observed: 'S1' },
      action: 'adopt-observed',
    },
    {
      name: 'confirmed state needs a fetch before deciding',
      refs: { confirmed: 'S1' },
      action: 'observe-remote',
    },
    {
      name: 'equal confirmed and observed state is current',
      refs: { confirmed: 'S1', observed: 'S1' },
      action: 'current',
    },
    {
      name: 'clean clone fast-forwards to a descendant observation',
      refs: { confirmed: 'S1', observed: 'S2' },
      action: 'advance-confirmed',
    },
    {
      name: 'clean clone rejects a rewritten remote',
      refs: { confirmed: 'S2', observed: 'S1' },
      action: 'reject-remote-rewrite',
    },
    {
      name: 'pending waits for an observation',
      refs: {
        confirmed: 'S1',
        pending: { head: 'P1', base: 'S1', paths: ['changes/A.md'] },
      },
      action: 'observe-remote',
    },
    {
      name: 'pending publishes when remote remains at its base',
      refs: {
        confirmed: 'S1',
        observed: 'S1',
        pending: { head: 'P1', base: 'S1', paths: ['changes/A.md'] },
      },
      action: 'publish-pending',
    },
    {
      name: 'ambiguous push is confirmed when remote contains pending',
      refs: {
        confirmed: 'S1',
        observed: 'R2',
        pending: { head: 'P1', base: 'S1', paths: ['changes/A.md'] },
      },
      action: 'confirm-observed',
    },
    {
      name: 'disjoint remote advance replays pending',
      refs: {
        confirmed: 'S1',
        observed: 'S2',
        observedPaths: ['changes/B.md'],
        pending: { head: 'P1', base: 'S1', paths: ['changes/A.md'] },
      },
      action: 'replay-pending',
    },
    {
      name: 'overlapping remote advance is an explicit conflict',
      refs: {
        confirmed: 'S1',
        observed: 'S2',
        observedPaths: ['changes/A.md'],
        pending: { head: 'P1', base: 'S1', paths: ['changes/A.md'] },
      },
      action: 'conflict',
    },
    {
      name: 'pending rejects a remote outside its confirmed ancestry',
      refs: {
        confirmed: 'S1',
        observed: 'X1',
        pending: { head: 'P1', base: 'S1', paths: ['changes/A.md'] },
      },
      action: 'reject-remote-rewrite',
    },
    {
      name: 'pending without confirmed state is corrupt',
      refs: {
        observed: 'S1',
        pending: { head: 'P1', base: 'S1', paths: ['changes/A.md'] },
      },
      action: 'invalid-local-state',
    },
    {
      name: 'pending based on a different confirmed state is corrupt',
      refs: {
        confirmed: 'S2',
        observed: 'S2',
        pending: { head: 'P1', base: 'S1', paths: ['changes/A.md'] },
      },
      action: 'invalid-local-state',
    },
  ];

  for (const { name, refs, action } of cases) {
    assert.equal(planReplicaSync(refs, { isAncestor }).action, action, name);
  }
});

test('193102 CR4/CR5: path overlap is exact and delimiter-independent', () => {
  assert.equal(pathsOverlap(['specs/café.md'], ['specs/cafe.md']), false);
  assert.equal(pathsOverlap(['specs/line\nbreak.md'], ['specs/line\nbreak.md']), true);
  assert.equal(pathsOverlap(['changes/A.md'], ['changes/B.md', 'changes/A.md']), true);
  assert.equal(pathsOverlap([], ['changes/A.md']), false);
});
