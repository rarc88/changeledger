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

test('CR3: rework that rounds to 0% is still reported, as <0.1%', () => {
  const change = changeDoc(C, {
    log: [logLine(at(3), 'review', 'in-review → in-progress (retry)')],
  });
  const usage = [
    usageRecord({ change: C, at: at(1), event: 'created', to: 'draft', sessions: [s1(0)] }),
    usageRecord({ change: C, at: at(2), from: 'draft', to: 'in-review', sessions: [s1(100000)] }),
    usageRecord({
      change: C,
      at: at(3),
      event: 'review',
      from: 'in-review',
      to: 'in-progress',
      sessions: [s1(100000)],
    }),
    usageRecord({
      change: C,
      at: at(4),
      from: 'in-progress',
      to: 'in-review',
      sessions: [s1(100004)],
    }),
  ].map(usageEntryOf);
  const result = analyzeUsage({ changes: [change], usage });
  assert.deepEqual(segmentTotals(only(result)), [
    ['draft', 100000],
    ['in-review', 0],
    ['rework', 4],
  ]);
  assert.ok(
    result.hints.includes(
      `rework: ${C} spent <0.1% of its tokens after a failed review or validation`,
    ),
    result.hints.join('\n'),
  );
});

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
    result.hints.includes('unpriced: local has 400 tokens without a comparable price'),
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
  const result = analyzeUsage({ changes: [changeDoc(A)], usage }, { id: A });
  const [segment] = only(result).segments;
  assert.equal(segment.cost_usd, null);
  assert.equal(segment.unpriced_tokens, 80);
  for (const hint of [
    'unpriced: late has 50 tokens without a comparable price',
    'unpriced: repriced has 30 tokens without a comparable price',
  ]) {
    assert.ok(result.hints.includes(hint), result.hints.join('\n'));
  }
});

test('CR5: a price that disappears between two records is unknown for that segment', () => {
  const usage = [
    usageRecord({
      change: A,
      at: at(1),
      event: 'created',
      to: 'draft',
      sessions: [usageSession('s1', { gone: { tokens: 100, cost: 2 } })],
    }),
    usageRecord({
      change: A,
      at: at(2),
      from: 'draft',
      to: 'approved',
      sessions: [usageSession('s1', { gone: { tokens: 160, cost: null } })],
    }),
  ].map(usageEntryOf);
  const result = analyzeUsage({ changes: [changeDoc(A)], usage }, { id: A });
  const [segment] = only(result).segments;
  assert.equal(segment.cost_usd, null);
  assert.equal(segment.unpriced_tokens, 60);
  assert.ok(
    result.hints.includes('unpriced: gone has 60 tokens without a comparable price'),
    result.hints.join('\n'),
  );
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

test('CR13: a failed snapshot neither resets the baseline nor becomes one', () => {
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
  assert.ok(result.hints.includes(`failed: 2 record(s) of ${A} have no data`));
});

// CR13: A's `created` record failed and both of C's did, between records with
// data of the same recorder (O's baseline and A's `draft → approved`).
function failedScenario() {
  const O = '20261001-000009';
  const changes = [changeDoc(A), changeDoc(C), changeDoc(O)];
  const usage = [
    usageRecord({ change: O, at: at(1), event: 'created', to: 'draft', sessions: [s1(100)] }),
    usageRecord({ change: A, at: at(2), event: 'created', to: 'draft', error: 'boom' }),
    usageRecord({ change: C, at: at(3), event: 'created', to: 'draft', error: 'boom' }),
    usageRecord({ change: C, at: at(4), from: 'draft', to: 'approved', error: 'boom' }),
    usageRecord({ change: A, at: at(5), from: 'draft', to: 'approved', sessions: [s1(400)] }),
  ].map(usageEntryOf);
  return { changes, usage, O };
}

test('CR13: records with error are reported as failed, and a change with only those is unmeasured', () => {
  const { O, ...input } = failedScenario();
  const result = analyzeUsage(input);
  assert.deepEqual(
    result.changes.map((c) => [c.id, segmentTotals(c)]),
    [
      [A, [['draft', 300]]],
      [O, []],
    ],
  );
  for (const hint of [
    `failed: 1 record(s) of ${A} have no data`,
    `failed: 2 record(s) of ${C} have no data`,
    'unmeasured: 1 change(s) have no usage records',
    `baseline: first record of ana at ${at(1)} is not attributed`,
  ]) {
    assert.ok(result.hints.includes(hint), result.hints.join('\n'));
  }
  assert.ok(!result.hints.some((h) => h.startsWith('baseline:') && h.includes(at(2))));
});

test('CR12: a session missing from one record is subtracted against its last seen values', () => {
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

test('CR13: with an id, a change without a record carrying data has null totals, never 0', () => {
  const { O, ...input } = failedScenario();
  const nulls = {
    input_tokens: null,
    output_tokens: null,
    cache_read_tokens: null,
    cache_write_tokens: null,
    total_tokens: null,
    cost_usd: null,
    unpriced_tokens: null,
    rework_pct: null,
  };
  const pick = (c) => Object.fromEntries(Object.keys(nulls).map((k) => [k, c[k]]));
  const failedOnly = only(analyzeUsage(input, { id: C }));
  assert.deepEqual(pick(failedOnly), nulls);
  assert.equal(failedOnly.records, 2);
  assert.deepEqual(failedOnly.segments, []);
  const unrecorded = only(
    analyzeUsage({ ...input, changes: [...input.changes, changeDoc(D)] }, { id: D }),
  );
  assert.deepEqual(pick(unrecorded), nulls);
  assert.equal(unrecorded.records, 0);
  // A measured change keeps numbers, even a baseline-only one with 0 tokens.
  assert.equal(only(analyzeUsage(input, { id: O })).total_tokens, 0);
  assert.equal(only(analyzeUsage(input, { id: A })).total_tokens, 300);
});

// CR14: ana's records of A at minutes 1 and 4; B's Log has transitions in
// between. `bRecords` lists the B transitions that left a record (by luis).
function gapScenario({ bLog, bCreated, bRecords = [] }) {
  const changes = [
    changeDoc(A),
    changeDoc(B, {
      ...(bCreated ? { created: bCreated } : {}),
      log: bLog,
    }),
  ];
  const usage = [
    usageRecord({ change: A, at: at(1), event: 'created', to: 'draft', sessions: [s1(100)] }),
    usageRecord({ change: A, at: at(4), from: 'draft', to: 'approved', sessions: [s1(900)] }),
    ...bRecords.map((when) =>
      usageRecord({
        change: B,
        at: when,
        from: 'x',
        to: 'y',
        by: 'luis',
        sessions: [usageSession('t', { opus: { tokens: 1 } })],
      }),
    ),
  ].map(usageEntryOf);
  return { changes, usage };
}

const bTransitions = [
  logLine(at(2), 'status', 'draft → approved'),
  logLine(at(3), 'review', 'in-review → in-progress (retry)'),
];

test('CR14: transitions without a record inside a segment are reported as a gap', () => {
  const result = analyzeUsage(gapScenario({ bLog: bTransitions }));
  assert.ok(
    result.hints.includes(
      `gap: 2 transition(s) between ${at(1)} and ${at(4)} have no usage record; their consumption is in ${A} draft`,
    ),
    result.hints.join('\n'),
  );
  const scoped = analyzeUsage(gapScenario({ bLog: bTransitions }), { id: A });
  assert.ok(
    scoped.hints.some((h) => h.startsWith('gap: 2 transition(s)')),
    scoped.hints.join('\n'),
  );
});

test('CR14: creation and validation count as transitions; other Log lines and the segment ends do not', () => {
  const result = analyzeUsage(
    gapScenario({
      bCreated: at(1, 30),
      bLog: [
        logLine(at(1), 'status', 'draft → approved'),
        logLine(at(2), 'validation', 'in-validation → in-progress (retry)'),
        logLine(at(2, 30), 'note', 'not a transition'),
        logLine(at(3), 'version', '0.18.0'),
        logLine(at(4), 'status', 'approved → in-progress'),
      ],
    }),
  );
  assert.deepEqual(
    result.hints.filter((h) => h.startsWith('gap:')),
    [
      `gap: 2 transition(s) between ${at(1)} and ${at(4)} have no usage record; their consumption is in ${A} draft`,
    ],
  );
});

test('CR14: without unrecorded transitions in between there is no gap hint', () => {
  const result = analyzeUsage(gapScenario({ bLog: bTransitions, bRecords: [at(2), at(3)] }));
  assert.deepEqual(
    result.hints.filter((h) => h.startsWith('gap:')),
    [],
  );
});

// CR15: two transitions of A at one instant, after a baseline of another
// change, written under file names in either suffix order.
function sameInstant(records, suffixes) {
  const base = usageRecord({
    change: B,
    at: at(1),
    event: 'created',
    to: 'draft',
    sessions: [s1(100)],
  });
  return [
    usageEntryOf(base),
    ...records.map((record, i) => ({
      ...usageEntryOf(record),
      name: `${A}--20261001T000200Z-${suffixes[i]}.json`,
    })),
  ];
}

for (const suffixes of [
  ['00000000', 'ffffffff'],
  ['ffffffff', '00000000'],
]) {
  test(`CR15: same-instant transitions of a change follow their chain (suffixes ${suffixes.join(', ')})`, () => {
    const usage = sameInstant(
      [
        usageRecord({ change: A, at: at(2), from: 'draft', to: 'approved', sessions: [s1(400)] }),
        usageRecord({
          change: A,
          at: at(2),
          from: 'approved',
          to: 'in-progress',
          sessions: [s1(400)],
        }),
      ],
      suffixes,
    );
    const a = only(analyzeUsage({ changes: [changeDoc(A), changeDoc(B)], usage }, { id: A }));
    assert.deepEqual(segmentTotals(a), [
      ['draft', 300],
      ['approved', 0],
    ]);
  });

  test(`CR15: a same-instant creation goes first (suffixes ${suffixes.join(', ')})`, () => {
    const usage = sameInstant(
      [
        usageRecord({ change: A, at: at(2), from: 'draft', to: 'approved', sessions: [s1(400)] }),
        usageRecord({ change: A, at: at(2), event: 'created', to: 'draft', sessions: [s1(400)] }),
      ],
      suffixes,
    );
    const a = only(analyzeUsage({ changes: [changeDoc(A), changeDoc(B)], usage }, { id: A }));
    assert.deepEqual(segmentTotals(a), [
      ['pre-draft', 300],
      ['draft', 0],
    ]);
  });
}

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
  // CR15 and CR13 pieces: a chain at one instant and a failed record.
  const chain = [
    usageRecord({
      change: D,
      at: at(40),
      by: 'eva',
      from: 'draft',
      to: 'approved',
      sessions: [s1(150)],
    }),
    usageRecord({
      change: D,
      at: at(40),
      by: 'eva',
      from: 'approved',
      to: 'in-progress',
      sessions: [s1(150)],
    }),
    usageRecord({
      change: D,
      at: at(41),
      by: 'eva',
      from: 'in-progress',
      to: 'in-review',
      error: 'boom',
    }),
  ].map(usageEntryOf);
  // A CR14 gap inside eva's segments: a transition of C without a record.
  const gapped = changeDoc(C, {
    log: [
      ...rework.changes[0].stages
        .find((s) => s.key === 'log')
        .body.split('\n')
        .filter(Boolean),
      logLine(at(35), 'status', 'in-review → done'),
    ],
  });
  return {
    changes: [gapped, ...version.changes.slice(1), changeDoc(A), changeDoc(B)],
    usage: [
      ...rework.usage,
      ...version.usage.map((e) => usageEntryOf({ ...e.record, recorded_by: 'zoe' })),
      ...batch,
      ...chain,
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
  const all = analyzeUsage(input);
  for (const prefix of ['rework:', 'unpriced:', 'baseline:', 'failed:', 'gap:']) {
    assert.ok(
      all.hints.some((h) => h.startsWith(prefix)),
      `${prefix}\n${all.hints.join('\n')}`,
    );
  }
});

test('CR10: record file names do not change the analysis', () => {
  const input = everything();
  const renamed = {
    ...input,
    usage: input.usage.map((e, i) => ({
      ...e,
      name: e.name.replace(
        /-[0-9a-f]{8}\.json$/,
        `-${String(input.usage.length - i).padStart(8, '0')}.json`,
      ),
    })),
  };
  for (const by of [undefined, ...USAGE_GROUP_KEYS]) {
    assert.deepEqual(analyzeUsage(renamed, { by }), analyzeUsage(input, { by }), `by ${by}`);
  }
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

test('CR10: nothing the module imports, directly or transitively, is an IO module', () => {
  const forbidden = ['node:fs', 'node:child_process', 'node:path', 'node:os'];
  const pending = [new URL('../src/usage-analysis.mjs', import.meta.url)];
  const visited = new Set();
  const found = [];
  while (pending.length) {
    const url = pending.pop();
    if (visited.has(url.href)) continue;
    visited.add(url.href);
    const source = fs.readFileSync(url, 'utf8');
    for (const [, specifier] of source.matchAll(
      /^\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/gm,
    )) {
      if (specifier.startsWith('.')) pending.push(new URL(specifier, url));
      else if (forbidden.some((f) => specifier === f || specifier === f.slice(5))) {
        found.push(`${url.pathname.split('/src/')[1]} imports ${specifier}`);
      }
    }
  }
  assert.deepEqual(found, []);
});
