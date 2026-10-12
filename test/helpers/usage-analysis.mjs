// Builders for the usage-analysis suites: change documents as Markdown and
// usage records in the shape the collector writes (`schema: 1`), plus the
// `{ name, change, record, error }` entries the loaders expose for them.

import { parseChange } from '../../src/change.mjs';

export const logLine = (at, type, payload) => `- **${at}** \`[${type}]\` ${payload}`;

export function changeText(
  id,
  {
    title = `Change ${id}`,
    type = 'feature',
    status = 'in-progress',
    log = [],
    created = `${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}T00:00:00Z`,
  } = {},
) {
  return `---\nid: "${id}"\ntitle: ${title}\ntype: ${type}\nstatus: ${status}\ncreated: ${created}\ndepends_on: []\n---\n\n## Request\n\nDemo.\n\n## Log\n${log.map((l) => `${l}\n`).join('')}`;
}

// A change as `loadRepo` exposes it: `{ frontmatter, stages, ... }`.
export const changeDoc = (id, options) => parseChange(changeText(id, options));

// `models`: `{ <model>: { tokens | input, output, cache_read, cache_write, cost } }`;
// `tokens` is shorthand for input tokens only, and an omitted `cost` is 0.
export function usageSession(id, models, { source = 'claude' } = {}) {
  return {
    source,
    session_id: id,
    project_path: '-tmp-demo',
    first_activity: null,
    last_activity: null,
    models: Object.entries(models).map(([model, m]) => ({
      model,
      input_tokens: m.input ?? m.tokens ?? 0,
      output_tokens: m.output ?? 0,
      cache_read_tokens: m.cache_read ?? 0,
      cache_write_tokens: m.cache_write ?? 0,
      cost_usd: m.cost === undefined ? 0 : m.cost,
    })),
  };
}

export function usageRecord({
  change,
  at,
  event = 'status',
  from = null,
  to = null,
  by = 'ana',
  sessions = [],
  error = null,
}) {
  return {
    schema: 1,
    change,
    at,
    event,
    from,
    to,
    recorded_by: by,
    collector: { name: 'ccusage', version: '20.0.26', pricing: 'online' },
    sessions,
    excluded: [],
    error,
  };
}

// FNV-1a over the record text: a stable 8-hex suffix, so a record keeps its
// name however the suite orders it.
function suffixOf(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function usageRecordFileName(record) {
  const instant = record.at.replace(/[-:]/g, '');
  return `${record.change}--${instant}-${suffixOf(JSON.stringify(record))}.json`;
}

export const usageEntryOf = (record) => ({
  file: null,
  name: usageRecordFileName(record),
  change: record.change,
  record,
  error: null,
});
