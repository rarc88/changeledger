// A two-change usage ledger (20261002-140242) whose figures depend on
// analysing the whole project: one recorder alternates between a `feature`
// and a `bug`, so each record of the bug is diffed against the feature's
// previous record, and the bug's last segment spans an unrecorded transition
// of the feature (a `gap`). Analysing the bug's records alone would give it a
// baseline of its own, 150 fewer tokens and no gap.

import { changeDoc, logLine, usageEntryOf, usageRecord, usageSession } from './usage-analysis.mjs';

export const FEATURE = '20261001-000001';
export const BUG = '20261001-000002';
export const QUIET = '20261001-000003';

const at = (minute) => `2026-10-01T00:${String(minute).padStart(2, '0')}:00Z`;

const opus = (tokens, cost, extra = {}) => usageSession('s1', { opus: { tokens, cost }, ...extra });

// `{ <id>: changeText options }` for FEATURE and BUG; QUIET, a `chore` with no
// usage record, is added with `{ quiet: true }`.
export function usageChanges({ quiet = false } = {}) {
  return {
    [FEATURE]: {
      title: 'Feature',
      type: 'feature',
      created: at(1),
      log: [
        logLine(at(1), 'version', '0.17.0'),
        logLine(at(3), 'status', 'draft → approved'),
        logLine(at(4), 'status', 'approved → in-progress'),
      ],
    },
    [BUG]: {
      title: 'Bug',
      type: 'bug',
      created: at(2),
      log: [logLine(at(2), 'version', '0.18.0'), logLine(at(5), 'status', 'draft → approved')],
    },
    ...(quiet ? { [QUIET]: { title: 'Quiet', type: 'chore', created: at(6) } } : {}),
  };
}

export function usageRecords() {
  return [
    usageRecord({
      change: FEATURE,
      at: at(1),
      event: 'created',
      to: 'draft',
      sessions: [opus(100, 1)],
    }),
    usageRecord({
      change: BUG,
      at: at(2),
      event: 'created',
      to: 'draft',
      sessions: [opus(300, 3)],
    }),
    usageRecord({
      change: FEATURE,
      at: at(3),
      from: 'draft',
      to: 'approved',
      sessions: [opus(350, 3.5)],
    }),
    usageRecord({
      change: BUG,
      at: at(5),
      from: 'draft',
      to: 'approved',
      sessions: [opus(1000, 10, { haiku: { tokens: 40, cost: null } })],
    }),
  ];
}

// The same ledger as `analyzeUsage` input.
export function usageInput(options) {
  return {
    changes: Object.entries(usageChanges(options)).map(([id, o]) => changeDoc(id, o)),
    usage: usageRecords().map(usageEntryOf),
  };
}
