// Pure delivery metrics derived from change timestamps. No IO and no clock —
// time-relative metrics (aging, live WIP durations) take `now` as a parameter.
// Everything is reconstructed from `created` plus the `## Log` status
// transitions. The viewer renders the result.

import { parseLogEvent } from './lifecycle.mjs';

const ACTIVE = ['approved', 'in-progress', 'in-review', 'in-validation', 'blocked'];

function logBody(change) {
  return (change.stages ?? []).find((s) => s.key === 'log')?.body ?? '';
}

// Same event grammar as `changeledger check`'s sequence validation — one shared
// parser so metrics and validation cannot drift (20260630-225210 CR5).
function logTransition(line) {
  const event = parseLogEvent(line);
  return event && ['status', 'review', 'validation'].includes(event.type)
    ? { at: event.at, state: event.to }
    : null;
}

// The moment a change reached `done`: the last lifecycle transition to done, or
// null. Canonical done is written by a passed human validation.
export function doneAt(change) {
  let at = null;
  for (const line of logBody(change).split('\n')) {
    const event = logTransition(line);
    if (event?.state === 'done') at = event.at;
  }
  return at;
}

// Ordered status transitions parsed from the Log: [{ at, state }]. Assumes the
// change began in `draft` at `created`.
function transitions(change) {
  const created = change.frontmatter?.created;
  if (!created) return [];
  const events = [{ at: created, state: 'draft' }];
  for (const line of logBody(change).split('\n')) {
    const event = logTransition(line);
    if (event) events.push(event);
  }
  return events;
}

// Time spent in each state: [{ state, ms }]. A provisional `done` interval is
// retained in the event stream but excluded from active-state duration.
export function statusTimeline(change, now) {
  const events = transitions(change);
  if (!events.length) return [];
  const segs = [];
  for (let i = 0; i < events.length; i++) {
    const start = Date.parse(events[i].at);
    const endIso = events[i + 1]?.at ?? now;
    const end = Date.parse(endIso);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    // `done` is outside active work, including a provisional interval before reopen.
    if (events[i].state === 'done') continue;
    segs.push({ state: events[i].state, ms: Math.max(0, end - start) });
  }
  return segs;
}

function median(sorted) {
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function avg(nums) {
  return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0;
}

// Nearest-rank percentile over an ascending-sorted array; 0 for an empty input
// so callers never divide by zero or render NaN.
function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1];
}

// Count of `review → in-progress` verdicts (the `fail --retry` outcome) — the
// same event grammar as lifecycle transitions, filtered to the implicit
// review-verdict shape so an explicit `status:` move or a validation verdict
// isn't miscounted as a retry.
function reviewRetryCount(change) {
  let count = 0;
  for (const line of logBody(change).split('\n')) {
    const event = parseLogEvent(line);
    if (event?.type === 'review' && event.from === 'in-review' && event.to === 'in-progress') {
      count++;
    }
  }
  return count;
}

export function computeMetrics(changes = [], { now } = {}) {
  const nowIso = now ?? '9999-12-31T23:59:59Z';

  const perChange = [];
  const byDate = new Map();
  const statusTotals = new Map(); // state → { ms, count }
  const wip = {};
  const aging = [];
  let blockedMs = 0;
  const byType = new Map(); // type → { closed, cycles:[] }
  const byOwner = new Map(); // owner → { closed, cycles:[] }
  let reviewRetries = 0;

  for (const c of changes) {
    const status = c.frontmatter?.status;
    const type = c.frontmatter?.type ?? 'unknown';
    const owner = c.frontmatter?.owner || 'unassigned';
    const created = c.frontmatter?.created;

    reviewRetries += reviewRetryCount(c);

    if (ACTIVE.includes(status)) wip[status] = (wip[status] ?? 0) + 1;

    const segs = statusTimeline(c, nowIso);
    for (const s of segs) {
      const t = statusTotals.get(s.state) ?? { ms: 0, count: 0 };
      t.ms += s.ms;
      t.count += 1;
      statusTotals.set(s.state, t);
      if (s.state === 'blocked') blockedMs += s.ms;
    }

    if (status === 'in-progress') {
      const events = transitions(c);
      const entered = [...events].reverse().find((e) => e.state === 'in-progress');
      if (entered)
        aging.push({ id: c.frontmatter.id, ms: Date.parse(nowIso) - Date.parse(entered.at) });
    }

    if (status === 'done' && created) {
      const closed = doneAt(c);
      const cycleMs = closed ? Date.parse(closed) - Date.parse(created) : NaN;
      if (!Number.isNaN(cycleMs)) {
        perChange.push({ id: c.frontmatter.id, cycleMs });
        byDate.set(closed.slice(0, 10), (byDate.get(closed.slice(0, 10)) ?? 0) + 1);
        const bt = byType.get(type) ?? { closed: 0, cycles: [] };
        bt.closed += 1;
        bt.cycles.push(cycleMs);
        byType.set(type, bt);

        const bo = byOwner.get(owner) ?? { closed: 0, cycles: [] };
        bo.closed += 1;
        bo.cycles.push(cycleMs);
        byOwner.set(owner, bo);
      }
    }
  }

  const cycles = perChange.map((p) => p.cycleMs).sort((a, b) => a - b);
  const throughput = [...byDate.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const timeInStatus = [...statusTotals.entries()].map(([state, t]) => ({
    state,
    totalMs: t.ms,
    avgMs: Math.round(t.ms / t.count),
  }));
  const byTypeArr = [...byType.entries()]
    .map(([type, v]) => ({ type, closed: v.closed, avgCycleMs: avg(v.cycles) }))
    .sort((a, b) => b.closed - a.closed);
  const byOwnerArr = [...byOwner.entries()]
    .map(([owner, v]) => ({ owner, closed: v.closed, avgCycleMs: avg(v.cycles) }))
    .sort((a, b) => b.closed - a.closed);
  const validationWaitMs = timeInStatus.find((t) => t.state === 'in-validation')?.avgMs ?? 0;

  return {
    count: perChange.length,
    avgCycleMs: avg(cycles),
    medianCycleMs: median(cycles),
    p50CycleMs: percentile(cycles, 50),
    p85CycleMs: percentile(cycles, 85),
    perChange,
    throughput,
    timeInStatus,
    wip,
    aging: aging.sort((a, b) => b.ms - a.ms),
    blockedMs,
    validationWaitMs,
    reviewRetries,
    byType: byTypeArr,
    byOwner: byOwnerArr,
  };
}
