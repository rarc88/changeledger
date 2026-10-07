import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { analyzeUsage, USAGE_GROUP_KEYS } from '../src/usage-analysis.mjs';
import {
  changeDoc,
  logLine,
  usageEntryOf,
  usageRecord,
  usageSession,
} from './helpers/usage-analysis.mjs';

const A = '20261001-000001';
const B = '20261001-000002';
const C = '20261001-000003';
const D = '20261001-000004';
const at = (minute, second = 0) =>
  `2026-10-01T00:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}Z`;
const s1 = (tokens) => usageSession('s1', { opus: { tokens } });

const segmentTotals = (change) => change.segments.map((s) => [s.segment, s.total_tokens]);
const only = (result) => {
  assert.equal(result.changes.length, 1);
  return result.changes[0];
};

// The CR1 scenario: one recorder, one session, four transitions of A.
function cr1Records() {
  return [
    usageRecord({ change: A, at: at(1), event: 'created', to: 'draft', sessions: [s1(100)] }),
    usageRecord({ change: A, at: at(2), from: 'draft', to: 'approved', sessions: [s1(300)] }),
    usageRecord({
      change: A,
      at: at(3),
      from: 'approved',
      to: 'in-progress',
      sessions: [s1(350)],
    }),
    usageRecord({
      change: A,
      at: at(4),
      from: 'in-progress',
      to: 'in-review',
      sessions: [s1(1000)],
    }),
  ];
}

test('CR1: consumption goes to the segment each transition closes; the first record is the baseline', () => {
  const result = analyzeUsage(
    { changes: [changeDoc(A)], usage: cr1Records().map(usageEntryOf) },
    { id: A },
  );
  const a = only(result);
  assert.deepEqual(segmentTotals(a), [
    ['draft', 200],
    ['approved', 50],
    ['in-progress', 650],
  ]);
  assert.equal(a.total_tokens, 900);
  assert.ok(
    result.hints.includes(`baseline: first record of ana at ${at(1)} is not attributed`),
    result.hints.join('\n'),
  );
});

test('CR1: a segment total is the sum of the four token types', () => {
  const tokens = (n) =>
    usageSession('s1', {
      opus: { input: n, output: 2 * n, cache_read: 3 * n, cache_write: 4 * n },
    });
  const usage = [
    usageRecord({ change: A, at: at(1), event: 'created', to: 'draft', sessions: [tokens(1)] }),
    usageRecord({ change: A, at: at(2), from: 'draft', to: 'approved', sessions: [tokens(3)] }),
  ].map(usageEntryOf);
  const [segment] = only(analyzeUsage({ changes: [changeDoc(A)], usage }, { id: A })).segments;
  assert.deepEqual(
    [
      segment.input_tokens,
      segment.output_tokens,
      segment.cache_read_tokens,
      segment.cache_write_tokens,
      segment.total_tokens,
    ],
    [2, 4, 6, 8, 20],
  );
});

test('CR2: the conversation before creating a change is its pre-draft segment', () => {
  const changes = [changeDoc(A), changeDoc(B)];
  const before = analyzeUsage({ changes, usage: cr1Records().map(usageEntryOf) }, { id: A });
  const usage = [
    ...cr1Records(),
    usageRecord({ change: B, at: at(5), event: 'created', to: 'draft', sessions: [s1(1200)] }),
  ].map(usageEntryOf);
  assert.deepEqual(segmentTotals(only(analyzeUsage({ changes, usage }, { id: B }))), [
    ['pre-draft', 200],
  ]);
  assert.deepEqual(only(analyzeUsage({ changes, usage }, { id: A })), only(before));
});

// Draft 100, approved 100, in-progress 400, in-review 100, then 300 after the
// failed verdict: 1000 tokens, 30% of them rework.
function reworkScenario(verdictType) {
  const failedFrom = verdictType === 'review' ? 'in-review' : 'in-validation';
  const change = changeDoc(C, {
    log: [logLine(at(5), verdictType, `${failedFrom} → in-progress (retry)`)],
  });
  const usage = [
    usageRecord({ change: C, at: at(1), event: 'created', to: 'draft', sessions: [s1(0)] }),
    usageRecord({ change: C, at: at(2), from: 'draft', to: 'approved', sessions: [s1(100)] }),
    usageRecord({ change: C, at: at(3), from: 'approved', to: 'in-progress', sessions: [s1(200)] }),
    usageRecord({ change: C, at: at(4), from: 'in-progress', to: failedFrom, sessions: [s1(600)] }),
    usageRecord({
      change: C,
      at: at(5),
      event: verdictType,
      from: failedFrom,
      to: 'in-progress',
      sessions: [s1(700)],
    }),
    usageRecord({
      change: C,
      at: at(6),
      from: 'in-progress',
      to: failedFrom,
      sessions: [s1(1000)],
    }),
  ].map(usageEntryOf);
  return { changes: [change], usage, failedFrom };
}

for (const verdictType of ['review', 'validation']) {
  test(`CR3: in-progress work after a failed ${verdictType} is rework`, () => {
    const { failedFrom, ...input } = reworkScenario(verdictType);
    const result = analyzeUsage(input);
    const c = only(result);
    assert.deepEqual(segmentTotals(c), [
      ['draft', 100],
      ['approved', 100],
      ['in-progress', 400],
      [failedFrom, 100],
      ['rework', 300],
    ]);
    assert.equal(c.rework_pct, 30);
    assert.ok(
      result.hints.includes(
        `rework: ${C} spent 30% of its tokens after a failed review or validation`,
      ),
      result.hints.join('\n'),
    );
  });
}

test('CR4: each recorder is subtracted against its own previous record', () => {
  const usage = [
    usageRecord({
      change: A,
      at: at(1),
      event: 'created',
      to: 'draft',
      by: 'ana',
      sessions: [s1(100)],
    }),
    usageRecord({
      change: A,
      at: at(2),
      from: 'draft',
      to: 'approved',
      by: 'luis',
      sessions: [s1(5000)],
    }),
    usageRecord({
      change: A,
      at: at(3),
      from: 'approved',
      to: 'in-progress',
      by: 'ana',
      sessions: [s1(300)],
    }),
    usageRecord({
      change: A,
      at: at(4),
      from: 'in-progress',
      to: 'in-review',
      by: 'luis',
      sessions: [s1(5400)],
    }),
  ].map(usageEntryOf);
  const result = analyzeUsage({ changes: [changeDoc(A)], usage }, { id: A });
  const a = only(result);
  assert.deepEqual(
    a.segments.map((s) => [s.segment, s.total_tokens, s.recorded_by]),
    [
      ['approved', 200, 'ana'],
      ['in-progress', 400, 'luis'],
    ],
  );
  assert.equal(a.total_tokens, 600);
  assert.ok(result.hints.includes(`baseline: first record of ana at ${at(1)} is not attributed`));
  assert.ok(result.hints.includes(`baseline: first record of luis at ${at(2)} is not attributed`));
});

test('CR5: cost sums only known prices; unpriced tokens are counted apart, never as cost 0', () => {
  const session = (opus, opusCost, local) =>
    usageSession('s1', {
      opus: { tokens: opus, cost: opusCost },
      local: { tokens: local, cost: null },
    });
  const usage = [
    usageRecord({
      change: A,
      at: at(1),
      event: 'created',
      to: 'draft',
      sessions: [session(100, 1, 100)],
    }),
    usageRecord({
      change: A,
      at: at(2),
      from: 'draft',
      to: 'approved',
      sessions: [session(200, 2.5, 500)],
    }),
  ].map(usageEntryOf);
  const result = analyzeUsage({ changes: [changeDoc(A)], usage }, { id: A });
  const [segment] = only(result).segments;
  assert.equal(segment.cost_usd, 1.5);
  assert.equal(segment.unpriced_tokens, 400);
  assert.equal(segment.total_tokens, 500);
  assert.deepEqual(
    segment.models.map((m) => [m.model, m.total_tokens, m.cost_usd, m.unpriced_tokens]),
    [
      ['local', 400, null, 400],
      ['opus', 100, 1.5, 0],
    ],
  );
  assert.ok(
    result.hints.includes('unpriced: local has 400 tokens without a price'),
    result.hints.join('\n'),
  );
});

test('CR5: a price that appears, or drops, between two records is unknown for that segment', () => {
  const session = (late, lateCost, repriced, repricedCost) =>
    usageSession('s1', {
      late: { tokens: late, cost: lateCost },
      repriced: { tokens: repriced, cost: repricedCost },
    });
  const usage = [
    usageRecord({
      change: A,
      at: at(1),
      event: 'created',
      to: 'draft',
      sessions: [session(100, null, 100, 5)],
    }),
    usageRecord({
      change: A,
      at: at(2),
      from: 'draft',
      to: 'approved',
      sessions: [session(150, 9, 130, 4)],
    }),
  ].map(usageEntryOf);
  const [segment] = only(analyzeUsage({ changes: [changeDoc(A)], usage }, { id: A })).segments;
  assert.equal(segment.cost_usd, null);
  assert.equal(segment.unpriced_tokens, 80);
});

test('CR6: a session whose tokens decrease counts 0 in that segment and is reported', () => {
  const sessions = (s9, other) => [
    usageSession('s9', { opus: { tokens: s9 } }),
    usageSession('s1', { opus: { tokens: other } }),
  ];
  const usage = [
    usageRecord({
      change: A,
      at: at(1),
      event: 'created',
      to: 'draft',
      sessions: sessions(500, 100),
    }),
    usageRecord({
      change: A,
      at: at(2),
      from: 'draft',
      to: 'approved',
      sessions: sessions(450, 200),
    }),
    usageRecord({
      change: A,
      at: at(3),
      from: 'approved',
      to: 'in-progress',
      sessions: sessions(470, 200),
    }),
  ].map(usageEntryOf);
  const result = analyzeUsage({ changes: [changeDoc(A)], usage });
  // After the anomaly the lowered value is the new baseline: +20, not -30.
  assert.deepEqual(segmentTotals(only(result)), [
    ['draft', 100],
    ['approved', 20],
  ]);
  assert.ok(
    result.hints.includes(
      `anomaly: session s9 decreased between ${at(1)} and ${at(2)}; counted as 0`,
    ),
    result.hints.join('\n'),
  );
});

function versionScenario() {
  const c = changeDoc(C, {
    log: [logLine(at(0, 30), 'version', '0.18.0'), logLine(at(3), 'version', '0.18.0 → 0.18.1')],
  });
  const usage = [
    usageRecord({ change: C, at: at(1), event: 'created', to: 'draft', sessions: [s1(0)] }),
    usageRecord({ change: C, at: at(2), from: 'draft', to: 'approved', sessions: [s1(100)] }),
    usageRecord({ change: C, at: at(3), from: 'approved', to: 'in-progress', sessions: [s1(300)] }),
    usageRecord({
      change: C,
      at: at(4),
      from: 'in-progress',
      to: 'in-review',
      sessions: [s1(600)],
    }),
    usageRecord({ change: D, at: at(5), event: 'created', to: 'draft', sessions: [s1(1000)] }),
  ].map(usageEntryOf);
  return { changes: [c, changeDoc(D)], usage };
}

test('CR7: each segment carries the ChangeLedger version stamped at or before its closing record', () => {
  const result = analyzeUsage(versionScenario(), { by: 'version' });
  const byId = Object.fromEntries(result.changes.map((c) => [c.id, c]));
  assert.deepEqual(
    byId[C].segments.map((s) => [s.segment, s.version]),
    [
      ['draft', '0.18.0'],
      ['approved', '0.18.1'],
      ['in-progress', '0.18.1'],
    ],
  );
  assert.deepEqual(
    byId[D].segments.map((s) => [s.segment, s.version]),
    [['pre-draft', 'unknown']],
  );
  assert.deepEqual(
    result.groups.map((g) => [g.key, g.total_tokens]),
    [
      ['0.18.1', 500],
      ['unknown', 400],
      ['0.18.0', 100],
    ],
  );
});

test('a failed snapshot neither resets the baseline nor becomes one', () => {
  const usage = [
    usageRecord({ change: A, at: at(0), event: 'created', to: 'draft', error: 'boom' }),
    usageRecord({ change: A, at: at(1), from: 'draft', to: 'approved', sessions: [s1(100)] }),
    usageRecord({ change: A, at: at(2), from: 'approved', to: 'in-progress', error: 'boom' }),
    usageRecord({
      change: A,
      at: at(3),
      from: 'in-progress',
      to: 'in-review',
      sessions: [s1(300)],
    }),
  ].map(usageEntryOf);
  const result = analyzeUsage({ changes: [changeDoc(A)], usage }, { id: A });
  assert.deepEqual(segmentTotals(only(result)), [['in-progress', 200]]);
  assert.deepEqual(
    result.hints.filter((h) => h.startsWith('baseline:')),
    [`baseline: first record of ana at ${at(1)} is not attributed`],
  );
});

test('a session missing from one record keeps its last seen values as baseline', () => {
  const s2 = (tokens) => usageSession('s2', { opus: { tokens } });
  const usage = [
    usageRecord({
      change: A,
      at: at(1),
      event: 'created',
      to: 'draft',
      sessions: [s1(100), s2(50)],
    }),
    usageRecord({ change: A, at: at(2), from: 'draft', to: 'approved', sessions: [s1(150)] }),
    usageRecord({
      change: A,
      at: at(3),
      from: 'approved',
      to: 'in-progress',
      sessions: [s1(150), s2(80)],
    }),
  ].map(usageEntryOf);
  assert.deepEqual(segmentTotals(only(analyzeUsage({ changes: [changeDoc(A)], usage }))), [
    ['draft', 50],
    ['approved', 30],
  ]);
});

test('without an id only measured changes are listed and the rest are reported as unmeasured', () => {
  const result = analyzeUsage({
    changes: [changeDoc(A), changeDoc(B), changeDoc(C)],
    usage: cr1Records().map(usageEntryOf),
  });
  assert.deepEqual(
    result.changes.map((c) => c.id),
    [A],
  );
  assert.deepEqual(result.groups, []);
  assert.ok(result.hints.includes('unmeasured: 2 change(s) have no usage records'));
});

test('an unknown group key is refused', () => {
  assert.throws(() => analyzeUsage({}, { by: 'foo' }), /segment, model, version, type, recorder/);
  assert.deepEqual(USAGE_GROUP_KEYS, ['segment', 'model', 'version', 'type', 'recorder']);
});

// Every scenario above at once, plus two records of one recorder sharing an
// instant (one collection serving a batch of events).
function everything() {
  const rework = reworkScenario('review');
  const version = versionScenario();
  const batch = [
    usageRecord({
      change: A,
      at: at(30),
      by: 'eva',
      event: 'created',
      to: 'draft',
      sessions: [s1(10)],
    }),
    usageRecord({
      change: A,
      at: at(31),
      by: 'eva',
      from: 'draft',
      to: 'approved',
      sessions: [s1(40)],
    }),
    usageRecord({
      change: B,
      at: at(31),
      by: 'eva',
      from: 'draft',
      to: 'approved',
      sessions: [s1(40)],
    }),
    usageRecord({
      change: B,
      at: at(32),
      by: 'eva',
      from: 'approved',
      to: 'in-progress',
      sessions: [
        usageSession('s1', { opus: { tokens: 90, cost: 1.1 }, local: { tokens: 7, cost: null } }),
      ],
    }),
  ].map(usageEntryOf);
  const shifted = cr1Records().map((r) => ({ ...r, recorded_by: 'ivo' }));
  return {
    changes: [...rework.changes, ...version.changes.slice(1), changeDoc(A), changeDoc(B)],
    usage: [
      ...rework.usage,
      ...version.usage.map((e) => usageEntryOf({ ...e.record, recorded_by: 'zoe' })),
      ...batch,
      ...shifted.map(usageEntryOf),
    ],
  };
}

test('CR10: the same input in a different order yields an identical analysis', () => {
  const input = everything();
  const reordered = {
    changes: [...input.changes].reverse(),
    usage: [...input.usage.slice(7), ...input.usage.slice(0, 7)].reverse(),
  };
  for (const by of [undefined, ...USAGE_GROUP_KEYS]) {
    const first = analyzeUsage(input, { by });
    assert.ok(first.changes.length >= 3 && first.hints.length >= 3);
    assert.deepEqual(analyzeUsage(reordered, { by }), first, `by ${by}`);
  }
  // Within a shared instant, the change id decides which record is diffed first.
  const batchB = analyzeUsage(input, { id: B }).changes[0];
  assert.deepEqual(segmentTotals(batchB), [
    ['draft', 0],
    ['approved', 57],
  ]);
});

test('CR10: the module is pure — no IO or clock imports and no import-time effects', async () => {
  const source = fs.readFileSync(new URL('../src/usage-analysis.mjs', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^import[\s\S]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['./lifecycle.mjs']);
  for (const forbidden of ['node:fs', 'node:child_process', 'node:path', 'node:os']) {
    assert.ok(!source.includes(forbidden), forbidden);
  }
  assert.doesNotMatch(source, /\bprocess\.|Date\.now|new Date\(|console\./);
  const mod = await import(`../src/usage-analysis.mjs?fresh=${Date.now()}`);
  assert.equal(typeof mod.analyzeUsage, 'function');
});
