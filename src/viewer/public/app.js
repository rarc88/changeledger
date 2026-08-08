import {
  getConfigMigrationPreview,
  getGitRefs,
  getLedgerDocument,
  getLedgerTree,
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
  clearOwnerFilters,
  clearStatusFilters,
  clearTypeFilters,
  initializeProjects,
  invalidateCache,
  normalizeRepoState,
  restoreViewerState,
  selectProject,
  setDetailPresentation,
  setLedgerCategory,
  setRepo,
  setSortKey,
  setTextFilter,
  setView,
  sortBoardColumnChanges,
  state,
  toggleBoardColumnSort,
  toggleGlobalMode,
  toggleOwnerFilter,
  togglePendingGraduation,
  toggleShowArchived,
  toggleShowDiscarded,
  toggleStatusFilter,
  toggleTypeFilter,
  toggleUnassignedOwner,
} from './app-state.js';
import { createLedgerBrowser, handleLedgerDocumentLink } from './ledger-browser.js';
import { cssIdent, initMermaid, makeMermaidExpandable, renderMermaid } from './security.js';
import { boardStatuses, isVisible, passesTombstones } from './state.js';
import { html, render as litRender, nothing } from './templates.js';
import {
  approvalPanel,
  boardColumnHeader,
  card,
  detailToolbar,
  referenceDetails,
  sortIndicator,
  specBody,
  stageBlock,
  statusSummary,
  tableRow,
  validationPanel,
} from './view-parts.js';
import { graphSvg, ledgerViewHtml, metricsHtml, sortSpecsByUpdated } from './view-renderers.js';
import { createLedgerNavigation, readLedgerRoute } from './viewer-routing.js';

export { cssIdent, esc, makeMermaidExpandable, safeHtml } from './security.js';
export { boardStatuses, isVisible, passesTombstones } from './state.js';
export {
  card,
  detailPresentationControls,
  detailToolbar,
  sortIndicator,
  stageBlock,
  statusSummary,
  statusTag,
  tableRow,
  taskList,
} from './view-parts.js';

const $ = (sel) => document.querySelector(sel);

export const ledgerBrowser = createLedgerBrowser({
  getTree: getLedgerTree,
  getDocument: getLedgerDocument,
});
export const ledgerBrowserState = ledgerBrowser.state;
let viewerNavigation = null;
let openedSpecName = null;
let repoRequestRevision = 0;
let latestRepoLoad = null;
let gitRefsRequestRevision = 0;
let openedChangeTarget = null;

const captureProjectTarget = (project) =>
  Object.freeze({
    project,
    repositoryPath: state.projectsList.find((candidate) => candidate.id === project)?.path ?? null,
  });

const sameProjectTarget = (left, right) =>
  left?.project === right?.project && left?.repositoryPath === right?.repositoryPath;

const hasProjectProvenance = (payload) =>
  Object.hasOwn(payload ?? {}, 'project_id') || Object.hasOwn(payload ?? {}, 'repository_path');

const matchesProjectProvenance = (payload, target) =>
  Object.hasOwn(payload ?? {}, 'project_id') &&
  Object.hasOwn(payload ?? {}, 'repository_path') &&
  String(payload.project_id) === String(target.project) &&
  payload.repository_path === target.repositoryPath;

export function configureViewerNavigation(navigation) {
  viewerNavigation = navigation;
}

function currentLedgerRoute(doc = null) {
  if (state.currentView !== 'ledger' || !state.currentProject) return null;
  return {
    view: 'ledger',
    project: state.currentProject,
    category: state.ledgerCategory,
    doc,
  };
}

function writeCurrentLedgerRoute(mode, doc = null) {
  const route = currentLedgerRoute(doc);
  if (route && viewerNavigation) viewerNavigation[mode](route);
}

initMermaid();

async function loadProjects(initialRoute = { kind: 'absent' }) {
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
  initializeProjects(projects, current, { exact: initialRoute.kind === 'valid' });
  if (state.currentProject && projects.some((project) => project.id === state.currentProject)) {
    sel.value = state.currentProject;
  }
  sel.style.display = projects.length > 1 ? '' : 'none';
  if (initialRoute.kind === 'valid') {
    await restoreLedgerRouteSelection(initialRoute.state);
    return;
  }
  if (initialRoute.kind === 'invalid') {
    renderLedgerRouteError($('#ledger'), 'Invalid Ledger URL');
    return;
  }
  await load();
  if (state.currentView === 'ledger' && state.currentProject) {
    writeCurrentLedgerRoute('replace');
  } else {
    viewerNavigation?.clear('replace', state.currentView);
  }
}

export function load(requestRepo = getRepo, applyRepo = applyLoadedRepo) {
  const revision = ++repoRequestRevision;
  const project = state.currentProject;
  const target = captureProjectTarget(project);
  const stale = () =>
    revision !== repoRequestRevision ||
    !sameProjectTarget(target, captureProjectTarget(state.currentProject));
  const supersedingLoad = () => {
    const latest = latestRepoLoad;
    return sameProjectTarget(target, captureProjectTarget(state.currentProject)) &&
      sameProjectTarget(latest?.target, target) &&
      latest.revision > revision
      ? latest.promise
      : false;
  };
  const promise = (async () => {
    if (!project) {
      if (state.currentView === 'projects') {
        syncViewerShell();
        return true;
      }
      showNoProjects();
      return false;
    }
    try {
      const text = await requestRepo(target.project, target.repositoryPath);
      if (stale()) return supersedingLoad();
      const payload = JSON.parse(text);
      if (!matchesProjectProvenance(payload, target)) return false;
      if (text === state.lastJson) return true;
      applyRepo(text);
      return true;
    } catch (e) {
      if (stale()) return supersedingLoad();
      if (hasProjectProvenance(e.payload) && !matchesProjectProvenance(e.payload, target))
        return false;
      if (state.currentView === 'ledger') renderLedgerRouteError($('#ledger'), e.message);
      else litRender(html`<p style="color:var(--bug);padding:20px">${e.message}</p>`, $('#board'));
      return false;
    }
  })();
  latestRepoLoad = { revision, project, target, promise };
  return promise;
}

function applyLoadedRepo(text) {
  setRepo(text);
  normalizeRepoState(state.repo);
  hydrateFilters();
  syncViewerShell();
}

export function showNoProjects(root = document) {
  setView('board');
  litRender(
    html`<p class="empty" style="padding:20px">No projects registered. Run <code>changeledger init</code> in a repo.</p>`,
    root.querySelector('#board'),
  );
  syncViewerShell(root, false);
  renderChangeErrors([], root);
}

function renderChangeErrors(errors = [], root = document) {
  let warning = root.querySelector('#change-errors');
  if (!errors.length) {
    warning?.remove();
    return;
  }
  if (!warning) {
    warning = (root.ownerDocument ?? root).createElement('aside');
    warning.id = 'change-errors';
    warning.className = 'change-errors';
    warning.setAttribute('role', 'alert');
    warning.setAttribute('aria-live', 'polite');
    warning.setAttribute('aria-label', 'Invalid change documents');
    root.querySelector('#board').before(warning);
  }
  litRender(
    html`<strong>${errors.length} change document${errors.length === 1 ? '' : 's'} could not be loaded</strong>
      <ul>
        ${errors.map(
          (error) => html`<li><code>${error.name}</code><span>${error.message}</span></li>`,
        )}
      </ul>`,
    warning,
  );
}

// Rebuilt on each project load (types/statuses can differ per project).
function hydrateFilters() {
  $('#lang').textContent = state.repo.language;
  const owners = [...new Set(state.repo.changes.map((c) => c.owner).filter(Boolean))].sort();
  renderChoiceFilter(
    $('#type-filter'),
    'Type',
    state.repo.types,
    state.filters.types,
    toggleTypeFilter,
    clearTypeFilters,
  );
  renderChoiceFilter(
    $('#owner-filter'),
    'Owner',
    owners,
    state.filters.owners,
    toggleOwnerFilter,
    clearOwnerFilters,
    true,
  );
  renderStatusFilter();
}

export function choiceFilterSummary(label, selected, includeUnassigned = false) {
  const count = selected.size + Number(includeUnassigned);
  if (count === 1 && includeUnassigned) return 'Unassigned';
  return count
    ? count === 1
      ? [...selected][0]
      : `${count} selected`
    : `All ${label.toLowerCase()}s`;
}

export function renderChoiceFilter(host, label, choices, selected, toggle, clear, owners = false) {
  const summary = choiceFilterSummary(label, selected, owners && state.filters.includeUnassigned);
  litRender(
    html`<details class="filter-menu">
      <summary class="filter-trigger">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3.25h12M4.25 8h7.5M6.5 12.75h3"></path></svg>
        <span data-choice-summary>${summary}</span>
        <svg class="filter-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 6.25 3.5 3.5 3.5-3.5"></path></svg>
      </summary>
      <div class="filter-popover">
        <div class="filter-heading"><span>${label}</span><button type="button" data-clear>Clear</button></div>
        <div class="filter-options">
          ${choices.map((choice) => html`<label class="check-option"><input type="checkbox" data-choice=${choice} .checked=${selected.has(choice)} /><span class="check-box" aria-hidden="true"></span><span>${choice}</span></label>`)}
          ${owners ? html`<label class="check-option"><input type="checkbox" data-unassigned .checked=${state.filters.includeUnassigned} /><span class="check-box" aria-hidden="true"></span><span>Unassigned</span></label>` : nothing}
        </div>
      </div>
    </details>`,
    host,
  );
  const syncFilter = () =>
    renderChoiceFilter(host, label, choices, selected, toggle, clear, owners);
  host.querySelectorAll('[data-choice]').forEach((input) => {
    input.onchange = () => {
      toggle(input.dataset.choice);
      syncFilter();
      render();
    };
  });
  if (owners)
    host.querySelector('[data-unassigned]').onchange = () => {
      toggleUnassignedOwner();
      syncFilter();
      render();
    };
  host.querySelector('[data-clear]').onclick = () => {
    clear();
    syncFilter();
    render();
  };
}

export function renderStatusFilter() {
  const sf = $('#status-filter');
  const summary = state.filters.pendingGraduation
    ? state.filters.statuses.size
      ? `${state.filters.statuses.size + 1} selected`
      : 'Pending graduation'
    : statusSummary(state.filters.statuses);
  litRender(
    html`<details class="filter-menu">
      <summary class="filter-trigger">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3.25h12M4.25 8h7.5M6.5 12.75h3"></path></svg>
        <span data-status-summary>${summary}</span>
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
          <label class="check-option">
            <input type="checkbox" data-pending-graduation .checked=${state.filters.pendingGraduation} />
            <span class="check-box" aria-hidden="true"></span>
            <span>Pending graduation</span>
          </label>
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
      renderStatusFilter();
      render();
    };
  });
  sf.querySelector('[data-pending-graduation]').onchange = () => {
    togglePendingGraduation();
    renderStatusFilter();
    render();
  };
  sf.querySelector('[data-clear-status]').onclick = () => {
    clearStatusFilters();
    renderStatusFilter();
    render();
  };
  sf.querySelector('[data-visibility="archived"]').onchange = () => {
    toggleShowArchived();
    renderStatusFilter();
    render();
  };
  sf.querySelector('[data-visibility="discarded"]').onchange = () => {
    toggleShowDiscarded();
    renderStatusFilter();
    render();
  };
}

function visibleChanges() {
  return state.repo.changes.filter((c) => isVisible(c, state.filters));
}

function render() {
  if (state.currentView === 'graph') renderGraph();
  else if (state.currentView === 'table') renderTable();
  else if (state.currentView === 'ledger') renderLedger();
  else if (state.currentView === 'metrics') renderMetrics();
  else if (state.currentView === 'projects') renderProjects();
  else renderBoard();
}

function renderBoard() {
  const changes = visibleChanges();
  const board = $('#board');
  litRender(
    boardStatuses(state.repo.statuses, state.filters.showDiscarded).map((status) => {
      const descending = state.boardSortColumns.has(status);
      const items = sortBoardColumnChanges(
        changes.filter((change) => change.status === status),
        descending,
      );
      return html`
        <div class="column" data-status=${status}>
          ${boardColumnHeader(status, items.length, descending)}
          <div class="column-body">${items.map(card)}</div>
        </div>`;
    }),
    board,
  );
  bindBoardSortControls(board);
  bindBoardInteractions(board, state.repo.changes);
}

export function bindBoardSortControls(board, rerender = renderBoard) {
  board.querySelectorAll('.column-sort-btn').forEach((button) => {
    button.onclick = (event) => {
      event.stopPropagation();
      toggleBoardColumnSort(button.dataset.sortStatus);
      rerender();
    };
  });
}

const pendingApprovals = new Map();
const approveBindings = new WeakMap();
const approvalKey = (project, id) => JSON.stringify([project, String(id)]);

async function approveOnce(project, id, move, buttons = [], onSuccess) {
  const key = approvalKey(project, id);
  const pending = pendingApprovals.get(key);
  if (pending) {
    for (const button of buttons) {
      pending.buttons.set(button, approveBindings.get(button));
      button.disabled = true;
    }
    if (onSuccess) pending.onSuccess.add(onSuccess);
    return false;
  }
  const active = {
    buttons: new Map(buttons.map((button) => [button, approveBindings.get(button)])),
    onSuccess: new Set(onSuccess ? [onSuccess] : []),
  };
  pendingApprovals.set(key, active);
  for (const button of active.buttons.keys()) button.disabled = true;
  try {
    const approved = await move(id, 'approved', undefined, { project });
    if (!approved) return false;
    for (const complete of active.onSuccess) complete();
    return true;
  } finally {
    pendingApprovals.delete(key);
    for (const [button, binding] of active.buttons) {
      if (approveBindings.get(button) === binding) button.disabled = false;
    }
  }
}

export function bindApproveAction(
  root,
  { id, project = state.currentProject, move = moveStatus, close = closeDetail } = {},
) {
  const button = root.querySelector('[data-approve]');
  if (!button || id == null) return;
  const binding = {};
  approveBindings.set(button, binding);
  const closeCurrentDetail = () => {
    const currentButton = root.querySelector('[data-approve]');
    if (approveBindings.get(currentButton) === binding) close();
  };
  const pending = pendingApprovals.get(approvalKey(project, id));
  button.disabled = Boolean(pending);
  pending?.buttons.set(button, binding);
  pending?.onSuccess.add(closeCurrentDetail);
  button.onclick = () => approveOnce(project, id, move, [button], closeCurrentDetail);
}

export function bindBoardInteractions(
  board,
  changes,
  { project = state.currentProject, open = openDetail, move = moveStatus } = {},
) {
  // Dragging is reserved for initial approval. Final validation uses explicit
  // detail actions because rejection requires a reason.
  board.querySelectorAll('.card').forEach((el) => {
    el.onclick = () => open(el.dataset.id);
    const c = changes.find((x) => String(x.id) === String(el.dataset.id));
    if (c && c.status === 'draft') {
      el.setAttribute('draggable', 'true');
      el.ondragstart = (e) => {
        e.dataTransfer.setData('text/plain', el.dataset.id);
        e.dataTransfer.effectAllowed = 'move';
      };
    } else {
      el.removeAttribute('draggable');
      el.ondragstart = null;
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
      const c = changes.find((x) => String(x.id) === String(id));
      if (c && c.status === 'draft') {
        approveOnce(project, id, move);
      }
    };
  }
}

// Persist a human-owned lifecycle move, then refresh the board.
export async function moveStatus(
  id,
  status,
  reason,
  {
    project = state.currentProject,
    request = postStatus,
    reload = () => load(),
    onError = showToast,
  } = {},
) {
  const target = captureProjectTarget(project);
  if (!sameProjectTarget(target, captureProjectTarget(state.currentProject))) return false;
  try {
    const res = await request(project, id, status, reason, target.repositoryPath);
    const out = await res.json();
    if ((res.ok || hasProjectProvenance(out)) && !matchesProjectProvenance(out, target))
      return false;
    if (!res.ok) {
      onError(out.error || 'status change failed');
      return false;
    }
  } catch (e) {
    onError(e.message);
    return false;
  }
  if (!sameProjectTarget(target, captureProjectTarget(state.currentProject))) {
    if (state.currentProject === project) return false;
    onError('status changed but project changed before reload');
    return false;
  }
  invalidateCache();
  const reloaded = await reload(project);
  if (!sameProjectTarget(target, captureProjectTarget(state.currentProject))) {
    if (state.currentProject === project) return false;
    onError('status changed but project changed before reload');
    return false;
  }
  if (!reloaded) {
    onError('status changed but reload failed');
    return false;
  }
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

export async function runValidationSubmission({
  root,
  request,
  onSuccess,
  stale = () => false,
  acceptResponse = () => true,
}) {
  if (stale()) return false;
  setValidationPending(root, true);
  showValidationError(root, '');
  try {
    const res = await request();
    if (stale()) return false;
    const out = await res.json();
    if (stale()) return false;
    if ((res.ok || hasProjectProvenance(out)) && !acceptResponse(out)) {
      resetValidationState(root);
      return false;
    }
    if (!res.ok) {
      showValidationError(root, out.error || 'Status change failed.');
      setValidationPending(root, false);
      return false;
    }
  } catch (error) {
    if (stale()) return false;
    showValidationError(root, error.message);
    setValidationPending(root, false);
    return false;
  }
  resetValidationState(root);
  await onSuccess();
  return true;
}

export function reopenPanel(status) {
  if (status !== 'done') return nothing;
  return html`<section class="validation-actions" aria-labelledby="reopen-title">
    <div class="validation-copy">
      <span class="validation-kicker">Lifecycle correction</span>
      <h2 id="reopen-title">Reopen completed change</h2>
      <p>Return this change to active work while preserving why its completion was reconsidered.</p>
    </div>
    <div class="reopen-controls">
      <div class="rejection-field">
        <label for="reopen-reason">Reason for reopening</label>
        <input
          id="reopen-reason"
          data-reopen-reason
          type="text"
          placeholder="What requires more work?"
        />
        <p class="validation-error" role="alert" hidden></p>
      </div>
      <button type="button" class="button button-danger" data-reopen>Reopen change</button>
    </div>
  </section>`;
}

export function bindReopenAction({
  root,
  request,
  onSuccess,
  stale = () => false,
  acceptResponse = () => true,
}) {
  const button = root.querySelector('[data-reopen]');
  if (!button) return;
  button.onclick = async () => {
    const input = root.querySelector('[data-reopen-reason]');
    const reason = input?.value.trim();
    if (!reason) {
      showValidationError(root, 'A reopening reason is required.');
      input?.focus();
      return false;
    }
    return runValidationSubmission({
      root,
      request: () => request(reason),
      onSuccess,
      stale,
      acceptResponse,
    });
  };
}

export function applyDetailPresentation(root = document) {
  const overlay = root.querySelector('#overlay');
  const detail = root.querySelector('#detail');
  if (!overlay || !detail) return;
  overlay.dataset.detailMode = state.detailMode;
  detail.dataset.detailSize = state.detailSize;
}

export function bindDetailPresentation(root = document) {
  root.querySelectorAll('[data-detail-setting]').forEach((button) => {
    button.onclick = () => {
      const setting = button.dataset.detailSetting;
      setDetailPresentation(
        setting === 'mode' ? button.dataset.detailValue : state.detailMode,
        setting === 'size' ? button.dataset.detailValue : state.detailSize,
      );
      applyDetailPresentation(root);
      root.querySelectorAll(`[data-detail-setting="${setting}"]`).forEach((option) => {
        option.setAttribute('aria-pressed', String(option === button));
      });
    };
  });
}

async function submitValidation(id, status, reason, target) {
  const root = $('#detail');
  const stale = () =>
    openedChangeTarget !== target ||
    !sameProjectTarget(target, captureProjectTarget(state.currentProject));
  await runValidationSubmission({
    root,
    request: () => postStatus(target.project, id, status, reason, target.repositoryPath),
    stale,
    acceptResponse: (body) => matchesProjectProvenance(body, target),
    onSuccess: async () => {
      closeDetail();
      invalidateCache();
      await load();
    },
  });
}

export function resetDetailScroll(
  detail,
  schedule = globalThis.requestAnimationFrame?.bind(globalThis),
) {
  const reset = () => {
    detail.scrollTo?.({ top: 0, left: 0, behavior: 'instant' });
    detail.scrollTop = 0;
  };
  reset();
  schedule?.(reset);
}

export function scrollToStage(stage) {
  stage.scrollIntoView({ behavior: 'auto', block: 'start' });
}

function renderOpenedDetail(content) {
  const detail = $('#detail');
  litRender(content, detail);
  resetDetailScroll(detail);
}

function openDetail(id) {
  const c = state.repo.changes.find((x) => String(x.id) === String(id));
  if (!c) return;
  const projectTarget = captureProjectTarget(state.currentProject);
  const detailTarget = Object.freeze({
    ...projectTarget,
    changeId: String(c.id),
    revision: ++gitRefsRequestRevision,
  });
  openedChangeTarget = detailTarget;
  const changes = state.repo.changes || [];
  const outgoing = (c.related_to || []).map((related) => ({ id: related, direction: 'outgoing' }));
  const incoming = changes
    .filter(
      (candidate) =>
        String(candidate.id) !== String(c.id) &&
        (candidate.related_to || []).some((related) => String(related) === String(c.id)),
    )
    .map((candidate) => ({ id: candidate.id, direction: 'incoming' }));
  const stages = c.stages.map((s) => stageBlock(c, s));

  renderOpenedDetail(
    html`
    ${detailToolbar(state.detailMode, state.detailSize, c.stages)}
    <h1>${c.title}</h1>
    <div class="detail-meta">
      <span class="pill">#${c.id}</span>
      <span class="pill" style=${`color:var(--${cssIdent(c.type)})`}>${c.type}</span>
      <span class="pill">${c.status}</span>
      ${c.owner ? html`<span class="pill owner">@${c.owner}</span>` : nothing}
      ${c.branch ? html`<span class="pill branch">⎇ ${c.branch}</span>` : nothing}
      <span class="pill" title=${c.created || ''}>${fmtDateTime(c.created)}</span>
    </div>
    ${referenceDetails('Dependencies', c.depends_on || [], changes, '↓')}
    ${referenceDetails('Related changes', [...outgoing, ...incoming], changes, '↔')}
    ${approvalPanel(c)}
    ${c.status === 'in-validation' ? validationPanel() : nothing}
    ${reopenPanel(c.status)}
    ${stages}
    <div id="git-section"></div>`,
  );

  resetValidationState($('#detail'));

  const overlay = $('#overlay');
  overlay.classList.remove('hidden');
  document.documentElement.classList.add('detail-open');
  applyDetailPresentation();
  bindDetailPresentation();
  $('#detail').querySelector('.close').onclick = closeDetail;
  bindApproveAction($('#detail'), { id: c.id, project: detailTarget.project });
  const accept = $('#detail').querySelector('[data-validation="pass"]');
  if (accept) accept.onclick = () => submitValidation(c.id, 'done', undefined, detailTarget);
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
      submitValidation(c.id, 'in-progress', reason, detailTarget);
    };
  }
  bindReopenAction({
    root: $('#detail'),
    request: (reason) =>
      postStatus(detailTarget.project, c.id, 'in-progress', reason, detailTarget.repositoryPath),
    stale: () =>
      openedChangeTarget !== detailTarget ||
      !sameProjectTarget(detailTarget, captureProjectTarget(state.currentProject)),
    acceptResponse: (body) => matchesProjectProvenance(body, detailTarget),
    onSuccess: async () => {
      invalidateCache();
      await load();
      if (openedChangeTarget !== detailTarget) return;
      openDetail(c.id);
    },
  });
  overlay.onclick = (e) => {
    if (e.target === overlay) closeDetail();
  };
  $('#detail')
    .querySelectorAll('[data-go]')
    .forEach((el) => {
      el.onclick = () => scrollToStage($(`#${el.dataset.go}`));
    });
  $('#detail')
    .querySelectorAll('[data-change]')
    .forEach((el) => {
      el.onclick = () => openDetail(el.dataset.change);
    });
  $('#detail')
    .querySelectorAll('[data-external]')
    .forEach((el) => {
      el.onclick = () => {
        const [proj, changeId] = el.dataset.external.split(':');
        gotoChange(proj, changeId);
      };
    });
  renderExpandableMermaid($('#detail'));
  loadGitRefs(detailTarget);
}

// Fetch and render the git refs (commits/branches) that reference this change.
export async function loadGitRefs(target = openedChangeTarget) {
  if (!target) return;
  const stale = () =>
    target.revision !== gitRefsRequestRevision ||
    openedChangeTarget !== target ||
    !sameProjectTarget(target, captureProjectTarget(state.currentProject));
  let refs;
  try {
    refs = await getGitRefs(target.project, target.changeId, target.repositoryPath);
  } catch {
    return;
  }
  if (stale() || !matchesProjectProvenance(refs, target)) return;
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
  openedChangeTarget = null;
  gitRefsRequestRevision += 1;
  $('#overlay')?.classList.add('hidden');
  document.documentElement?.classList.remove('detail-open');
}

function closeLedgerSpec({ historyMode = 'push' } = {}) {
  const wasOpen = openedSpecName !== null;
  openedSpecName = null;
  closeDetail();
  if (wasOpen && historyMode) writeCurrentLedgerRoute(historyMode);
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

async function paintLedger(root, browser) {
  const q = state.filters.text.toLowerCase();
  const specs = sortSpecsByUpdated(
    (state.repo.specs || []).filter(
      (s) => !q || `${s.title} ${(s.tags || []).join(' ')} ${s.body}`.toLowerCase().includes(q),
    ),
  );
  litRender(ledgerViewHtml(state.ledgerCategory, specs, fmtDateTime, browser.state), root);
  root.querySelectorAll('[data-ledger-category]').forEach((button) => {
    button.onclick = async () => {
      openedSpecName = null;
      setLedgerCategory(button.dataset.ledgerCategory);
      writeCurrentLedgerRoute('push');
      await renderLedger(root, browser);
    };
  });
  root.querySelectorAll('.spec-card').forEach((el) => {
    el.onclick = () => openSpec(specs[Number(el.dataset.i)]);
  });
  root.querySelectorAll('[data-ledger-document]').forEach((button) => {
    button.onclick = () => openLedgerDocument(button.dataset.ledgerDocument, root, browser);
  });
  const tree = root.querySelector('[data-ledger-tree]');
  const back = root.querySelector('[data-ledger-back]');
  if (back && tree) {
    back.onclick = () => {
      tree.focus();
      tree.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  }
  const article = root.querySelector('.ledger-article');
  if (article && browser.state.document?.format === 'markdown') {
    article.onclick = (event) =>
      handleLedgerDocumentLink(
        event,
        browser.state.selectedPath,
        browser.state.documents,
        (path) => void openLedgerDocument(path, root, browser),
      );
    await renderExpandableMermaid(article);
  }
}

/* Ledger view */
export async function renderLedger(root = $('#ledger'), browser = ledgerBrowser) {
  const context = browser.setContext(state.currentProject, state.ledgerCategory);
  await paintLedger(root, browser);
  await context;
  if (
    browser.state.project === state.currentProject &&
    browser.state.category === state.ledgerCategory
  ) {
    await paintLedger(root, browser);
  }
}

export async function openLedgerDocument(
  path,
  root = $('#ledger'),
  browser = ledgerBrowser,
  { historyMode = 'push', restore = false } = {},
) {
  const opening = browser[restore ? 'restore' : 'open'](path);
  if (historyMode && browser.state.selectedPath === path) {
    writeCurrentLedgerRoute(historyMode, path);
  }
  await paintLedger(root, browser);
  const opened = await opening;
  await paintLedger(root, browser);
  return opened;
}

function renderLedgerRouteError(root, message) {
  litRender(html`<p class="ledger-error" role="alert">${message}</p>`, root);
}

async function ensureLedgerProject(project) {
  const match = state.projectsList.find((candidate) => candidate.id === project);
  if (!match) return { ok: false, error: 'Project not found' };
  if (!match.alive) return { ok: false, error: 'Project path is gone' };
  const selector = $('#project');
  if (selector) selector.value = project;
  return (await load())
    ? { ok: true }
    : { ok: false, error: 'Unable to load the requested project' };
}

export async function restoreLedgerRouteSelection(
  route,
  { root = $('#ledger'), browser = ledgerBrowser, ensureProject = ensureLedgerProject } = {},
) {
  setView('ledger');
  state.globalMode = false;
  if (state.currentProject !== route.project) selectProject(route.project);
  setLedgerCategory(route.category);
  openedSpecName = null;
  browser.clearSelection();
  closeDetail();

  const project = await ensureProject(route.project);
  if (!project?.ok) {
    renderLedgerRouteError(root, project?.error || 'Project not found');
    return false;
  }

  await renderLedger(root, browser);
  if (!route.doc) return true;
  if (route.category === 'specs') {
    const spec = (state.repo?.specs ?? []).find((candidate) => candidate.name === route.doc);
    if (!spec) {
      renderLedgerRouteError(root, 'Spec not found');
      return false;
    }
    openSpec(spec, { historyMode: null });
    return true;
  }
  return openLedgerDocument(route.doc, root, browser, { historyMode: null, restore: true });
}

function openSpec(s, { historyMode = 'push' } = {}) {
  openedChangeTarget = null;
  gitRefsRequestRevision += 1;
  openedSpecName = s.name ?? null;
  if (historyMode) writeCurrentLedgerRoute(historyMode, openedSpecName);
  renderOpenedDetail(
    html`
    ${detailToolbar(state.detailMode, state.detailSize)}
    <h1>${s.title}</h1>
    <div class="detail-meta">
      <span class="pill">spec</span>
      <span class="pill" title=${s.updated || ''}>${fmtDateTime(s.updated)}</span>
      ${(s.tags || []).map((t) => html`<span class="pill">${t}</span>`)}
    </div>
    ${specBody(s.body, s.graduated_from, state.repo.changes || [])}`,
  );
  const overlay = $('#overlay');
  overlay.classList.remove('hidden');
  document.documentElement.classList.add('detail-open');
  applyDetailPresentation();
  bindDetailPresentation();
  const detail = $('#detail');
  detail.querySelector('.close').onclick = () => closeLedgerSpec();
  overlay.onclick = (e) => {
    if (e.target === overlay) closeLedgerSpec();
  };
  detail.onclick = (e) => handleSpecBodyClick(e, (href) => openSpecByName(href, state, openSpec));
  detail.querySelectorAll('[data-change]').forEach((el) => {
    el.onclick = () => openChangeById(el.dataset.change);
  });
  detail.querySelectorAll('[data-external]').forEach((el) => {
    el.onclick = () => {
      const [project, changeId] = el.dataset.external.split(':');
      gotoChange(project, changeId);
    };
  });
  renderExpandableMermaid(detail);
}

export function openChangeById(id, repoState = state, _openDetail = openDetail) {
  const found = (repoState.repo?.changes ?? []).find((change) => String(change.id) === String(id));
  if (found) _openDetail(found.id);
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

const VIEWS = ['board', 'table', 'graph', 'ledger', 'metrics', 'projects'];

// The shared metrics module is dynamic-imported once and cached: the client
// computes metrics itself, over the filtered set, instead of duplicating
// `computeMetrics` (20260711-155721 CR2). Served read-only from the CLI's own
// `src/metrics.mjs` by the router.
let sharedMetricsModule;
function loadMetricsModule() {
  sharedMetricsModule ??= import('/shared/metrics.mjs');
  return sharedMetricsModule;
}

// `computeMetrics` speaks the CLI's native change shape (`{ frontmatter,
// stages }`); `state.repo.changes` is already flattened for board/table
// rendering. Adapt back rather than reshaping the shared module's contract,
// which the server also relies on unchanged.
function toMetricsChange(c) {
  return {
    frontmatter: { id: c.id, type: c.type, status: c.status, owner: c.owner, created: c.created },
    stages: c.stages,
  };
}

async function renderMetrics() {
  const changes = visibleChanges();
  const { computeMetrics } = await loadMetricsModule();
  const metrics = computeMetrics(changes.map(toMetricsChange), { now: new Date().toISOString() });
  litRender(metricsHtml(metrics, changes.length), $('#metrics'));
}

export function syncViewerShell(root = document, renderContent = true) {
  renderChangeErrors(state.repo?.change_errors ?? [], root);
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

export function restoreInitialViewerShell(
  root = document,
  getStorage = () => window.localStorage,
  location = null,
) {
  let browserStorage = null;
  try {
    browserStorage = getStorage();
  } catch {
    // Storage access itself may be forbidden (opaque origins/privacy policy).
  }
  restoreViewerState(browserStorage);
  const route = location ? readLedgerRoute(location) : { kind: 'absent' };
  if (route.kind === 'valid') {
    selectProject(route.state.project);
    setView('ledger');
    setLedgerCategory(route.state.category);
    state.globalMode = false;
  } else if (route.kind === 'invalid') {
    setView('ledger');
    state.globalMode = false;
  }
  syncViewerShell(root, false);
  return route;
}

let managedProject = null;
let managedConfig = null;
let configMode = 'form'; // 'form' | 'raw'
let configDirty = false; // true when form/raw has unsaved edits
let migrationPreview = null; // null | { summary, changes, yaml } | { already_current }
let managedConfigRequestRevision = 0;
let managedContextRevision = 0;
let migrationPreviewRequestRevision = 0;

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
  const supported = config.supported;
  const futureSch = schema > supported;
  const outdated = schema < supported;

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
              <p>Config schema ${schema} is outdated. Preview and apply the migration to schema ${supported} to enable the Form editor.</p>
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
      <legend>Git</legend>
      <label>Integration branch
        <input name="integration_branch" .value=${cfg.git?.integration_branch ?? ''} placeholder="Auto-detect" />
      </label>
      <p class="config-note">Change branches start from and merge into this branch. Leave empty to auto-detect.</p>
      <label>Change branch format
        <input name="change_branch_format" .value=${cfg.git?.change_branch_format ?? ''} placeholder="work/{id}" />
      </label>
      <p class="config-note">Optional format for change branches. Use <code>{id}</code> exactly once; <code>{type}</code> is also available.</p>
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

export async function openManagedProject(id, { reload = false } = {}) {
  managedContextRevision += 1;
  managedProject = id;
  configDirty = false;
  const project = state.projectsList.find((item) => item.id === id);
  if (!project?.alive) {
    managedConfig = null;
    migrationPreview = null;
    renderProjects();
    return;
  }
  if (
    !reload &&
    managedConfig?.id === id &&
    managedConfig.repositoryPath === project.path &&
    !managedConfig.error
  ) {
    renderProjects();
    return;
  }
  const target = captureProjectTarget(id);
  const revision = ++managedConfigRequestRevision;
  const stale = () =>
    revision !== managedConfigRequestRevision ||
    !sameProjectTarget(target, captureProjectTarget(managedProject));
  managedConfig = { id, repositoryPath: target.repositoryPath, loading: true };
  migrationPreview = null;
  renderProjects();
  try {
    const structured = await getProjectConfigStructured(id, target.repositoryPath);
    if (stale() || !matchesProjectProvenance(structured, target)) return;
    managedConfig = { id, repositoryPath: target.repositoryPath, ...structured };
    // Default to form for current schema, raw for future schema
    if (structured.schemaVersion > structured.supported) {
      configMode = 'raw';
    } else {
      configMode = 'form';
    }
  } catch (error) {
    if (
      stale() ||
      (hasProjectProvenance(error.payload) && !matchesProjectProvenance(error.payload, target))
    )
      return;
    managedConfig = {
      id,
      repositoryPath: target.repositoryPath,
      content: '',
      revision: '',
      error: error.message,
    };
  }
  renderProjects();
}

export function setProjectFormPending(root, pending) {
  root.querySelectorAll('button, input, textarea').forEach((control) => {
    control.disabled = pending;
  });
  root.classList.toggle('is-pending', pending);
}

export async function projectMutation(
  root,
  request,
  onSuccess,
  { stale = () => false, target = null, errorTarget = target } = {},
) {
  setProjectFormPending(root, true);
  const error = root.querySelector('.project-error');
  if (error) error.hidden = true;
  try {
    const response = await request();
    if (stale()) return false;
    const body = await response.json();
    const receiptTarget = response.ok ? target : errorTarget;
    if (
      stale() ||
      (receiptTarget &&
        (response.ok || hasProjectProvenance(body)) &&
        !matchesProjectProvenance(body, receiptTarget))
    )
      return false;
    if (!response.ok) throw new Error(body.error || 'Project update failed.');
    await onSuccess(body);
    return true;
  } catch (failure) {
    if (stale()) return false;
    if (error) {
      error.textContent = failure.message;
      error.hidden = false;
    } else showToast(failure.message);
    return false;
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

async function refreshProjectRegistry(stale = () => false) {
  const { projects, current, localOnly } = await getProjects();
  if (stale()) return false;
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
  return true;
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
  if (els.integration_branch) {
    const currentBranch = currentConfig.git?.integration_branch ?? '';
    const proposedBranch = els.integration_branch.value.trim();
    if (proposedBranch !== currentBranch) {
      patch.git = { ...patch.git, integration_branch: proposedBranch || null };
    }
  }
  if (els.change_branch_format) {
    const currentFormat = currentConfig.git?.change_branch_format ?? '';
    const proposedFormat = els.change_branch_format.value.trim();
    if (proposedFormat !== currentFormat) {
      patch.git = { ...patch.git, change_branch_format: proposedFormat || null };
    }
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
  const liveTarget = captureProjectTarget(managedProject);
  const configTarget = Object.freeze({
    project: managedProject,
    repositoryPath: managedConfig?.repositoryPath ?? liveTarget.repositoryPath,
  });
  const configSnapshot = managedConfig;
  const captureConfigStale = () => {
    const revision = managedContextRevision;
    return () =>
      revision !== managedContextRevision ||
      !sameProjectTarget(configTarget, captureProjectTarget(managedProject));
  };
  litRender(
    projectsViewTemplate(state.projectsList, managedProject, managedConfig, state.localOnly),
    root,
  );
  bindProjectViewActions(root, {
    select: async (id) => {
      const stale = captureConfigStale();
      if (configDirty) {
        const ok = await showConfirm('You have unsaved changes. Switch project and discard them?');
        if (!ok || stale()) return;
      }
      return openManagedProject(id);
    },
    reload: async () => {
      const stale = captureConfigStale();
      if (configDirty) {
        const ok = await showConfirm('Reload will discard your unsaved changes. Continue?');
        if (!ok || stale()) return;
      }
      return openManagedProject(configTarget.project, { reload: true });
    },
    markDirty: () => {
      managedContextRevision += 1;
      configDirty = true;
    },
    switchMode: async (mode) => {
      const stale = captureConfigStale();
      if (configDirty && mode !== configMode) {
        const ok = await showConfirm('You have unsaved changes. Switch mode and discard them?');
        if (!ok || stale()) return;
      }
      configMode = mode;
      managedContextRevision += 1;
      configDirty = false;
      renderProjects();
    },
    saveRaw: (content, configForm) => {
      const stale = captureConfigStale();
      return projectMutation(
        configForm,
        () =>
          postProjectConfig(
            configTarget.project,
            content,
            configSnapshot.revision,
            configTarget.repositoryPath,
          ),
        async (body) => {
          if (stale()) return;
          const nextConfig = { ...configSnapshot, content, revision: body.revision };
          if (!(await refreshProjectRegistry(stale)) || stale()) return;
          managedContextRevision += 1;
          configDirty = false;
          managedConfig = nextConfig;
          renderProjects();
        },
        { stale, target: configTarget },
      );
    },
    saveForm: (formEl, configForm) => {
      const stale = captureConfigStale();
      return projectMutation(
        configForm,
        () => {
          const patch = collectFormPatch(formEl, configSnapshot.config ?? {});
          return patchProjectConfigApi(
            configTarget.project,
            patch,
            configSnapshot.revision,
            configTarget.repositoryPath,
          );
        },
        async (_body) => {
          if (stale()) return;
          configDirty = false;
          await openManagedProject(configTarget.project, { reload: true });
        },
        { stale, target: configTarget },
      );
    },
    previewMigration: async () => {
      const staleContext = captureConfigStale();
      const revision = ++migrationPreviewRequestRevision;
      const stale = () => staleContext() || revision !== migrationPreviewRequestRevision;
      try {
        const result = await getConfigMigrationPreview(
          configTarget.project,
          configSnapshot.revision,
          configTarget.repositoryPath,
        );
        if (stale() || !matchesProjectProvenance(result, configTarget)) return;
        migrationPreview = result;
      } catch (e) {
        if (
          stale() ||
          (hasProjectProvenance(e.payload) && !matchesProjectProvenance(e.payload, configTarget))
        )
          return;
        migrationPreview = { error: e.message };
      }
      renderProjects();
    },
    applyMigration: async () => {
      const stale = captureConfigStale();
      const ok = await showConfirm(
        'Apply the config migration? This will update .changeledger/config.yml.',
      );
      if (!ok || stale()) return;
      try {
        const body = await postConfigMigrationApply(
          configTarget.project,
          configSnapshot.revision,
          configTarget.repositoryPath,
        );
        if (stale() || !matchesProjectProvenance(body, configTarget)) return;
        await openManagedProject(configTarget.project, { reload: true });
      } catch (e) {
        if (
          stale() ||
          (hasProjectProvenance(e.payload) && !matchesProjectProvenance(e.payload, configTarget))
        )
          return;
        migrationPreview = { error: e.message };
        renderProjects();
      }
    },
    repair: (projectPath, pathForm) => {
      const stale = captureConfigStale();
      const repairedTarget = { project: configTarget.project, repositoryPath: projectPath };
      const revision = managedContextRevision;
      return projectMutation(
        pathForm,
        () => postProjectPath(configTarget.project, projectPath, configTarget.repositoryPath),
        async () => {
          if (!(await refreshProjectRegistry(stale))) return;
          if (
            revision !== managedContextRevision ||
            managedProject !== configTarget.project ||
            !sameProjectTarget(repairedTarget, captureProjectTarget(managedProject))
          )
            return;
          await openManagedProject(configTarget.project, { reload: true });
        },
        { stale, target: repairedTarget, errorTarget: configTarget },
      );
    },
    unregister: async (editor) => {
      const stale = captureConfigStale();
      const revision = managedContextRevision;
      const project = state.projectsList.find((item) => item.id === configTarget.project);
      const answer = await requestUnregisterConfirmation(project);
      if (answer === null || stale()) return;
      return projectMutation(
        editor,
        () => postProjectRemove(configTarget.project, answer, configTarget.repositoryPath),
        async () => {
          if (!(await refreshProjectRegistry(stale))) return;
          if (revision !== managedContextRevision || managedProject !== configTarget.project)
            return;
          managedContextRevision += 1;
          managedProject = null;
          managedConfig = null;
          if (state.currentProject) await load();
          renderProjects();
        },
        { stale, target: configTarget },
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

export function activateView(v, { renderContent = true, historyMode = 'push' } = {}) {
  setView(v);
  openedSpecName = null;
  ledgerBrowser.clearSelection();
  closeDetail();
  if (historyMode && viewerNavigation) {
    if (v === 'ledger') writeCurrentLedgerRoute(historyMode);
    else viewerNavigation.clear(historyMode, v);
  }
  $('#toggle-global').classList.remove('active');
  $('#global').classList.add('hidden');
  for (const name of VIEWS) {
    $(`#view-${name}`).classList.toggle('active', v === name);
    $(`#${name}`).classList.toggle('hidden', v !== name);
  }
  if (renderContent) render();
}

export async function selectViewerProject(nextProject, { loadProject = load } = {}) {
  selectProject(nextProject);
  openedSpecName = null;
  ledgerBrowser.clearSelection();
  const selector = $('#project');
  if (selector) selector.value = nextProject;
  if (state.currentView === 'ledger') writeCurrentLedgerRoute('push');
  return loadProject();
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
export async function restoreViewerLocation(event) {
  const route = viewerNavigation?.read() ?? { kind: 'absent' };
  if (route.kind === 'valid') {
    await restoreLedgerRouteSelection(route.state);
    return;
  }
  const view = event?.state?.view;
  if (VIEWS.includes(view) && view !== 'ledger') {
    activateView(view, { historyMode: null });
  } else if (route.kind === 'invalid') {
    activateView('ledger', { renderContent: false, historyMode: null });
    renderLedgerRouteError($('#ledger'), 'Invalid Ledger URL');
  }
}

function bootstrap() {
  configureViewerNavigation(
    createLedgerNavigation({ location: window.location, history: window.history }),
  );
  const initialRoute = restoreInitialViewerShell(
    document,
    () => window.localStorage,
    window.location,
  );
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
  document.addEventListener('pointerdown', (event) => {
    closeFilterMenusOnOutsideClick(
      ['#type-filter', '#owner-filter', '#status-filter'].map((selector) =>
        $(`${selector} .filter-menu`),
      ),
      event.target,
    );
  });
  $('#view-board').onclick = () => activateView('board');
  $('#view-table').onclick = () => activateView('table');
  $('#view-graph').onclick = () => activateView('graph');
  $('#view-ledger').onclick = () => activateView('ledger');
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
    await selectViewerProject(nextProject);
  };
  document.onkeydown = (e) => {
    if (e.key === 'Escape' && !diagramLightbox.handleKeydown(e)) {
      if (openedSpecName) closeLedgerSpec();
      else closeDetail();
    }
  };

  window.onpopstate = (event) => void restoreViewerLocation(event);
  void loadProjects(initialRoute);
  setInterval(load, 5000);

  // The topbar wraps to multiple rows at content-dependent widths, so the
  // CSS fallback constant cannot bound the projects panels; track the real
  // rendered height instead.
  const topbar = document.querySelector('.topbar');
  if (topbar && typeof ResizeObserver === 'function') {
    const syncHeaderHeight = () =>
      document.documentElement.style.setProperty('--header-height', `${topbar.offsetHeight}px`);
    new ResizeObserver(syncHeaderHeight).observe(topbar);
    syncHeaderHeight();
  }
}

export function closeFilterMenusOnOutsideClick(menus, target) {
  return menus.reduce((closed, menu) => {
    if (!menu?.open || menu.contains(target)) return closed;
    menu.open = false;
    return true;
  }, false);
}

// Only a real browser page with the app shell bootstraps; importing the module
// (for tests) must not touch the DOM or start polling.
if (typeof document !== 'undefined' && document.getElementById('search')) {
  bootstrap();
}
