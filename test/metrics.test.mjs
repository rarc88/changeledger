import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeMetrics, doneAt, statusTimeline } from '../src/metrics.mjs';

function change({ id, created, status = 'done', type = 'feature', logBody }) {
  return {
    frontmatter: { id, created, status, type },
    stages: [{ key: 'log', body: logBody ?? '' }],
  };
}

const HOUR = 3600000;

const DONE_LOG = (iso) => `- **2026-06-13T10:00:00Z** — status: draft → approved
- **${iso}** — status: in-progress → done`;

test('doneAt extracts the iso of the last → done log entry', () => {
  const c = change({
    id: 'a',
    created: '2026-06-13T08:00:00Z',
    logBody: DONE_LOG('2026-06-13T12:00:00Z'),
  });
  assert.equal(doneAt(c), '2026-06-13T12:00:00Z');
});

test('doneAt extracts the iso of a review pass transition', () => {
  const c = change({
    id: 'a',
    created: '2026-06-13T08:00:00Z',
    logBody: `- **2026-06-13T11:00:00Z** — status: in-progress → in-review
- **2026-06-13T12:00:00Z** — review → done (delegated subagent, clean context)`,
  });
  assert.equal(doneAt(c), '2026-06-13T12:00:00Z');
});

test('doneAt returns null when there is no done transition', () => {
  const c = change({
    id: 'a',
    created: '2026-06-13T08:00:00Z',
    status: 'draft',
    logBody: '- **x** — created',
  });
  assert.equal(doneAt(c), null);
});

test('CR1: cycle time is doneAt minus created in ms', () => {
  const c = change({
    id: 'a',
    created: '2026-06-13T10:00:00Z',
    logBody: DONE_LOG('2026-06-13T12:00:00Z'),
  });
  const m = computeMetrics([c]);
  assert.equal(m.perChange[0].cycleMs, 2 * 3600000);
});

test('CR2: aggregates and throughput group by close date', () => {
  const changes = [
    change({ id: 'a', created: '2026-06-13T10:00:00Z', logBody: DONE_LOG('2026-06-13T12:00:00Z') }),
    change({ id: 'b', created: '2026-06-13T10:00:00Z', logBody: DONE_LOG('2026-06-13T14:00:00Z') }),
    change({ id: 'c', created: '2026-06-14T10:00:00Z', logBody: DONE_LOG('2026-06-14T11:00:00Z') }),
  ];
  const m = computeMetrics(changes);
  assert.equal(m.count, 3);
  assert.equal(m.avgCycleMs, Math.round(((2 + 4 + 1) * 3600000) / 3));
  assert.equal(m.medianCycleMs, 2 * 3600000);
  assert.deepEqual(m.throughput, [
    { date: '2026-06-13', count: 2 },
    { date: '2026-06-14', count: 1 },
  ]);
});

test('CR1: aggregates and throughput include review pass closures', () => {
  const c = change({
    id: 'a',
    created: '2026-06-16T10:00:00Z',
    logBody: `- **2026-06-16T11:00:00Z** — status: draft → approved
- **2026-06-16T12:00:00Z** — status: approved → in-progress
- **2026-06-16T13:00:00Z** — status: in-progress → in-review
- **2026-06-16T14:00:00Z** — review → done (delegated subagent, clean context)`,
  });
  const m = computeMetrics([c]);
  assert.equal(m.count, 1);
  assert.equal(m.perChange[0].cycleMs, 4 * HOUR);
  assert.deepEqual(m.throughput, [{ date: '2026-06-16', count: 1 }]);
});

test('CR2: non-done changes are ignored', () => {
  const changes = [
    change({
      id: 'a',
      created: '2026-06-13T10:00:00Z',
      status: 'in-progress',
      logBody: '- **x** — created',
    }),
  ];
  const m = computeMetrics(changes);
  assert.equal(m.count, 0);
  assert.deepEqual(m.throughput, []);
});

const FULL_LOG = `- **2026-06-13T11:00:00Z** — status: draft → approved
- **2026-06-13T12:00:00Z** — status: approved → in-progress
- **2026-06-13T15:00:00Z** — status: in-progress → done`;

test('CR1: statusTimeline splits time across states', () => {
  const c = change({ id: 'a', created: '2026-06-13T10:00:00Z', logBody: FULL_LOG });
  const segs = statusTimeline(c, '2026-06-13T15:00:00Z');
  assert.deepEqual(segs, [
    { state: 'draft', ms: 1 * HOUR },
    { state: 'approved', ms: 1 * HOUR },
    { state: 'in-progress', ms: 3 * HOUR },
  ]);
});

test('CR1: statusTimeline treats review verdicts as lifecycle transitions', () => {
  const c = change({
    id: 'a',
    created: '2026-06-13T10:00:00Z',
    logBody: `- **2026-06-13T11:00:00Z** — status: draft → approved
- **2026-06-13T12:00:00Z** — status: approved → in-progress
- **2026-06-13T13:00:00Z** — status: in-progress → in-review
- **2026-06-13T15:00:00Z** — review → done (delegated subagent, clean context)`,
  });
  const segs = statusTimeline(c, '2026-06-13T15:00:00Z');
  assert.deepEqual(segs, [
    { state: 'draft', ms: 1 * HOUR },
    { state: 'approved', ms: 1 * HOUR },
    { state: 'in-progress', ms: 1 * HOUR },
    { state: 'in-review', ms: 2 * HOUR },
  ]);
});

test('CR1: timeInStatus aggregates totals and averages', () => {
  const c = change({ id: 'a', created: '2026-06-13T10:00:00Z', logBody: FULL_LOG });
  const m = computeMetrics([c], { now: '2026-06-13T15:00:00Z' });
  const ip = m.timeInStatus.find((t) => t.state === 'in-progress');
  assert.equal(ip.totalMs, 3 * HOUR);
  assert.equal(ip.avgMs, 3 * HOUR);
});

test('CR2: wip counts active states; aging measures in-progress age', () => {
  const wip = change({
    id: 'b',
    created: '2026-06-13T10:00:00Z',
    status: 'in-progress',
    logBody: `- **2026-06-13T11:00:00Z** — status: draft → approved
- **2026-06-13T12:00:00Z** — status: approved → in-progress`,
  });
  const m = computeMetrics([wip], { now: '2026-06-13T22:00:00Z' });
  assert.equal(m.wip['in-progress'], 1);
  assert.equal(m.aging[0].id, 'b');
  assert.equal(m.aging[0].ms, 10 * HOUR);
});

test('CR11: wip counts an in-review change as active', () => {
  const c = change({
    id: 'r',
    created: '2026-06-13T10:00:00Z',
    status: 'in-review',
    logBody: `- **2026-06-13T11:00:00Z** — status: in-progress → in-review`,
  });
  const m = computeMetrics([c], { now: '2026-06-13T12:00:00Z' });
  assert.equal(m.wip['in-review'], 1);
});

test('171002 CR1: validation is active WIP and contributes time in status', () => {
  const c = change({
    id: 'v',
    created: '2026-06-13T10:00:00Z',
    status: 'in-validation',
    logBody: `- **2026-06-13T11:00:00Z** — status: in-progress → in-validation`,
  });
  const m = computeMetrics([c], { now: '2026-06-13T13:00:00Z' });
  assert.equal(m.wip['in-validation'], 1);
  assert.equal(m.timeInStatus.find((t) => t.state === 'in-validation').totalMs, 2 * HOUR);
});

test('171002 CR2: human validation is the canonical done transition', () => {
  const c = change({
    id: 'v',
    created: '2026-06-13T10:00:00Z',
    logBody: `- **2026-06-13T11:00:00Z** — status: in-progress → in-validation
- **2026-06-13T12:00:00Z** — validation → done (human accepted)`,
  });
  assert.equal(doneAt(c), '2026-06-13T12:00:00Z');
});

test('150232 CR6: reopened work uses the last acceptance for cycle time', () => {
  const c = change({
    id: 'reopened',
    created: '2026-06-13T10:00:00Z',
    status: 'done',
    logBody: `- **2026-06-13T11:00:00Z** — validation → done (human accepted)
- **2026-06-13T12:00:00Z** — status: done → in-progress (human reopened): fix
- **2026-06-13T13:00:00Z** — status: in-progress → in-review
- **2026-06-13T14:00:00Z** — review → in-validation (delegated subagent, clean context)
- **2026-06-13T15:00:00Z** — validation → done (human accepted)`,
  });
  assert.equal(doneAt(c), '2026-06-13T15:00:00Z');
  assert.equal(computeMetrics([c]).perChange[0].cycleMs, 5 * HOUR);
});

test('CR2: blockedMs sums time spent blocked', () => {
  const c = change({
    id: 'c',
    created: '2026-06-13T10:00:00Z',
    status: 'done',
    logBody: `- **2026-06-13T11:00:00Z** — status: in-progress → blocked
- **2026-06-13T13:00:00Z** — status: blocked → in-progress
- **2026-06-13T14:00:00Z** — status: in-progress → done`,
  });
  const m = computeMetrics([c], { now: '2026-06-13T14:00:00Z' });
  assert.equal(m.blockedMs, 2 * HOUR);
});

test('CR3: byType reports closed count and avg cycle per type', () => {
  const a = change({
    id: 'a',
    type: 'feature',
    created: '2026-06-13T10:00:00Z',
    logBody: FULL_LOG,
  });
  const b = change({
    id: 'b',
    type: 'bug',
    created: '2026-06-13T10:00:00Z',
    logBody: '- **2026-06-13T12:00:00Z** — status: in-progress → done',
  });
  const m = computeMetrics([a, b], { now: '2026-06-13T20:00:00Z' });
  const feat = m.byType.find((t) => t.type === 'feature');
  const bug = m.byType.find((t) => t.type === 'bug');
  assert.equal(feat.closed, 1);
  assert.equal(feat.avgCycleMs, 5 * HOUR);
  assert.equal(bug.avgCycleMs, 2 * HOUR);
});

// 20260711-155721: friction metrics — review retries, validation wait, cycle
// percentiles and per-owner breakdown.

test('155721 CR3: p50/p85 cycle time percentiles alongside avg/median', () => {
  const changes = [
    change({ id: 'a', created: '2026-06-13T10:00:00Z', logBody: DONE_LOG('2026-06-13T12:00:00Z') }), // 2h
    change({ id: 'b', created: '2026-06-13T10:00:00Z', logBody: DONE_LOG('2026-06-13T14:00:00Z') }), // 4h
    change({ id: 'c', created: '2026-06-14T10:00:00Z', logBody: DONE_LOG('2026-06-14T11:00:00Z') }), // 1h
  ];
  const m = computeMetrics(changes);
  assert.equal(m.p50CycleMs, 2 * HOUR);
  assert.equal(m.p85CycleMs, 4 * HOUR);
  assert.equal(m.avgCycleMs, Math.round(((2 + 4 + 1) * HOUR) / 3));
  assert.equal(m.medianCycleMs, 2 * HOUR);
});

test('155721 CR3: reviewRetries counts fail --retry verdicts, validationWaitMs is the mean in-validation wait', () => {
  const c = change({
    id: 'x',
    created: '2026-07-01T10:00:00Z',
    logBody: `- **2026-07-01T10:00:00Z** — status: draft → approved
- **2026-07-01T10:00:00Z** — status: approved → in-progress
- **2026-07-01T11:00:00Z** — status: in-progress → in-review
- **2026-07-01T12:00:00Z** — review → in-progress (retry): reason1
- **2026-07-01T13:00:00Z** — status: in-progress → in-review
- **2026-07-01T14:00:00Z** — review → in-progress (retry): reason2
- **2026-07-01T15:00:00Z** — status: in-progress → in-review
- **2026-07-01T16:00:00Z** — review → in-validation (delegated subagent, clean context)
- **2026-07-01T20:00:00Z** — validation → done (human accepted)`,
  });
  const m = computeMetrics([c]);
  assert.equal(m.reviewRetries, 2);
  assert.equal(m.validationWaitMs, 4 * HOUR);
});

test('155721 CR3: reviewRetries ignores review→blocked and validation→in-progress verdicts', () => {
  const c = change({
    id: 'y',
    created: '2026-07-01T10:00:00Z',
    status: 'blocked',
    logBody: `- **2026-07-01T11:00:00Z** — status: in-progress → in-review
- **2026-07-01T12:00:00Z** — review → blocked: spec is ambiguous`,
  });
  const m = computeMetrics([c], { now: '2026-07-01T12:00:00Z' });
  assert.equal(m.reviewRetries, 0);
});

test('155721 CR3: byOwner mirrors byType, unassigned changes group together', () => {
  const a = change({ id: 'a', created: '2026-06-13T10:00:00Z', logBody: FULL_LOG });
  a.frontmatter.owner = 'alice';
  const b = change({
    id: 'b',
    created: '2026-06-13T10:00:00Z',
    logBody: '- **2026-06-13T12:00:00Z** — status: in-progress → done',
  });
  const m = computeMetrics([a, b], { now: '2026-06-13T20:00:00Z' });
  const alice = m.byOwner.find((o) => o.owner === 'alice');
  const unassigned = m.byOwner.find((o) => o.owner === 'unassigned');
  assert.equal(alice.closed, 1);
  assert.equal(alice.avgCycleMs, 5 * HOUR);
  assert.equal(unassigned.closed, 1);
  assert.equal(unassigned.avgCycleMs, 2 * HOUR);
});

test('155721 CR5: empty input yields zero metrics, no NaN/Infinity', () => {
  const m = computeMetrics([]);
  assert.equal(m.count, 0);
  assert.equal(m.p50CycleMs, 0);
  assert.equal(m.p85CycleMs, 0);
  assert.equal(m.validationWaitMs, 0);
  assert.equal(m.reviewRetries, 0);
  assert.deepEqual(m.byOwner, []);
});
