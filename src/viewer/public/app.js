import { getGitRefs, getProjects, getRepo, postStatus, searchAllProjects } from './api.js';
import { cssIdent, esc, initMermaid, renderMermaid, safeHtml } from './security.js';
import { boardStatuses, isVisible, passesTombstones } from './state.js';
import { card, stageBlock, tableRow } from './view-parts.js';
import { graphSvg, metricsHtml, specsListHtml } from './view-renderers.js';

export { cssIdent, esc, safeHtml } from './security.js';
export { boardStatuses, isVisible, passesTombstones } from './state.js';
export { card, stageBlock, tableRow, taskList } from './view-parts.js';

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

initMermaid();

async function loadProjects() {
  const { projects, current } = await getProjects();
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
    const text = await getRepo(currentProject);
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
    const res = await postStatus(currentProject, id, status);
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
    refs = await getGitRefs(currentProject, id);
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
  $('#graph').innerHTML = graphSvg(changes);
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

/* Specs view */
function renderSpecs() {
  const q = filters.text.toLowerCase();
  const specs = (repo.specs || []).filter(
    (s) => !q || `${s.title} ${(s.tags || []).join(' ')} ${s.body}`.toLowerCase().includes(q),
  );
  $('#specs').innerHTML = specsListHtml(specs, fmtDateTime);
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

function renderMetrics() {
  $('#metrics').innerHTML = metricsHtml(repo.metrics || {});
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
    groups = await searchAllProjects(q);
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
