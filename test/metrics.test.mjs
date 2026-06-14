import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeMetrics, doneAt } from '../src/metrics.mjs';

function change({ id, created, status = 'done', logBody }) {
  return {
    frontmatter: { id, created, status },
    stages: [{ key: 'log', body: logBody ?? '' }],
  };
}

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
