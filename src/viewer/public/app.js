const MARK = { done: '✓', todo: '○', blocked: '✕' };

let repo = null;
let lastJson = '';
const filters = { text: '', type: 'all', statuses: new Set() };
let currentView = 'board';
let sortKey = 'id';
let sortDir = 1;

const $ = (sel) => document.querySelector(sel);

if (typeof mermaid !== 'undefined') {
  mermaid.initialize({ startOnLoad: false, theme: 'dark' });
}

// Replace ```mermaid code blocks (rendered by marked as <pre><code>) with live
// diagrams. Uses textContent so escaped chars (-->, etc.) are decoded first.
function renderMermaid(root) {
  if (typeof mermaid === 'undefined') return;
  const blocks = root.querySelectorAll('pre > code.language-mermaid');
  blocks.forEach((code) => {
    const div = document.createElement('div');
    div.className = 'mermaid';
    div.textContent = code.textContent;
    code.parentElement.replaceWith(div);
  });
  const nodes = root.querySelectorAll('.mermaid');
  if (nodes.length) mermaid.run({ nodes });
}

async function load() {
  try {
    const res = await fetch('/api/repo');
    const text = await res.text();
    if (text === lastJson) return;
    lastJson = text;
    repo = JSON.parse(text);
    hydrateFilters();
    render();
  } catch (e) {
    $('#board').innerHTML = `<p style="color:var(--bug);padding:20px">${e.message}</p>`;
  }
}

function hydrateFilters() {
  if ($('#type-filter').dataset.ready) return;
  $('#type-filter').dataset.ready = '1';
  $('#type-filter').innerHTML =
    '<option value="all">All types</option>' +
    repo.types.map((t) => `<option value="${t}">${t}</option>`).join('');
  $('#lang').textContent = repo.language;

  const sf = $('#status-filter');
  sf.innerHTML = repo.statuses
    .map((s) => `<button class="chip" data-status="${s}">${s}</button>`)
    .join('');
  sf.querySelectorAll('.chip').forEach((el) => {
    el.onclick = () => {
      const s = el.dataset.status;
      filters.statuses.has(s) ? filters.statuses.delete(s) : filters.statuses.add(s);
      el.classList.toggle('active', filters.statuses.has(s));
      render();
    };
  });
}

// Full-text haystack: id, title, type, stage headings/bodies and task text.
function haystack(c) {
  const stages = c.stages.map((s) => `${s.heading} ${s.body}`).join(' ');
  const tasks = c.tasks
    .map((t) => `${t.text} ${(t.criteria || []).join(' ')} ${t.reason || ''}`)
    .join(' ');
  return `${c.id} ${c.title} ${c.type} ${c.status} ${stages} ${tasks}`.toLowerCase();
}

function visibleChanges() {
  const q = filters.text.toLowerCase();
  return repo.changes.filter((c) => {
    if (filters.type !== 'all' && c.type !== filters.type) return false;
    if (filters.statuses.size && !filters.statuses.has(c.status)) return false;
    if (!q) return true;
    return haystack(c).includes(q);
  });
}

function render() {
  if (currentView === 'graph') renderGraph();
  else if (currentView === 'table') renderTable();
  else if (currentView === 'specs') renderSpecs();
  else renderBoard();
}

function renderBoard() {
  const changes = visibleChanges();
  const board = $('#board');
  board.innerHTML = repo.statuses
    .map((status) => {
      const items = changes.filter((c) => c.status === status);
      return `
        <div class="column">
          <div class="column-head"><span>${status}</span><span class="count">${items.length}</span></div>
          <div class="column-body">${items.map(card).join('')}</div>
        </div>`;
    })
    .join('');
  board.querySelectorAll('.card').forEach((el) => {
    el.onclick = () => openDetail(el.dataset.id);
  });
}

function card(c) {
  const pct = c.progress.total ? Math.round((c.progress.done / c.progress.total) * 100) : 0;
  const blocked = c.progress.blocked
    ? `<span class="flag-blocked">● ${c.progress.blocked} blocked</span>`
    : '';
  return `
    <div class="card" data-id="${c.id}" style="--type-color: var(--${c.type})">
      <div class="card-top">
        <span class="card-id">#${c.id}</span>
        <span class="type-tag">${c.type}</span>
      </div>
      <div class="card-title">${esc(c.title)}</div>
      ${c.progress.total ? `<div class="progress"><i style="width:${pct}%"></i></div>` : ''}
      <div class="card-meta">
        ${c.progress.total ? `<span>${c.progress.done}/${c.progress.total} tasks</span>` : ''}
        ${blocked}
      </div>
    </div>`;
}

function openDetail(id) {
  const c = repo.changes.find((x) => String(x.id) === String(id));
  if (!c) return;
  const deps = (c.depends_on || [])
    .map((d) => `<span class="pill" data-dep="${d}" style="cursor:pointer">depends on #${d}</span>`)
    .join('');
  const pipeline = c.stages
    .map((s) => `<span class="stage-chip" data-go="stage-${s.key}">${s.heading}</span>`)
    .join('');
  const stages = c.stages.map((s) => stageBlock(c, s)).join('');

  $('#detail').innerHTML = `
    <span class="close">×</span>
    <h1>${esc(c.title)}</h1>
    <div class="detail-meta">
      <span class="pill">#${c.id}</span>
      <span class="pill" style="color:var(--${c.type})">${c.type}</span>
      <span class="pill">${c.status}</span>
      <span class="pill">${c.created || ''}</span>
      ${deps}
    </div>
    <div class="pipeline">${pipeline}</div>
    ${stages}`;

  const overlay = $('#overlay');
  overlay.classList.remove('hidden');
  $('.close').onclick = closeDetail;
  overlay.onclick = (e) => {
    if (e.target === overlay) closeDetail();
  };
  $('#detail')
    .querySelectorAll('[data-go]')
    .forEach((el) => {
      el.onclick = () =>
        $(`#${el.dataset.go}`).scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  $('#detail')
    .querySelectorAll('[data-dep]')
    .forEach((el) => {
      el.onclick = () => openDetail(el.dataset.dep);
    });
  renderMermaid($('#detail'));
}

function stageBlock(c, s) {
  const content =
    s.key === 'plan' && c.tasks.length ? taskList(c.tasks) : marked.parse(s.body || '');
  return `
    <div class="stage" id="stage-${s.key}">
      <h2>${s.heading}</h2>
      <div class="stage-content">${content}</div>
    </div>`;
}

function taskList(tasks) {
  return (
    '<ul class="tasks">' +
    tasks
      .map((t) => {
        const cr = (t.criteria || []).map((x) => `<span class="cr">${x}</span>`).join(' ');
        const when = t.resolvedAt ? `<span class="when">${t.resolvedAt}</span>` : '';
        const reason = t.reason ? `<span class="reason">— ${esc(t.reason)}</span>` : '';
        return `<li class="task ${t.state}">
          <span class="mark">${MARK[t.state]}</span>
          <span class="text">${esc(t.text)} ${cr} ${reason}</span>
          ${when}
        </li>`;
      })
      .join('') +
    '</ul>'
  );
}

function closeDetail() {
  $('#overlay').classList.add('hidden');
}

/* Dependency graph */
function renderGraph() {
  const changes = repo.changes;
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

  const COL = 230,
    ROW = 78,
    W = 180,
    H = 52;
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
      const x1 = e.from.x + W,
        y1 = e.from.y + H / 2,
        x2 = e.to.x,
        y2 = e.to.y + H / 2;
      const mx = (x1 + x2) / 2;
      return `<path class="edge" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" />`;
    })
    .join('');

  const nodes = changes
    .map((c) => {
      const p = pos.get(String(c.id));
      return `<g class="node" data-id="${c.id}" transform="translate(${p.x},${p.y})">
        <rect width="${W}" height="${H}" stroke="var(--${c.type})"></rect>
        <text class="nid" x="10" y="18">#${c.id} · ${c.status}</text>
        <text x="10" y="36">${esc(clip(c.title, 24))}</text>
      </g>`;
    })
    .join('');

  $('#graph').innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" height="${height}">
      <defs>
        <marker id="arrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
          <path d="M0,0 L7,3 L0,6 Z" fill="var(--muted)"></path>
        </marker>
      </defs>
      ${edges}${nodes}
    </svg>`;
  $('#graph')
    .querySelectorAll('.node')
    .forEach((el) => {
      el.onclick = () => openDetail(el.dataset.id);
    });
}

/* Table view */
function renderTable() {
  const cols = [
    { key: 'id', label: 'ID' },
    { key: 'title', label: 'Title' },
    { key: 'type', label: 'Type' },
    { key: 'status', label: 'Status' },
    { key: 'progress', label: 'Progress' },
    { key: 'deps', label: 'Deps' },
  ];
  const rows = visibleChanges()
    .slice()
    .sort((a, b) => {
      const va = sortVal(a, sortKey),
        vb = sortVal(b, sortKey);
      return va < vb ? -sortDir : va > vb ? sortDir : 0;
    });

  $('#table').innerHTML = `
    <table class="grid">
      <thead><tr>${cols
        .map(
          (c) =>
            `<th data-sort="${c.key}">${c.label}${sortKey === c.key ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`,
        )
        .join('')}</tr></thead>
      <tbody>${rows.map(tableRow).join('')}</tbody>
    </table>`;

  $('#table')
    .querySelectorAll('th[data-sort]')
    .forEach((el) => {
      el.onclick = () => {
        const k = el.dataset.sort;
        if (sortKey === k) sortDir = -sortDir;
        else {
          sortKey = k;
          sortDir = 1;
        }
        renderTable();
      };
    });
  $('#table')
    .querySelectorAll('tr[data-id]')
    .forEach((el) => {
      el.onclick = () => openDetail(el.dataset.id);
    });
}

function sortVal(c, key) {
  if (key === 'progress') return c.progress.total ? c.progress.done / c.progress.total : -1;
  if (key === 'deps') return (c.depends_on || []).length;
  if (key === 'id') return String(c.id);
  return String(c[key] ?? '');
}

function tableRow(c) {
  const pct = c.progress.total ? Math.round((c.progress.done / c.progress.total) * 100) : 0;
  const prog = c.progress.total
    ? `${c.progress.done}/${c.progress.total}${c.progress.blocked ? ` · ${c.progress.blocked}!` : ''} (${pct}%)`
    : '—';
  return `<tr data-id="${c.id}">
    <td class="mono">#${c.id}</td>
    <td>${esc(c.title)}</td>
    <td><span class="type-tag" style="--type-color: var(--${c.type})">${c.type}</span></td>
    <td>${c.status}</td>
    <td class="mono">${prog}</td>
    <td class="mono">${(c.depends_on || []).join(', ') || '—'}</td>
  </tr>`;
}

/* Specs view */
function renderSpecs() {
  const q = filters.text.toLowerCase();
  const specs = (repo.specs || []).filter(
    (s) => !q || `${s.title} ${(s.tags || []).join(' ')} ${s.body}`.toLowerCase().includes(q),
  );
  $('#specs').innerHTML = specs.length
    ? specs
        .map(
          (s, i) => `<div class="spec-card" data-i="${i}">
            <div class="spec-title">${esc(s.title)}</div>
            <div class="card-meta"><span>${s.updated || ''}</span>${(s.tags || [])
              .map((t) => `<span class="pill">${esc(t)}</span>`)
              .join('')}</div>
          </div>`,
        )
        .join('')
    : `<p class="empty">No specs yet. Truth graduates here as changes complete.</p>`;
  $('#specs')
    .querySelectorAll('.spec-card')
    .forEach((el) => {
      el.onclick = () => openSpec(specs[Number(el.dataset.i)]);
    });
}

function openSpec(s) {
  $('#detail').innerHTML = `
    <span class="close">×</span>
    <h1>${esc(s.title)}</h1>
    <div class="detail-meta">
      <span class="pill">spec</span>
      <span class="pill">${s.updated || ''}</span>
      ${(s.tags || []).map((t) => `<span class="pill">${esc(t)}</span>`).join('')}
    </div>
    <div class="stage-content">${marked.parse(s.body || '')}</div>`;
  const overlay = $('#overlay');
  overlay.classList.remove('hidden');
  $('.close').onclick = closeDetail;
  overlay.onclick = (e) => {
    if (e.target === overlay) closeDetail();
  };
  renderMermaid($('#detail'));
}

function setView(v) {
  currentView = v;
  for (const name of ['board', 'table', 'graph', 'specs']) {
    $(`#view-${name}`).classList.toggle('active', v === name);
    $(`#${name}`).classList.toggle('hidden', v !== name);
  }
  render();
}

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

$('#search').oninput = (e) => {
  filters.text = e.target.value;
  render();
};
$('#type-filter').onchange = (e) => {
  filters.type = e.target.value;
  render();
};
$('#view-board').onclick = () => setView('board');
$('#view-table').onclick = () => setView('table');
$('#view-graph').onclick = () => setView('graph');
$('#view-specs').onclick = () => setView('specs');
document.onkeydown = (e) => {
  if (e.key === 'Escape') closeDetail();
};

load();
setInterval(load, 5000);
