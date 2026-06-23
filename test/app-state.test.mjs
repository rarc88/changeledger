import assert from 'node:assert/strict';
import { test } from 'node:test';

// Reset module state between tests by re-importing fresh each time.
async function freshState() {
  const url = new URL('../src/viewer/public/app-state.js', import.meta.url).href;
  // bust the module cache with a unique query string
  const mod = await import(`${url}?bust=${Math.random()}`);
  return mod;
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
