import { cssIdent } from './security.js';
import { html, nothing, svg } from './templates.js';
import { splitGraduationHistory } from './view-parts.js';

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// Plain-text excerpt for spec cards: strips the leading graduation-history
// blockquote, picks the first prose paragraph (skipping headings, remaining
// blockquotes and code fences) and removes inline Markdown syntax. The result
// is interpolated as text (lit-html), never as HTML.
function firstProseParagraph(text) {
  const paragraphs = String(text ?? '').split(/\n\s*\n/);
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    if (/^#{1,6}\s/.test(trimmed)) continue;
    if (/^>/.test(trimmed)) continue;
    if (/^```/.test(trimmed)) continue;
    return trimmed;
  }
  return '';
}

function stripMarkdown(text) {
  return text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function specExcerpt(body, maxLen = 160) {
  const { after } = splitGraduationHistory(body);
  return clip(stripMarkdown(firstProseParagraph(after)), maxLen);
}

// Most recently updated truth first.
export function sortSpecsByUpdated(specs) {
  const time = (s) => Date.parse(s?.updated || '') || 0;
  return [...specs].sort((a, b) => time(b) - time(a));
}

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
  if (!specs.length) {
    return html`<p class="empty">No specs yet. Truth graduates here as changes complete.</p>`;
  }
  return sortSpecsByUpdated(specs).map(
    (s, i) => html`<div class="spec-card" data-i=${i}>
      <div class="spec-title">${s.title}</div>
      <div class="card-meta">
        <span title=${s.updated || ''}>${fmtDateTime(s.updated)}</span>
        ${(s.tags || []).map((t) => html`<span class="pill">${t}</span>`)}
      </div>
      <p class="spec-excerpt">${specExcerpt(s.body)}</p>
    </div>`,
  );
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

// Hand-rolled SVG bar chart for throughput: one bar per day, a date label and
// the numeric count both drawn as text so the value is visible without a
// tooltip (no charting dependency — same precedent as `graphSvg`).
function throughputSvg(tp) {
  if (!tp.length) return html`<p class="empty">No closed changes yet.</p>`;

  const width = 640;
  const height = 180;
  const padTop = 22;
  const padBottom = 30;
  const padSide = 12;
  const plotWidth = Math.max(1, width - padSide * 2);
  const plotHeight = Math.max(1, height - padTop - padBottom);
  const max = Math.max(1, ...tp.map((t) => t.count));
  const slot = plotWidth / tp.length;
  const barWidth = Math.max(2, Math.min(48, slot - 8));

  const bars = tp.map((t, i) => {
    const barHeight = (t.count / max) * plotHeight;
    const x = padSide + i * slot + (slot - barWidth) / 2;
    const y = height - padBottom - barHeight;
    return svg`<g class="tp-bar">
        <rect class="tp-rect" x=${x} y=${y} width=${barWidth} height=${barHeight}></rect>
        <text class="tp-value" x=${x + barWidth / 2} y=${Math.max(12, y - 6)} text-anchor="middle">${t.count}</text>
        <text class="tp-date" x=${x + barWidth / 2} y=${height - padBottom + 16} text-anchor="middle">${t.date}</text>
      </g>`;
  });

  return html`<svg
    class="throughput-svg"
    viewBox=${`0 0 ${width} ${height}`}
    height=${height}
    role="img"
    aria-label="Throughput per day"
  >
    <line
      class="tp-axis"
      x1=${padSide}
      y1=${height - padBottom}
      x2=${width - padSide}
      y2=${height - padBottom}
    ></line>
    ${bars}
  </svg>`;
}

function metricsTable(rows, columnLabel, labelOf) {
  return rows.length
    ? html`<table class="grid">
        <thead>
          <tr><th>${columnLabel}</th><th>Closed</th><th>Avg cycle</th></tr>
        </thead>
        <tbody>
          ${rows.map(
            (r) => html`<tr>
              <td>${labelOf(r)}</td>
              <td class="mono">${r.closed}</td>
              <td class="mono">${fmtDuration(r.avgCycleMs)}</td>
            </tr>`,
          )}
        </tbody>
      </table>`
    : html`<p class="empty">No closed changes yet.</p>`;
}

export function metricsHtml(metrics = {}, totalChanges = 0) {
  if (!totalChanges) {
    return html`<p class="empty">No changes match the current filters.</p>`;
  }

  const wip = metrics.wip || {};
  const wipTotal = Object.values(wip).reduce((a, b) => a + b, 0);
  const cards = [
    ['Closed', metrics.count ?? 0],
    ['Cycle p50', fmtDuration(metrics.p50CycleMs)],
    ['Cycle p85', fmtDuration(metrics.p85CycleMs)],
    ['WIP', wipTotal],
    ['Blocked time', fmtDuration(metrics.blockedMs)],
    ['Validation wait', fmtDuration(metrics.validationWaitMs)],
    ['Review retries', metrics.reviewRetries ?? 0],
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
  const typeRows = metricsTable(
    byType,
    'Type',
    (t) =>
      html`<span class="type-tag" style=${`--type-color: var(--${cssIdent(t.type)})`}>${t.type}</span>`,
  );

  const byOwner = metrics.byOwner || [];
  const ownerRows = metricsTable(byOwner, 'Owner', (o) =>
    o.owner === 'unassigned' ? html`<span class="muted">Unassigned</span>` : o.owner,
  );

  return html`
    <div class="metrics-cards">${cards}</div>
    <div class="metrics-grid">
      <section class="metrics-panel">
        <h3 class="metrics-h">Throughput (closed per day)</h3>
        ${throughputSvg(metrics.throughput || [])}
      </section>
      <section class="metrics-panel">
        <h3 class="metrics-h">Avg time in status (lead time per stage)</h3>
        <div>${leadBars}</div>
      </section>
      <section class="metrics-panel">
        <h3 class="metrics-h">Aging — in progress</h3>
        ${wipChips.length ? html`<div class="detail-meta">${wipChips}</div>` : nothing}
        ${agingRows}
      </section>
      <section class="metrics-panel">
        <h3 class="metrics-h">By type</h3>
        ${typeRows}
        <h3 class="metrics-h">By owner</h3>
        ${ownerRows}
      </section>
    </div>`;
}
