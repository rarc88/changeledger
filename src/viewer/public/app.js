const MARK = { done: '✓', todo: '○', blocked: '✕' };

let repo = null;
let lastJson = '';
const filters = {
  text: '',
  type: 'all',
  owner: 'all',
  statuses: new Set(),
  showArchived: false,
  showDiscarded: false,
};
let currentView = 'board';
let sortKey = 'id';
let sortDir = 1;
let currentProject = null;
let projectsList = [];
let globalMode = false;

const $ = (sel) => document.querySelector(sel);

if (typeof mermaid !== 'undefined') {
  // securityLevel 'strict' is explicit: change/spec bodies are untrusted input,
  // so diagram text must not run scripts or click handlers.
  mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' });
}

// Renders untrusted Markdown to sanitized HTML. Marked does not strip active
// HTML (event handlers, javascript: URLs, <script>), so every body that reaches
// innerHTML passes through DOMPurify first. Repo documents are untrusted even
// locally — opening the viewer must not let a document run code in its origin.
function safeHtml(markdown) {
  const html = marked.parse(markdown || '');
  return typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(html) : html;
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

async function loadProjects() {
  const { projects, current } = await fetch('/api/projects').then((r) => r.json());
  projectsList = projects;
  const sel = $('#project');
  sel.innerHTML = projects
    .map(
      (p) =>
        `<option value="${esc(p.id)}" ${p.alive ? '' : 'disabled'}>${esc(p.name)}${p.alive ? '' : ' (missing)'}</option>`,
    )
    .join('');
  currentProject = current ?? projects.find((p) => p.alive)?.id ?? null;
  if (currentProject) sel.value = currentProject;
  sel.style.display = projects.length > 1 ? '' : 'none';
  await load();
}

async function load() {
  if (!currentProject) {
    $('#board').innerHTML =
      '<p class="empty" style="padding:20px">No projects registered. Run `sl init` in a repo.</p>';
    return;
  }
  try {
    const res = await fetch(`/api/repo?project=${encodeURIComponent(currentProject)}`);
    const text = await res.text();
    if (text === lastJson) return;
    lastJson = text;
    repo = JSON.parse(text);
    hydrateFilters();
    render();
  } catch (e) {
    $('#board').innerHTML = `<p style="color:var(--bug);padding:20px">${esc(e.message)}</p>`;
  }
}

// Rebuilt on each project load (types/statuses can differ per project).
function hydrateFilters() {
  $('#type-filter').innerHTML =
    '<option value="all">All types</option>' +
    repo.types.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  $('#type-filter').value = filters.type;
  $('#lang').textContent = repo.language;

  const owners = [...new Set(repo.changes.map((c) => c.owner).filter(Boolean))].sort();
  $('#owner-filter').innerHTML =
    '<option value="all">All owners</option>' +
    owners.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
  if (filters.owner !== 'all' && !owners.includes(filters.owner)) filters.owner = 'all';
  $('#owner-filter').value = filters.owner;
  $('#owner-filter').style.display = owners.length ? '' : 'none';

  const sf = $('#status-filter');
  sf.innerHTML = boardStatuses(repo.statuses)
    .map(
      (s) =>
        `<button type="button" class="chip ${filters.statuses.has(s) ? 'active' : ''}" data-status="${esc(s)}">${esc(s)}</button>`,
    )
    .join('');
  for (const el of sf.querySelectorAll('.chip')) {
    el.onclick = () => {
      const s = el.dataset.status;
      if (filters.statuses.has(s)) filters.statuses.delete(s);
      else filters.statuses.add(s);
      el.classList.toggle('active', filters.statuses.has(s));
      render();
    };
  }
}

// Full-text haystack: id, title, type, stage headings/bodies and task text.
function haystack(c) {
  const stages = c.stages.map((s) => `${s.heading} ${s.body}`).join(' ');
  const tasks = c.tasks
    .map((t) => `${t.text} ${(t.criteria || []).join(' ')} ${t.reason || ''}`)
    .join(' ');
  return `${c.id} ${c.title} ${c.type} ${c.status} ${c.owner || ''} ${stages} ${tasks}`.toLowerCase();
}

// Tombstone visibility: archived and discarded changes are hidden by default and
// each revealed by its own toggle. Shared by every view (board/table via
// isVisible, and the graph) so no view can diverge on the rule.
export const passesTombstones = (c, f) =>
  (f.showArchived || !c.archived) && (f.showDiscarded || c.status !== 'discarded');

// Whether a change is shown under the current filters. Exported as a pure
// predicate so the rule is testable.
export function isVisible(c, f) {
  if (!passesTombstones(c, f)) return false;
  if (f.type !== 'all' && c.type !== f.type) return false;
  if (f.owner !== 'all' && c.owner !== f.owner) return false;
  if (f.statuses.size && !f.statuses.has(c.status)) return false;
  const q = f.text.toLowerCase();
  if (!q) return true;
  return haystack(c).includes(q);
}

// Statuses that get a board column. `discarded` is terminal and off-board — it
// never shows as a lane even when its changes are revealed by the toggle.
export const boardStatuses = (statuses) => statuses.filter((s) => s !== 'discarded');

function visibleChanges() {
  return repo.changes.filter((c) => isVisible(c, filters));
}

function render() {
  if (currentView === 'graph') renderGraph();
  else if (currentView === 'table') renderTable();
  else if (currentView === 'specs') renderSpecs();
  else if (currentView === 'metrics') renderMetrics();
  else renderBoard();
}

function renderBoard() {
  const changes = visibleChanges();
  const board = $('#board');
  board.innerHTML = boardStatuses(repo.statuses)
    .map((status) => {
      const items = changes.filter((c) => c.status === status);
      return `
        <div class="column" data-status="${esc(status)}">
          <div class="column-head"><span>${esc(status)}</span><span class="count">${items.length}</span></div>
          <div class="column-body">${items.map(card).join('')}</div>
        </div>`;
    })
    .join('');
  // The only human-driven lifecycle move is approval: draft → approved. So only
  // draft cards are draggable, and only the approved column is a drop target.
  board.querySelectorAll('.card').forEach((el) => {
    el.onclick = () => openDetail(el.dataset.id);
    const c = repo.changes.find((x) => String(x.id) === String(el.dataset.id));
    if (c && c.status === 'draft') {
      el.setAttribute('draggable', 'true');
      el.ondragstart = (e) => {
        e.dataTransfer.setData('text/plain', el.dataset.id);
        e.dataTransfer.effectAllowed = 'move';
      };
    }
  });
  const approvedCol = board.querySelector('.column[data-status="approved"]');
  if (approvedCol) {
    approvedCol.ondragover = (e) => {
      e.preventDefault();
      approvedCol.classList.add('drop-target');
    };
    approvedCol.ondragleave = () => approvedCol.classList.remove('drop-target');
    approvedCol.ondrop = (e) => {
      e.preventDefault();
      approvedCol.classList.remove('drop-target');
      const id = e.dataTransfer.getData('text/plain');
      const c = repo.changes.find((x) => String(x.id) === String(id));
      if (c && c.status === 'draft') moveStatus(id, 'approved');
    };
  }
}

// Persist the human approval move (draft → approved), then refresh the board.
async function moveStatus(id, status) {
  try {
    const res = await fetch('/api/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sl-token': window.__SL_TOKEN__ },
      body: JSON.stringify({ project: currentProject, id, status }),
    });
    const out = await res.json();
    if (!res.ok) {
      alert(out.error || 'status change failed');
      return;
    }
  } catch (e) {
    alert(e.message);
    return;
  }
  lastJson = '';
  load();
}

export function card(c) {
  const pct = c.progress.total ? Math.round((c.progress.done / c.progress.total) * 100) : 0;
  const blocked = c.progress.blocked
    ? `<span class="flag-blocked">● ${c.progress.blocked} blocked</span>`
    : '';
  return `
    <div class="card ${c.archived ? 'archived' : ''}" data-id="${esc(c.id)}" style="--type-color: var(--${cssIdent(c.type)})">
      <div class="card-top">
        <span class="card-id">#${esc(c.id)}</span>
        <span class="type-tag">${esc(c.type)}</span>
      </div>
      <div class="card-title">${esc(c.title)}</div>
      ${c.progress.total ? `<div class="progress"><i style="width:${pct}%"></i></div>` : ''}
      <div class="card-meta">
        ${c.progress.total ? `<span>${c.progress.done}/${c.progress.total} tasks</span>` : ''}
        ${c.owner ? `<span class="owner">@${esc(c.owner)}</span>` : ''}
        ${blocked}
      </div>
    </div>`;
}

function openDetail(id) {
  const c = repo.changes.find((x) => String(x.id) === String(id));
  if (!c) return;
  const deps = (c.depends_on || [])
    .map((d) => {
      const ext = String(d).includes(':');
      const attr = ext ? `data-extdep="${esc(d)}"` : `data-dep="${esc(d)}"`;
      const label = ext ? `depends on ${esc(d)}` : `depends on #${esc(d)}`;
      return `<span class="pill ${ext ? 'ext' : ''}" ${attr} style="cursor:pointer">${label}</span>`;
    })
    .join('');
  const pipeline = c.stages
    .map((s) => `<span class="stage-chip" data-go="stage-${esc(s.key)}">${esc(s.heading)}</span>`)
    .join('');
  const stages = c.stages.map((s) => stageBlock(c, s)).join('');

  $('#detail').innerHTML = `
    <span class="close">×</span>
    <h1>${esc(c.title)}</h1>
    <div class="detail-meta">
      <span class="pill">#${esc(c.id)}</span>
      <span class="pill" style="color:var(--${cssIdent(c.type)})">${esc(c.type)}</span>
      <span class="pill">${esc(c.status)}</span>
      ${c.owner ? `<span class="pill owner">@${esc(c.owner)}</span>` : ''}
      <span class="pill" title="${esc(c.created || '')}">${esc(fmtDateTime(c.created))}</span>
      ${deps}
    </div>
    <div class="pipeline">${pipeline}</div>
    ${stages}
    <div id="git-section"></div>`;

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
  $('#detail')
    .querySelectorAll('[data-extdep]')
    .forEach((el) => {
      el.onclick = () => {
        const [proj, changeId] = el.dataset.extdep.split(':');
        gotoChange(proj, changeId);
      };
    });
  renderMermaid($('#detail'));
  loadGitRefs(c.id);
}

// Fetch and render the git refs (commits/branches) that reference this change.
async function loadGitRefs(id) {
  let refs;
  try {
    refs = await fetch(
      `/api/git?project=${encodeURIComponent(currentProject)}&id=${encodeURIComponent(id)}`,
    ).then((r) => r.json());
  } catch {
    return;
  }
  const sec = $('#git-section');
  if (!sec) return;
  if (!refs.commits.length && !refs.branches.length) {
    sec.innerHTML = '';
    return;
  }
  const commits = refs.commits
    .map(
      (c) =>
        `<li><span class="mono">${esc(c.sha.slice(0, 8))}</span> ${esc(c.subject)} <span class="when" title="${esc(c.date || '')}">${esc(fmtDate(c.date))}</span></li>`,
    )
    .join('');
  const branches = refs.branches.map((b) => `<span class="pill">${esc(b)}</span>`).join('');
  sec.innerHTML = `
    <div class="stage">
      <h2>Git</h2>
      <div class="stage-content">
        ${branches ? `<div class="detail-meta">${branches}</div>` : ''}
        ${refs.commits.length ? `<ul class="git-commits">${commits}</ul>` : ''}
      </div>
    </div>`;
}

export function stageBlock(c, s) {
  const content = s.key === 'plan' && c.tasks.length ? taskList(c.tasks) : safeHtml(s.body);
  return `
    <div class="stage" id="stage-${esc(s.key)}">
      <h2>${esc(s.heading)}</h2>
      <div class="stage-content">${content}</div>
    </div>`;
}

export function taskList(tasks) {
  return (
    '<ul class="tasks">' +
    tasks
      .map((t) => {
        const cr = (t.criteria || []).map((x) => `<span class="cr">${esc(x)}</span>`).join(' ');
        const when = t.resolvedAt ? `<span class="when">${esc(t.resolvedAt)}</span>` : '';
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

// Cross-project navigation: resolve `proj` (by id or name) in the loaded project
// list, switch to it, then open the target change once its repo has loaded.
async function gotoChange(proj, changeId) {
  const match = projectsList.find((p) => p.id === proj || p.name === proj);
  if (!match?.alive) {
    alert(`Project "${proj}" is not registered or its path is gone.`);
    return;
  }
  if (match.id !== currentProject) {
    currentProject = match.id;
    $('#project').value = match.id;
    lastJson = '';
    filters.type = 'all';
    filters.owner = 'all';
    filters.statuses.clear();
    await load();
  }
  openDetail(changeId);
}

/* Dependency graph */
function renderGraph() {
  const changes = repo.changes.filter((c) => passesTombstones(c, filters));
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
      return `<g class="node" data-id="${esc(c.id)}" transform="translate(${p.x},${p.y})">
        <rect width="${W}" height="${H}" stroke="var(--${cssIdent(c.type)})"></rect>
        <text class="nid" x="10" y="18">#${esc(c.id)} · ${esc(c.status)}</text>
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

export function tableRow(c) {
  const pct = c.progress.total ? Math.round((c.progress.done / c.progress.total) * 100) : 0;
  const prog = c.progress.total
    ? `${c.progress.done}/${c.progress.total}${c.progress.blocked ? ` · ${c.progress.blocked}!` : ''} (${pct}%)`
    : '—';
  return `<tr data-id="${esc(c.id)}">
    <td class="mono">#${esc(c.id)}</td>
    <td>${esc(c.title)}</td>
    <td><span class="type-tag" style="--type-color: var(--${cssIdent(c.type)})">${esc(c.type)}</span></td>
    <td>${esc(c.status)}</td>
    <td class="mono">${prog}</td>
    <td class="mono">${(c.depends_on || []).map(esc).join(', ') || '—'}</td>
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
            <div class="card-meta"><span title="${esc(s.updated || '')}">${esc(fmtDateTime(s.updated))}</span>${(
              s.tags || []
            )
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
      <span class="pill" title="${esc(s.updated || '')}">${esc(fmtDateTime(s.updated))}</span>
      ${(s.tags || []).map((t) => `<span class="pill">${esc(t)}</span>`).join('')}
    </div>
    <div class="stage-content">${safeHtml(s.body)}</div>`;
  const overlay = $('#overlay');
  overlay.classList.remove('hidden');
  $('.close').onclick = closeDetail;
  overlay.onclick = (e) => {
    if (e.target === overlay) closeDetail();
  };
  renderMermaid($('#detail'));
}

const VIEWS = ['board', 'table', 'graph', 'specs', 'metrics'];

/* Metrics view */
function fmtDuration(ms) {
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

function renderMetrics() {
  const m = repo.metrics || {};
  const wip = m.wip || {};
  const wipTotal = Object.values(wip).reduce((a, b) => a + b, 0);
  const cards = [
    ['Closed', m.count ?? 0],
    ['Avg cycle', fmtDuration(m.avgCycleMs)],
    ['Median cycle', fmtDuration(m.medianCycleMs)],
    ['WIP', wipTotal],
    ['Blocked time', fmtDuration(m.blockedMs)],
  ]
    .map(
      ([label, val]) =>
        `<div class="metric-card"><div class="metric-val">${val}</div><div class="metric-label">${esc(label)}</div></div>`,
    )
    .join('');

  const wipChips = Object.entries(wip)
    .map(([s, n]) => `<span class="pill">${esc(s)}: ${n}</span>`)
    .join('');

  const lead = (m.timeInStatus || []).filter((t) => t.avgMs > 0);
  const leadBars = lead.length
    ? barRows(
        lead,
        (t) => esc(t.state),
        (t) => t.avgMs,
        fmtDuration,
      )
    : '<p class="empty">No data yet.</p>';

  const tp = m.throughput || [];
  const tpBars = tp.length
    ? barRows(
        tp,
        (t) => `<span class="mono">${esc(t.date)}</span>`,
        (t) => t.count,
      )
    : '<p class="empty">No closed changes yet.</p>';

  const aging = m.aging || [];
  const agingRows = aging.length
    ? `<ul class="git-commits">${aging
        .map(
          (a) =>
            `<li><span class="mono">#${esc(a.id)}</span> <span class="when">${fmtDuration(a.ms)}</span></li>`,
        )
        .join('')}</ul>`
    : '<p class="empty">Nothing in progress.</p>';

  const byType = m.byType || [];
  const typeRows = byType.length
    ? `<table class="grid"><thead><tr><th>Type</th><th>Closed</th><th>Avg cycle</th></tr></thead><tbody>${byType
        .map(
          (t) =>
            `<tr><td><span class="type-tag" style="--type-color: var(--${cssIdent(t.type)})">${esc(t.type)}</span></td><td class="mono">${t.closed}</td><td class="mono">${fmtDuration(t.avgCycleMs)}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : '<p class="empty">No closed changes yet.</p>';

  $('#metrics').innerHTML = `
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

function setView(v) {
  currentView = v;
  if (globalMode) {
    globalMode = false;
    $('#toggle-global').classList.remove('active');
  }
  $('#global').classList.add('hidden');
  for (const name of VIEWS) {
    $(`#view-${name}`).classList.toggle('active', v === name);
    $(`#${name}`).classList.toggle('hidden', v !== name);
  }
  render();
}

// Global search: query every project server-side, render grouped results.
async function renderGlobal() {
  const q = filters.text.trim();
  const el = $('#global');
  if (!q) {
    el.innerHTML = '<p class="empty" style="padding:20px">Type to search across all projects.</p>';
    return;
  }
  let groups;
  try {
    groups = await fetch(`/api/search?q=${encodeURIComponent(q)}`).then((r) => r.json());
  } catch (e) {
    el.innerHTML = `<p style="color:var(--bug);padding:20px">${esc(e.message)}</p>`;
    return;
  }
  if (!groups.length) {
    el.innerHTML = `<p class="empty" style="padding:20px">No matches for “${esc(q)}”.</p>`;
    return;
  }
  el.innerHTML = groups
    .map(
      (g) => `
      <div class="search-group">
        <h3>${esc(g.project.name)} <span class="count">${g.matches.length}</span></h3>
        ${g.matches
          .map(
            (m) => `<div class="search-hit" data-proj="${esc(g.project.id)}" data-id="${esc(m.id)}">
              <span class="card-id">#${esc(m.id)}</span>
              <span class="type-tag" style="--type-color: var(--${cssIdent(m.type)})">${esc(m.type)}</span>
              <span>${esc(m.title)}</span>
              <span class="pill">${esc(m.status)}</span>
            </div>`,
          )
          .join('')}
      </div>`,
    )
    .join('');
  el.querySelectorAll('.search-hit').forEach((hit) => {
    hit.onclick = () => gotoChange(hit.dataset.proj, hit.dataset.id);
  });
}

function enterGlobal() {
  for (const name of VIEWS) $(`#${name}`).classList.add('hidden');
  $('#global').classList.remove('hidden');
  renderGlobal();
}

// Escapes a value for HTML text and double-quoted attribute contexts. Every
// untrusted document/config field (id, type, status, stage heading, timestamps,
// dependency ids…) passes through this before reaching innerHTML — sanitizing
// the Markdown body is not enough on its own.
export const esc = (s) =>
  String(s ?? '').replace(
    /['&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
// A value interpolated into a CSS custom-property name (`var(--TYPE)`) must be a
// bare identifier; anything else is dropped to a neutral, defined fallback so a
// crafted `type` cannot break out of the declaration or inject extra rules.
export const cssIdent = (s) => (/^[A-Za-z][\w-]*$/.test(String(s ?? '')) ? String(s) : 'muted');
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// Render an ISO UTC timestamp in the viewer's local format. The stored value
// stays ISO UTC (source of truth); only the display is localized. Empty/invalid
// input renders as ''.
const fmtDateTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
};
const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
};

// Wire the DOM and start polling. Guarded below so importing this module (tests)
// has no side effects; only a real browser page bootstraps.
function bootstrap() {
  $('#search').oninput = (e) => {
    filters.text = e.target.value;
    if (globalMode) renderGlobal();
    else render();
  };
  $('#toggle-global').onclick = (e) => {
    globalMode = !globalMode;
    e.target.classList.toggle('active', globalMode);
    if (globalMode) enterGlobal();
    else setView(currentView);
  };
  $('#type-filter').onchange = (e) => {
    filters.type = e.target.value;
    render();
  };
  $('#owner-filter').onchange = (e) => {
    filters.owner = e.target.value;
    render();
  };
  $('#toggle-archived').onclick = (e) => {
    filters.showArchived = !filters.showArchived;
    e.target.classList.toggle('active', filters.showArchived);
    render();
  };
  $('#toggle-discarded').onclick = (e) => {
    filters.showDiscarded = !filters.showDiscarded;
    e.target.classList.toggle('active', filters.showDiscarded);
    render();
  };
  $('#view-board').onclick = () => setView('board');
  $('#view-table').onclick = () => setView('table');
  $('#view-graph').onclick = () => setView('graph');
  $('#view-specs').onclick = () => setView('specs');
  $('#view-metrics').onclick = () => setView('metrics');
  $('#project').onchange = (e) => {
    currentProject = e.target.value;
    lastJson = '';
    filters.type = 'all';
    filters.owner = 'all';
    filters.statuses.clear();
    load();
  };
  document.onkeydown = (e) => {
    if (e.key === 'Escape') closeDetail();
  };

  loadProjects();
  setInterval(load, 5000);
}

// Only a real browser page with the app shell bootstraps; importing the module
// (for tests) must not touch the DOM or start polling.
if (typeof document !== 'undefined' && document.getElementById('search')) {
  bootstrap();
}
