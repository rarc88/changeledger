export const VIEWER_STATE_KEY = 'changeledger.viewer-state.v1';

const VALID_VIEWS = new Set(['board', 'table', 'graph', 'specs', 'metrics', 'projects']);
const VALID_SORT_KEYS = new Set(['id', 'title', 'type', 'status', 'progress', 'deps']);
const VALID_DETAIL_MODES = new Set(['side', 'floating']);
const VALID_DETAIL_SIZES = new Set(['compact', 'wide', 'full']);
let storage = null;

const emptyProjectFilters = () => ({
  types: [],
  owners: [],
  includeUnassigned: false,
  statuses: [],
  pendingGraduation: false,
  showArchived: false,
  showDiscarded: false,
});

export const state = {
  repo: null,
  lastJson: '',
  filters: {
    text: '',
    type: 'all',
    owner: 'all',
    types: new Set(),
    owners: new Set(),
    includeUnassigned: false,
    statuses: new Set(),
    pendingGraduation: false,
    showArchived: false,
    showDiscarded: false,
  },
  projectFilters: {},
  currentView: 'board',
  sortKey: 'id',
  sortDir: 1,
  currentProject: null,
  projectsList: [],
  localOnly: false,
  globalMode: false,
  detailMode: 'side',
  detailSize: 'wide',
};

function currentProjectFilters() {
  return {
    types: [...state.filters.types],
    owners: [...state.filters.owners],
    includeUnassigned: state.filters.includeUnassigned,
    statuses: [...state.filters.statuses],
    pendingGraduation: state.filters.pendingGraduation,
    showArchived: state.filters.showArchived,
    showDiscarded: state.filters.showDiscarded,
  };
}

function saveCurrentProjectFilters() {
  if (state.currentProject) state.projectFilters[state.currentProject] = currentProjectFilters();
}

function applyProjectFilters(id) {
  const filters = state.projectFilters[id] ?? emptyProjectFilters();
  state.filters.types = new Set(
    Array.isArray(filters.types)
      ? filters.types.filter((value) => typeof value === 'string')
      : typeof filters.type === 'string' && filters.type !== 'all'
        ? [filters.type]
        : [],
  );
  state.filters.type = state.filters.types.size === 1 ? [...state.filters.types][0] : 'all';
  state.filters.owners = new Set(
    Array.isArray(filters.owners)
      ? filters.owners.filter((value) => typeof value === 'string')
      : typeof filters.owner === 'string' && filters.owner !== 'all'
        ? [filters.owner]
        : [],
  );
  state.filters.owner = state.filters.owners.size === 1 ? [...state.filters.owners][0] : 'all';
  state.filters.includeUnassigned = filters.includeUnassigned === true;
  state.filters.statuses = new Set(
    Array.isArray(filters.statuses)
      ? filters.statuses.filter((value) => typeof value === 'string')
      : [],
  );
  state.filters.pendingGraduation = filters.pendingGraduation === true;
  state.filters.showArchived = filters.showArchived === true;
  state.filters.showDiscarded = filters.showDiscarded === true;
}

export function serializeViewerState() {
  saveCurrentProjectFilters();
  return {
    version: 1,
    currentProject: state.currentProject,
    currentView: state.currentView,
    globalMode: state.globalMode,
    text: state.filters.text,
    sortKey: state.sortKey,
    sortDir: state.sortDir,
    projects: state.projectFilters,
    detailMode: state.detailMode,
    detailSize: state.detailSize,
  };
}

export function persistViewerState() {
  if (!storage) return false;
  try {
    storage.setItem(VIEWER_STATE_KEY, JSON.stringify(serializeViewerState()));
    return true;
  } catch {
    return false;
  }
}

export function restoreViewerState(storageLike) {
  storage = storageLike;
  let snapshot;
  try {
    snapshot = JSON.parse(storage.getItem(VIEWER_STATE_KEY) || 'null');
  } catch {
    return false;
  }
  if (snapshot?.version !== 1 || typeof snapshot !== 'object') return false;
  if (typeof snapshot.currentProject === 'string') state.currentProject = snapshot.currentProject;
  if (typeof snapshot.currentView === 'string') state.currentView = snapshot.currentView;
  state.globalMode = snapshot.globalMode === true;
  if (typeof snapshot.text === 'string') state.filters.text = snapshot.text;
  if (typeof snapshot.sortKey === 'string') state.sortKey = snapshot.sortKey;
  if (snapshot.sortDir === 1 || snapshot.sortDir === -1) state.sortDir = snapshot.sortDir;
  state.detailMode = VALID_DETAIL_MODES.has(snapshot.detailMode) ? snapshot.detailMode : 'side';
  state.detailSize = VALID_DETAIL_SIZES.has(snapshot.detailSize) ? snapshot.detailSize : 'wide';
  if (
    snapshot.projects &&
    typeof snapshot.projects === 'object' &&
    !Array.isArray(snapshot.projects)
  ) {
    state.projectFilters = snapshot.projects;
  }
  if (state.currentProject) applyProjectFilters(state.currentProject);
  return true;
}

export function initializeProjects(projects, serverCurrent) {
  state.projectsList = projects;
  const alive = new Set(projects.filter((project) => project.alive).map((project) => project.id));
  const selected = alive.has(state.currentProject)
    ? state.currentProject
    : alive.has(serverCurrent)
      ? serverCurrent
      : (projects.find((project) => project.alive)?.id ?? null);
  if (selected !== state.currentProject) {
    saveCurrentProjectFilters();
    state.currentProject = selected;
    if (selected) applyProjectFilters(selected);
  }
  if (!selected) state.globalMode = false;
  persistViewerState();
  return selected;
}

export function normalizeRepoState(repo) {
  if (!VALID_VIEWS.has(state.currentView)) state.currentView = 'board';
  if (!VALID_SORT_KEYS.has(state.sortKey)) {
    state.sortKey = 'id';
    state.sortDir = 1;
  }
  if (state.sortDir !== 1 && state.sortDir !== -1) state.sortDir = 1;
  if (!repo.types.includes(state.filters.type)) state.filters.type = 'all';
  state.filters.types = new Set(
    [...state.filters.types].filter((type) => repo.types.includes(type)),
  );
  const owners = new Set(repo.changes.map((change) => change.owner).filter(Boolean));
  if (state.filters.owner !== 'all' && !owners.has(state.filters.owner))
    state.filters.owner = 'all';
  state.filters.owners = new Set([...state.filters.owners].filter((owner) => owners.has(owner)));
  const statuses = new Set(repo.statuses);
  state.filters.statuses = new Set(
    [...state.filters.statuses].filter((status) => statuses.has(status)),
  );
  persistViewerState();
}

export function setRepo(json) {
  state.lastJson = json;
  state.repo = JSON.parse(json);
}

export function invalidateCache() {
  state.lastJson = '';
}

export function setTextFilter(text) {
  state.filters.text = text;
  persistViewerState();
}

export function toggleTypeFilter(type) {
  if (state.filters.types.has(type)) state.filters.types.delete(type);
  else state.filters.types.add(type);
  state.filters.type = state.filters.types.size === 1 ? [...state.filters.types][0] : 'all';
  persistViewerState();
}

export function setTypeFilter(type) {
  state.filters.types = new Set(type === 'all' ? [] : [type]);
  state.filters.type = type;
  persistViewerState();
}

export function toggleOwnerFilter(owner) {
  if (state.filters.owners.has(owner)) state.filters.owners.delete(owner);
  else state.filters.owners.add(owner);
  state.filters.owner = state.filters.owners.size === 1 ? [...state.filters.owners][0] : 'all';
  persistViewerState();
}

export function setOwnerFilter(owner) {
  state.filters.owners = new Set(owner === 'all' ? [] : [owner]);
  state.filters.owner = owner;
  persistViewerState();
}

export function toggleUnassignedOwner() {
  state.filters.includeUnassigned = !state.filters.includeUnassigned;
  persistViewerState();
}

export function clearTypeFilters() {
  state.filters.types.clear();
  persistViewerState();
}

export function clearOwnerFilters() {
  state.filters.owners.clear();
  state.filters.includeUnassigned = false;
  persistViewerState();
}

export function toggleStatusFilter(status) {
  if (state.filters.statuses.has(status)) state.filters.statuses.delete(status);
  else state.filters.statuses.add(status);
  persistViewerState();
  return state.filters.statuses.has(status);
}

export function clearStatusFilters() {
  state.filters.statuses.clear();
  state.filters.pendingGraduation = false;
  state.filters.showArchived = false;
  state.filters.showDiscarded = false;
  persistViewerState();
}

export function togglePendingGraduation() {
  state.filters.pendingGraduation = !state.filters.pendingGraduation;
  persistViewerState();
  return state.filters.pendingGraduation;
}

export function toggleShowArchived() {
  state.filters.showArchived = !state.filters.showArchived;
  persistViewerState();
  return state.filters.showArchived;
}

export function toggleShowDiscarded() {
  state.filters.showDiscarded = !state.filters.showDiscarded;
  persistViewerState();
  return state.filters.showDiscarded;
}

export function setView(view) {
  state.currentView = view;
  state.globalMode = false;
  persistViewerState();
}

export function selectProject(id) {
  saveCurrentProjectFilters();
  state.currentProject = id;
  state.lastJson = '';
  applyProjectFilters(id);
  persistViewerState();
}

export function setSortKey(key) {
  if (state.sortKey === key) state.sortDir = -state.sortDir;
  else {
    state.sortKey = key;
    state.sortDir = 1;
  }
  persistViewerState();
}

export function toggleGlobalMode() {
  state.globalMode = !state.globalMode;
  persistViewerState();
  return state.globalMode;
}

export function setDetailPresentation(mode, size) {
  if (VALID_DETAIL_MODES.has(mode)) state.detailMode = mode;
  if (VALID_DETAIL_SIZES.has(size)) state.detailSize = size;
  persistViewerState();
  return { mode: state.detailMode, size: state.detailSize };
}
