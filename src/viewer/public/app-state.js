export const VIEWER_STATE_KEY = 'changeledger.viewer-state.v1';

const VALID_VIEWS = new Set(['board', 'table', 'graph', 'specs', 'metrics', 'projects']);
const VALID_SORT_KEYS = new Set(['id', 'title', 'type', 'status', 'progress', 'deps']);
let storage = null;

const emptyProjectFilters = () => ({
  type: 'all',
  owner: 'all',
  statuses: [],
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
    statuses: new Set(),
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
};

function currentProjectFilters() {
  return {
    type: state.filters.type,
    owner: state.filters.owner,
    statuses: [...state.filters.statuses],
    showArchived: state.filters.showArchived,
    showDiscarded: state.filters.showDiscarded,
  };
}

function saveCurrentProjectFilters() {
  if (state.currentProject) state.projectFilters[state.currentProject] = currentProjectFilters();
}

function applyProjectFilters(id) {
  const filters = state.projectFilters[id] ?? emptyProjectFilters();
  state.filters.type = typeof filters.type === 'string' ? filters.type : 'all';
  state.filters.owner = typeof filters.owner === 'string' ? filters.owner : 'all';
  state.filters.statuses = new Set(
    Array.isArray(filters.statuses)
      ? filters.statuses.filter((value) => typeof value === 'string')
      : [],
  );
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
  const owners = new Set(repo.changes.map((change) => change.owner).filter(Boolean));
  if (state.filters.owner !== 'all' && !owners.has(state.filters.owner))
    state.filters.owner = 'all';
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

export function setTypeFilter(type) {
  state.filters.type = type;
  persistViewerState();
}

export function setOwnerFilter(owner) {
  state.filters.owner = owner;
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
  state.filters.showArchived = false;
  state.filters.showDiscarded = false;
  persistViewerState();
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
