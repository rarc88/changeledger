// Pure analysis of the ledger's usage records (20261002-140038). No IO and no
// clock: the input is the loaded changes and usage entries, the output plain
// data that `changeledger analyze` prints and the viewer can recompute.
//
// Records are cumulative snapshots. Each recorder (`recorded_by`) is ordered
// on its own and every record is diffed, session by session and model by
// model, against the last values that recorder saw of each session, whichever
// change it named. The difference belongs to the record's change and to the
// segment its transition closes.

import { isIsoUtc, parseLogEvent } from './lifecycle.mjs';

export const USAGE_ANALYSIS_SCHEMA = 1;
export const USAGE_GROUP_KEYS = ['segment', 'model', 'version', 'type', 'recorder'];

const TOKEN_FIELDS = ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens'];
const UNKNOWN = 'unknown';
const UNMEASURED_FIGURES = Object.freeze(
  Object.fromEntries(
    [...TOKEN_FIELDS, 'total_tokens', 'cost_usd', 'unpriced_tokens', 'rework_pct'].map((f) => [
      f,
      null,
    ]),
  ),
);

const isMapping = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const count = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;

function logEvents(change) {
  const body = (change?.stages ?? []).find((s) => s.key === 'log')?.body ?? '';
  return body.split('\n').map(parseLogEvent).filter(Boolean);
}

// Whether `a` goes before `b` when both are records of one change at one
// instant: a creation goes first, then each transition before the one that
// leaves the state it entered.
const precedes = (a, b) =>
  b.event !== 'created' && (a.event === 'created' || (a.to != null && a.to === b.from));

// Orders records of one change sharing an instant along their transition
// chain. `group` arrives sorted by content; among records the chain does not
// order (or a cycle), the content order decides.
function chainOrder(group) {
  const remaining = [...group];
  const ordered = [];
  while (remaining.length) {
    const ready = remaining.filter(
      (r) => !remaining.some((o) => o !== r && precedes(o.record, r.record)),
    );
    const next = (ready.length ? ready : remaining)[0];
    ordered.push(next);
    remaining.splice(remaining.indexOf(next), 1);
  }
  return ordered;
}

// The records the analysis can place: readable, `schema: 1`, naming a
// `change` and with a string `at`. The rest are skipped here; `check` reports
// an unreadable record, a wrong `schema` or a missing `change`, but not a
// missing `at`.
function validRecords(usage) {
  const records = [];
  for (const entry of usage ?? []) {
    const record = entry?.record;
    if (entry?.error || !isMapping(record) || record.schema !== 1) continue;
    if (record.change == null || typeof record.at !== 'string') continue;
    records.push({ record, text: JSON.stringify(record) });
  }
  // A total order that depends on neither the input order nor the file
  // names: instant, change id, transition chain, then content.
  records.sort(
    (a, b) =>
      compare(a.record.at, b.record.at) ||
      compare(String(a.record.change), String(b.record.change)) ||
      compare(a.text, b.text),
  );
  const ordered = [];
  for (let i = 0; i < records.length; ) {
    let j = i + 1;
    while (
      j < records.length &&
      records[j].record.at === records[i].record.at &&
      String(records[j].record.change) === String(records[i].record.change)
    ) {
      j++;
    }
    ordered.push(...(j - i > 1 ? chainOrder(records.slice(i, j)) : [records[i]]));
    i = j;
  }
  return ordered.map((entry, seq) => ({ ...entry, seq }));
}

const sessionKey = (s) => `${s?.source ?? ''}\u0000${s?.session_id ?? ''}`;
const sessionName = (s) => s?.session_id ?? UNKNOWN;
const modelTokens = (m) => Object.fromEntries(TOKEN_FIELDS.map((f) => [f, count(m?.[f])]));

// One model's growth since `prev` (absent for a model first seen now). Its
// cost is known only when both ends are priced and it did not drop.
function modelPiece(model, prev) {
  const tokens = modelTokens(model);
  const cost = typeof model.cost_usd === 'number' ? model.cost_usd : null;
  if (!prev) return { model: model.model, tokens, cost };
  const diff = Object.fromEntries(TOKEN_FIELDS.map((f) => [f, tokens[f] - prev.tokens[f]]));
  const priced = cost !== null && prev.cost !== null && cost >= prev.cost;
  return { model: model.model, tokens: diff, cost: priced ? cost - prev.cost : null };
}

// Walks one recorder's records in order and returns what each one adds:
// `[{ record, base, pieces }]` for attributable records (`base`: the `at` of
// the recorder's previous record with data), plus baseline and anomaly facts.
// `seen` keeps every session's last values, so a session missing from one
// record is not counted again in full when it comes back.
function attributeRecorder(recorder, records) {
  const seen = new Map();
  const contributions = [];
  const anomalies = [];
  let baseline = null;
  let base = null;
  for (const { record, seq } of records) {
    // The collector writes a failed snapshot (`error` set) with no sessions:
    // skipping it keeps the last real values as baseline, and its
    // consumption reaches the recorder's next record.
    if (record.error) continue;
    const sessions = Array.isArray(record.sessions) ? record.sessions : [];
    const pieces = [];
    for (const session of sessions) {
      const key = sessionKey(session);
      const prev = seen.get(key);
      const models = (Array.isArray(session?.models) ? session.models : []).filter(isMapping);
      const decreased =
        prev &&
        models.some((m) => {
          const before = prev.models.get(m.model);
          const now = modelTokens(m);
          return before && TOKEN_FIELDS.some((f) => now[f] < before.tokens[f]);
        });
      if (decreased) {
        anomalies.push({ record, session: sessionName(session), from: prev.at });
      } else if (baseline) {
        for (const m of models) pieces.push(modelPiece(m, prev?.models.get(m.model)));
      }
      const state = prev ?? { at: null, models: new Map() };
      state.at = record.at;
      for (const m of models) {
        state.models.set(m.model, {
          tokens: modelTokens(m),
          cost: typeof m.cost_usd === 'number' ? m.cost_usd : null,
        });
      }
      seen.set(key, state);
    }
    if (!baseline) baseline = { recorder, record };
    else contributions.push({ recorder, record, seq, base, pieces });
    base = record.at;
  }
  return { baseline, contributions, anomalies };
}

function emptyTotals() {
  return {
    tokens: Object.fromEntries(TOKEN_FIELDS.map((f) => [f, 0])),
    cost: 0,
    priced: false,
    unpriced: 0,
  };
}

function addPiece(totals, piece) {
  let total = 0;
  for (const f of TOKEN_FIELDS) {
    totals.tokens[f] += piece.tokens[f];
    total += piece.tokens[f];
  }
  if (piece.cost === null) totals.unpriced += total;
  else {
    totals.cost += piece.cost;
    totals.priced = true;
  }
}

function addTotals(into, from) {
  for (const f of TOKEN_FIELDS) into.tokens[f] += from.tokens[f];
  into.cost += from.cost;
  into.priced ||= from.priced;
  into.unpriced += from.unpriced;
}

// Figures as printed: the four token types, their sum, the known cost (null
// when every token in it is unpriced) and the unpriced tokens.
function figures(totals) {
  const total = TOKEN_FIELDS.reduce((sum, f) => sum + totals.tokens[f], 0);
  return {
    ...totals.tokens,
    total_tokens: total,
    cost_usd: totals.priced || totals.unpriced === 0 ? round(totals.cost, 6) : null,
    unpriced_tokens: totals.unpriced,
  };
}

const hasGrowth = (piece) =>
  TOKEN_FIELDS.some((f) => piece.tokens[f] !== 0) || (piece.cost !== null && piece.cost !== 0);

function versionAt(events, at) {
  let version = UNKNOWN;
  for (const event of events) {
    if (event.type === 'version' && event.at <= at) version = event.version;
  }
  return version;
}

// A failed verdict in the Log: `[review] in-review → in-progress` (fail
// --retry), `[review] in-review → blocked` (fail --block) or
// `[validation] in-validation → in-progress` (fail). The lifecycle has no
// `in-validation → blocked` edge.
const FAILED_VERDICT_TARGETS = Object.freeze({
  review: ['in-progress', 'blocked'],
  validation: ['in-progress'],
});

// The instant of the change's first failed verdict, or null. `segmentName`
// calls every `in-progress` segment closed at or after it `rework`.
function reworkSince(events) {
  const failures = events
    .filter((e) => FAILED_VERDICT_TARGETS[e.type]?.includes(e.to))
    .map((e) => e.at)
    .sort(compare);
  return failures[0] ?? null;
}

// Log transitions (`[status]`, `[review]`, `[validation]` and the creation
// stamped in `created`) that left no usage record with their change and
// instant, sorted by instant.
function unrecordedTransitions(docs, records) {
  const recorded = new Set(records.map((r) => `${r.record.change}\u0000${r.record.at}`));
  const instants = [];
  for (const [id, doc] of docs) {
    const created = doc?.frontmatter?.created;
    const ats = [
      ...(isIsoUtc(created) ? [String(created)] : []),
      ...logEvents(doc)
        .filter((e) => ['status', 'review', 'validation'].includes(e.type))
        .map((e) => e.at),
    ];
    for (const at of ats) if (!recorded.has(`${id}\u0000${at}`)) instants.push(at);
  }
  return instants.sort(compare);
}

// How many of the sorted `instants` fall strictly between `from` and `to`.
function countBetween(instants, from, to) {
  let n = 0;
  for (const at of instants) {
    if (at >= to) break;
    if (at > from) n++;
  }
  return n;
}

function segmentName(record, failedAt) {
  if (record.event === 'created') return 'pre-draft';
  const from = record.from ?? UNKNOWN;
  if (from === 'in-progress' && failedAt !== null && failedAt <= record.at) return 'rework';
  return from;
}

function buildSegment(contribution, events, failedAt, unrecorded) {
  const { record, recorder, pieces, base } = contribution;
  const totals = emptyTotals();
  const byModel = new Map();
  for (const piece of pieces.filter(hasGrowth)) {
    addPiece(totals, piece);
    const name = String(piece.model ?? UNKNOWN);
    if (!byModel.has(name)) byModel.set(name, emptyTotals());
    addPiece(byModel.get(name), piece);
  }
  return {
    segment: segmentName(record, failedAt),
    at: record.at,
    event: record.event ?? null,
    from: record.from ?? null,
    to: record.to ?? null,
    recorded_by: recorder,
    version: versionAt(events, record.at),
    ...figures(totals),
    models: [...byModel.keys()].sort(compare).map((model) => ({
      model,
      ...figures(byModel.get(model)),
    })),
    _totals: totals,
    _models: byModel,
    _base: base,
    _gap: countBetween(unrecorded, base, record.at),
  };
}

const percent = (part, whole) => (whole > 0 ? round((part / whole) * 100, 1) : 0);

function groupKeys(by, change, segment) {
  if (by === 'segment') return [segment.segment];
  if (by === 'version') return [segment.version];
  if (by === 'type') return [change.type];
  if (by === 'recorder') return [segment.recorded_by];
  return [...segment._models.keys()];
}

function buildGroups(by, changes) {
  const groups = new Map();
  for (const change of changes) {
    for (const segment of change._segments) {
      for (const key of groupKeys(by, change, segment)) {
        if (!groups.has(key)) groups.set(key, { totals: emptyTotals(), segments: 0 });
        const group = groups.get(key);
        addTotals(group.totals, by === 'model' ? segment._models.get(key) : segment._totals);
        group.segments++;
      }
    }
  }
  return [...groups.entries()]
    .map(([key, g]) => ({ key, segments: g.segments, ...figures(g.totals) }))
    .sort((a, b) => b.total_tokens - a.total_tokens || compare(a.key, b.key));
}

// `{ schema, changes, groups, hints }` over `changes` (loaded change
// documents) and `usage` (loaded usage entries). With `id`, `changes` holds
// that change alone (empty when the ledger knows nothing of it) and hints are
// limited to it; `by` fills `groups`.
export function analyzeUsage({ changes = [], usage = [] } = {}, { id, by } = {}) {
  if (by !== undefined && !USAGE_GROUP_KEYS.includes(by)) {
    throw new Error(`unknown group "${by}"; allowed: ${USAGE_GROUP_KEYS.join(', ')}`);
  }
  const docs = new Map();
  for (const change of [...changes].sort((a, b) =>
    compare(String(a?.frontmatter?.id), String(b?.frontmatter?.id)),
  )) {
    const key = String(change?.frontmatter?.id);
    if (!docs.has(key)) docs.set(key, change);
  }

  const records = validRecords(usage);
  const recorders = new Map();
  const recordCounts = new Map();
  const failedCounts = new Map();
  for (const entry of records) {
    const recorder = String(entry.record.recorded_by ?? UNKNOWN);
    if (!recorders.has(recorder)) recorders.set(recorder, []);
    recorders.get(recorder).push(entry);
    const change = String(entry.record.change);
    recordCounts.set(change, (recordCounts.get(change) ?? 0) + 1);
    if (entry.record.error) failedCounts.set(change, (failedCounts.get(change) ?? 0) + 1);
  }
  const unrecorded = unrecordedTransitions(docs, records);

  const baselines = [];
  const anomalies = [];
  const contributions = [];
  for (const [recorder, list] of recorders) {
    const result = attributeRecorder(recorder, list);
    if (result.baseline) baselines.push(result.baseline);
    anomalies.push(...result.anomalies);
    contributions.push(...result.contributions);
  }
  // A change is measured when at least one segment is attributed to it: not
  // when all its records failed, nor when its only record with data is its
  // recorder's baseline.
  const measured = new Set(contributions.map((c) => String(c.record.change)));

  const known = new Set([...docs.keys(), ...recordCounts.keys()]);
  const selected =
    id === undefined ? [...measured].sort(compare) : known.has(String(id)) ? [String(id)] : [];
  // Hints about records cover every change without `id`, that change alone
  // with it.
  const inScope = (change) => id === undefined || String(change) === String(id);

  const results = selected.map((changeId) => {
    const doc = docs.get(changeId);
    const events = logEvents(doc);
    const failedAt = reworkSince(events);
    const segments = contributions
      .filter((c) => String(c.record.change) === changeId)
      .sort(
        (a, b) =>
          compare(a.record.at, b.record.at) || compare(a.recorder, b.recorder) || a.seq - b.seq,
      )
      .map((c) => buildSegment(c, events, failedAt, unrecorded));
    const totals = emptyTotals();
    const rework = emptyTotals();
    for (const segment of segments) {
      addTotals(totals, segment._totals);
      if (segment.segment === 'rework') addTotals(rework, segment._totals);
    }
    const own = figures(totals);
    return {
      _reworkTokens: figures(rework).total_tokens,
      id: changeId,
      title: doc?.frontmatter?.title ?? null,
      type: String(doc?.frontmatter?.type ?? UNKNOWN),
      records: recordCounts.get(changeId) ?? 0,
      ...own,
      rework_pct: percent(figures(rework).total_tokens, own.total_tokens),
      // An unmeasured change (reachable only through `id`) has unknown
      // figures, not 0.
      ...(measured.has(changeId) ? {} : UNMEASURED_FIGURES),
      segments,
    };
  });

  const groups =
    by === undefined
      ? []
      : buildGroups(
          by,
          results.map((c) => ({ ...c, _segments: c.segments })),
        );

  const hints = [];
  for (const change of results) {
    if (change._reworkTokens > 0) {
      const pct = change.rework_pct === 0 ? '<0.1' : change.rework_pct;
      hints.push(
        `rework: ${change.id} spent ${pct}% of its tokens after a failed review or validation`,
      );
    }
  }
  const unpriced = new Map();
  for (const change of results) {
    for (const segment of change.segments) {
      for (const model of segment.models) {
        if (model.unpriced_tokens > 0) {
          unpriced.set(model.model, (unpriced.get(model.model) ?? 0) + model.unpriced_tokens);
        }
      }
    }
  }
  for (const model of [...unpriced.keys()].sort(compare)) {
    hints.push(`unpriced: ${model} has ${unpriced.get(model)} tokens without a comparable price`);
  }
  for (const a of anomalies
    .filter((a) => inScope(a.record.change))
    .sort((x, y) => compare(x.record.at, y.record.at) || compare(x.session, y.session))) {
    hints.push(
      `anomaly: session ${a.session} decreased between ${a.from} and ${a.record.at}; counted as 0`,
    );
  }
  for (const b of baselines
    .filter((b) => inScope(b.record.change))
    .sort((x, y) => compare(x.record.at, y.record.at) || compare(x.recorder, y.recorder))) {
    hints.push(`baseline: first record of ${b.recorder} at ${b.record.at} is not attributed`);
  }
  if (id === undefined) {
    const unmeasured = [...known].filter((key) => !measured.has(key)).length;
    if (unmeasured > 0) hints.push(`unmeasured: ${unmeasured} change(s) have no usage records`);
  }
  for (const change of [...failedCounts.keys()].sort(compare)) {
    if (!inScope(change)) continue;
    hints.push(`failed: ${failedCounts.get(change)} record(s) of ${change} have no data`);
  }
  for (const change of results) {
    for (const segment of change.segments) {
      if (segment._gap > 0) {
        hints.push(
          `gap: ${segment._gap} transition(s) between ${segment._base} and ${segment.at} have no usage record; their consumption is in ${change.id} ${segment.segment}`,
        );
      }
    }
  }

  return {
    schema: USAGE_ANALYSIS_SCHEMA,
    changes: results.map(({ _reworkTokens, ...c }) => ({
      ...c,
      segments: c.segments.map(({ _totals, _models, _base, _gap, ...segment }) => segment),
    })),
    groups,
    hints,
  };
}
