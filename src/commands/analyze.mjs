// `changeledger analyze` — token and cost figures per change, segment, model,
// version, type or recorder, computed from the ledger's usage records by the
// pure `src/usage-analysis.mjs` (20261002-140038). Read-only.

import { loadRepo } from '../repo.mjs';
import { analyzeUsage } from '../usage-analysis.mjs';

// The analysis plus how many usage record files the ledger holds, readable
// or not, so an empty listing can tell "no records" from "no data".
function load(id, by, cwd) {
  const { changes, usage } = loadRepo(cwd);
  const result = analyzeUsage({ changes, usage }, { id, by });
  if (id !== undefined && !result.changes.length) {
    throw new Error(
      `No change with id "${id}" (use the exact id; run \`changeledger check\` if a filename's id looks wrong)`,
    );
  }
  return { result, recordFiles: usage.length };
}

export function analyze(id, { by } = {}, cwd = process.cwd()) {
  return load(id, by, cwd).result;
}

// What a view without figures says, given how many records it could have
// drawn on: `no usage records` for none, `no usage data` otherwise.
const nothingMessage = (recordFiles) => (recordFiles > 0 ? 'no usage data' : 'no usage records');

const money = (cost) => (cost === null ? 'n/a' : `$${cost.toFixed(2)}`);

// A rework share that rounds to 0 while rework has tokens prints as `<0.1%`,
// as its hint does.
function reworkShare(change) {
  const tokens = change.segments
    .filter((s) => s.segment === 'rework')
    .reduce((sum, s) => sum + s.total_tokens, 0);
  return tokens > 0 && change.rework_pct === 0 ? '<0.1%' : `${change.rework_pct}%`;
}

// Left-aligned columns separated by two spaces; the last column is not padded.
function table(header, rows) {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells) =>
    cells
      .map((cell, i) => (i === cells.length - 1 ? String(cell) : String(cell).padEnd(widths[i])))
      .join('  ');
  return [line(header), ...rows.map(line)];
}

function changesView(result, recordFiles) {
  if (!result.changes.length) return [nothingMessage(recordFiles)];
  return table(
    ['ID', 'TOKENS', 'COST', 'REWORK', 'TITLE'],
    result.changes.map((c) => [
      c.id,
      c.total_tokens,
      money(c.cost_usd),
      reworkShare(c),
      c.title ?? '',
    ]),
  );
}

function changeView(change) {
  const heading = `#${change.id} ${change.title ?? ''}`.trimEnd();
  // Unmeasured: no segment is attributed to it, so no total is printed.
  if (change.total_tokens === null) return [heading, nothingMessage(change.records)];
  const lines = [
    heading,
    `total: ${change.total_tokens} tokens, ${money(change.cost_usd)}, ${change.unpriced_tokens} unpriced tokens, rework ${reworkShare(change)}`,
  ];
  return [
    ...lines,
    '',
    ...table(
      ['SEGMENT', 'CLOSED AT', 'VERSION', 'RECORDER', 'TOKENS', 'COST', 'MODELS'],
      change.segments.map((s) => [
        s.segment,
        s.at,
        s.version,
        s.recorded_by,
        s.total_tokens,
        money(s.cost_usd),
        s.models.map((m) => m.model).join(', '),
      ]),
    ),
  ];
}

function groupsView(by, groups, recordFiles) {
  if (!groups.length) return [nothingMessage(recordFiles)];
  return table(
    [by.toUpperCase(), 'TOKENS', 'COST', 'UNPRICED', 'SEGMENTS'],
    groups.map((g) => [g.key, g.total_tokens, money(g.cost_usd), g.unpriced_tokens, g.segments]),
  );
}

export function runAnalyze(id, options = {}, cwd = process.cwd()) {
  const { result, recordFiles } = load(id, options.by, cwd);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const lines =
    options.by !== undefined
      ? groupsView(options.by, result.groups, recordFiles)
      : id !== undefined
        ? changeView(result.changes[0])
        : changesView(result, recordFiles);
  if (result.hints.length) lines.push('', ...result.hints);
  console.log(lines.join('\n'));
}
