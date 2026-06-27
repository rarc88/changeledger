import assert from 'node:assert/strict';
import { test } from 'node:test';

// Reset module state between tests by re-importing fresh each time.
async function freshState() {
  const url = new URL('../src/viewer/public/app-state.js', import.meta.url).href;
  // bust the module cache with a unique query string
  const mod = await import(`${url}?bust=${Math.random()}`);
  return mod;
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    value: (key) => values.get(key),
  };
}

test('231428: initial state has correct defaults', async () => {
  const { state } = await freshState();
  assert.equal(state.repo, null);
  assert.equal(state.lastJson, '');
  assert.equal(state.currentView, 'board');
  assert.equal(state.sortKey, 'id');
  assert.equal(state.sortDir, 1);
  assert.equal(state.currentProject, null);
  assert.deepEqual(state.projectsList, []);
  assert.equal(state.globalMode, false);
  assert.equal(state.filters.type, 'all');
  assert.equal(state.filters.owner, 'all');
  assert.equal(state.filters.showArchived, false);
  assert.equal(state.filters.showDiscarded, false);
  assert.equal(state.filters.statuses.size, 0);
});

test('231428: setRepo parses json and caches it', async () => {
  const { state, setRepo } = await freshState();
  const obj = { changes: [], statuses: [] };
  setRepo(JSON.stringify(obj));
  assert.deepEqual(state.repo, obj);
  assert.equal(state.lastJson, JSON.stringify(obj));
});

test('231428: invalidateCache clears lastJson', async () => {
  const { state, setRepo, invalidateCache } = await freshState();
  setRepo(JSON.stringify({}));
  invalidateCache();
  assert.equal(state.lastJson, '');
});

test('231428: selectProject resets filters and clears cache', async () => {
  const { state, setTextFilter, setTypeFilter, setOwnerFilter, selectProject } = await freshState();
  setTextFilter('search');
  setTypeFilter('bug');
  setOwnerFilter('alice');
  state.filters.statuses.add('draft');
  state.lastJson = 'cached';

  selectProject('proj-123');
  assert.equal(state.currentProject, 'proj-123');
  assert.equal(state.lastJson, '');
  assert.equal(state.filters.type, 'all');
  assert.equal(state.filters.owner, 'all');
  assert.equal(state.filters.statuses.size, 0);
});

test('231428: setSortKey toggles direction on same key', async () => {
  const { state, setSortKey } = await freshState();
  assert.equal(state.sortKey, 'id');
  assert.equal(state.sortDir, 1);

  setSortKey('title');
  assert.equal(state.sortKey, 'title');
  assert.equal(state.sortDir, 1);

  setSortKey('title');
  assert.equal(state.sortDir, -1);

  setSortKey('title');
  assert.equal(state.sortDir, 1);
});

test('231428: setSortKey resets direction when key changes', async () => {
  const { state, setSortKey } = await freshState();
  setSortKey('title');
  setSortKey('title'); // dir = -1
  setSortKey('status'); // new key → dir resets to 1
  assert.equal(state.sortKey, 'status');
  assert.equal(state.sortDir, 1);
});

test('231428: toggleStatusFilter adds and removes a status', async () => {
  const { state, toggleStatusFilter } = await freshState();
  const was = toggleStatusFilter('draft');
  assert.equal(was, true);
  assert.ok(state.filters.statuses.has('draft'));

  const now = toggleStatusFilter('draft');
  assert.equal(now, false);
  assert.ok(!state.filters.statuses.has('draft'));
});

test('125850 CR1/CR10: clearStatusFilters empties statuses and visibility toggles', async () => {
  const { state, clearStatusFilters } = await freshState();
  state.filters.statuses.add('draft');
  state.filters.statuses.add('in-validation');
  state.filters.showArchived = true;
  state.filters.showDiscarded = true;
  clearStatusFilters();
  assert.equal(state.filters.statuses.size, 0);
  assert.equal(state.filters.showArchived, false);
  assert.equal(state.filters.showDiscarded, false);
});

test('231428: toggleShowArchived flips and returns new value', async () => {
  const { state, toggleShowArchived } = await freshState();
  assert.equal(toggleShowArchived(), true);
  assert.equal(state.filters.showArchived, true);
  assert.equal(toggleShowArchived(), false);
});

test('231428: toggleShowDiscarded flips and returns new value', async () => {
  const { state, toggleShowDiscarded } = await freshState();
  assert.equal(toggleShowDiscarded(), true);
  assert.equal(state.filters.showDiscarded, true);
  assert.equal(toggleShowDiscarded(), false);
});

test('231428: setView updates currentView and clears globalMode', async () => {
  const { state, setView, toggleGlobalMode } = await freshState();
  toggleGlobalMode();
  assert.equal(state.globalMode, true);
  setView('graph');
  assert.equal(state.currentView, 'graph');
  assert.equal(state.globalMode, false);
});

test('231428: toggleGlobalMode flips and returns new value', async () => {
  const { state, toggleGlobalMode } = await freshState();
  assert.equal(toggleGlobalMode(), true);
  assert.equal(state.globalMode, true);
  assert.equal(toggleGlobalMode(), false);
  assert.equal(state.globalMode, false);
});

test('111219 CR1/CR2/CR8: snapshot round-trip restores complete safe viewer context', async () => {
  const first = await freshState();
  const store = memoryStorage();
  first.restoreViewerState(store);
  first.initializeProjects([{ id: 'alpha', alive: true }], 'alpha');
  first.setTextFilter('release');
  first.setTypeFilter('feature');
  first.setOwnerFilter('ana');
  first.toggleStatusFilter('draft');
  first.toggleShowArchived();
  first.toggleShowDiscarded();
  first.setView('table');
  first.setSortKey('progress');
  first.setSortKey('progress');
  first.toggleGlobalMode();

  const second = await freshState();
  assert.equal(second.restoreViewerState(store), true);
  assert.equal(second.state.currentProject, 'alpha');
  assert.equal(second.state.currentView, 'table');
  assert.equal(second.state.globalMode, true);
  assert.equal(second.state.filters.text, 'release');
  assert.equal(second.state.filters.type, 'feature');
  assert.equal(second.state.filters.owner, 'ana');
  assert.deepEqual([...second.state.filters.statuses], ['draft']);
  assert.equal(second.state.filters.showArchived, true);
  assert.equal(second.state.filters.showDiscarded, true);
  assert.equal(second.state.sortKey, 'progress');
  assert.equal(second.state.sortDir, -1);

  const saved = store.value(second.VIEWER_STATE_KEY);
  assert.ok(!saved.includes('token'));
  assert.ok(!saved.includes('config.yml'));
  assert.ok(!saved.includes('/repos/'));
});

test('111219 CR3: project selection preserves independent filters', async () => {
  const {
    state,
    initializeProjects,
    selectProject,
    setOwnerFilter,
    setTypeFilter,
    toggleShowDiscarded,
  } = await freshState();
  initializeProjects(
    [
      { id: 'alpha', alive: true },
      { id: 'beta', alive: true },
    ],
    'alpha',
  );
  setTypeFilter('feature');
  state.filters.statuses.add('draft');
  selectProject('beta');
  setTypeFilter('bug');
  setOwnerFilter('bob');
  toggleShowDiscarded();

  selectProject('alpha');
  assert.equal(state.filters.type, 'feature');
  assert.deepEqual([...state.filters.statuses], ['draft']);
  assert.equal(state.filters.owner, 'all');
  assert.equal(state.filters.showDiscarded, false);

  selectProject('beta');
  assert.equal(state.filters.type, 'bug');
  assert.equal(state.filters.owner, 'bob');
  assert.equal(state.filters.showDiscarded, true);
});

test('111219 CR4: missing selected project falls back and rewrites snapshot', async () => {
  const mod = await freshState();
  const store = memoryStorage({
    [mod.VIEWER_STATE_KEY]: JSON.stringify({
      version: 1,
      currentProject: 'gone',
      currentView: 'graph',
      projects: {},
    }),
  });
  mod.restoreViewerState(store);
  assert.equal(
    mod.initializeProjects(
      [
        { id: 'gone', alive: false },
        { id: 'alpha', alive: true },
      ],
      'alpha',
    ),
    'alpha',
  );
  assert.equal(JSON.parse(store.value(mod.VIEWER_STATE_KEY)).currentProject, 'alpha');
});

test('111219 CR5: repo normalization drops stale values and keeps valid statuses', async () => {
  const mod = await freshState();
  mod.state.currentView = 'timeline';
  mod.state.sortKey = 'banana';
  mod.state.sortDir = 7;
  mod.state.filters.type = 'removed';
  mod.state.filters.owner = 'former';
  mod.state.filters.statuses = new Set(['draft', 'removed']);
  mod.normalizeRepoState({
    types: ['feature'],
    statuses: ['draft', 'done'],
    changes: [{ owner: 'ana' }],
  });
  assert.equal(mod.state.currentView, 'board');
  assert.equal(mod.state.sortKey, 'id');
  assert.equal(mod.state.sortDir, 1);
  assert.equal(mod.state.filters.type, 'all');
  assert.equal(mod.state.filters.owner, 'all');
  assert.deepEqual([...mod.state.filters.statuses], ['draft']);
});

test('111219 CR6: corrupt, unknown and throwing storage never blocks state', async () => {
  const corrupt = await freshState();
  assert.equal(
    corrupt.restoreViewerState(memoryStorage({ [corrupt.VIEWER_STATE_KEY]: '{' })),
    false,
  );

  const unknown = await freshState();
  assert.equal(
    unknown.restoreViewerState(
      memoryStorage({ [unknown.VIEWER_STATE_KEY]: JSON.stringify({ version: 99 }) }),
    ),
    false,
  );

  const blocked = await freshState();
  const throwing = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('quota');
    },
  };
  assert.equal(blocked.restoreViewerState(throwing), false);
  blocked.setTextFilter('still works');
  assert.equal(blocked.state.filters.text, 'still works');
});

test('111219 CR7: Clear persists empty statuses and disabled visibility', async () => {
  const mod = await freshState();
  const store = memoryStorage();
  mod.restoreViewerState(store);
  mod.initializeProjects([{ id: 'alpha', alive: true }], 'alpha');
  mod.toggleStatusFilter('draft');
  mod.toggleStatusFilter('done');
  mod.toggleShowArchived();
  mod.toggleShowDiscarded();
  mod.clearStatusFilters();

  const saved = JSON.parse(store.value(mod.VIEWER_STATE_KEY));
  assert.deepEqual(saved.projects.alpha.statuses, []);
  assert.equal(saved.projects.alpha.showArchived, false);
  assert.equal(saved.projects.alpha.showDiscarded, false);
});
