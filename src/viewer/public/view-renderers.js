import { cssIdent } from './security.js';
import { html, nothing, svg } from './templates.js';

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function graphSvg(changes) {
  if (!changes.length) {
    return html`<p class="empty">No changes match the current filters.</p>`;
  }

  const byId = new Map(changes.map((c) => [String(c.id), c]));
  const depthCache = new Map();
  const depth = (id, seen = new Set()) => {
    if (depthCache.has(id)) return depthCache.get(id);
    if (seen.has(id)) return 0;
    const nextSeen = new Set(seen);
    nextSeen.add(id);
    const c = byId.get(String(id));
    const deps = (c?.depends_on || []).filter((d) => byId.has(String(d)));
    const d = deps.length ? 1 + Math.max(...deps.map((x) => depth(String(x), nextSeen))) : 0;
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
      return svg`<path class="edge" d=${`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} />`;
    });

  const nodes = changes.map((c) => {
    const p = pos.get(String(c.id));
    return svg`<g class="node" data-id=${c.id} transform=${`translate(${p.x},${p.y})`}>
        <rect width=${W} height=${H} stroke=${`var(--${cssIdent(c.type)})`}></rect>
        <text class="nid" x="10" y="18">#${c.id} · ${c.status}</text>
        <text x="10" y="36">${clip(c.title, 24)}</text>
      </g>`;
  });

  return html`
    <svg viewBox=${`0 0 ${width} ${height}`} height=${height}>
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
    ? specs.map(
        (s, i) => html`<div class="spec-card" data-i=${i}>
          <div class="spec-title">${s.title}</div>
          <div class="card-meta">
            <span title=${s.updated || ''}>${fmtDateTime(s.updated)}</span>
            ${(s.tags || []).map((t) => html`<span class="pill">${t}</span>`)}
          </div>
        </div>`,
      )
    : html`<p class="empty">No specs yet. Truth graduates here as changes complete.</p>`;
}

export function fmtDuration(ms) {
  if (!ms || ms < 0) return '—';
  const h = ms / 3600000;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} d`;
}

function barRows(items, label, value, fmt = (v) => v) {
  const max = Math.max(1, ...items.map(value));
  return items.map(
    (it) =>
      html`<div class="bar-row">
        <span class="bar-date">${label(it)}</span>
        <span class="bar" style=${`width:${(value(it) / max) * 100}%`}></span>
        <span class="mono">${fmt(value(it))}</span>
      </div>`,
  );
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
  ].map(
    ([label, val]) =>
      html`<div class="metric-card">
          <div class="metric-val">${val}</div>
          <div class="metric-label">${label}</div>
        </div>`,
  );

  const wipChips = Object.entries(wip).map(([s, n]) => html`<span class="pill">${s}: ${n}</span>`);

  const lead = (metrics.timeInStatus || []).filter((t) => t.avgMs > 0);
  const leadBars = lead.length
    ? barRows(
        lead,
        (t) => t.state,
        (t) => t.avgMs,
        fmtDuration,
      )
    : html`<p class="empty">No data yet.</p>`;

  const tp = metrics.throughput || [];
  const tpBars = tp.length
    ? barRows(
        tp,
        (t) => html`<span class="mono">${t.date}</span>`,
        (t) => t.count,
      )
    : html`<p class="empty">No closed changes yet.</p>`;

  const aging = metrics.aging || [];
  const agingRows = aging.length
    ? html`<ul class="git-commits">
        ${aging.map(
          (a) =>
            html`<li><span class="mono">#${a.id}</span> <span class="when">${fmtDuration(a.ms)}</span></li>`,
        )}
      </ul>`
    : html`<p class="empty">Nothing in progress.</p>`;

  const byType = metrics.byType || [];
  const typeRows = byType.length
    ? html`<table class="grid">
        <thead>
          <tr><th>Type</th><th>Closed</th><th>Avg cycle</th></tr>
        </thead>
        <tbody>
          ${byType.map(
            (t) => html`<tr>
              <td><span class="type-tag" style=${`--type-color: var(--${cssIdent(t.type)})`}>${t.type}</span></td>
              <td class="mono">${t.closed}</td>
              <td class="mono">${fmtDuration(t.avgCycleMs)}</td>
            </tr>`,
          )}
        </tbody>
      </table>`
    : html`<p class="empty">No closed changes yet.</p>`;

  return html`
    <div class="metrics-cards">${cards}</div>
    ${wipChips.length ? html`<div class="detail-meta">${wipChips}</div>` : nothing}
    <h3 class="metrics-h">Avg time in status (lead time per stage)</h3>
    <div>${leadBars}</div>
    <h3 class="metrics-h">Throughput (closed per day)</h3>
    <div>${tpBars}</div>
    <h3 class="metrics-h">Aging — in progress</h3>
    ${agingRows}
    <h3 class="metrics-h">By type</h3>
    ${typeRows}`;
}
