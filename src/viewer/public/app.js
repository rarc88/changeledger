import {
  getConfigMigrationPreview,
  getGitRefs,
  getProjectConfigStructured,
  getProjects,
  getRepo,
  patchProjectConfigApi,
  postConfigMigrationApply,
  postProjectConfig,
  postProjectPath,
  postProjectRemove,
  postStatus,
  searchAllProjects,
} from './api.js';
import {
  clearStatusFilters,
  initializeProjects,
  invalidateCache,
  normalizeRepoState,
  restoreViewerState,
  selectProject,
  setOwnerFilter,
  setRepo,
  setSortKey,
  setTextFilter,
  setTypeFilter,
  setView,
  state,
  toggleGlobalMode,
  toggleShowArchived,
  toggleShowDiscarded,
  toggleStatusFilter,
} from './app-state.js';
import { cssIdent, initMermaid, makeMermaidExpandable, renderMermaid } from './security.js';
import { boardStatuses, isVisible, passesTombstones } from './state.js';
import { html, render as litRender, nothing } from './templates.js';
import {
  card,
  closeButton,
  sortIndicator,
  specBody,
  stageBlock,
  statusSummary,
  tableRow,
  validationPanel,
} from './view-parts.js';
import { graphSvg, metricsHtml, specsListHtml } from './view-renderers.js';

export { cssIdent, esc, makeMermaidExpandable, safeHtml } from './security.js';
export { boardStatuses, isVisible, passesTombstones } from './state.js';
export {
  card,
  sortIndicator,
  stageBlock,
  statusSummary,
  statusTag,
  tableRow,
  taskList,
} from './view-parts.js';

const $ = (sel) => document.querySelector(sel);

initMermaid();

async function loadProjects() {
  const { projects, current, localOnly } = await getProjects();
  state.projectsList = projects;
  state.localOnly = localOnly;
  const sel = $('#project');
  litRender(
    projects.map(
      (p) =>
        html`<option value=${p.id} ?disabled=${!p.alive}>${p.name}${p.alive ? '' : ' (missing)'}</option>`,
    ),
    sel,
  );
  initializeProjects(projects, current);
  if (state.currentProject) sel.value = state.currentProject;
  sel.style.display = projects.length > 1 ? '' : 'none';
  await load();
}

async function load() {
  if (!state.currentProject) {
    if (state.currentView === 'projects') {
      syncViewerShell();
      return;
    }
    showNoProjects();
    return;
  }
  try {
    const text = await getRepo(state.currentProject);
    if (text === state.lastJson) return;
    setRepo(text);
    normalizeRepoState(state.repo);
    hydrateFilters();
    syncViewerShell();
  } catch (e) {
    litRender(html`<p style="color:var(--bug);padding:20px">${e.message}</p>`, $('#board'));
  }
}

export function showNoProjects(root = document) {
  setView('board');
  litRender(
    html`<p class="empty" style="padding:20px">No projects registered. Run <code>changeledger init</code> in a repo.</p>`,
    root.querySelector('#board'),
  );
  syncViewerShell(root, false);
}

// Rebuilt on each project load (types/statuses can differ per project).
function hydrateFilters() {
  litRender(
    html`<option value="all">All types</option>
      ${state.repo.types.map((t) => html`<option value=${t}>${t}</option>`)}`,
    $('#type-filter'),
  );
  $('#type-filter').value = state.filters.type;
  $('#lang').textContent = state.repo.language;

  const owners = [...new Set(state.repo.changes.map((c) => c.owner).filter(Boolean))].sort();
  litRender(
    html`<option value="all">All owners</option>
      ${owners.map((o) => html`<option value=${o}>${o}</option>`)}`,
    $('#owner-filter'),
  );
  if (state.filters.owner !== 'all' && !owners.includes(state.filters.owner)) setOwnerFilter('all');
  $('#owner-filter').value = state.filters.owner;
  $('#owner-filter').style.display = owners.length ? '' : 'none';

  renderStatusFilter();
}

function renderStatusFilter() {
  const sf = $('#status-filter');
  litRender(
    html`<details class="filter-menu">
      <summary class="filter-trigger">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3.25h12M4.25 8h7.5M6.5 12.75h3"></path></svg>
        <span data-status-summary>${statusSummary(state.filters.statuses)}</span>
        <svg class="filter-chevron" viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4.5 6.25 3.5 3.5 3.5-3.5"></path>
        </svg>
      </summary>
      <div class="filter-popover">
        <div class="filter-heading"><span>Status</span><button type="button" data-clear-status>Clear</button></div>
        <div class="filter-options">
          ${boardStatuses(state.repo.statuses).map(
            (status) => html`<label class="check-option">
              <input type="checkbox" data-status=${status} .checked=${state.filters.statuses.has(status)} />
              <span class="check-box" aria-hidden="true"></span>
              <span>${status.replaceAll('-', ' ')}</span>
            </label>`,
          )}
        </div>
        <div class="filter-heading visibility-heading"><span>Visibility</span></div>
        <div class="filter-options">
          <label class="check-option">
            <input type="checkbox" data-visibility="archived" .checked=${state.filters.showArchived} />
            <span class="check-box" aria-hidden="true"></span><span>Archived</span>
          </label>
          <label class="check-option">
            <input type="checkbox" data-visibility="discarded" .checked=${state.filters.showDiscarded} />
            <span class="check-box" aria-hidden="true"></span><span>Discarded</span>
          </label>
        </div>
      </div>
    </details>`,
    sf,
  );
  sf.querySelectorAll('[data-status]').forEach((input) => {
    input.onchange = () => {
      toggleStatusFilter(input.dataset.status);
      sf.querySelector('[data-status-summary]').textContent = statusSummary(state.filters.statuses);
      render();
    };
  });
  sf.querySelector('[data-clear-status]').onclick = () => {
    clearStatusFilters();
    sf.querySelectorAll('[data-status], [data-visibility]').forEach((input) => {
      input.checked = false;
    });
    sf.querySelector('[data-status-summary]').textContent = statusSummary(state.filters.statuses);
    render();
  };
  sf.querySelector('[data-visibility="archived"]').onchange = () => {
    toggleShowArchived();
    render();
  };
  sf.querySelector('[data-visibility="discarded"]').onchange = () => {
    toggleShowDiscarded();
    render();
  };
}

function visibleChanges() {
  return state.repo.changes.filter((c) => isVisible(c, state.filters));
}

function render() {
  if (state.currentView === 'graph') renderGraph();
  else if (state.currentView === 'table') renderTable();
  else if (state.currentView === 'specs') renderSpecs();
  else if (state.currentView === 'metrics') renderMetrics();
  else if (state.currentView === 'projects') renderProjects();
  else renderBoard();
}

function renderBoard() {
  const changes = visibleChanges();
  const board = $('#board');
  litRender(
    boardStatuses(state.repo.statuses, state.filters.showDiscarded).map((status) => {
      const items = changes.filter((c) => c.status === status);
      return html`
        <div class="column" data-status=${status}>
          <div class="column-head"><span>${status}</span><span class="count">${items.length}</span></div>
          <div class="column-body">${items.map(card)}</div>
        </div>`;
    }),
    board,
  );
  // Dragging is reserved for initial approval. Final validation uses explicit
  // detail actions because rejection requires a reason.
  board.querySelectorAll('.card').forEach((el) => {
    el.onclick = () => openDetail(el.dataset.id);
    const c = state.repo.changes.find((x) => String(x.id) === String(el.dataset.id));
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
      const c = state.repo.changes.find((x) => String(x.id) === String(id));
      if (c && c.status === 'draft') moveStatus(id, 'approved');
    };
  }
}

// Persist a human-owned lifecycle move, then refresh the board.
async function moveStatus(id, status, reason) {
  try {
    const res = await postStatus(state.currentProject, id, status, reason);
    const out = await res.json();
    if (!res.ok) {
      showToast(out.error || 'status change failed');
      return;
    }
  } catch (e) {
    showToast(e.message);
    return;
  }
  invalidateCache();
  await load();
  return true;
}

export function setValidationPending(root, pending) {
  const panel = root.querySelector('.validation-actions');
  if (!panel) return;
  panel.classList.toggle('is-pending', pending);
  panel.querySelectorAll('button, input').forEach((control) => {
    control.disabled = pending;
  });
}

export function showValidationError(root, message) {
  const error = root.querySelector('.validation-error');
  if (!error) return;
  error.textContent = message;
  error.hidden = !message;
}

export function resetValidationState(root) {
  setValidationPending(root, false);
  showValidationError(root, '');
}

export async function runValidationSubmission({ root, request, onSuccess }) {
  setValidationPending(root, true);
  showValidationError(root, '');
  try {
    const res = await request();
    const out = await res.json();
    if (!res.ok) {
      showValidationError(root, out.error || 'Status change failed.');
      setValidationPending(root, false);
      return false;
    }
  } catch (error) {
    showValidationError(root, error.message);
    setValidationPending(root, false);
    return false;
  }
  resetValidationState(root);
  await onSuccess();
  return true;
}

async function submitValidation(id, status, reason) {
  const root = $('#detail');
  await runValidationSubmission({
    root,
    request: () => postStatus(state.currentProject, id, status, reason),
    onSuccess: async () => {
      closeDetail();
      invalidateCache();
      await load();
    },
  });
}

function openDetail(id) {
  const c = state.repo.changes.find((x) => String(x.id) === String(id));
  if (!c) return;
  const deps = (c.depends_on || []).map((d) => {
    const ext = String(d).includes(':');
    return ext
      ? html`<span class="pill ext" data-extdep=${d} style="cursor:pointer">depends on ${d}</span>`
      : html`<span class="pill" data-dep=${d} style="cursor:pointer">depends on #${d}</span>`;
  });
  const pipeline = c.stages.map(
    (s) => html`<span class="stage-chip" data-go=${`stage-${s.key}`}>${s.heading}</span>`,
  );
  const stages = c.stages.map((s) => stageBlock(c, s));

  litRender(
    html`
    ${closeButton()}
    <h1>${c.title}</h1>
    <div class="detail-meta">
      <span class="pill">#${c.id}</span>
      <span class="pill" style=${`color:var(--${cssIdent(c.type)})`}>${c.type}</span>
      <span class="pill">${c.status}</span>
      ${c.owner ? html`<span class="pill owner">@${c.owner}</span>` : nothing}
      <span class="pill" title=${c.created || ''}>${fmtDateTime(c.created)}</span>
      ${deps}
    </div>
    ${c.status === 'in-validation' ? validationPanel() : nothing}
    <div class="pipeline">${pipeline}</div>
    ${stages}
    <div id="git-section"></div>`,
    $('#detail'),
  );

  resetValidationState($('#detail'));

  const overlay = $('#overlay');
  overlay.classList.remove('hidden');
  $('#detail').querySelector('.close').onclick = closeDetail;
  const accept = $('#detail').querySelector('[data-validation="pass"]');
  if (accept) accept.onclick = () => submitValidation(c.id, 'done');
  const reject = $('#detail').querySelector('[data-validation="fail"]');
  if (reject) {
    reject.onclick = () => {
      const input = $('#detail').querySelector('[data-validation-reason]');
      const reason = input?.value.trim();
      if (!reason) {
        showValidationError($('#detail'), 'A rejection reason is required.');
        input?.focus();
        return;
      }
      submitValidation(c.id, 'in-progress', reason);
    };
  }
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
  renderExpandableMermaid($('#detail'));
  loadGitRefs(c.id);
}

// Fetch and render the git refs (commits/branches) that reference this change.
async function loadGitRefs(id) {
  let refs;
  try {
    refs = await getGitRefs(state.currentProject, id);
  } catch {
    return;
  }
  const sec = $('#git-section');
  if (!sec) return;
  if (!refs.commits.length && !refs.branches.length) {
    litRender(nothing, sec);
    return;
  }
  const commits = refs.commits.map(
    (c) =>
      html`<li>
        <span class="mono">${c.sha.slice(0, 8)}</span> ${c.subject}
        <span class="when" title=${c.date || ''}>${fmtDate(c.date)}</span>
      </li>`,
  );
  const branches = refs.branches.map((b) => html`<span class="pill">${b}</span>`);
  litRender(
    html`
    <div class="stage">
      <h2>Git</h2>
      <div class="stage-content">
        ${branches.length ? html`<div class="detail-meta">${branches}</div>` : nothing}
        ${refs.commits.length ? html`<ul class="git-commits">${commits}</ul>` : nothing}
      </div>
    </div>`,
    sec,
  );
}

function closeDetail() {
  $('#overlay').classList.add('hidden');
}

let diagramLightbox = null;

async function renderExpandableMermaid(root) {
  await renderMermaid(root);
  makeMermaidExpandable(root, (node) => diagramLightbox?.open(node));
}

export function createDiagramLightbox({ overlay, canvas, closeButton }) {
  let origin = null;
  const close = () => {
    if (overlay.classList.contains('hidden')) return false;
    overlay.classList.add('hidden');
    canvas.replaceChildren();
    origin?.focus();
    origin = null;
    return true;
  };
  const controller = {
    open(node) {
      const source = node.querySelector('svg');
      if (!source) return false;
      origin = node;
      canvas.replaceChildren(source.cloneNode(true));
      overlay.classList.remove('hidden');
      closeButton.focus();
      return true;
    },
    close,
    handleBackdrop(event) {
      return event.target === overlay ? close() : false;
    },
    handleKeydown(event) {
      return event.key === 'Escape' ? close() : false;
    },
  };
  closeButton.onclick = close;
  overlay.onclick = controller.handleBackdrop;
  return controller;
}

// Cross-project navigation: resolve `proj` (by id or name) in the loaded project
// list, switch to it, then open the target change once its repo has loaded.
async function gotoChange(proj, changeId) {
  const match = state.projectsList.find((p) => p.id === proj || p.name === proj);
  if (!match?.alive) {
    showToast(`Project "${proj}" is not registered or its path is gone.`);
    return;
  }
  if (match.id !== state.currentProject) {
    selectProject(match.id);
    $('#project').value = match.id;
    await load();
  }
  openDetail(changeId);
}

/* Dependency graph */
function renderGraph() {
  const changes = state.repo.changes.filter((c) => passesTombstones(c, state.filters));
  litRender(graphSvg(changes), $('#graph'));
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
      const va = sortVal(a, state.sortKey),
        vb = sortVal(b, state.sortKey);
      return va < vb ? -state.sortDir : va > vb ? state.sortDir : 0;
    });

  litRender(
    html`
    <table class="grid">
      <thead>
        <tr>
          ${cols.map(
            (c) =>
              html`<th data-sort=${c.key}>
                <span class="column-label">${c.label}</span>
                ${state.sortKey === c.key ? sortIndicator(state.sortDir) : nothing}
              </th>`,
          )}
        </tr>
      </thead>
      <tbody>${rows.map(tableRow)}</tbody>
    </table>`,
    $('#table'),
  );

  $('#table')
    .querySelectorAll('th[data-sort]')
    .forEach((el) => {
      el.onclick = () => {
        setSortKey(el.dataset.sort);
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
  const q = state.filters.text.toLowerCase();
  const specs = (state.repo.specs || []).filter(
    (s) => !q || `${s.title} ${(s.tags || []).join(' ')} ${s.body}`.toLowerCase().includes(q),
  );
  litRender(specsListHtml(specs, fmtDateTime), $('#specs'));
  $('#specs')
    .querySelectorAll('.spec-card')
    .forEach((el) => {
      el.onclick = () => openSpec(specs[Number(el.dataset.i)]);
    });
}

function openSpec(s) {
  litRender(
    html`
    ${closeButton()}
    <h1>${s.title}</h1>
    <div class="detail-meta">
      <span class="pill">spec</span>
      <span class="pill" title=${s.updated || ''}>${fmtDateTime(s.updated)}</span>
      ${(s.tags || []).map((t) => html`<span class="pill">${t}</span>`)}
    </div>
    ${specBody(s.body)}`,
    $('#detail'),
  );
  const overlay = $('#overlay');
  overlay.classList.remove('hidden');
  const detail = $('#detail');
  detail.querySelector('.close').onclick = closeDetail;
  overlay.onclick = (e) => {
    if (e.target === overlay) closeDetail();
  };
  detail.onclick = (e) => handleSpecBodyClick(e, (href) => openSpecByName(href, state, openSpec));
  renderExpandableMermaid(detail);
}

/**
 * Normalizes a spec href and opens the matching spec.
 * Exported for testing: accepts `repoState` and `_openSpec` to avoid DOM coupling.
 */
export function openSpecByName(href, repoState = state, _openSpec = openSpec) {
  const name = href.replace(/^\.\//, '').replace(/\.md$/, '');
  const found = (repoState.repo?.specs ?? []).find((s) => s.name.replace(/\.md$/, '') === name);
  if (found) _openSpec(found);
}

/**
 * Click handler for the spec body container.
 * Exported for testing: accepts `_openSpecByName` callback to avoid DOM coupling.
 * Intercepts relative *.md links only; lets external links through unchanged.
 */
export function handleSpecBodyClick(event, _openSpecByName) {
  const anchor = event.target.closest('a');
  if (!anchor) return;
  const href = anchor.getAttribute('href');
  if (!href) return;
  // Let external links (with scheme or absolute path) through unchanged.
  if (/^[a-z][a-z\d+\-.]*:/i.test(href) || href.startsWith('/')) return;
  // Only intercept relative *.md links.
  if (!href.endsWith('.md')) return;
  event.preventDefault();
  _openSpecByName(href);
}

const VIEWS = ['board', 'table', 'graph', 'specs', 'metrics', 'projects'];

function renderMetrics() {
  litRender(metricsHtml(state.repo.metrics || {}), $('#metrics'));
}

export function syncViewerShell(root = document, renderContent = true) {
  root.querySelector('#search').value = state.filters.text;
  root.querySelector('#toggle-global').classList.toggle('active', state.globalMode);
  for (const name of VIEWS) {
    root.querySelector(`#view-${name}`).classList.toggle('active', name === state.currentView);
    root
      .querySelector(`#${name}`)
      .classList.toggle('hidden', state.globalMode || name !== state.currentView);
  }
  root.querySelector('#global').classList.toggle('hidden', !state.globalMode);
  if (!renderContent) return;
  if (state.globalMode) renderGlobal();
  else render();
}

export function restoreInitialViewerShell(root = document, getStorage = () => window.localStorage) {
  let browserStorage = null;
  try {
    browserStorage = getStorage();
  } catch {
    // Storage access itself may be forbidden (opaque origins/privacy policy).
  }
  restoreViewerState(browserStorage);
  syncViewerShell(root, false);
}

let managedProject = null;
let managedConfig = null;
let configMode = 'form'; // 'form' | 'raw'
let configDirty = false; // true when form/raw has unsaved edits
let migrationPreview = null; // null | { summary, changes, yaml } | { already_current }

const SUPPORTED_SCHEMA_VERSION = 1;
// Confirm dialog — uses native <dialog> for proper focus-trap, ESC and backdrop.
// _confirmImpl is replaceable in tests (JSDOM lacks showModal).
let _confirmImpl = null;
let dialogSequence = 0;

export function showToast(message, { type = 'error', duration = 4000 } = {}) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  el.setAttribute('role', 'alert');
  container.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

export function setConfirmImpl(impl) {
  _confirmImpl = impl;
}

// Prompt dialog — returns the entered string or null (cancel). Mockable via _promptImpl.
let _promptImpl = null;
export function setPromptImpl(impl) {
  _promptImpl = impl;
}

export function showPrompt(message, { placeholder = '' } = {}) {
  if (_promptImpl !== null) return Promise.resolve(_promptImpl(message));
  return new Promise((resolve) => {
    const id = `cl-prompt-${++dialogSequence}`;
    const dialog = document.createElement('dialog');
    dialog.className = 'cl-confirm-dialog';
    dialog.setAttribute('aria-labelledby', `${id}-title`);
    dialog.innerHTML = `
      <p id="${id}-title" class="cl-confirm-message"></p>
      <label for="${id}-input" class="cl-prompt-label">Confirmation value</label>
      <input id="${id}-input" class="cl-prompt-input" type="text" autocomplete="off" />
      <div class="cl-confirm-actions">
        <button type="button" class="button cl-confirm-yes">Confirm</button>
        <button type="button" class="button secondary cl-confirm-no">Cancel</button>
      </div>`;
    dialog.querySelector('.cl-confirm-message').textContent = message;
    const input = dialog.querySelector('.cl-prompt-input');
    if (placeholder) input.placeholder = placeholder;
    document.body.appendChild(dialog);
    const done = (result) => {
      dialog.close();
      dialog.remove();
      resolve(result);
    };
    dialog.querySelector('.cl-confirm-yes').onclick = () => done(input.value);
    dialog.querySelector('.cl-confirm-no').onclick = () => done(null);
    dialog.addEventListener('cancel', () => done(null));
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) done(null);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(input.value);
    });
    dialog.showModal();
    input.focus();
  });
}

export function showConfirm(message) {
  if (_confirmImpl) return Promise.resolve(_confirmImpl(message));
  return new Promise((resolve) => {
    const id = `cl-confirm-${++dialogSequence}`;
    const dialog = document.createElement('dialog');
    dialog.className = 'cl-confirm-dialog';
    dialog.setAttribute('aria-labelledby', `${id}-title`);
    dialog.innerHTML = `
      <p id="${id}-title" class="cl-confirm-message"></p>
      <div class="cl-confirm-actions">
        <button type="button" class="button cl-confirm-yes">Confirm</button>
        <button type="button" class="button secondary cl-confirm-no">Cancel</button>
      </div>`;
    dialog.querySelector('.cl-confirm-message').textContent = message;
    document.body.appendChild(dialog);
    const done = (result) => {
      dialog.close();
      dialog.remove();
      resolve(result);
    };
    dialog.querySelector('.cl-confirm-yes').onclick = () => done(true);
    dialog.querySelector('.cl-confirm-no').onclick = () => done(false);
    dialog.addEventListener('cancel', () => done(false));
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) done(false);
    });
    dialog.showModal();
  });
}

function configSectionTemplate(config, mode, preview) {
  if (!config) return nothing;
  if (config.error) {
    return html`<div class="config-section">
      <p class="project-error" role="alert" aria-live="assertive">${config.error}</p>
    </div>`;
  }

  const schema = config.schemaVersion ?? 0;
  const futureSch = schema > SUPPORTED_SCHEMA_VERSION;
  const outdated = schema < SUPPORTED_SCHEMA_VERSION;

  return html`<div class="config-section">
    ${
      !futureSch
        ? html`<div class="config-tabs" role="tablist" aria-label="Config editor mode">
            <button
              type="button"
              role="tab"
              class=${`config-tab${mode === 'form' ? ' active' : ''}`}
              aria-selected=${mode === 'form'}
              data-config-mode="form"
            >Form</button>
            <button
              type="button"
              role="tab"
              class=${`config-tab${mode === 'raw' ? ' active' : ''}`}
              aria-selected=${mode === 'raw'}
              data-config-mode="raw"
            >Raw YAML</button>
          </div>`
        : nothing
    }

    ${
      futureSch
        ? html`<div class="config-future-schema">
            <p class="config-schema-badge">Schema ${schema}</p>
            <p>Update ChangeLedger to edit config schema ${schema}.</p>
          </div>
          ${rawReadonlyTemplate(config)}`
        : outdated
          ? html`<div class="config-migration-card">
              <h3>Migration required</h3>
              <p>Config schema ${schema} is outdated. Preview and apply the migration to schema ${SUPPORTED_SCHEMA_VERSION} to enable the Form editor.</p>
              ${
                preview?.already_current
                  ? html`<p class="config-migration-ok">Migration already applied.</p>`
                  : preview?.error
                    ? html`<p class="project-error" role="alert" aria-live="assertive">${preview.error}</p>
                        <div class="project-actions">
                          <button class="button secondary" type="button" data-preview-migration>Retry preview</button>
                        </div>`
                    : preview
                      ? html`<div class="config-migration-preview">
                          <p class="config-migration-summary">${preview.summary}</p>
                          <p><strong>Changes:</strong></p>
                          <ul>${preview.changes?.map((c) => html`<li>${c}</li>`)}</ul>
                          <pre class="config-migration-yaml">${preview.yaml}</pre>
                          <div class="project-actions">
                            <button class="button" type="button" data-apply-migration>Apply migration</button>
                          </div>
                        </div>`
                      : html`<div class="project-actions">
                          <button class="button secondary" type="button" data-preview-migration>Preview migration</button>
                        </div>`
              }
              <p class="config-section-note">You can still inspect the current config in Raw YAML.</p>
              ${rawEditorTemplate(config)}
            </div>`
          : mode === 'form'
            ? formEditorTemplate(config)
            : rawEditorTemplate(config)
    }
  </div>`;
}

// Raw editor with Save button (for editable schemas)
function rawEditorTemplate(config) {
  return html`<form class="config-form">
    <div class="config-label"><label for="project-config">.changeledger/config.yml</label><button type="button" class="text-button" data-reload-config>Reload</button></div>
    <textarea id="project-config" spellcheck="false" .value=${config?.content ?? ''}></textarea>
    <p class="project-error" role="alert" aria-live="assertive" ?hidden=${!config?.rawError}>${config?.rawError ?? ''}</p>
    <div class="project-actions"><button class="button" type="submit">Save configuration</button></div>
  </form>`;
}

// Raw viewer without Save (future schema — strictly read-only)
function rawReadonlyTemplate(config) {
  return html`<div class="config-form config-form-readonly">
    <div class="config-label"><label for="project-config-ro">.changeledger/config.yml</label></div>
    <textarea id="project-config-ro" spellcheck="false" readonly .value=${config?.content ?? ''}></textarea>
    <p class="config-note">Editing disabled for schema ${config.schemaVersion ?? '?'}. Update ChangeLedger to enable editing.</p>
  </div>`;
}

function formEditorTemplate(config) {
  const cfg = config.config ?? {};
  const types = cfg.types ?? {};
  const impacts = cfg.release?.impacts ?? {};
  const readiness = cfg.readiness ?? {};
  const allStatuses = cfg.statuses ?? [];
  const stages = cfg.stages ?? [];

  return html`<form class="config-form config-form-structured" data-config-form>
    <div class="config-label">
      <label>.changeledger/config.yml (Form)</label>
      <button type="button" class="text-button" data-reload-config>Reload</button>
    </div>

    <fieldset class="config-group">
      <legend>General</legend>
      <label>Project name
        <input name="project_name" .value=${cfg.project_name ?? ''} />
      </label>
      <label>Language
        <input name="language" .value=${cfg.language ?? 'en'} />
      </label>
      <label class="config-checkbox">
        <input type="checkbox" name="tdd" ?checked=${cfg.tdd !== false} />
        TDD mode (require test-grade criteria)
      </label>
    </fieldset>

    <fieldset class="config-group">
      <legend>Paths</legend>
      <p class="config-note">Changing paths only updates the config — existing files are not moved.</p>
      <label>Changes directory
        <input name="changes_dir" .value=${cfg.changes_dir ?? '.changeledger/changes'} />
      </label>
      <label>Specs directory
        <input name="specs_dir" .value=${cfg.specs_dir ?? '.changeledger/specs'} />
      </label>
    </fieldset>

    <fieldset class="config-group">
      <legend>Lifecycle statuses</legend>
      <label>Status order (one per line)
        <textarea name="statuses" rows="8">${allStatuses.join('\n')}</textarea>
      </label>
      <p class="config-note">Canonical statuses are required. Custom statuses may be added and reordered.</p>
    </fieldset>

    <fieldset class="config-group">
      <legend>Lifecycle stages</legend>
      <label>Canonical stage order (one per line)
        <textarea name="stages" rows="6">${stages.join('\n')}</textarea>
      </label>
      <p class="config-note">Stages used by a change type cannot be removed until that type is updated.</p>
    </fieldset>

    <fieldset class="config-group">
      <legend>Change types</legend>
      ${Object.entries(types).map(
        ([typeName, typeDef]) => html`
            <fieldset class="config-type-row">
              <legend>${typeName}</legend>
              <label>Active stages (one per line)
                <textarea name=${`stages_${typeName}`} rows="3">${(typeDef?.stages ?? []).join('\n')}</textarea>
              </label>
              <label>Review policy
                <select name=${`review_required_${typeName}`}>
                  <option value="" ?selected=${!Object.hasOwn(typeDef ?? {}, 'review_required')}>Not configured</option>
                  <option value="true" ?selected=${typeDef?.review_required === true}>Required</option>
                  <option value="false" ?selected=${typeDef?.review_required === false}>Not required</option>
                </select>
              </label>
              <label>SemVer impact
                <select name=${`impact_${typeName}`}>
                  <option value="" ?selected=${!Object.hasOwn(impacts, typeName)}>Not configured</option>
                  ${['none', 'patch', 'minor', 'major'].map(
                    (v) =>
                      html`<option value=${v} ?selected=${impacts[typeName] === v}>${v}</option>`,
                  )}
                </select>
              </label>
            </fieldset>
          `,
      )}
    </fieldset>

    <fieldset class="config-group">
      <legend>Definition of Ready</legend>
      <label>Target patterns (one per line)
        <textarea name="target_patterns" rows="3">${(readiness.target_patterns ?? []).join('\n')}</textarea>
      </label>
      <label>Verification patterns (one per line)
        <textarea name="verification_patterns" rows="3">${(readiness.verification_patterns ?? []).join('\n')}</textarea>
      </label>
    </fieldset>

    <fieldset class="config-group config-group-internal">
      <legend>Internal</legend>
      <p><span class="config-readonly-label">schema_version</span><span class="config-readonly-value">${cfg.schema_version ?? 0}</span></p>
      <p><span class="config-readonly-label">project_id</span><span class="config-readonly-value mono">${cfg.project_id ?? ''}</span></p>
    </fieldset>

    <p class="project-error" role="alert" aria-live="assertive" ?hidden=${!config?.formError}>${config?.formError ?? ''}</p>
    <div class="project-actions">
      <button class="button" type="submit">Save configuration</button>
    </div>
  </form>`;
}

export function projectsViewTemplate(
  projects,
  selected,
  config,
  localOnly,
  preview = migrationPreview,
) {
  const project = projects.find((item) => item.id === selected);
  return html`<div class="projects-shell">
    <div class="projects-list">
      <div class="projects-heading">
        <div><span class="eyebrow">Registry</span><h1>Projects</h1></div>
        <span class="count">${projects.length}</span>
      </div>
      ${
        projects.length
          ? html`<div class="project-rows">${projects.map(
              (
                item,
              ) => html`<button type="button" class=${`project-row${item.id === selected ? ' active' : ''}`} data-manage-project=${item.id}>
              <span class=${`health-dot ${item.alive ? 'available' : 'missing'}`} aria-hidden="true"></span>
              <span class="project-summary"><strong>${item.name}</strong><small>${item.path}</small></span>
              <span class="mono project-id">${item.id}</span>
              <span class=${`project-health ${item.alive ? 'available' : 'missing'}`}>${item.alive ? 'Available' : 'Missing'}</span>
            </button>`,
            )}</div>`
          : html`<p class="empty">No projects registered.</p>`
      }
    </div>
    <div class="project-editor">
      ${
        !project
          ? html`<div class="project-placeholder"><span class="eyebrow">Configuration</span><h2>Select a project</h2><p>Inspect its registry entry and edit its ChangeLedger configuration.</p></div>`
          : html`<div class="project-editor-head">
              <div><span class="eyebrow">${project.id}</span><h2>${project.name}</h2><p>${project.path}</p></div>
              <span class=${`project-health ${project.alive ? 'available' : 'missing'}`}>${project.alive ? 'Available' : 'Missing'}</span>
            </div>
            ${
              !localOnly
                ? html`<form class="project-path-form">
                  <label for="project-path">Registered path</label>
                  <div><input id="project-path" name="path" .value=${project.path} /><button class="button secondary" type="submit">Repair path</button></div>
                </form>`
                : nothing
            }
            ${
              project.alive
                ? config?.loading
                  ? html`<p class="empty">Loading configuration…</p>`
                  : configSectionTemplate(config, configMode, preview)
                : html`<div class="missing-config"><h3>Configuration unavailable</h3><p>Repair the registered path to edit this project.</p></div>`
            }
            ${
              !localOnly
                ? html`<div class="danger-zone"><div><strong>Unregister project</strong><p>Removes this local registry entry. Repository files are never deleted.</p></div><button type="button" class="button danger" data-unregister>Unregister</button></div>`
                : nothing
            }`
      }
    </div>
  </div>`;
}

async function openManagedProject(id, { reload = false } = {}) {
  managedProject = id;
  configDirty = false;
  const project = state.projectsList.find((item) => item.id === id);
  if (!project?.alive) {
    managedConfig = null;
    migrationPreview = null;
    renderProjects();
    return;
  }
  if (!reload && managedConfig?.id === id && !managedConfig.error) {
    renderProjects();
    return;
  }
  managedConfig = { id, loading: true };
  migrationPreview = null;
  renderProjects();
  try {
    const structured = await getProjectConfigStructured(id);
    managedConfig = { id, ...structured };
    // Default to form for current schema, raw for future schema
    if (structured.schemaVersion > SUPPORTED_SCHEMA_VERSION) {
      configMode = 'raw';
    } else {
      configMode = 'form';
    }
  } catch (error) {
    managedConfig = { id, content: '', revision: '', error: error.message };
  }
  renderProjects();
}

export function setProjectFormPending(root, pending) {
  root.querySelectorAll('button, input, textarea').forEach((control) => {
    control.disabled = pending;
  });
  root.classList.toggle('is-pending', pending);
}

export async function projectMutation(root, request, onSuccess) {
  setProjectFormPending(root, true);
  const error = root.querySelector('.project-error');
  if (error) error.hidden = true;
  try {
    const response = await request();
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Project update failed.');
    await onSuccess(body);
  } catch (failure) {
    if (error) {
      error.textContent = failure.message;
      error.hidden = false;
    } else showToast(failure.message);
  } finally {
    setProjectFormPending(root, false);
  }
}

export function requestUnregisterConfirmation(project, ask = null) {
  if (ask !== null)
    return ask(
      `Type "${project.name}" to unregister this project. No repository files will be deleted.`,
    );
  return showPrompt(
    `Type "${project.name}" to unregister this project. No repository files will be deleted.`,
    { placeholder: project.name },
  );
}

async function refreshProjectRegistry() {
  const { projects, current, localOnly } = await getProjects();
  state.localOnly = localOnly;
  initializeProjects(projects, current);
  const select = $('#project');
  litRender(
    projects.map(
      (item) =>
        html`<option value=${item.id} ?disabled=${!item.alive}>${item.name}${item.alive ? '' : ' (missing)'}</option>`,
    ),
    select,
  );
  if (state.currentProject) select.value = state.currentProject;
  select.style.display = projects.length > 1 ? '' : 'none';
}

const listFromControl = (control) =>
  (control?.value ?? '')
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);

const sameList = (left = [], right = []) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

export function collectFormPatch(formEl, currentConfig) {
  const patch = {};
  const els = formEl.elements;

  if (els.project_name && els.project_name.value !== (currentConfig.project_name ?? '')) {
    patch.project_name = els.project_name.value;
  }
  if (els.language && els.language.value !== (currentConfig.language ?? 'en')) {
    patch.language = els.language.value;
  }
  if (els.tdd && els.tdd.checked !== (currentConfig.tdd !== false)) patch.tdd = els.tdd.checked;
  if (
    els.changes_dir &&
    els.changes_dir.value !== (currentConfig.changes_dir ?? '.changeledger/changes')
  ) {
    patch.changes_dir = els.changes_dir.value;
  }
  if (els.specs_dir && els.specs_dir.value !== (currentConfig.specs_dir ?? '.changeledger/specs')) {
    patch.specs_dir = els.specs_dir.value;
  }

  const statuses = listFromControl(els.statuses);
  if (els.statuses && !sameList(statuses, currentConfig.statuses ?? [])) patch.statuses = statuses;
  const stages = listFromControl(els.stages);
  if (els.stages && !sameList(stages, currentConfig.stages ?? [])) patch.stages = stages;

  // Type fields are tri-state: an empty select means the key is not configured.
  const types = currentConfig.types ?? {};
  const existingImpacts = currentConfig.release?.impacts ?? {};
  const typePatch = {};
  const impacts = {};
  for (const typeName of Object.keys(types)) {
    const currentType = types[typeName] ?? {};
    const typeStages = listFromControl(els[`stages_${typeName}`]);
    if (els[`stages_${typeName}`] && !sameList(typeStages, currentType.stages ?? [])) {
      typePatch[typeName] = { ...(typePatch[typeName] ?? {}), stages: typeStages };
    }

    const rrEl = els[`review_required_${typeName}`];
    const currentReview = Object.hasOwn(currentType, 'review_required')
      ? String(currentType.review_required)
      : '';
    if (rrEl && rrEl.value !== currentReview) {
      typePatch[typeName] = {
        ...(typePatch[typeName] ?? {}),
        review_required: rrEl.value === '' ? null : rrEl.value === 'true',
      };
    }

    const impactEl = els[`impact_${typeName}`];
    const currentImpact = Object.hasOwn(existingImpacts, typeName) ? existingImpacts[typeName] : '';
    if (impactEl && impactEl.value !== currentImpact) {
      impacts[typeName] = impactEl.value === '' ? null : impactEl.value;
    }
  }
  if (Object.keys(typePatch).length) patch.types = typePatch;
  if (Object.keys(impacts).length) patch.release = { impacts };

  // readiness patterns
  if (els.target_patterns !== undefined) {
    const targetPatterns = listFromControl(els.target_patterns);
    const verifyPatterns = listFromControl(els.verification_patterns);
    const currentReadiness = currentConfig.readiness ?? {};
    if (
      !sameList(targetPatterns, currentReadiness.target_patterns ?? []) ||
      !sameList(verifyPatterns, currentReadiness.verification_patterns ?? [])
    ) {
      patch.readiness = {
        target_patterns: targetPatterns,
        verification_patterns: verifyPatterns,
      };
    }
  }

  return patch;
}

function renderProjects() {
  const root = $('#projects');
  litRender(
    projectsViewTemplate(state.projectsList, managedProject, managedConfig, state.localOnly),
    root,
  );
  bindProjectViewActions(root, {
    select: async (id) => {
      if (configDirty) {
        const ok = await showConfirm('You have unsaved changes. Switch project and discard them?');
        if (!ok) return;
      }
      openManagedProject(id);
    },
    reload: async () => {
      if (configDirty) {
        const ok = await showConfirm('Reload will discard your unsaved changes. Continue?');
        if (!ok) return;
      }
      openManagedProject(managedProject, { reload: true });
    },
    markDirty: () => {
      configDirty = true;
    },
    switchMode: async (mode) => {
      if (configDirty && mode !== configMode) {
        const ok = await showConfirm('You have unsaved changes. Switch mode and discard them?');
        if (!ok) return;
      }
      configMode = mode;
      configDirty = false;
      renderProjects();
    },
    saveRaw: (content, configForm) =>
      projectMutation(
        configForm,
        () => postProjectConfig(managedProject, content, managedConfig.revision),
        async (body) => {
          configDirty = false;
          managedConfig = { ...managedConfig, content, revision: body.revision };
          await refreshProjectRegistry();
          renderProjects();
        },
      ),
    saveForm: (formEl, configForm) =>
      projectMutation(
        configForm,
        () => {
          const patch = collectFormPatch(formEl, managedConfig.config ?? {});
          return patchProjectConfigApi(managedProject, patch, managedConfig.revision);
        },
        async (_body) => {
          configDirty = false;
          await openManagedProject(managedProject, { reload: true });
        },
      ),
    previewMigration: async () => {
      try {
        const result = await getConfigMigrationPreview(managedProject, managedConfig.revision);
        migrationPreview = result;
      } catch (e) {
        migrationPreview = { error: e.message };
      }
      renderProjects();
    },
    applyMigration: async () => {
      const ok = await showConfirm(
        'Apply the config migration? This will update .changeledger/config.yml.',
      );
      if (!ok) return;
      try {
        await postConfigMigrationApply(managedProject, managedConfig.revision);
        await openManagedProject(managedProject, { reload: true });
      } catch (e) {
        migrationPreview = { error: e.message };
        renderProjects();
      }
    },
    repair: (projectPath, pathForm) =>
      projectMutation(
        pathForm,
        () => postProjectPath(managedProject, projectPath),
        async () => {
          await refreshProjectRegistry();
          await openManagedProject(managedProject, { reload: true });
        },
      ),
    unregister: async (editor) => {
      const project = state.projectsList.find((item) => item.id === managedProject);
      const answer = await requestUnregisterConfirmation(project);
      if (answer === null) return;
      projectMutation(
        editor,
        () => postProjectRemove(managedProject, answer),
        async () => {
          managedProject = null;
          managedConfig = null;
          await refreshProjectRegistry();
          if (state.currentProject) await load();
          renderProjects();
        },
      );
    },
  });
}

export function bindProjectViewActions(root, handlers) {
  root.querySelectorAll('[data-manage-project]').forEach((button) => {
    button.onclick = () => handlers.select(button.dataset.manageProject);
  });

  root.querySelectorAll('[data-config-mode]').forEach((button) => {
    button.onclick = () => handlers.switchMode(button.dataset.configMode);
  });

  const reload = root.querySelector('[data-reload-config]');
  if (reload) reload.onclick = () => handlers.reload();

  const rawForm = root.querySelector('.config-form:not([data-config-form])');
  if (rawForm) {
    rawForm.onsubmit = (event) => {
      event.preventDefault();
      handlers.saveRaw(rawForm.querySelector('textarea').value, rawForm);
    };
    rawForm.querySelector('textarea')?.addEventListener('input', () => handlers.markDirty?.());
  }

  const formEditor = root.querySelector('[data-config-form]');
  if (formEditor) {
    formEditor.onsubmit = (event) => {
      event.preventDefault();
      handlers.saveForm(formEditor, formEditor);
    };
    formEditor.addEventListener('input', () => handlers.markDirty?.());
    formEditor.addEventListener('change', () => handlers.markDirty?.());
  }

  const previewBtn = root.querySelector('[data-preview-migration]');
  if (previewBtn) previewBtn.onclick = () => handlers.previewMigration();

  const applyBtn = root.querySelector('[data-apply-migration]');
  if (applyBtn) applyBtn.onclick = () => handlers.applyMigration();

  const pathForm = root.querySelector('.project-path-form');
  if (pathForm)
    pathForm.onsubmit = (event) => {
      event.preventDefault();
      handlers.repair(pathForm.elements.path.value, pathForm);
    };
  const unregister = root.querySelector('[data-unregister]');
  if (unregister)
    unregister.onclick = () => handlers.unregister(root.querySelector('.project-editor'));
}

function activateView(v) {
  setView(v);
  $('#toggle-global').classList.remove('active');
  $('#global').classList.add('hidden');
  for (const name of VIEWS) {
    $(`#view-${name}`).classList.toggle('active', v === name);
    $(`#${name}`).classList.toggle('hidden', v !== name);
  }
  render();
}

// Global search: query every project server-side, render grouped results.
async function renderGlobal() {
  const q = state.filters.text.trim();
  const el = $('#global');
  if (!q) {
    litRender(
      html`<p class="empty" style="padding:20px">Type to search across all projects.</p>`,
      el,
    );
    return;
  }
  let groups;
  try {
    groups = await searchAllProjects(q);
  } catch (e) {
    litRender(html`<p style="color:var(--bug);padding:20px">${e.message}</p>`, el);
    return;
  }
  if (!groups.length) {
    litRender(html`<p class="empty" style="padding:20px">No matches for “${q}”.</p>`, el);
    return;
  }
  litRender(
    groups.map(
      (g) => html`
      <div class="search-group">
        <h3>${g.project.name} <span class="count">${g.matches.length}</span></h3>
        ${g.matches.map(
          (m) => html`<div class="search-hit" data-proj=${g.project.id} data-id=${m.id}>
              <span class="card-id">#${m.id}</span>
              <span class="type-tag" style=${`--type-color: var(--${cssIdent(m.type)})`}>${m.type}</span>
              <span>${m.title}</span>
              <span class="pill">${m.status}</span>
            </div>`,
        )}
      </div>`,
    ),
    el,
  );
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
  restoreInitialViewerShell();
  diagramLightbox = createDiagramLightbox({
    overlay: $('#diagram-overlay'),
    canvas: $('#diagram-canvas'),
    closeButton: $('#close-diagram'),
  });
  $('#search').oninput = (e) => {
    setTextFilter(e.target.value);
    if (state.globalMode) renderGlobal();
    else render();
  };
  $('#toggle-global').onclick = (e) => {
    const active = toggleGlobalMode();
    e.target.classList.toggle('active', active);
    if (active) enterGlobal();
    else activateView(state.currentView);
  };
  $('#type-filter').onchange = (e) => {
    setTypeFilter(e.target.value);
    render();
  };
  $('#owner-filter').onchange = (e) => {
    setOwnerFilter(e.target.value);
    render();
  };
  document.addEventListener('pointerdown', (event) => {
    closeStatusMenuOnOutsideClick($('#status-filter .filter-menu'), event.target);
  });
  $('#view-board').onclick = () => activateView('board');
  $('#view-table').onclick = () => activateView('table');
  $('#view-graph').onclick = () => activateView('graph');
  $('#view-specs').onclick = () => activateView('specs');
  $('#view-metrics').onclick = () => activateView('metrics');
  $('#view-projects').onclick = () => activateView('projects');
  $('#project').onchange = async (e) => {
    const nextProject = e.target.value;
    if (state.currentView === 'projects' && configDirty && nextProject !== state.currentProject) {
      const ok = await showConfirm('You have unsaved changes. Switch project and discard them?');
      if (!ok) {
        e.target.value = state.currentProject;
        return;
      }
      configDirty = false;
    }
    selectProject(nextProject);
    load();
  };
  document.onkeydown = (e) => {
    if (e.key === 'Escape' && !diagramLightbox.handleKeydown(e)) closeDetail();
  };

  loadProjects();
  setInterval(load, 5000);
}

export function closeStatusMenuOnOutsideClick(menu, target) {
  if (!menu?.open || menu.contains(target)) return false;
  menu.open = false;
  return true;
}

// Only a real browser page with the app shell bootstraps; importing the module
// (for tests) must not touch the DOM or start polling.
if (typeof document !== 'undefined' && document.getElementById('search')) {
  bootstrap();
}
