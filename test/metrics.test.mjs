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
