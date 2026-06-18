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
  currentView: 'board',
  sortKey: 'id',
  sortDir: 1,
  currentProject: null,
  projectsList: [],
  globalMode: false,
};

export function setRepo(json) {
  state.lastJson = json;
  state.repo = JSON.parse(json);
}

export function invalidateCache() {
  state.lastJson = '';
}

export function setTextFilter(text) {
  state.filters.text = text;
}

export function setTypeFilter(type) {
  state.filters.type = type;
}

export function setOwnerFilter(owner) {
  state.filters.owner = owner;
}

export function toggleStatusFilter(status) {
  if (state.filters.statuses.has(status)) state.filters.statuses.delete(status);
  else state.filters.statuses.add(status);
  return state.filters.statuses.has(status);
}

export function toggleShowArchived() {
  state.filters.showArchived = !state.filters.showArchived;
  return state.filters.showArchived;
}

export function toggleShowDiscarded() {
  state.filters.showDiscarded = !state.filters.showDiscarded;
  return state.filters.showDiscarded;
}

export function setView(v) {
  state.currentView = v;
  state.globalMode = false;
}

export function selectProject(id) {
  state.currentProject = id;
  state.lastJson = '';
  state.filters.type = 'all';
  state.filters.owner = 'all';
  state.filters.statuses.clear();
}

export function setSortKey(key) {
  if (state.sortKey === key) state.sortDir = -state.sortDir;
  else {
    state.sortKey = key;
    state.sortDir = 1;
  }
}

export function toggleGlobalMode() {
  state.globalMode = !state.globalMode;
  return state.globalMode;
}
