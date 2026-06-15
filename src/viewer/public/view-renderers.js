import { cssIdent, esc } from './security.js';

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function graphSvg(changes) {
  const byId = new Map(changes.map((c) => [String(c.id), c]));
  const depthCache = new Map();
  const depth = (id, seen = new Set()) => {
    if (depthCache.has(id)) return depthCache.get(id);
    if (seen.has(id)) return 0;
    seen.add(id);
    const c = byId.get(String(id));
    const deps = (c?.depends_on || []).filter((d) => byId.has(String(d)));
    const d = deps.length ? 1 + Math.max(...deps.map((x) => depth(String(x), seen))) : 0;
    depthCache.set(id, d);
    return d;
  };

  const layers = {};
  for (const c of changes) {
    const d = depth(String(c.id));
    layers[d] ||= [];
    layers[d].push(c);
  }

  const COL = 230;
  const ROW = 78;
  const W = 180;
  const H = 52;
  const pos = new Map();
  for (const [d, items] of Object.entries(layers)) {
    items.forEach((c, i) => {
      pos.set(String(c.id), { x: +d * COL + 30, y: i * ROW + 30 });
    });
  }

  const width = (Math.max(...Object.keys(layers).map(Number)) + 1) * COL + 60;
  const height = Math.max(...Object.values(layers).map((l) => l.length)) * ROW + 60;

  const edges = changes
    .flatMap((c) =>
      (c.depends_on || [])
        .filter((d) => pos.has(String(d)))
        .map((d) => ({ from: pos.get(String(d)), to: pos.get(String(c.id)) })),
    )
    .map((e) => {
      const x1 = e.from.x + W;
      const y1 = e.from.y + H / 2;
      const x2 = e.to.x;
      const y2 = e.to.y + H / 2;
      const mx = (x1 + x2) / 2;
      return `<path class="edge" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" />`;
    })
    .join('');

  const nodes = changes
    .map((c) => {
      const p = pos.get(String(c.id));
      return `<g class="node" data-id="${esc(c.id)}" transform="translate(${p.x},${p.y})">
        <rect width="${W}" height="${H}" stroke="var(--${cssIdent(c.type)})"></rect>
        <text class="nid" x="10" y="18">#${esc(c.id)} · ${esc(c.status)}</text>
        <text x="10" y="36">${esc(clip(c.title, 24))}</text>
      </g>`;
    })
    .join('');

  return `
    <svg viewBox="0 0 ${width} ${height}" height="${height}">
      <defs>
        <marker id="arrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
          <path d="M0,0 L7,3 L0,6 Z" fill="var(--muted)"></path>
        </marker>
      </defs>
      ${edges}${nodes}
    </svg>`;
}

export function specsListHtml(specs, fmtDateTime) {
  return specs.length
    ? specs
        .map(
          (s, i) => `<div class="spec-card" data-i="${i}">
            <div class="spec-title">${esc(s.title)}</div>
            <div class="card-meta"><span title="${esc(s.updated || '')}">${esc(fmtDateTime(s.updated))}</span>${(
              s.tags || []
            )
              .map((t) => `<span class="pill">${esc(t)}</span>`)
              .join('')}</div>
          </div>`,
        )
        .join('')
    : '<p class="empty">No specs yet. Truth graduates here as changes complete.</p>';
}

export function fmtDuration(ms) {
  if (!ms || ms < 0) return '—';
  const h = ms / 3600000;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} d`;
}

function barRows(items, label, value, fmt = (v) => v) {
  const max = Math.max(1, ...items.map(value));
  return items
    .map(
      (it) =>
        `<div class="bar-row"><span class="bar-date">${label(it)}</span><span class="bar" style="width:${(value(it) / max) * 100}%"></span><span class="mono">${fmt(value(it))}</span></div>`,
    )
    .join('');
}

export function metricsHtml(metrics = {}) {
  const wip = metrics.wip || {};
  const wipTotal = Object.values(wip).reduce((a, b) => a + b, 0);
  const cards = [
    ['Closed', metrics.count ?? 0],
    ['Avg cycle', fmtDuration(metrics.avgCycleMs)],
    ['Median cycle', fmtDuration(metrics.medianCycleMs)],
    ['WIP', wipTotal],
    ['Blocked time', fmtDuration(metrics.blockedMs)],
  ]
    .map(
      ([label, val]) =>
        `<div class="metric-card"><div class="metric-val">${val}</div><div class="metric-label">${esc(label)}</div></div>`,
    )
    .join('');

  const wipChips = Object.entries(wip)
    .map(([s, n]) => `<span class="pill">${esc(s)}: ${n}</span>`)
    .join('');

  const lead = (metrics.timeInStatus || []).filter((t) => t.avgMs > 0);
  const leadBars = lead.length
    ? barRows(
        lead,
        (t) => esc(t.state),
        (t) => t.avgMs,
        fmtDuration,
      )
    : '<p class="empty">No data yet.</p>';

  const tp = metrics.throughput || [];
  const tpBars = tp.length
    ? barRows(
        tp,
        (t) => `<span class="mono">${esc(t.date)}</span>`,
        (t) => t.count,
      )
    : '<p class="empty">No closed changes yet.</p>';

  const aging = metrics.aging || [];
  const agingRows = aging.length
    ? `<ul class="git-commits">${aging
        .map(
          (a) =>
            `<li><span class="mono">#${esc(a.id)}</span> <span class="when">${fmtDuration(a.ms)}</span></li>`,
        )
        .join('')}</ul>`
    : '<p class="empty">Nothing in progress.</p>';

  const byType = metrics.byType || [];
  const typeRows = byType.length
    ? `<table class="grid"><thead><tr><th>Type</th><th>Closed</th><th>Avg cycle</th></tr></thead><tbody>${byType
        .map(
          (t) =>
            `<tr><td><span class="type-tag" style="--type-color: var(--${cssIdent(t.type)})">${esc(t.type)}</span></td><td class="mono">${t.closed}</td><td class="mono">${fmtDuration(t.avgCycleMs)}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : '<p class="empty">No closed changes yet.</p>';

  return `
    <div class="metrics-cards">${cards}</div>
    ${wipChips ? `<div class="detail-meta">${wipChips}</div>` : ''}
    <h3 class="metrics-h">Avg time in status (lead time per stage)</h3>
    <div>${leadBars}</div>
    <h3 class="metrics-h">Throughput (closed per day)</h3>
    <div>${tpBars}</div>
    <h3 class="metrics-h">Aging — in progress</h3>
    ${agingRows}
    <h3 class="metrics-h">By type</h3>
    ${typeRows}`;
}
