import {
  getGitRefs,
  getProjectConfig,
  getProjects,
  getRepo,
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
    litRender(
      html`<p class="empty" style="padding:20px">No projects registered. Run <code>changeledger init</code> in a repo.</p>`,
      $('#board'),
    );
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
      alert(out.error || 'status change failed');
      return;
    }
  } catch (e) {
    alert(e.message);
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
    alert(`Project "${proj}" is not registered or its path is gone.`);
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
  $('#detail').querySelector('.close').onclick = closeDetail;
  overlay.onclick = (e) => {
    if (e.target === overlay) closeDetail();
  };
  renderExpandableMermaid($('#detail'));
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

let managedProject = null;
let managedConfig = null;

export function projectsViewTemplate(projects, selected, config, localOnly) {
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
                  : html`<form class="config-form">
                    <div class="config-label"><label for="project-config">.changeledger/config.yml</label><button type="button" class="text-button" data-reload-config>Reload</button></div>
                    <textarea id="project-config" spellcheck="false" .value=${config?.content ?? ''}></textarea>
                    <p class="project-error" ?hidden=${!config?.error}>${config?.error ?? ''}</p>
                    <div class="project-actions"><button class="button" type="submit">Save configuration</button></div>
                  </form>`
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
  const project = state.projectsList.find((item) => item.id === id);
  if (!project?.alive) {
    managedConfig = null;
    renderProjects();
    return;
  }
  if (!reload && managedConfig?.id === id && !managedConfig.error) {
    renderProjects();
    return;
  }
  managedConfig = { id, loading: true };
  renderProjects();
  try {
    managedConfig = { id, ...(await getProjectConfig(id)) };
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
    } else alert(failure.message);
  } finally {
    setProjectFormPending(root, false);
  }
}

export function requestUnregisterConfirmation(project, ask = prompt) {
  return ask(
    `Type "${project.name}" to unregister this project. No repository files will be deleted.`,
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

function renderProjects() {
  const root = $('#projects');
  litRender(
    projectsViewTemplate(state.projectsList, managedProject, managedConfig, state.localOnly),
    root,
  );
  bindProjectViewActions(root, {
    select: (id) => openManagedProject(id),
    reload: () => openManagedProject(managedProject, { reload: true }),
    save: (content, configForm) =>
      projectMutation(
        configForm,
        () => postProjectConfig(managedProject, content, managedConfig.revision),
        async (body) => {
          managedConfig = { id: managedProject, content, revision: body.revision };
          await refreshProjectRegistry();
          renderProjects();
        },
      ),
    repair: (projectPath, pathForm) =>
      projectMutation(
        pathForm,
        () => postProjectPath(managedProject, projectPath),
        async () => {
          await refreshProjectRegistry();
          await openManagedProject(managedProject, { reload: true });
        },
      ),
    unregister: (editor) => {
      const project = state.projectsList.find((item) => item.id === managedProject);
      const confirm = requestUnregisterConfirmation(project);
      if (confirm === null) return;
      projectMutation(
        editor,
        () => postProjectRemove(managedProject, confirm),
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
  const reload = root.querySelector('[data-reload-config]');
  if (reload) reload.onclick = () => handlers.reload();
  const configForm = root.querySelector('.config-form');
  if (configForm)
    configForm.onsubmit = (event) => {
      event.preventDefault();
      handlers.save(configForm.querySelector('textarea').value, configForm);
    };
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
  restoreViewerState(window.localStorage);
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
  $('#project').onchange = (e) => {
    selectProject(e.target.value);
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
