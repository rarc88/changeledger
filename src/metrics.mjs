// Pure delivery metrics derived from change timestamps. No IO — operates on the
// loaded changes (frontmatter + stages). The viewer renders the result.

// The moment a change reached `done` lives in its Log as
// `- **<iso>** — status: ... → done` (written by `sl status`). Returns the ISO of
// the last such entry, or null if absent.
export function doneAt(change) {
  const log = (change.stages ?? []).find((s) => s.key === 'log');
  if (!log) return null;
  let iso = null;
  for (const line of log.body.split('\n')) {
    const m = line.match(/\*\*([^*]+)\*\*\s*—\s*status:.*→\s*done\b/);
    if (m) iso = m[1].trim();
  }
  return iso;
}

function median(sorted) {
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function computeMetrics(changes = []) {
  const perChange = [];
  const byDate = new Map();

  for (const c of changes) {
    if (c.frontmatter?.status !== 'done') continue;
    const closed = doneAt(c);
    const created = c.frontmatter?.created;
    if (!closed || !created) continue;
    const cycleMs = Date.parse(closed) - Date.parse(created);
    if (Number.isNaN(cycleMs)) continue;
    perChange.push({ id: c.frontmatter.id, cycleMs });
    const date = closed.slice(0, 10);
    byDate.set(date, (byDate.get(date) ?? 0) + 1);
  }

  const cycles = perChange.map((p) => p.cycleMs).sort((a, b) => a - b);
  const avgCycleMs = cycles.length
    ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length)
    : 0;

  const throughput = [...byDate.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return {
    count: perChange.length,
    avgCycleMs,
    medianCycleMs: median(cycles),
    perChange,
    throughput,
  };
}
