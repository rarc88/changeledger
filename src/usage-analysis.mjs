// Pure analysis of the ledger's usage records (20261002-140038). No IO and no
// clock: the input is the loaded changes and usage entries, the output plain
// data that `changeledger analyze` prints and the viewer can recompute.
//
// Records are cumulative snapshots. Each recorder (`recorded_by`) is ordered
// on its own and every record is diffed, session by session and model by
// model, against what that recorder saw before, whichever change it named.
// The difference belongs to the record's change and to the segment its
// transition closes.

import { parseLogEvent } from './lifecycle.mjs';

export const USAGE_ANALYSIS_SCHEMA = 1;
export const USAGE_GROUP_KEYS = ['segment', 'model', 'version', 'type', 'recorder'];

const TOKEN_FIELDS = ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens'];
const UNKNOWN = 'unknown';

const isMapping = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const count = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;

function logEvents(change) {
  const body = (change?.stages ?? []).find((s) => s.key === 'log')?.body ?? '';
  return body.split('\n').map(parseLogEvent).filter(Boolean);
}

// Valid `schema: 1` records only: an unreadable or malformed one is
// `check`'s to report and carries nothing to attribute.
function validRecords(usage) {
  const records = [];
  for (const entry of usage ?? []) {
    const record = entry?.record;
    if (entry?.error || !isMapping(record) || record.schema !== 1) continue;
    if (record.change == null || typeof record.at !== 'string') continue;
    records.push({ name: String(entry.name ?? ''), record });
  }
  // A total order over the records, so their input order does not change the
  // result.
  return records.sort(
    (a, b) =>
      compare(a.record.at, b.record.at) ||
      compare(String(a.record.change), String(b.record.change)) ||
      compare(a.name, b.name) ||
      compare(JSON.stringify(a.record), JSON.stringify(b.record)),
  );
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
// `[{ record, pieces }]` for attributable records, plus baseline and anomaly
// facts. `seen` keeps every session's last values, so a session missing from
// one record is not counted again in full when it comes back.
function attributeRecorder(recorder, records) {
  const seen = new Map();
  const contributions = [];
  const anomalies = [];
  let baseline = null;
  for (const { record } of records) {
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
    else contributions.push({ recorder, record, pieces });
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

// The first failed review or validation, after which `in-progress` is rework.
function reworkSince(events) {
  const failures = events
    .filter((e) => (e.type === 'review' || e.type === 'validation') && e.to === 'in-progress')
    .map((e) => e.at)
    .sort(compare);
  return failures[0] ?? null;
}

function segmentName(record, failedAt) {
  if (record.event === 'created') return 'pre-draft';
  const from = record.from ?? UNKNOWN;
  if (from === 'in-progress' && failedAt !== null && failedAt <= record.at) return 'rework';
  return from;
}

function buildSegment(contribution, events, failedAt) {
  const { record, recorder, pieces } = contribution;
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
  for (const entry of records) {
    const recorder = String(entry.record.recorded_by ?? UNKNOWN);
    if (!recorders.has(recorder)) recorders.set(recorder, []);
    recorders.get(recorder).push(entry);
    const change = String(entry.record.change);
    recordCounts.set(change, (recordCounts.get(change) ?? 0) + 1);
  }

  const baselines = [];
  const anomalies = [];
  const contributions = [];
  for (const [recorder, list] of recorders) {
    const result = attributeRecorder(recorder, list);
    if (result.baseline) baselines.push(result.baseline);
    anomalies.push(...result.anomalies);
    contributions.push(...result.contributions);
  }

  const known = new Set([...docs.keys(), ...recordCounts.keys()]);
  const selected =
    id === undefined
      ? [...recordCounts.keys()].sort(compare)
      : known.has(String(id))
        ? [String(id)]
        : [];
  const inScope = new Set(selected);

  const results = selected.map((changeId) => {
    const doc = docs.get(changeId);
    const events = logEvents(doc);
    const failedAt = reworkSince(events);
    const segments = contributions
      .filter((c) => String(c.record.change) === changeId)
      .sort(
        (a, b) =>
          compare(a.record.at, b.record.at) ||
          compare(a.recorder, b.recorder) ||
          compare(JSON.stringify(a.record), JSON.stringify(b.record)),
      )
      .map((c) => buildSegment(c, events, failedAt));
    const totals = emptyTotals();
    const rework = emptyTotals();
    for (const segment of segments) {
      addTotals(totals, segment._totals);
      if (segment.segment === 'rework') addTotals(rework, segment._totals);
    }
    const own = figures(totals);
    return {
      id: changeId,
      title: doc?.frontmatter?.title ?? null,
      type: String(doc?.frontmatter?.type ?? UNKNOWN),
      records: recordCounts.get(changeId) ?? 0,
      ...own,
      rework_pct: percent(figures(rework).total_tokens, own.total_tokens),
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
    if (change.rework_pct > 0) {
      hints.push(
        `rework: ${change.id} spent ${change.rework_pct}% of its tokens after a failed review or validation`,
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
    hints.push(`unpriced: ${model} has ${unpriced.get(model)} tokens without a price`);
  }
  for (const a of anomalies
    .filter((a) => inScope.has(String(a.record.change)))
    .sort((x, y) => compare(x.record.at, y.record.at) || compare(x.session, y.session))) {
    hints.push(
      `anomaly: session ${a.session} decreased between ${a.from} and ${a.record.at}; counted as 0`,
    );
  }
  for (const b of baselines
    .filter((b) => inScope.has(String(b.record.change)))
    .sort((x, y) => compare(x.record.at, y.record.at) || compare(x.recorder, y.recorder))) {
    hints.push(`baseline: first record of ${b.recorder} at ${b.record.at} is not attributed`);
  }
  if (id === undefined) {
    const unmeasured = [...docs.keys()].filter((key) => !recordCounts.has(key)).length;
    if (unmeasured > 0) hints.push(`unmeasured: ${unmeasured} change(s) have no usage records`);
  }

  return {
    schema: USAGE_ANALYSIS_SCHEMA,
    changes: results.map((c) => ({
      ...c,
      segments: c.segments.map(({ _totals, _models, ...segment }) => segment),
    })),
    groups,
    hints,
  };
}
