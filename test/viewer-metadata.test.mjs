import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { marked } from 'marked';
import { computeMetrics } from '../src/metrics.mjs';

// app.js reads `marked`/`DOMPurify` as globals (the browser loads them from
// /vendor). Provide the real libraries so safeHtml behaves exactly as in the
// browser, then import the module.
const { window } = new JSDOM('<!DOCTYPE html><body></body>');
globalThis.document = window.document;
// api.js reads `window.__CHANGELEDGER_TOKEN__` for authenticated POSTs; only
// exercised by tests that drive a real mutation handler end to end.
globalThis.window = window;
globalThis.marked = marked;
globalThis.DOMPurify = createDOMPurify(window);
const { render } = await import('lit-html');
const {
  boardStatuses,
  applyDetailPresentation,
  bindDetailPresentation,
  bindProjectViewActions,
  card,
  choiceFilterSummary,
  closeFilterMenusOnOutsideClick,
  collectFormPatch,
  createDiagramLightbox,
  cssIdent,
  esc,
  globalSearchTemplate,
  gotoChange,
  isVisible,
  load,
  loadGitRefs,
  moveStatus,
  openChangeById,
  openManagedProject,
  openSpecByName,
  passesTombstones,
  projectMutation,
  projectsViewTemplate,
  replaceProjectRegistry,
  requestUnregisterConfirmation,
  renderExpandableMermaid,
  renderMetrics,
  renderGlobal,
  bindReopenAction,
  reopenPanel,
  renderChoiceFilter,
  renderStatusFilter,
  detailToolbar,
  detailPresentationControls,
  restoreInitialViewerShell,
  resetValidationState,
  scrollToStage,
  selectViewerProject,
  runValidationSubmission,
  setConfirmImpl,
  setPromptImpl,
  showConfirm,
  showNoProjects,
  showPrompt,
  showToast,
  syncReplicaState,
  stageBlock,
  sortIndicator,
  statusTag,
  statusSummary,
  syncViewerShell,
  tableRow,
  taskList,
} = await import('../src/viewer/public/app.js');
const { state: appState } = await import('../src/viewer/public/app-state.js');
const { closeButton, referenceDetails, specBody, validationPanel } = await import(
  '../src/viewer/public/view-parts.js'
);
const { graphSvg, metricsHtml, specsListHtml } = await import(
  '../src/viewer/public/view-renderers.js'
);

// 20260615-175732 — structured metadata (frontmatter, stage headings, tasks,
// config) is untrusted in a cloned repo. The viewer interpolates it into
// innerHTML; sanitizing only the Markdown body left these surfaces open. These
// tests parse the produced HTML in a real DOM and assert no active content and
// no attribute break-out.

const { document } = window;
const parse = (html) => {
  const host = document.createElement('div');
  if (typeof html === 'string') host.innerHTML = html;
  else render(html, host);
  return host;
};
const XSS = '"><img src=x onerror=alert(1)>';
const HOUR = 3600000;

// 20260722-190137 — a slow response for a project the viewer has since
// navigated away from must never overwrite the currently selected project's
// state, and an older revision of the *same* project arriving last must not
// roll the view back either. These tests drive the real `load()`/
// `loadGitRefs`/`openManagedProject` continuations under a controllable
// `fetch`, resolving requests out of order to reproduce the races the
// production audit (20260721-193106) found.

function deferredResponse() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return {
    resolve: (body, { ok = true, status = 200 } = {}) =>
      resolve({
        ok,
        status,
        text: async () => body,
        json: async () => JSON.parse(body),
      }),
    reject: (error) => {
      promise.catch(() => {});
      resolve = null;
      throw error;
    },
    promise,
  };
}

function deferredValue() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

const INDEX_HTML = fs.readFileSync(
  new URL('../src/viewer/public/index.html', import.meta.url),
  'utf8',
);

// Installs the real shell into the shared JSDOM document (app.js queries
// `document` directly) and returns a restorer so later tests in this file
// never see leaked markup.
function installViewerShell() {
  const previous = document.body.innerHTML;
  document.body.innerHTML = INDEX_HTML;
  return () => {
    document.body.innerHTML = previous;
  };
}

function repoPayload({
  project_id,
  repository_path = appState.projectsList.find((project) => project.id === project_id)?.path,
  ledger_revision = 'rev',
  changes = [],
} = {}) {
  return JSON.stringify({
    project_id,
    repository_path,
    ledger_revision,
    language: 'en',
    statuses: ['draft'],
    types: [],
    metrics: {},
    changes,
    specs: [],
  });
}

const viewerChange = (id, title) => ({
  id,
  title,
  type: 'bug',
  status: 'in-validation',
  created: '2026-07-24T00:00:00Z',
  depends_on: [],
  related_to: [],
  stages: [],
  tasks: [],
});

async function withMockedFetch(handler, run) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

test('190137 CR1: a project switched away from discards its late repo response', async () => {
  const restore = installViewerShell();
  try {
    appState.projectsList = [
      { id: 'project-a', name: 'A', path: '/a', alive: true },
      { id: 'project-b', name: 'B', path: '/b', alive: true },
    ];
    appState.currentProject = 'project-a';
    appState.lastJson = '';
    appState.repo = null;
    const responses = { 'project-a': deferredResponse(), 'project-b': deferredResponse() };

    await withMockedFetch(
      (url) => {
        const project = new URL(String(url), 'http://x').searchParams.get('project');
        return responses[project].promise;
      },
      async () => {
        const pendingA = load();
        appState.currentProject = 'project-b';
        const pendingB = load();

        responses['project-b'].resolve(
          repoPayload({ project_id: 'project-b', ledger_revision: 'rev-b' }),
        );
        await pendingB;
        assert.equal(appState.repo.ledger_revision, 'rev-b');

        responses['project-a'].resolve(
          repoPayload({ project_id: 'project-a', ledger_revision: 'rev-a' }),
        );
        await pendingA;
        assert.equal(
          appState.repo.ledger_revision,
          'rev-b',
          'stale project-a response must not apply',
        );
        assert.equal(appState.currentProject, 'project-b');
      },
    );
  } finally {
    restore();
  }
});

test('190137 CR3: within the same project, an older revision arriving last cannot roll back the view', async () => {
  const restore = installViewerShell();
  try {
    appState.projectsList = [{ id: 'project-a', name: 'A', path: '/a', alive: true }];
    appState.currentProject = 'project-a';
    appState.lastJson = '';
    appState.repo = null;
    const first = deferredResponse();
    const second = deferredResponse();
    const queue = [first, second];

    await withMockedFetch(
      () => queue.shift().promise,
      async () => {
        const pendingFirst = load();
        appState.lastJson = 'force-refetch';
        const pendingSecond = load();

        second.resolve(repoPayload({ project_id: 'project-a', ledger_revision: 'rev-new' }));
        await pendingSecond;
        assert.equal(appState.repo.ledger_revision, 'rev-new');

        first.resolve(repoPayload({ project_id: 'project-a', ledger_revision: 'rev-old' }));
        await pendingFirst;
        assert.equal(
          appState.repo.ledger_revision,
          'rev-new',
          'older same-project response must not win',
        );
      },
    );
  } finally {
    restore();
  }
});

test('190137 CR2: a payload declaring a different project_id than the target is discarded', async () => {
  const restore = installViewerShell();
  try {
    appState.projectsList = [{ id: 'project-a', name: 'A', path: '/a', alive: true }];
    appState.currentProject = 'project-a';
    appState.lastJson = '';
    appState.repo = null;

    await withMockedFetch(
      async () => ({
        ok: true,
        status: 200,
        text: async () =>
          repoPayload({ project_id: 'project-b', ledger_revision: 'rev-misrouted' }),
      }),
      async () => {
        await load();
        assert.equal(appState.repo, null, 'a misattributed identity must never be applied');
      },
    );
  } finally {
    restore();
  }
});

test('190137 CR2: a repo payload without a ledger revision is discarded', async () => {
  const restore = installViewerShell();
  try {
    appState.projectsList = [{ id: 'repo-no-revision', name: 'A', path: '/a', alive: true }];
    appState.currentProject = 'repo-no-revision';
    appState.lastJson = '';
    appState.repo = null;

    await withMockedFetch(
      async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            project_id: 'repo-no-revision',
            repository_path: '/a',
            language: 'en',
            statuses: [],
            types: [],
            metrics: {},
            changes: [],
            specs: [],
          }),
      }),
      async () => {
        assert.equal(await load(), false);
        assert.equal(appState.repo, null);
      },
    );
  } finally {
    restore();
  }
});

test('190137 CR4: a repo response from the old path is stale after same-id rebind', async () => {
  const restore = installViewerShell();
  try {
    appState.projectsList = [{ id: 'repo-rebind', name: 'A', path: '/a', alive: true }];
    appState.currentProject = 'repo-rebind';
    appState.repo = null;
    appState.lastJson = '';
    const response = deferredResponse();

    await withMockedFetch(
      () => response.promise,
      async () => {
        const pending = load();
        appState.projectsList = [{ id: 'repo-rebind', name: 'A', path: '/a2', alive: true }];
        response.resolve(
          repoPayload({ project_id: 'repo-rebind', repository_path: '/a', ledger_revision: 'old' }),
        );

        assert.equal(await pending, false);
        assert.equal(appState.repo, null);
      },
    );
  } finally {
    restore();
  }
});

test('190137 CR4: git refs for a change no longer open are discarded', async () => {
  const restore = installViewerShell();
  try {
    appState.projectsList = [
      { id: 'project-a', name: 'A', path: '/a', alive: true },
      { id: 'project-b', name: 'B', path: '/b', alive: true },
    ];
    appState.currentProject = 'project-a';
    appState.repo = JSON.parse(
      repoPayload({
        project_id: 'project-a',
        ledger_revision: 'ledger-a',
        changes: [viewerChange('20260613-120000', 'Alpha change')],
      }),
    );
    const gitRefs = deferredResponse();

    await withMockedFetch(
      () => gitRefs.promise,
      async () => {
        openChangeById('20260613-120000');
        const abandonedSection = document.getElementById('git-section');
        const pending = loadGitRefs('20260613-120000');
        // The detail panel moved on to a different change (or project) while
        // this fetch was in flight; loadGitRefs must not paint into it.
        selectViewerProject('project-b');
        gitRefs.resolve(
          JSON.stringify({
            project_id: 'project-a',
            repository_path: '/a',
            ledger_revision: 'ledger-a',
            commits: [{ sha: 'a'.repeat(40), subject: 'x' }],
            branches: [],
          }),
        );
        await pending;
        assert.ok(document.getElementById('overlay').classList.contains('hidden'));
        assert.equal(abandonedSection.innerHTML, '');
      },
    );
  } finally {
    restore();
  }
});

test('190137 CR2: git refs with a different project identity are discarded', async () => {
  const restore = installViewerShell();
  try {
    appState.projectsList = [{ id: 'git-identity-a', name: 'Alpha', path: '/a', alive: true }];
    appState.currentProject = 'git-identity-a';
    appState.repo = JSON.parse(
      repoPayload({
        project_id: 'git-identity-a',
        ledger_revision: 'ledger-a',
        changes: [viewerChange('20260724-120000', 'Alpha change')],
      }),
    );
    const responses = [
      {
        project_id: 'git-identity-a',
        repository_path: '/a',
        ledger_revision: 'ledger-a',
        commits: [],
        branches: [],
      },
      {
        project_id: 'git-identity-b',
        repository_path: '/b',
        ledger_revision: 'ledger-b',
        commits: [{ sha: 'b'.repeat(40), subject: 'B commit', date: '' }],
        branches: ['b-main'],
      },
    ];

    await withMockedFetch(
      async () => ({ ok: true, status: 200, json: async () => responses.shift() }),
      async () => {
        openChangeById('20260724-120000');
        await Promise.resolve();
        await loadGitRefs('20260724-120000');

        assert.doesNotMatch(document.getElementById('git-section').textContent, /B commit|b-main/);
      },
    );
  } finally {
    restore();
  }
});

test('190137 CR4: Git refs from the old path are stale after same-id rebind', async () => {
  const restore = installViewerShell();
  try {
    const project = 'git-rebind';
    const change = '20260724-120001';
    appState.projectsList = [{ id: project, name: 'A', path: '/a', alive: true }];
    appState.currentProject = project;
    appState.repo = JSON.parse(
      repoPayload({
        project_id: project,
        repository_path: '/a',
        ledger_revision: 'ledger-a',
        changes: [viewerChange(change, 'Alpha change')],
      }),
    );
    const refs = deferredResponse();

    await withMockedFetch(
      () => refs.promise,
      async () => {
        openChangeById(change);
        const pending = loadGitRefs(change);
        appState.projectsList = [{ id: project, name: 'A', path: '/a2', alive: true }];
        refs.resolve(
          JSON.stringify({
            project_id: project,
            repository_path: '/a',
            ledger_revision: 'ledger-a',
            commits: [{ sha: 'a'.repeat(40), subject: 'OLD PATH COMMIT', date: '' }],
            branches: [],
          }),
        );
        await pending;

        assert.doesNotMatch(document.getElementById('git-section')?.textContent ?? '', /OLD PATH/);
      },
    );
  } finally {
    restore();
  }
});

test('190137 CR3: an older same-detail Git response cannot replace a newer one', async () => {
  const restore = installViewerShell();
  try {
    const project = 'git-latest-a';
    const changeId = '20260724-120001';
    appState.projectsList = [{ id: project, name: 'Alpha', path: '/a', alive: true }];
    appState.currentProject = project;
    appState.repo = JSON.parse(
      repoPayload({
        project_id: project,
        ledger_revision: 'ledger-a',
        changes: [viewerChange(changeId, 'A')],
      }),
    );
    const older = deferredResponse();
    const newer = deferredResponse();
    let request = 0;
    const receipt = (subject) => ({
      project_id: project,
      repository_path: '/a',
      ledger_revision: 'ledger-a',
      commits: [{ sha: (subject === 'OLD' ? 'a' : 'b').repeat(40), subject, date: '' }],
      branches: [],
    });

    await withMockedFetch(
      async () => {
        request += 1;
        if (request === 1)
          return { ok: true, status: 200, json: async () => ({ ...receipt(''), commits: [] }) };
        return request === 2 ? older.promise : newer.promise;
      },
      async () => {
        openChangeById(changeId);
        await Promise.resolve();
        const pendingOlder = loadGitRefs(changeId);
        const pendingNewer = loadGitRefs(changeId);
        newer.resolve(JSON.stringify(receipt('NEW')));
        await pendingNewer;
        older.resolve(JSON.stringify(receipt('OLD')));
        await pendingOlder;

        assert.match(document.getElementById('git-section').textContent, /NEW/);
        assert.doesNotMatch(document.getElementById('git-section').textContent, /OLD/);
      },
    );
  } finally {
    restore();
  }
});

test('190137 CR4: a managed project switched away from discards its late config response', async () => {
  const restore = installViewerShell();
  try {
    appState.projectsList = [
      { id: 'project-a', name: 'A', path: '/a', alive: true },
      { id: 'project-b', name: 'B', path: '/b', alive: true },
    ];
    const responses = { 'project-a': deferredResponse(), 'project-b': deferredResponse() };

    await withMockedFetch(
      (url) => {
        const project = new URL(String(url), 'http://x').searchParams.get('project');
        return responses[project].promise;
      },
      async () => {
        const pendingA = openManagedProject('project-a');
        const pendingB = openManagedProject('project-b');

        // schemaVersion === supported keeps the default form mode (the
        // module-level configMode toggle would otherwise leak into later
        // tests in this file), rendering project_id as plain readonly text.
        responses['project-b'].resolve(
          JSON.stringify({
            project_id: 'project-b',
            repository_path: '/b',
            ledger_revision: 'ledger-b',
            content: 'project_id: project-b',
            revision: 'rev-b',
            config_revision: 'rev-b',
            schemaVersion: 2,
            supported: 2,
            config: { project_id: 'project-b' },
          }),
        );
        await pendingB;

        responses['project-a'].resolve(
          JSON.stringify({
            project_id: 'project-a',
            repository_path: '/a',
            ledger_revision: 'ledger-a',
            content: 'project_id: project-a',
            revision: 'rev-a',
            config_revision: 'rev-a',
            schemaVersion: 2,
            supported: 2,
            config: { project_id: 'project-a' },
          }),
        );
        await pendingA;

        const projectsView = document.getElementById('projects');
        assert.match(
          projectsView.querySelector('.config-readonly-value.mono')?.textContent ?? '',
          /project-b/,
        );
      },
    );
  } finally {
    restore();
  }
});

test('190137 CR4: a config response from the old path is stale after same-id rebind', async () => {
  const restore = installViewerShell();
  try {
    const project = 'config-rebind';
    appState.projectsList = [{ id: project, name: 'A', path: '/old', alive: true }];
    const structured = deferredResponse();

    await withMockedFetch(
      () => structured.promise,
      async () => {
        const pending = openManagedProject(project, { reload: true });
        appState.projectsList = [{ id: project, name: 'A', path: '/new', alive: true }];
        structured.resolve(
          JSON.stringify({
            project_id: project,
            repository_path: '/old',
            ledger_revision: 'ledger-old',
            config_revision: 'config-old',
            content: 'project_name: OLD PATH CONFIG',
            schemaVersion: 2,
            supported: 2,
            config: { project_id: project, project_name: 'OLD PATH CONFIG' },
          }),
        );
        await pending;

        assert.doesNotMatch(document.getElementById('projects').textContent, /OLD PATH CONFIG/);
      },
    );
  } finally {
    restore();
  }
});

test("190137 CR4: a raw config save for an abandoned project cannot corrupt the next project's revision", async () => {
  const restore = installViewerShell();
  try {
    appState.projectsList = [
      { id: 'project-a', name: 'A', path: '/a', alive: true },
      { id: 'project-b', name: 'B', path: '/b', alive: true },
    ];
    const structuredA = deferredResponse();
    const structuredB = deferredResponse();
    const saveA = deferredResponse();
    const sentSaveBodies = [];

    await withMockedFetch(
      (url, init = {}) => {
        const parsed = new URL(String(url), 'http://x');
        if (parsed.pathname === '/api/projects') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              projects: appState.projectsList,
              current: null,
              localOnly: false,
            }),
          });
        }
        if ((init.method ?? 'GET') === 'POST' && parsed.pathname === '/api/project-config') {
          sentSaveBodies.push(JSON.parse(init.body));
          return saveA.promise;
        }
        if ((init.method ?? 'GET') === 'POST' && parsed.pathname === '/api/project-config-patch') {
          sentSaveBodies.push(JSON.parse(init.body));
          return new Promise(() => {}); // B's own save response is irrelevant here
        }
        const project = parsed.searchParams.get('project');
        if (project === 'project-a') return structuredA.promise;
        if (project === 'project-b') return structuredB.promise;
        throw new Error(`unexpected fetch ${url}`);
      },
      async () => {
        const openA = openManagedProject('project-a');
        structuredA.resolve(
          JSON.stringify({
            project_id: 'project-a',
            repository_path: '/a',
            ledger_revision: 'ledger-a',
            content: 'project_id: project-a',
            revision: 'rev-a',
            config_revision: 'rev-a',
            schemaVersion: 2,
            supported: 2,
            config: { project_id: 'project-a' },
          }),
        );
        await openA;

        const root = document.getElementById('projects');
        root.querySelector('[data-config-mode="raw"]').click();
        const rawForm = root.querySelector('.config-form:not([data-config-form])');
        rawForm.querySelector('textarea').value = 'project_id: project-a\nedited: true';
        rawForm.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

        // Selection moves on to project-b — and its own config finishes
        // loading — while A's raw save is still in flight. Resolving B here
        // (rather than leaving it stuck loading) also resets the shared
        // `configMode` toggle back to 'form' for later tests in this file.
        const openB = openManagedProject('project-b');
        structuredB.resolve(
          JSON.stringify({
            project_id: 'project-b',
            repository_path: '/b',
            ledger_revision: 'ledger-b',
            content: 'project_id: project-b',
            revision: 'rev-b',
            config_revision: 'rev-b',
            schemaVersion: 2,
            supported: 2,
            config: { project_id: 'project-b' },
          }),
        );
        await openB;

        saveA.resolve(
          JSON.stringify({
            project_id: 'project-a',
            repository_path: '/a',
            config_revision: 'rev-a-2',
            ledger_revision: 'rev-a-2',
            ledger_freshness: 'local',
          }),
        );
        for (let i = 0; i < 50 && rawForm.classList.contains('is-pending'); i++) {
          await Promise.resolve();
        }

        // A save for B, right after the abandoned A save landed, must still
        // use B's own real revision — never one leaked in from A's stale
        // receipt (the concrete consequence of the CR4 corruption). B is
        // still in its default form mode, so this submits through the form
        // editor rather than switching tabs (which would otherwise leak the
        // shared `configMode` toggle into later tests in this file).
        root
          .querySelector('[data-config-form]')
          .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

        assert.equal(sentSaveBodies.length, 2);
        assert.equal(sentSaveBodies[1].config_revision, 'rev-b');
      },
    );
  } finally {
    restore();
  }
});

// 20260722-190137 validation correction — the replica #sync-state handler
// captured the write target but reloaded/toasted against whatever project was
// selected after the await (A's result surfaced under B), the success toast
// inherited showToast's 'error' default and passed a boolean where an options
// object is expected, and the message was Spanish amid an English UI. These
// tests drive the extracted `syncReplicaState` continuation under a controlled
// fetch and assert target affinity plus correctly-typed, attributed toasts.

function toastContainer() {
  return document.getElementById('toast-container');
}

test('190137 correction CR4: a replica sync started on A shows nothing under B', async () => {
  const restore = installViewerShell();
  try {
    appState.projectsList = [
      { id: 'project-a', name: 'A', path: '/a', alive: true },
      { id: 'project-b', name: 'B', path: '/b', alive: true },
    ];
    appState.currentProject = 'project-a';
    const sync = deferredResponse();
    let repoLoaded = false;

    await withMockedFetch(
      (url) => {
        const parsed = new URL(String(url), 'http://x');
        if (parsed.pathname === '/api/state-sync') return sync.promise;
        if (parsed.pathname === '/api/repo') {
          repoLoaded = true;
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => repoPayload({ project_id: 'project-a', ledger_revision: 'rev-a' }),
          });
        }
        throw new Error(`unexpected fetch ${url}`);
      },
      async () => {
        const pending = syncReplicaState('project-a');
        appState.currentProject = 'project-b';
        sync.resolve(
          JSON.stringify({
            ok: true,
            project_id: 'project-a',
            repository_path: '/a',
            ledger_revision: 'rev-a',
          }),
        );
        await pending;

        assert.equal(repoLoaded, false, 'the abandoned sync target must not reload');
        assert.equal(
          toastContainer().children.length,
          0,
          'no success toast may be attributed to the newly selected project',
        );
      },
    );
  } finally {
    restore();
  }
});

test('190137 correction CR4: a replica sync that stays on its project reloads and reports success as non-error', async () => {
  const restore = installViewerShell();
  try {
    appState.projectsList = [{ id: 'project-a', name: 'Alpha', path: '/a', alive: true }];
    appState.currentProject = 'project-a';
    appState.lastJson = '';
    appState.repo = null;

    await withMockedFetch(
      (url) => {
        const parsed = new URL(String(url), 'http://x');
        if (parsed.pathname === '/api/state-sync') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              project_id: 'project-a',
              repository_path: '/a',
              ledger_revision: 'rev-sync-receipt',
            }),
          });
        }
        if (parsed.pathname === '/api/repo') {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () =>
              repoPayload({ project_id: 'project-a', ledger_revision: 'rev-synced' }),
          });
        }
        throw new Error(`unexpected fetch ${url}`);
      },
      async () => {
        await syncReplicaState('project-a');

        assert.equal(appState.repo.ledger_revision, 'rev-synced', 'the synced project reloads');
        const toast = toastContainer().querySelector('.toast');
        assert.ok(toast, 'a success toast is shown');
        assert.equal(
          toast.classList.contains('toast-error'),
          false,
          'a success is not rendered as an error',
        );
        assert.match(toast.textContent, /Alpha/, 'the toast names the synced project');
      },
    );
  } finally {
    restore();
  }
});

test('190137 correction CR4: a failed replica sync reports the error attributed to its project', async () => {
  const restore = installViewerShell();
  try {
    appState.projectsList = [{ id: 'project-a', name: 'Alpha', path: '/a', alive: true }];
    appState.currentProject = 'project-a';

    await withMockedFetch(
      (url) => {
        const parsed = new URL(String(url), 'http://x');
        if (parsed.pathname === '/api/state-sync') {
          return Promise.resolve({
            ok: false,
            status: 409,
            json: async () => ({ error: 'replica is behind' }),
          });
        }
        throw new Error(`unexpected fetch ${url}`);
      },
      async () => {
        await syncReplicaState('project-a');

        const toast = toastContainer().querySelector('.toast');
        assert.ok(toast, 'a failure toast is shown');
        assert.ok(toast.classList.contains('toast-error'), 'a failure is rendered as an error');
        assert.match(toast.textContent, /Alpha/, 'the failure names its project');
        assert.match(toast.textContent, /replica is behind/, 'the server error is preserved');
      },
    );
  } finally {
    restore();
  }
});

test('190137 CR4: a mutation success from the old path cannot reload a rebound project', async () => {
  const restore = installViewerShell();
  try {
    const project = 'mutation-rebind';
    appState.projectsList = [{ id: project, name: 'Alpha', path: '/a', alive: true }];
    appState.currentProject = project;
    appState.repo = JSON.parse(
      repoPayload({ project_id: project, repository_path: '/a', ledger_revision: 'ledger-a' }),
    );
    const status = deferredResponse();
    let repoLoads = 0;

    await withMockedFetch(
      (url) => {
        const parsed = new URL(String(url), 'http://x');
        if (parsed.pathname === '/api/status') return status.promise;
        if (parsed.pathname === '/api/repo') {
          repoLoads += 1;
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () =>
              repoPayload({
                project_id: project,
                repository_path: '/a2',
                ledger_revision: 'ledger-a2',
              }),
          });
        }
        throw new Error(`unexpected fetch ${url}`);
      },
      async () => {
        const pending = moveStatus(
          { project, ledger_revision: 'ledger-a' },
          '20260724-120002',
          'approved',
        );
        appState.projectsList = [{ id: project, name: 'Alpha', path: '/a2', alive: true }];
        status.resolve(
          JSON.stringify({
            project_id: project,
            repository_path: '/a',
            ledger_revision: 'ledger-written-a',
          }),
        );
        await pending;

        assert.equal(repoLoads, 0);
      },
    );
  } finally {
    restore();
  }
});

test('190137 CR4: an error from the old path is silent after same-id rebind', async () => {
  const restore = installViewerShell();
  try {
    const project = 'error-rebind';
    appState.projectsList = [{ id: project, name: 'Alpha', path: '/a', alive: true }];
    appState.currentProject = project;
    const sync = deferredResponse();

    await withMockedFetch(
      () => sync.promise,
      async () => {
        const pending = syncReplicaState(project);
        appState.projectsList = [{ id: project, name: 'Alpha', path: '/a2', alive: true }];
        sync.resolve(JSON.stringify({ error: 'old path failed' }), { ok: false, status: 409 });
        await pending;

        assert.equal(toastContainer().children.length, 0);
      },
    );
  } finally {
    restore();
  }
});

// 20260722-190137 validation correction (external audit) — syncReplicaState
// re-checked affinity after the POST but not after the reload it awaits, so A's
// success toast surfaced while B was selected. The affinity token must be
// re-checked at *every* async boundary of the handler (post-POST, post-reload,
// and the error path). Unique project ids per test because the affinity lane's
// sequence is module state that persists across tests.

test('190137 correction CR4: a replica sync switched away during its reload shows nothing under B', async () => {
  const restore = installViewerShell();
  try {
    appState.projectsList = [
      { id: 'sync-load-a', name: 'Alpha', path: '/a', alive: true },
      { id: 'sync-load-b', name: 'Beta', path: '/b', alive: true },
    ];
    appState.currentProject = 'sync-load-a';
    appState.repo = null;
    appState.lastJson = '';

    await withMockedFetch(
      (url) => {
        const parsed = new URL(String(url), 'http://x');
        if (parsed.pathname === '/api/state-sync') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              project_id: 'sync-load-a',
              repository_path: '/a',
              ledger_revision: 'rev-a',
            }),
          });
        }
        if (parsed.pathname === '/api/repo') {
          // The reload for A is now in flight; the user selects B before it
          // returns. A's payload must neither render nor toast under B.
          appState.currentProject = 'sync-load-b';
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => repoPayload({ project_id: 'sync-load-a', ledger_revision: 'rev-a' }),
          });
        }
        throw new Error(`unexpected fetch ${url}`);
      },
      async () => {
        await syncReplicaState('sync-load-a');

        assert.equal(appState.repo, null, "A's late reload must not overwrite the view");
        assert.equal(
          toastContainer().children.length,
          0,
          'no success toast may surface under the newly selected project',
        );
      },
    );
  } finally {
    restore();
  }
});

test('190137 correction CR4: a replica sync that fails after the user leaves shows no error under B', async () => {
  const restore = installViewerShell();
  try {
    appState.projectsList = [
      { id: 'sync-err-a', name: 'Alpha', path: '/a', alive: true },
      { id: 'sync-err-b', name: 'Beta', path: '/b', alive: true },
    ];
    appState.currentProject = 'sync-err-a';

    await withMockedFetch(
      (url) => {
        const parsed = new URL(String(url), 'http://x');
        if (parsed.pathname === '/api/state-sync') {
          // The user switches to B before the failing sync for A resolves.
          appState.currentProject = 'sync-err-b';
          return Promise.resolve({
            ok: false,
            status: 409,
            json: async () => ({ error: 'replica is behind' }),
          });
        }
        throw new Error(`unexpected fetch ${url}`);
      },
      async () => {
        await syncReplicaState('sync-err-a');

        assert.equal(
          toastContainer().children.length,
          0,
          "an abandoned sync's failure must not be attributed to another project",
        );
      },
    );
  } finally {
    restore();
  }
});

test('190137 correction CR3: an older same-project config response cannot overwrite a newer one', async () => {
  const restore = installViewerShell();
  try {
    appState.projectsList = [{ id: 'project-a', name: 'A', path: '/a', alive: true }];
    const older = deferredResponse();
    const newer = deferredResponse();
    const queue = [older, newer];
    const structured = (project_name) =>
      JSON.stringify({
        project_id: 'project-a',
        repository_path: '/a',
        ledger_revision: 'ledger-a',
        content: `project_name: ${project_name}`,
        revision: 'rev',
        config_revision: 'rev',
        schemaVersion: 2,
        supported: 2,
        config: { project_id: 'project-a', project_name },
      });

    await withMockedFetch(
      () => queue.shift().promise,
      async () => {
        const pendingOlder = openManagedProject('project-a', { reload: true });
        const pendingNewer = openManagedProject('project-a', { reload: true });

        newer.resolve(structured('A-new'));
        await pendingNewer;
        const projectsView = document.getElementById('projects');
        assert.equal(
          projectsView.querySelector('input[name="project_name"]')?.value,
          'A-new',
          'the newest same-project response is applied',
        );

        older.resolve(structured('A-old'));
        await pendingOlder;
        assert.equal(
          projectsView.querySelector('input[name="project_name"]')?.value,
          'A-new',
          'a stale same-project response must not roll the config back',
        );
      },
    );
  } finally {
    restore();
  }
});

test('190137 correction CR3: re-selecting a project mid-load does not strand the pending response', async () => {
  const restore = installViewerShell();
  try {
    appState.projectsList = [{ id: 'project-strand', name: 'A', path: '/a', alive: true }];
    const only = deferredResponse();
    let fetches = 0;
    const structured = JSON.stringify({
      project_id: 'project-strand',
      repository_path: '/a',
      ledger_revision: 'ledger-strand',
      content: 'project_name: A-loaded',
      revision: 'rev',
      config_revision: 'rev',
      schemaVersion: 2,
      supported: 2,
      config: { project_id: 'project-strand', project_name: 'A-loaded' },
    });

    await withMockedFetch(
      () => {
        fetches += 1;
        return only.promise;
      },
      async () => {
        const pending = openManagedProject('project-strand');
        // Second click on the same project while the first fetch is in flight:
        // it must not invalidate the pending request's sequence.
        await openManagedProject('project-strand');

        only.resolve(structured);
        await pending;
        const projectsView = document.getElementById('projects');
        assert.equal(fetches, 1, 'the repeat selection reuses the in-flight request');
        assert.equal(
          projectsView.querySelector('input[name="project_name"]')?.value,
          'A-loaded',
          'the pending response still renders instead of leaving the panel stuck loading',
        );
      },
    );
  } finally {
    restore();
  }
});

test('190137 correction CR4: a late validation error cannot paint into another project detail', async () => {
  const restore = installViewerShell();
  try {
    appState.projectsList = [
      { id: 'validation-a', name: 'Alpha', path: '/a', alive: true },
      { id: 'validation-b', name: 'Beta', path: '/b', alive: true },
    ];
    appState.currentProject = 'validation-a';
    appState.lastJson = '';
    const validation = deferredResponse();

    await withMockedFetch(
      (url, init = {}) => {
        const parsed = new URL(String(url), 'http://x');
        if ((init.method ?? 'GET') === 'POST' && parsed.pathname === '/api/status') {
          return validation.promise;
        }
        const project = parsed.searchParams.get('project');
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () =>
            repoPayload({
              project_id: project,
              ledger_revision: `rev-${project}`,
              changes: [viewerChange('shared', project === 'validation-a' ? 'Alpha' : 'Beta')],
            }),
        });
      },
      async () => {
        await load();
        openChangeById('shared');
        const pending = document.querySelector('[data-validation="pass"]').onclick();

        appState.currentProject = 'validation-b';
        await load();
        openChangeById('shared');
        validation.resolve(JSON.stringify({ error: 'Alpha validation failed' }), {
          ok: false,
          status: 409,
        });
        await pending;

        assert.equal(document.querySelector('#detail h1')?.textContent, 'Beta');
        assert.doesNotMatch(
          document.querySelector('#detail .validation-error')?.textContent ?? '',
          /Alpha validation failed/,
        );
      },
    );
  } finally {
    restore();
  }
});

test('190137 CR4: opening a spec invalidates a pending change validation', async () => {
  const restore = installViewerShell();
  try {
    const project = 'detail-spec';
    const change = '20260724-120004';
    appState.projectsList = [{ id: project, name: 'Detail', path: '/detail', alive: true }];
    appState.currentProject = project;
    appState.repo = JSON.parse(
      repoPayload({
        project_id: project,
        repository_path: '/detail',
        ledger_revision: 'ledger-detail',
        changes: [viewerChange(change, 'Change detail')],
      }),
    );
    appState.repo.specs = [
      {
        name: 'target.md',
        title: 'Specification target',
        updated: '',
        tags: [],
        body: 'Spec body',
      },
    ];
    const validation = deferredResponse();

    await withMockedFetch(
      (url, init = {}) => {
        const parsed = new URL(String(url), 'http://x');
        if ((init.method ?? 'GET') === 'POST' && parsed.pathname === '/api/status') {
          return validation.promise;
        }
        if (parsed.pathname === '/api/git') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              project_id: project,
              repository_path: '/detail',
              ledger_revision: 'ledger-detail',
              commits: [],
              branches: [],
            }),
          });
        }
        if (parsed.pathname === '/api/repo') {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => JSON.stringify(appState.repo),
          });
        }
        throw new Error(`unexpected fetch ${url}`);
      },
      async () => {
        openChangeById(change);
        const pending = document.querySelector('[data-validation="pass"]').onclick();
        openSpecByName('target.md');

        validation.resolve(
          JSON.stringify({
            project_id: project,
            repository_path: '/detail',
            ledger_revision: 'ledger-after-validation',
          }),
        );
        await pending;

        assert.equal(document.querySelector('#detail h1')?.textContent, 'Specification target');
        assert.equal(document.getElementById('overlay').classList.contains('hidden'), false);
      },
    );
  } finally {
    restore();
  }
});

test('190137 correction CR3: an older migration preview cannot replace a newer result', async () => {
  const restore = installViewerShell();
  try {
    const project = 'preview-latest';
    appState.projectsList = [{ id: project, name: 'Preview', path: '/preview', alive: true }];
    const older = deferredResponse();
    const newer = deferredResponse();
    const previews = [older, newer];

    await withMockedFetch(
      (url) => {
        const parsed = new URL(String(url), 'http://x');
        if (parsed.pathname === '/api/project-config-migrate-preview') {
          return previews.shift().promise;
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            project_id: project,
            repository_path: '/preview',
            content: `project_id: ${project}`,
            revision: 'ledger-preview',
            ledger_revision: 'ledger-preview',
            config_revision: 'config-preview',
            schemaVersion: 0,
            supported: 1,
            config: { project_id: project },
          }),
        });
      },
      async () => {
        await openManagedProject(project, { reload: true });
        const button = document.querySelector('[data-preview-migration]');
        const pendingOlder = button.onclick();
        const pendingNewer = button.onclick();

        newer.resolve(
          JSON.stringify({
            project_id: project,
            repository_path: '/preview',
            summary: 'New preview',
            ledger_revision: 'ledger-preview',
            config_revision: 'config-preview',
            changes: [],
            yaml: 'new: true',
          }),
        );
        await pendingNewer;
        older.resolve(
          JSON.stringify({
            project_id: project,
            repository_path: '/preview',
            summary: 'Old preview',
            ledger_revision: 'ledger-preview',
            config_revision: 'config-preview',
            changes: [],
            yaml: 'old: true',
          }),
        );
        await pendingOlder;

        assert.equal(
          document.querySelector('.config-migration-summary')?.textContent,
          'New preview',
        );
      },
    );
  } finally {
    restore();
  }
});

test('190137 correction CR4: gotoChange cannot open a replacement project after await load', async () => {
  const restore = installViewerShell();
  try {
    appState.projectsList = [
      { id: 'goto-a', name: 'A', path: '/a', alive: true },
      { id: 'goto-b', name: 'B', path: '/b', alive: true },
      { id: 'goto-c', name: 'C', path: '/c', alive: true },
    ];
    appState.currentProject = 'goto-a';
    appState.lastJson = '';
    const responses = { 'goto-b': deferredResponse(), 'goto-c': deferredResponse() };

    await withMockedFetch(
      (url) => responses[new URL(String(url), 'http://x').searchParams.get('project')].promise,
      async () => {
        const navigation = gotoChange('goto-b', 'shared');
        appState.currentProject = 'goto-c';
        const replacement = load();
        responses['goto-c'].resolve(
          repoPayload({
            project_id: 'goto-c',
            ledger_revision: 'rev-c',
            changes: [viewerChange('shared', 'Charlie')],
          }),
        );
        await replacement;
        responses['goto-b'].resolve(
          repoPayload({
            project_id: 'goto-b',
            ledger_revision: 'rev-b',
            changes: [viewerChange('shared', 'Bravo')],
          }),
        );
        await navigation;

        assert.equal(appState.currentProject, 'goto-c');
        assert.ok(document.getElementById('overlay').classList.contains('hidden'));
      },
    );
  } finally {
    restore();
  }
});

test('190137 CR1: gotoChange does not open the previous repo after its target load fails', async () => {
  const restore = installViewerShell();
  try {
    appState.projectsList = [
      { id: 'goto-fail-a', name: 'A', path: '/a', alive: true },
      { id: 'goto-fail-b', name: 'B', path: '/b', alive: true },
    ];
    appState.currentProject = 'goto-fail-a';
    appState.repo = JSON.parse(
      repoPayload({
        project_id: 'goto-fail-a',
        ledger_revision: 'ledger-a',
        changes: [viewerChange('shared', 'ALPHA STALE')],
      }),
    );
    appState.lastJson = JSON.stringify(appState.repo);

    let repoFetches = 0;
    await withMockedFetch(
      async (url) => {
        const pathname = new URL(String(url), 'http://x').pathname;
        if (pathname === '/api/git') {
          return { ok: false, status: 500, json: async () => ({ error: 'unexpected detail' }) };
        }
        repoFetches += 1;
        if (repoFetches === 1) return { ok: false, status: 500, text: async () => '' };
        return {
          ok: true,
          status: 200,
          text: async () =>
            repoPayload({
              project_id: 'goto-fail-b',
              ledger_revision: 'ledger-b',
              changes: [viewerChange('shared', 'BRAVO CURRENT')],
            }),
        };
      },
      async () => {
        await gotoChange('goto-fail-b', 'shared');
        assert.equal(appState.currentProject, 'goto-fail-b');
        assert.equal(appState.repo.project_id, 'goto-fail-a');
        assert.ok(document.getElementById('overlay').classList.contains('hidden'));

        await gotoChange('goto-fail-b', 'shared');
        assert.equal(repoFetches, 2, 'retrying the selected project reloads its missing repo');
        assert.equal(appState.repo.project_id, 'goto-fail-b');
        assert.equal(document.querySelector('#detail h1').textContent, 'BRAVO CURRENT');
      },
    );
  } finally {
    restore();
  }
});

test('190137 CR4: gotoChange cannot open a later B context after B to C to B re-entry', async () => {
  const restore = installViewerShell();
  try {
    appState.projectsList = [
      { id: 'goto-return-a', name: 'A', path: '/a', alive: true },
      { id: 'goto-return-b', name: 'B', path: '/b', alive: true },
      { id: 'goto-return-c', name: 'C', path: '/c', alive: true },
    ];
    selectViewerProject('goto-return-a');
    appState.lastJson = '';
    const oldB = deferredResponse();
    const currentB = deferredResponse();
    const responseQueues = {
      'goto-return-b': [oldB, currentB],
    };

    await withMockedFetch(
      (url) => {
        const project = new URL(String(url), 'http://x').searchParams.get('project');
        return responseQueues[project].shift().promise;
      },
      async () => {
        const navigation = gotoChange('goto-return-b', 'shared');
        selectViewerProject('goto-return-c');
        selectViewerProject('goto-return-b');
        const replacement = load();
        currentB.resolve(
          repoPayload({
            project_id: 'goto-return-b',
            ledger_revision: 'rev-b-new',
            changes: [viewerChange('shared', 'B new')],
          }),
        );
        await replacement;
        oldB.resolve(
          repoPayload({
            project_id: 'goto-return-b',
            ledger_revision: 'rev-b-old',
            changes: [viewerChange('shared', 'B old')],
          }),
        );
        await navigation;

        assert.equal(appState.currentProject, 'goto-return-b');
        assert.equal(appState.repo.ledger_revision, 'rev-b-new');
        assert.ok(
          document.getElementById('overlay').classList.contains('hidden'),
          'the stale navigation must not open the later B detail',
        );
      },
    );
  } finally {
    restore();
  }
});

test('190137 CR2: a sync receipt for a different repository is discarded', async () => {
  const restore = installViewerShell();
  try {
    appState.projectsList = [{ id: 'sync-identity-a', name: 'Alpha', path: '/a', alive: true }];
    appState.currentProject = 'sync-identity-a';
    appState.repo = null;
    appState.lastJson = '';
    let repoLoads = 0;

    await withMockedFetch(
      (url) => {
        const parsed = new URL(String(url), 'http://x');
        if (parsed.pathname === '/api/state-sync') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              project_id: 'sync-identity-a',
              repository_path: '/wrong-repository',
              ledger_revision: 'ledger-a',
            }),
          });
        }
        if (parsed.pathname === '/api/repo') repoLoads += 1;
        throw new Error(`unexpected fetch ${url}`);
      },
      async () => {
        await syncReplicaState('sync-identity-a');
        assert.equal(repoLoads, 0, 'a mismatched receipt must not trigger a reload');
        assert.equal(
          toastContainer().children.length,
          0,
          'a mismatched receipt must not be toasted',
        );
      },
    );
  } finally {
    restore();
  }
});

test('190137 CR4: a sync from an earlier A selection is stale after A to B to A', async () => {
  const restore = installViewerShell();
  try {
    appState.projectsList = [
      { id: 'sync-return-a', name: 'Alpha', path: '/a', alive: true },
      { id: 'sync-return-b', name: 'Beta', path: '/b', alive: true },
    ];
    selectViewerProject('sync-return-a');
    const sync = deferredResponse();
    let repoLoads = 0;

    await withMockedFetch(
      (url) => {
        const parsed = new URL(String(url), 'http://x');
        if (parsed.pathname === '/api/state-sync') return sync.promise;
        if (parsed.pathname === '/api/repo') repoLoads += 1;
        throw new Error(`unexpected fetch ${url}`);
      },
      async () => {
        const pending = syncReplicaState('sync-return-a');
        selectViewerProject('sync-return-b');
        selectViewerProject('sync-return-a');
        sync.resolve(
          JSON.stringify({
            ok: true,
            project_id: 'sync-return-a',
            repository_path: '/a',
            ledger_revision: 'ledger-a-2',
          }),
        );
        await pending;

        assert.equal(repoLoads, 0, 'the earlier A context must not reload the later A selection');
        assert.equal(toastContainer().children.length, 0);
      },
    );
  } finally {
    restore();
  }
});

test('190137 CR4: a status move from an earlier A selection cannot reload a later A', async () => {
  const restore = installViewerShell();
  try {
    appState.projectsList = [
      { id: 'status-return-a', name: 'Alpha', path: '/a', alive: true },
      { id: 'status-return-b', name: 'Beta', path: '/b', alive: true },
    ];
    selectViewerProject('status-return-a');
    const status = deferredResponse();
    let repoLoads = 0;

    await withMockedFetch(
      (url) => {
        const parsed = new URL(String(url), 'http://x');
        if (parsed.pathname === '/api/status') return status.promise;
        if (parsed.pathname === '/api/repo') repoLoads += 1;
        throw new Error(`unexpected fetch ${url}`);
      },
      async () => {
        const pending = moveStatus(
          { project: 'status-return-a', ledger_revision: 'ledger-a' },
          'change-a',
          'approved',
        );
        selectViewerProject('status-return-b');
        selectViewerProject('status-return-a');
        status.resolve(
          JSON.stringify({
            ok: true,
            project_id: 'status-return-a',
            repository_path: '/a',
            ledger_revision: 'ledger-a-next',
          }),
        );
        assert.equal(await pending, undefined);
        assert.equal(
          repoLoads,
          0,
          'the earlier status receipt must not reload the later A context',
        );
      },
    );
  } finally {
    restore();
  }
});

test('190137 CR2: projectMutation rejects a success receipt with the wrong path', async () => {
  const root = document.createElement('form');
  root.innerHTML = '<p class="project-error" hidden></p><button></button>';
  let applied = false;

  const result = await projectMutation(
    root,
    async () => ({
      ok: true,
      json: async () => ({ project_id: 'config-a', repository_path: '/wrong' }),
    }),
    async () => {
      applied = true;
    },
    { identity: { project: 'config-a', repositoryPath: '/a' } },
  );

  assert.equal(result, false);
  assert.equal(applied, false);
  assert.equal(root.classList.contains('is-pending'), false);
});

test('190137 CR4: a reopen cannot reopen a detail after its project was closed', async () => {
  const restore = installViewerShell();
  try {
    appState.projectsList = [
      { id: 'reopen-a', name: 'Alpha', path: '/a', alive: true },
      { id: 'reopen-b', name: 'Beta', path: '/b', alive: true },
    ];
    const reopen = deferredResponse();
    const doneChange = (title) => ({ ...viewerChange('shared', title), status: 'done' });

    await withMockedFetch(
      (url, init = {}) => {
        const parsed = new URL(String(url), 'http://x');
        if ((init.method ?? 'GET') === 'POST' && parsed.pathname === '/api/status') {
          return reopen.promise;
        }
        if (parsed.pathname === '/api/git') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ commits: [], branches: [] }),
          });
        }
        if (parsed.pathname === '/api/repo') {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () =>
              repoPayload({ project_id: 'reopen-b', changes: [doneChange('Beta')] }),
          });
        }
        throw new Error(`unexpected fetch ${url}`);
      },
      async () => {
        appState.currentProject = 'reopen-a';
        appState.repo = JSON.parse(
          repoPayload({ project_id: 'reopen-a', changes: [doneChange('Alpha old')] }),
        );
        openChangeById('shared');
        document.querySelector('[data-reopen-reason]').value = 'Needs another pass';
        const pending = document.querySelector('[data-reopen]').onclick();

        appState.currentProject = 'reopen-b';
        document.querySelector('#detail .close').click();

        reopen.resolve(
          JSON.stringify({
            ok: true,
            project_id: 'reopen-a',
            repository_path: '/a',
            ledger_revision: 'rev-reopened',
          }),
        );
        await pending;

        assert.equal(appState.currentProject, 'reopen-b');
        assert.ok(
          document.getElementById('overlay').classList.contains('hidden'),
          'the completed A request must not reopen B detail',
        );
      },
    );
  } finally {
    restore();
  }
});

test('190137 CR4: an old A config save cannot replace edits made after A to B to A', async () => {
  const restore = installViewerShell();
  try {
    appState.projectsList = [
      { id: 'config-return-a', name: 'Alpha', path: '/a', alive: true },
      { id: 'config-return-b', name: 'Beta', path: '/b', alive: true },
    ];
    const save = deferredResponse();
    const structured = (id, name, revision) => ({
      project_id: id,
      repository_path: id === 'config-return-a' ? '/a' : '/b',
      ledger_revision: `ledger-${id}`,
      content: `project_id: ${id}\nproject_name: ${name}`,
      revision,
      config_revision: revision,
      schemaVersion: 2,
      supported: 2,
      config: { project_id: id, project_name: name },
    });
    const configReads = [
      structured('config-return-a', 'Alpha old', 'config-a-old'),
      structured('config-return-b', 'Beta', 'config-b'),
      structured('config-return-a', 'Alpha new', 'config-a-new'),
    ];

    await withMockedFetch(
      (url, init = {}) => {
        const parsed = new URL(String(url), 'http://x');
        if (parsed.pathname === '/api/projects') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              projects: appState.projectsList,
              current: null,
              localOnly: false,
            }),
          });
        }
        if ((init.method ?? 'GET') === 'POST' && parsed.pathname === '/api/project-config') {
          return save.promise;
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => configReads.shift(),
        });
      },
      async () => {
        await openManagedProject('config-return-a', { reload: true });
        document.querySelector('[data-config-mode="raw"]').click();
        const oldForm = document.querySelector('.config-form:not([data-config-form])');
        oldForm.querySelector('textarea').value =
          'project_id: config-return-a\nproject_name: Alpha saved old';
        oldForm.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

        await openManagedProject('config-return-b', { reload: true });
        await openManagedProject('config-return-a', { reload: true });
        document.querySelector('[data-config-mode="raw"]').click();
        const currentTextarea = document.querySelector(
          '.config-form:not([data-config-form]) textarea',
        );
        currentTextarea.value = 'project_id: config-return-a\nproject_name: Alpha user new';
        currentTextarea.dispatchEvent(new window.Event('input', { bubbles: true }));

        save.resolve(
          JSON.stringify({
            ok: true,
            project_id: 'config-return-a',
            repository_path: '/a',
            config_revision: 'config-a-saved-old',
            ledger_revision: 'ledger-a-saved-old',
          }),
        );
        for (let i = 0; i < 50 && oldForm.classList.contains('is-pending'); i++) {
          await Promise.resolve();
        }

        assert.match(
          document.querySelector('.config-form:not([data-config-form]) textarea')?.value ?? '',
          /Alpha user new/,
        );
      },
    );
  } finally {
    restore();
  }
});

test('190137 CR4: a current migration preview error remains visible', async () => {
  const restore = installViewerShell();
  try {
    const project = 'preview-error';
    appState.projectsList = [{ id: project, name: 'Preview', path: '/preview', alive: true }];

    await withMockedFetch(
      (url) => {
        const parsed = new URL(String(url), 'http://x');
        if (parsed.pathname === '/api/project-config-migrate-preview') {
          return Promise.resolve({
            ok: false,
            status: 409,
            json: async () => ({ error: 'configuration changed on disk' }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            project_id: project,
            repository_path: '/preview',
            content: `project_id: ${project}`,
            revision: 'ledger-preview-error',
            ledger_revision: 'ledger-preview-error',
            config_revision: 'config-preview-error',
            schemaVersion: 0,
            supported: 1,
            config: { project_id: project },
          }),
        });
      },
      async () => {
        await openManagedProject(project, { reload: true });
        await document.querySelector('[data-preview-migration]').onclick();
        assert.match(
          document.querySelector('.project-error')?.textContent ?? '',
          /changed on disk/,
        );
      },
    );
  } finally {
    restore();
  }
});

test('190137 CR2: a migration preview without revisions is discarded', async () => {
  const restore = installViewerShell();
  try {
    const project = 'preview-no-revision';
    appState.projectsList = [{ id: project, name: 'Preview', path: '/preview', alive: true }];
    await withMockedFetch(
      (url) => {
        const parsed = new URL(String(url), 'http://x');
        if (parsed.pathname === '/api/project-config-migrate-preview') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              project_id: project,
              repository_path: '/preview',
              summary: 'NO REVISION PREVIEW',
              changes: [],
              yaml: 'bad: true',
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            project_id: project,
            repository_path: '/preview',
            ledger_revision: 'ledger-preview',
            content: `project_id: ${project}`,
            revision: 'config-preview',
            config_revision: 'config-preview',
            schemaVersion: 0,
            supported: 1,
            config: { project_id: project },
          }),
        });
      },
      async () => {
        await openManagedProject(project, { reload: true });
        await document.querySelector('[data-preview-migration]').onclick();
        assert.doesNotMatch(document.getElementById('projects').textContent, /NO REVISION PREVIEW/);
      },
    );
  } finally {
    restore();
  }
});

test('190137 CR2/CR3: a late R1 preview cannot replace config saved as R2', async () => {
  const restore = installViewerShell();
  try {
    const project = 'preview-save-race';
    appState.projectsList = [{ id: project, name: 'Preview', path: '/preview', alive: true }];
    const preview = deferredResponse();

    await withMockedFetch(
      (url, init = {}) => {
        const parsed = new URL(String(url), 'http://x');
        if (parsed.pathname === '/api/project-config-migrate-preview') return preview.promise;
        if (parsed.pathname === '/api/projects') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              projects: appState.projectsList,
              current: project,
              localOnly: false,
            }),
          });
        }
        if ((init.method ?? 'GET') === 'POST' && parsed.pathname === '/api/project-config') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              project_id: project,
              repository_path: '/preview',
              ledger_revision: 'ledger-r2',
              config_revision: 'config-r2',
              ledger_freshness: 'local',
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            project_id: project,
            repository_path: '/preview',
            ledger_revision: 'ledger-r1',
            content: `project_id: ${project}`,
            revision: 'config-r1',
            config_revision: 'config-r1',
            schemaVersion: 0,
            supported: 1,
            config: { project_id: project },
          }),
        });
      },
      async () => {
        await openManagedProject(project, { reload: true });
        document.querySelector('[data-config-mode="raw"]').click();
        const rawForm = document.querySelector('.config-form:not([data-config-form])');
        const textarea = rawForm.querySelector('textarea');
        textarea.value = `${textarea.value}\nproject_name: updated`;
        textarea.dispatchEvent(new window.Event('input', { bubbles: true }));

        const pendingPreview = document.querySelector('[data-preview-migration]').onclick();
        await rawForm.onsubmit(new window.Event('submit', { bubbles: true, cancelable: true }));

        preview.resolve(
          JSON.stringify({
            project_id: project,
            repository_path: '/preview',
            ledger_revision: 'ledger-r1',
            config_revision: 'config-r1',
            summary: 'STALE R1 PREVIEW',
            changes: [],
            yaml: 'stale: true',
          }),
        );
        await pendingPreview;

        assert.doesNotMatch(document.getElementById('projects').textContent, /STALE R1 PREVIEW/);
        assert.equal(document.querySelector('[data-apply-migration]'), null);
      },
    );
  } finally {
    restore();
  }
});

test('190137 CR2: preview rejects present revisions that differ from the requested snapshot', async () => {
  const restore = installViewerShell();
  try {
    const project = 'preview-exact-revision';
    appState.projectsList = [{ id: project, name: 'Preview', path: '/preview', alive: true }];
    await withMockedFetch(
      (url) => {
        const parsed = new URL(String(url), 'http://x');
        if (parsed.pathname === '/api/project-config-migrate-preview') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              project_id: project,
              repository_path: '/preview',
              ledger_revision: 'ledger-other',
              config_revision: 'config-other',
              summary: 'WRONG SNAPSHOT PREVIEW',
              changes: [],
              yaml: 'wrong: true',
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            project_id: project,
            repository_path: '/preview',
            ledger_revision: 'ledger-requested',
            config_revision: 'config-requested',
            content: `project_id: ${project}`,
            schemaVersion: 0,
            supported: 1,
            config: { project_id: project },
          }),
        });
      },
      async () => {
        await openManagedProject(project, { reload: true });
        await document.querySelector('[data-preview-migration]').onclick();
        assert.doesNotMatch(document.getElementById('projects').textContent, /WRONG SNAPSHOT/);
      },
    );
  } finally {
    restore();
  }
});

test('190137 CR4: repairing the selected project path invalidates detail and reloads the board', async () => {
  const restore = installViewerShell();
  try {
    const project = 'repair-selected';
    const change = '20260724-120003';
    appState.projectsList = [{ id: project, name: 'Repair', path: '/old', alive: true }];
    appState.currentProject = project;
    appState.repo = JSON.parse(
      repoPayload({
        project_id: project,
        repository_path: '/old',
        ledger_revision: 'ledger-old',
        changes: [viewerChange(change, 'Old detail')],
      }),
    );
    appState.lastJson = JSON.stringify(appState.repo);
    let configReads = 0;
    let repoLoads = 0;

    await withMockedFetch(
      (url, init = {}) => {
        const parsed = new URL(String(url), 'http://x');
        if (parsed.pathname === '/api/git') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              project_id: project,
              repository_path: '/old',
              ledger_revision: 'ledger-old',
              commits: [],
              branches: [],
            }),
          });
        }
        if (parsed.pathname === '/api/project-path') {
          assert.equal(init.method, 'POST');
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ project_id: project, repository_path: '/new' }),
          });
        }
        if (parsed.pathname === '/api/projects') {
          const projects = [{ id: project, name: 'Repair', path: '/new', alive: true }];
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ projects, current: project, localOnly: false }),
          });
        }
        if (parsed.pathname === '/api/repo') {
          repoLoads += 1;
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () =>
              repoPayload({
                project_id: project,
                repository_path: '/new',
                ledger_revision: 'ledger-new',
              }),
          });
        }
        if (parsed.pathname === '/api/project-config-structured') {
          configReads += 1;
          const repositoryPath = configReads === 1 ? '/old' : '/new';
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              project_id: project,
              repository_path: repositoryPath,
              ledger_revision: `ledger-${configReads}`,
              config_revision: `config-${configReads}`,
              content: `project_id: ${project}`,
              schemaVersion: 2,
              supported: 2,
              config: { project_id: project },
            }),
          });
        }
        throw new Error(`unexpected fetch ${url}`);
      },
      async () => {
        openChangeById(change);
        await Promise.resolve();
        await openManagedProject(project, { reload: true });
        const pathForm = document.querySelector('.project-path-form');
        pathForm.elements.path.value = '/new';
        await pathForm.onsubmit(new window.Event('submit', { bubbles: true, cancelable: true }));

        assert.equal(repoLoads, 1);
        assert.equal(appState.repo.repository_path, '/new');
        assert.ok(document.getElementById('overlay').classList.contains('hidden'));
        assert.equal(configReads, 2);
      },
    );
  } finally {
    restore();
  }
});

test('190137 CR4: repair cannot reload another managed project after awaiting the board', async () => {
  const restore = installViewerShell();
  try {
    const projects = [
      { id: 'repair-late-a', name: 'Alpha', path: '/old-a', alive: true },
      { id: 'repair-late-b', name: 'Beta', path: '/b', alive: true },
    ];
    appState.projectsList = projects;
    appState.currentProject = 'repair-late-a';
    appState.repo = JSON.parse(
      repoPayload({
        project_id: 'repair-late-a',
        repository_path: '/old-a',
        ledger_revision: 'ledger-a-old',
      }),
    );
    const board = deferredResponse();
    let boardStarted;
    const boardPending = new Promise((resolve) => {
      boardStarted = resolve;
    });
    const configReads = new Map();

    await withMockedFetch(
      (url, init = {}) => {
        const parsed = new URL(String(url), 'http://x');
        if (parsed.pathname === '/api/project-path') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ project_id: 'repair-late-a', repository_path: '/new-a' }),
          });
        }
        if (parsed.pathname === '/api/projects') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              projects: [{ ...projects[0], path: '/new-a' }, projects[1]],
              current: 'repair-late-a',
              localOnly: false,
            }),
          });
        }
        if (parsed.pathname === '/api/repo') {
          boardStarted();
          return board.promise;
        }
        if (parsed.pathname === '/api/project-config-structured') {
          const project = parsed.searchParams.get('project');
          const reads = (configReads.get(project) ?? 0) + 1;
          configReads.set(project, reads);
          const repositoryPath =
            project === 'repair-late-a' ? (reads === 1 ? '/old-a' : '/new-a') : '/b';
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              project_id: project,
              repository_path: repositoryPath,
              ledger_revision: `ledger-${project}-${reads}`,
              config_revision: `config-${project}-${reads}`,
              content: `project_id: ${project}\nproject_name: ${project === 'repair-late-b' ? 'Beta' : 'Alpha'}`,
              schemaVersion: 2,
              supported: 2,
              config: {
                project_id: project,
                project_name: project === 'repair-late-b' ? 'Beta' : 'Alpha',
                types: {},
                statuses: [],
                stages: [],
              },
            }),
          });
        }
        throw new Error(`unexpected fetch ${url} ${init.method ?? 'GET'}`);
      },
      async () => {
        await openManagedProject('repair-late-a', { reload: true });
        const pathForm = document.querySelector('.project-path-form');
        pathForm.elements.path.value = '/new-a';
        const repair = pathForm.onsubmit(
          new window.Event('submit', { bubbles: true, cancelable: true }),
        );
        await boardPending;

        await openManagedProject('repair-late-b', { reload: true });
        const input = document.querySelector('input[name="project_name"]');
        input.value = 'B UNSAVED';
        input.dispatchEvent(new window.Event('input', { bubbles: true }));

        board.resolve(
          repoPayload({
            project_id: 'repair-late-a',
            repository_path: '/new-a',
            ledger_revision: 'ledger-a-new',
          }),
        );
        await repair;

        assert.equal(configReads.get('repair-late-b'), 1);
        assert.equal(document.querySelector('input[name="project_name"]').value, 'B UNSAVED');
      },
    );
  } finally {
    restore();
  }
});

test('190137 CR4: a preview from an earlier A context cannot paint a later A', async () => {
  const restore = installViewerShell();
  try {
    appState.projectsList = [
      { id: 'preview-return-a', name: 'Alpha', path: '/a', alive: true },
      { id: 'preview-return-b', name: 'Beta', path: '/b', alive: true },
    ];
    const preview = deferredResponse();
    const structured = (id, repositoryPath) => ({
      project_id: id,
      repository_path: repositoryPath,
      content: `project_id: ${id}`,
      revision: `ledger-${id}`,
      ledger_revision: `ledger-${id}`,
      config_revision: `config-${id}`,
      schemaVersion: 0,
      supported: 1,
      config: { project_id: id },
    });
    const configReads = [
      structured('preview-return-a', '/a'),
      structured('preview-return-b', '/b'),
      structured('preview-return-a', '/a'),
    ];

    await withMockedFetch(
      (url) => {
        const parsed = new URL(String(url), 'http://x');
        if (parsed.pathname === '/api/project-config-migrate-preview') return preview.promise;
        return Promise.resolve({ ok: true, status: 200, json: async () => configReads.shift() });
      },
      async () => {
        await openManagedProject('preview-return-a', { reload: true });
        const pending = document.querySelector('[data-preview-migration]').onclick();
        await openManagedProject('preview-return-b', { reload: true });
        await openManagedProject('preview-return-a', { reload: true });

        preview.resolve(
          JSON.stringify({
            project_id: 'preview-return-a',
            repository_path: '/a',
            ledger_revision: 'ledger-preview-return-a',
            config_revision: 'config-preview-return-a',
            summary: 'STALE A PREVIEW',
            changes: [],
            yaml: 'stale: true',
          }),
        );
        await pending;

        assert.doesNotMatch(document.getElementById('projects').textContent, /STALE A PREVIEW/);
      },
    );
  } finally {
    restore();
  }
});

test('190137 CR4: an unregister confirmation from an earlier A cannot remove a later A', async () => {
  const restore = installViewerShell();
  let resolvePrompt;
  setPromptImpl(
    () =>
      new Promise((resolve) => {
        resolvePrompt = resolve;
      }),
  );
  try {
    appState.projectsList = [
      { id: 'unregister-return-a', name: 'Alpha', path: '/a', alive: true },
      { id: 'unregister-return-b', name: 'Beta', path: '/b', alive: true },
    ];
    const structured = (id, repositoryPath) => ({
      project_id: id,
      repository_path: repositoryPath,
      content: `project_id: ${id}`,
      revision: `ledger-${id}`,
      ledger_revision: `ledger-${id}`,
      config_revision: `config-${id}`,
      schemaVersion: 2,
      supported: 2,
      config: { project_id: id },
    });
    const configReads = [
      structured('unregister-return-a', '/a'),
      structured('unregister-return-b', '/b'),
      structured('unregister-return-a', '/a'),
    ];
    let removePosts = 0;

    await withMockedFetch(
      (url, init = {}) => {
        const parsed = new URL(String(url), 'http://x');
        if ((init.method ?? 'GET') === 'POST' && parsed.pathname === '/api/project-remove') {
          removePosts += 1;
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              project_id: 'unregister-return-a',
              repository_path: '/a',
            }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => configReads.shift() });
      },
      async () => {
        await openManagedProject('unregister-return-a', { reload: true });
        const pending = document.querySelector('[data-unregister]').onclick();
        await openManagedProject('unregister-return-b', { reload: true });
        await openManagedProject('unregister-return-a', { reload: true });
        resolvePrompt('Alpha');
        await pending;

        assert.equal(removePosts, 0, 'the obsolete confirmation must not unregister the later A');
      },
    );
  } finally {
    setPromptImpl(null);
    restore();
  }
});

test('190137 CR4: a reload confirmation from an earlier A cannot reload a later A', async () => {
  const restore = installViewerShell();
  let resolveConfirm;
  setConfirmImpl(
    () =>
      new Promise((resolve) => {
        resolveConfirm = resolve;
      }),
  );
  try {
    appState.projectsList = [
      { id: 'reload-return-a', name: 'Alpha', path: '/a', alive: true },
      { id: 'reload-return-b', name: 'Beta', path: '/b', alive: true },
    ];
    let configReads = 0;
    await withMockedFetch(
      async () => {
        configReads += 1;
        const id = configReads === 2 ? 'reload-return-b' : 'reload-return-a';
        const repositoryPath = id.endsWith('-b') ? '/b' : '/a';
        return {
          ok: true,
          status: 200,
          json: async () => ({
            project_id: id,
            repository_path: repositoryPath,
            ledger_revision: `ledger-${id}`,
            content: `project_id: ${id}`,
            revision: `config-${id}`,
            config_revision: `config-${id}`,
            schemaVersion: 2,
            supported: 2,
            config: { project_id: id },
          }),
        };
      },
      async () => {
        await openManagedProject('reload-return-a', { reload: true });
        const form = document.querySelector('[data-config-form]');
        form.dispatchEvent(new window.Event('input', { bubbles: true }));
        const pending = document.querySelector('[data-reload-config]').onclick();
        await openManagedProject('reload-return-b', { reload: true });
        await openManagedProject('reload-return-a', { reload: true });
        resolveConfirm(true);
        await pending;

        assert.equal(configReads, 3, 'the obsolete confirmation must not start another reload');
      },
    );
  } finally {
    setConfirmImpl(null);
    restore();
  }
});

test('190137 CR3/CR4: global search keeps the newest query result', async () => {
  const restore = installViewerShell();
  try {
    const older = deferredResponse();
    const newer = deferredResponse();
    const responses = [older, newer];
    appState.filters.text = 'old';
    appState.globalMode = true;

    await withMockedFetch(
      () => responses.shift().promise,
      async () => {
        const pendingOlder = renderGlobal();
        appState.filters.text = 'new';
        const pendingNewer = renderGlobal();
        newer.resolve(JSON.stringify({ groups: [], ledgers: [] }));
        await pendingNewer;
        older.resolve(
          JSON.stringify({
            groups: [
              {
                project: { id: 'old', name: 'OLD RESULT' },
                matches: [{ id: 'old', title: 'OLD RESULT', type: 'bug', status: 'draft' }],
              },
            ],
            ledgers: [],
          }),
        );
        await pendingOlder;

        assert.doesNotMatch(document.getElementById('global').textContent, /OLD RESULT/);
        assert.match(document.getElementById('global').textContent, /No matches for “new”/);
      },
    );
  } finally {
    appState.globalMode = false;
    restore();
  }
});

test('190137 CR4: global search results are stale after an identity-equivalent registry refresh', async () => {
  const restore = installViewerShell();
  try {
    appState.projectsList = [{ id: 'search-rebind', name: 'A', path: '/old', alive: true }];
    appState.filters.text = 'query';
    appState.globalMode = true;
    const search = deferredResponse();

    await withMockedFetch(
      () => search.promise,
      async () => {
        const pending = renderGlobal();
        replaceProjectRegistry(
          [{ id: 'search-rebind', name: 'A', path: '/old', alive: true }],
          'search-rebind',
        );
        search.resolve(
          JSON.stringify({
            ledgers: [
              {
                project_id: 'search-rebind',
                repository_path: '/old',
                ledger_revision: 'ledger-old',
                ledger_freshness: 'local',
              },
            ],
            groups: [
              {
                project: {
                  project_id: 'search-rebind',
                  name: 'A',
                  repository_path: '/old',
                },
                ledger_revision: 'ledger-old',
                matches: [
                  {
                    id: '20260724-120005',
                    title: 'STALE SEARCH RESULT',
                    type: 'bug',
                    status: 'draft',
                  },
                ],
              },
            ],
          }),
        );
        await pending;

        assert.doesNotMatch(document.getElementById('global').textContent, /STALE SEARCH RESULT/);
      },
    );
  } finally {
    appState.globalMode = false;
    restore();
  }
});

test('190137 CR2: global search rejects mismatched provenance without a registry change', async () => {
  const restore = installViewerShell();
  try {
    appState.projectsList = [{ id: 'search-receipt', name: 'A', path: '/live', alive: true }];
    appState.filters.text = 'query';
    appState.globalMode = true;
    await withMockedFetch(
      async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          ledgers: [
            {
              project_id: 'search-receipt',
              repository_path: '/wrong',
              ledger_revision: 'ledger-wrong',
            },
          ],
          groups: [],
        }),
      }),
      async () => {
        await renderGlobal();
        assert.doesNotMatch(document.getElementById('global').textContent, /ledger-wrong/);
      },
    );
  } finally {
    appState.globalMode = false;
    restore();
  }
});

test('190137 CR4: global search is stale after a registry old to new to old cycle', async () => {
  const restore = installViewerShell();
  try {
    const oldRegistry = [{ id: 'search-return', name: 'A', path: '/old', alive: true }];
    appState.projectsList = oldRegistry;
    appState.filters.text = 'query';
    appState.globalMode = true;
    const search = deferredResponse();
    await withMockedFetch(
      () => search.promise,
      async () => {
        const pending = renderGlobal();
        replaceProjectRegistry(
          [{ id: 'search-return', name: 'A', path: '/new', alive: true }],
          'search-return',
        );
        replaceProjectRegistry(oldRegistry, 'search-return');
        search.resolve(
          JSON.stringify({
            ledgers: [
              {
                project_id: 'search-return',
                repository_path: '/old',
                ledger_revision: 'ledger-old',
              },
            ],
            groups: [],
          }),
        );
        await pending;
        assert.doesNotMatch(document.getElementById('global').textContent, /ledger-old/);
      },
    );
  } finally {
    appState.globalMode = false;
    restore();
  }
});

test('190137 CR4: stale or failed Mermaid completion cannot mutate a replacement detail', async () => {
  const root = document.createElement('div');
  root.innerHTML = '<div class="mermaid"></div>';
  const rendering = deferredValue();
  let stale = false;
  const pending = renderExpandableMermaid(
    root,
    () => stale,
    () => rendering.promise,
  );
  stale = true;
  rendering.resolve();
  await pending;
  assert.equal(root.querySelector('.mermaid').classList.contains('mermaid-expandable'), false);

  await assert.doesNotReject(() =>
    renderExpandableMermaid(
      root,
      () => false,
      async () => {
        throw new Error('diagram failed');
      },
    ),
  );
});

function prepareMetricsProject(project, path = `/${project}`) {
  appState.projectsList = [{ id: project, name: project, path, alive: true }];
  selectViewerProject(project);
  appState.repo = JSON.parse(
    repoPayload({
      project_id: project,
      ledger_revision: `ledger-${project}`,
      changes: [viewerChange(`${project}-change`, `${project} change`)],
    }),
  );
  appState.currentView = 'metrics';
  appState.globalMode = false;
  appState.filters.text = '';
  appState.filters.types = new Set();
  appState.filters.owners = new Set();
  appState.filters.statuses = new Set();
  appState.filters.includeUnassigned = false;
  appState.filters.showArchived = false;
  appState.filters.showDiscarded = false;
}

test('190137 CR4: metrics captured for A cannot render after selecting B', async () => {
  const restore = installViewerShell();
  try {
    prepareMetricsProject('metrics-switch-a', '/a');
    appState.projectsList.push({ id: 'metrics-switch-b', name: 'B', path: '/b', alive: true });
    const module = deferredValue();
    const pending = renderMetrics(() => module.promise);

    selectViewerProject('metrics-switch-b');
    module.resolve({ computeMetrics });
    await pending;

    assert.equal(document.getElementById('metrics').textContent.trim(), '');
  } finally {
    restore();
  }
});

test('190137 CR4: metrics from an earlier A context stay stale after A to B to A', async () => {
  const restore = installViewerShell();
  try {
    prepareMetricsProject('metrics-return-a', '/a');
    appState.projectsList.push({ id: 'metrics-return-b', name: 'B', path: '/b', alive: true });
    const module = deferredValue();
    const pending = renderMetrics(() => module.promise);

    selectViewerProject('metrics-return-b');
    selectViewerProject('metrics-return-a');
    module.resolve({ computeMetrics });
    await pending;

    assert.equal(document.getElementById('metrics').textContent.trim(), '');
  } finally {
    restore();
  }
});

test('190137 CR3: an older metrics calculation cannot replace newer filters', async () => {
  const restore = installViewerShell();
  try {
    prepareMetricsProject('metrics-filter');
    const olderModule = deferredValue();
    const older = renderMetrics(() => olderModule.promise);

    appState.filters.text = 'no matching change';
    await renderMetrics(async () => ({ computeMetrics }));
    assert.match(document.getElementById('metrics').textContent, /No changes match/);

    olderModule.resolve({ computeMetrics });
    await older;
    assert.match(document.getElementById('metrics').textContent, /No changes match/);
  } finally {
    restore();
  }
});

test('190137 CR4: metrics do not render after leaving the metrics view', async () => {
  const restore = installViewerShell();
  try {
    prepareMetricsProject('metrics-view');
    const module = deferredValue();
    const pending = renderMetrics(() => module.promise);

    appState.currentView = 'board';
    module.resolve({ computeMetrics });
    await pending;

    assert.equal(document.getElementById('metrics').textContent.trim(), '');
  } finally {
    restore();
  }
});

test('190137 CR4: a current metrics module failure is rendered without rejecting', async () => {
  const restore = installViewerShell();
  try {
    prepareMetricsProject('metrics-error');
    await renderMetrics(async () => {
      throw new Error('metrics module unavailable');
    });

    assert.match(document.getElementById('metrics').textContent, /metrics module unavailable/);
  } finally {
    restore();
  }
});

test('190137 CR4: a metrics import error is stale after selecting another project', async () => {
  const restore = installViewerShell();
  try {
    prepareMetricsProject('metrics-error-a', '/a');
    appState.projectsList.push({ id: 'metrics-error-b', name: 'B', path: '/b', alive: true });
    const module = deferredValue();
    const pending = renderMetrics(() => module.promise);
    selectViewerProject('metrics-error-b');
    module.reject(new Error('stale metrics failure'));
    await pending;

    assert.doesNotMatch(document.getElementById('metrics').textContent, /stale metrics failure/);
  } finally {
    restore();
  }
});

test('193101 correction CR2: global search renders ledger provenance with and without matches', () => {
  const provenance = {
    project_id: 'project-1',
    repository_path: '/project-1',
    ledger_revision: '0123456789abcdef',
    ledger_freshness: 'local',
  };
  const matching = parse(
    globalSearchTemplate(
      {
        ledgers: [provenance],
        groups: [
          {
            project: {
              project_id: 'project-1',
              name: 'Project',
              repository_path: '/project-1',
            },
            ledger_revision: provenance.ledger_revision,
            ledger_freshness: provenance.ledger_freshness,
            matches: [{ id: 'change-1', title: 'Match', type: 'feature', status: 'draft' }],
          },
        ],
      },
      'match',
    ),
  );
  assert.match(matching.textContent, /0123456789abcdef/);
  assert.match(matching.textContent, /freshness: local/);

  const empty = parse(globalSearchTemplate({ ledgers: [provenance], groups: [] }, 'missing'));
  assert.match(empty.textContent, /No matches/);
  assert.match(empty.textContent, /0123456789abcdef/);
  assert.match(empty.textContent, /freshness: local/);
});

test('193101 correction CR2: normal viewer shell renders the loaded ledger provenance', () => {
  const root = parse(
    fs.readFileSync(new URL('../src/viewer/public/index.html', import.meta.url), 'utf8'),
  );
  appState.repo = {
    ledger_revision: 'fedcba9876543210',
    ledger_freshness: 'local',
  };
  appState.globalMode = false;
  appState.currentView = 'board';
  syncViewerShell(root, false);
  assert.match(root.querySelector('#ledger-snapshot').textContent, /fedcba9876543210/);
  assert.match(root.querySelector('#ledger-snapshot').textContent, /freshness: local/);
});

const baseChange = () => ({
  id: '20260613-120000',
  type: 'feature',
  status: 'draft',
  title: 'ok',
  owner: null,
  archived: false,
  created: '2026-06-13T12:00:00Z',
  depends_on: [],
  progress: { total: 0, done: 0, blocked: 0 },
  stages: [],
  tasks: [],
});

test('111218 CR1/CR2: projects view renders health, exact YAML text and safe metadata', () => {
  const host = parse(
    projectsViewTemplate(
      [
        { id: 'aaa111', name: XSS, path: '/repos/alpha', alive: true },
        { id: 'bbb222', name: 'beta', path: '/gone/beta', alive: false },
      ],
      'aaa111',
      {
        content: 'language: es\n# <script>alert(1)</script>',
        revision: 'rev',
        schemaVersion: 0,
        supported: 2,
      },
      false,
    ),
  );
  assert.equal(host.querySelectorAll('.project-row').length, 2);
  assert.equal(host.querySelectorAll('.project-health.available').length, 2);
  assert.equal(host.querySelectorAll('.project-health.missing').length, 1);
  assert.equal(host.querySelector('textarea').value, 'language: es\n# <script>alert(1)</script>');
  assert.equal(host.querySelector('script'), null);
  assert.equal(host.querySelector('img'), null);
});

test('111218 CR1/CR8: missing and local projects expose only valid actions', () => {
  const missing = parse(
    projectsViewTemplate(
      [{ id: 'aaa111', name: 'alpha', path: '/gone', alive: false }],
      'aaa111',
      null,
      false,
    ),
  );
  assert.ok(missing.querySelector('.project-path-form'));
  assert.ok(missing.querySelector('[data-unregister]'));
  assert.equal(missing.querySelector('.config-form'), null);

  const local = parse(
    projectsViewTemplate(
      [{ id: 'aaa111', name: 'alpha', path: '/repos/alpha', alive: true }],
      'aaa111',
      { content: 'project_id: aaa111', revision: 'rev' },
      true,
    ),
  );
  assert.ok(local.querySelector('.config-form'));
  assert.equal(local.querySelector('.project-path-form'), null);
  assert.equal(local.querySelector('[data-unregister]'), null);
});

test('111218 CR3/CR9: project mutation disables controls pending and completes once', async () => {
  const root = document.createElement('form');
  root.innerHTML = '<button>Save</button><input><textarea></textarea><p class="project-error"></p>';
  let resolveRequest;
  let successes = 0;
  const pending = projectMutation(
    root,
    () =>
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    async () => {
      successes++;
    },
  );
  assert.ok(root.classList.contains('is-pending'));
  assert.ok([...root.querySelectorAll('button,input,textarea')].every((item) => item.disabled));
  resolveRequest({ ok: true, json: async () => ({ ok: true }) });
  await pending;
  assert.equal(successes, 1);
  assert.ok([...root.querySelectorAll('button,input,textarea')].every((item) => !item.disabled));
});

test('111218 CR4/CR9: project mutation keeps the form and exposes a server error', async () => {
  const root = document.createElement('form');
  root.innerHTML =
    '<button>Save</button><textarea>candidate yaml</textarea><p class="project-error" hidden></p>';
  let successes = 0;
  await projectMutation(
    root,
    async () => ({
      ok: false,
      json: async () => ({ error: 'configuration changed on disk; reload before saving' }),
    }),
    async () => {
      successes++;
    },
  );
  assert.equal(successes, 0);
  assert.equal(root.querySelector('textarea').value, 'candidate yaml');
  assert.equal(root.querySelector('.project-error').hidden, false);
  assert.match(root.querySelector('.project-error').textContent, /configuration changed on disk/);
});

test('111218 CR7: unregister confirmation names the project and promises no deletion', () => {
  let message = '';
  const answer = requestUnregisterConfirmation({ name: 'alpha' }, (value) => {
    message = value;
    return 'alpha';
  });
  assert.equal(answer, 'alpha');
  assert.match(message, /Type "alpha"/);
  assert.match(message, /No repository files will be deleted/);
});

test('111218 CR3/CR6/CR7/CR9: project view wires select, reload, save, repair and unregister', () => {
  const root = parse(
    projectsViewTemplate(
      [{ id: 'aaa111', name: 'alpha', path: '/repos/alpha', alive: true }],
      'aaa111',
      { content: 'project_name: alpha', revision: 'rev', schemaVersion: 0, supported: 2 },
      false,
    ),
  );
  const calls = [];
  bindProjectViewActions(root, {
    select: (id) => calls.push(['select', id]),
    reload: () => calls.push(['reload']),
    saveRaw: (content, form) => calls.push(['saveRaw', content, form.className]),
    repair: (projectPath, form) => calls.push(['repair', projectPath, form.className]),
    unregister: (editor) => calls.push(['unregister', editor.className]),
  });

  root.querySelector('[data-manage-project]').click();
  root.querySelector('[data-reload-config]').click();
  root
    .querySelector('.config-form')
    .dispatchEvent(new window.Event('submit', { cancelable: true }));
  root
    .querySelector('.project-path-form')
    .dispatchEvent(new window.Event('submit', { cancelable: true }));
  root.querySelector('[data-unregister]').click();

  assert.deepEqual(calls, [
    ['select', 'aaa111'],
    ['reload'],
    ['saveRaw', 'project_name: alpha', 'config-form'],
    ['repair', '/repos/alpha', 'project-path-form'],
    ['unregister', 'project-editor'],
  ]);
});

test('111219 CR1/CR2: restored state hydrates search, active view and global mode', () => {
  const root = document.createElement('div');
  root.innerHTML = `<input id="search"><button id="toggle-global"></button>
    ${['board', 'table', 'graph', 'specs', 'metrics', 'projects']
      .map((name) => `<button id="view-${name}"></button><section id="${name}"></section>`)
      .join('')}
    <section id="global"></section>`;
  appState.filters.text = 'authentication';
  appState.currentView = 'graph';
  appState.globalMode = false;
  syncViewerShell(root, false);
  assert.equal(root.querySelector('#search').value, 'authentication');
  assert.ok(root.querySelector('#view-graph').classList.contains('active'));
  assert.ok(!root.querySelector('#graph').classList.contains('hidden'));
  assert.ok(root.querySelector('#board').classList.contains('hidden'));

  appState.globalMode = true;
  syncViewerShell(root, false);
  assert.ok(root.querySelector('#toggle-global').classList.contains('active'));
  assert.ok(!root.querySelector('#global').classList.contains('hidden'));
  assert.ok(root.querySelector('#graph').classList.contains('hidden'));
});

test('111219 CR1/CR6: bootstrap restores shell synchronously and tolerates blocked storage access', () => {
  const shell = () => {
    const root = document.createElement('div');
    root.innerHTML = `<input id="search"><button id="toggle-global"></button>
      ${['board', 'table', 'graph', 'specs', 'metrics', 'projects']
        .map((name) => `<button id="view-${name}"></button><section id="${name}"></section>`)
        .join('')}
      <section id="global"></section>`;
    return root;
  };
  const root = shell();
  const snapshot = JSON.stringify({
    version: 1,
    currentView: 'table',
    globalMode: true,
    text: 'restored before fetch',
    projects: {},
  });
  restoreInitialViewerShell(root, () => ({ getItem: () => snapshot, setItem() {} }));
  assert.equal(root.querySelector('#search').value, 'restored before fetch');
  assert.ok(root.querySelector('#view-table').classList.contains('active'));
  assert.ok(root.querySelector('#toggle-global').classList.contains('active'));
  assert.ok(!root.querySelector('#global').classList.contains('hidden'));

  assert.doesNotThrow(() =>
    restoreInitialViewerShell(shell(), () => {
      throw new window.DOMException('blocked', 'SecurityError');
    }),
  );
});

test('111219 CR4: no live project replaces a restored view with the visible empty state', () => {
  const root = document.createElement('div');
  root.innerHTML = `<input id="search"><button id="toggle-global"></button>
    ${['board', 'table', 'graph', 'specs', 'metrics', 'projects']
      .map((name) => `<button id="view-${name}"></button><section id="${name}"></section>`)
      .join('')}
    <section id="global"></section>`;
  appState.currentProject = null;
  appState.currentView = 'table';
  appState.globalMode = true;

  showNoProjects(root);

  assert.equal(appState.currentView, 'board');
  assert.equal(appState.globalMode, false);
  assert.ok(root.querySelector('#view-board').classList.contains('active'));
  assert.ok(!root.querySelector('#board').classList.contains('hidden'));
  assert.ok(root.querySelector('#table').classList.contains('hidden'));
  assert.match(root.querySelector('#board').textContent, /No projects registered/);
});

test('175732 CR1: a payload in id/type/status does not create active HTML in a card', () => {
  const host = parse(card({ ...baseChange(), id: XSS, type: XSS, status: XSS }));
  assert.equal(host.querySelector('img'), null, 'no injected <img>');
  assert.equal(host.querySelectorAll('[onerror]').length, 0, 'no event-handler attribute');
});

test('175732 CR1: a payload in a stage heading does not create active HTML', () => {
  const host = parse(stageBlock(baseChange(), { key: 'request', heading: XSS, body: 'hi' }));
  assert.equal(host.querySelector('img'), null);
  assert.equal(host.querySelectorAll('[onerror]').length, 0);
});

test('175732 CR1: a payload in a task resolution timestamp does not create active HTML', () => {
  const tasks = [{ text: 'do it', state: 'done', criteria: [], resolvedAt: XSS }];
  const host = parse(`<ul>${taskList(tasks)}</ul>`);
  assert.equal(host.querySelector('img'), null);
  assert.equal(host.querySelectorAll('[onerror]').length, 0);
});

test('175732 CR2: a quote-bearing id stays inside the data-id attribute', () => {
  const host = parse(card({ ...baseChange(), id: XSS }));
  const el = host.querySelector('.card');
  assert.equal(el.dataset.id, XSS, 'attribute value is the literal id, not broken out');
});

test('175732 CR2: a crafted type cannot inject into the CSS custom property', () => {
  // `var(--TYPE)` must not accept arbitrary text; cssIdent whitelists identifiers.
  assert.equal(cssIdent('feature'), 'feature');
  assert.equal(cssIdent('a); } body { x:1'), 'muted');
  assert.equal(cssIdent('"><img>'), 'muted');
  const host = parse(tableRow({ ...baseChange(), type: 'x); }' }));
  const styled = host.querySelector('[style*="--type-color"]');
  assert.match(styled.getAttribute('style'), /var\(--muted\)/, 'falls back to a safe ident');
  assert.ok(!/var\(--x/.test(styled.getAttribute('style')), 'crafted type not in the declaration');
});

test('175732 CR4: esc still neutralizes the core HTML metacharacters', () => {
  assert.equal(esc('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
});

test('210508 CR6 / 125850 CR2: discarded is hidden by default and gets an opt-in board column', () => {
  const f = {
    text: '',
    type: 'all',
    owner: 'all',
    statuses: new Set(),
    showArchived: false,
    showDiscarded: false,
  };
  const c = { ...baseChange(), status: 'discarded' };
  assert.equal(isVisible(c, f), false, 'hidden by default');
  assert.equal(isVisible(c, { ...f, showDiscarded: true }), true, 'shown with the toggle');
  assert.deepEqual(boardStatuses(['draft', 'approved', 'done', 'discarded']), [
    'draft',
    'approved',
    'done',
  ]);
  assert.deepEqual(boardStatuses(['draft', 'done', 'discarded'], true), [
    'draft',
    'done',
    'discarded',
  ]);
  // The graph uses passesTombstones directly (shared with isVisible) so it can't
  // diverge: discarded is hidden by default there too, shown only with the toggle.
  assert.equal(passesTombstones(c, f), false, 'graph hides discarded by default');
  assert.equal(passesTombstones(c, { ...f, showDiscarded: true }), true, 'graph shows with toggle');
  assert.equal(
    passesTombstones({ ...baseChange(), archived: true }, f),
    false,
    'graph hides archived',
  );
});

test('125850 CR1: compact status summary reports all, one, or a count', () => {
  assert.equal(statusSummary(new Set()), 'All statuses');
  assert.equal(statusSummary(new Set(['in-validation'])), 'In validation');
  assert.equal(statusSummary(new Set(['draft', 'done'])), '2 statuses');
});

test('105206 CR2/CR4: owner summary names an unassigned-only selection', () => {
  assert.equal(choiceFilterSummary('Owner', new Set(), true), 'Unassigned');
  assert.equal(choiceFilterSummary('Owner', new Set(['ana'])), 'ana');
  assert.equal(choiceFilterSummary('Owner', new Set(['ana']), true), '2 selected');
});

test('105206 CR1/CR2/CR3: type and owner sets combine inclusively without a sentinel', () => {
  const filters = {
    text: '',
    types: new Set(['feature', 'bug']),
    owners: new Set(['ana']),
    includeUnassigned: true,
    statuses: new Set(),
    showArchived: false,
    showDiscarded: false,
  };
  assert.equal(isVisible({ ...baseChange(), type: 'feature', owner: 'ana' }, filters), true);
  assert.equal(isVisible({ ...baseChange(), type: 'bug', owner: null }, filters), true);
  assert.equal(isVisible({ ...baseChange(), type: 'chore', owner: 'ana' }, filters), false);
  assert.equal(
    isVisible({ ...baseChange(), type: 'feature', owner: '__unassigned__' }, filters),
    false,
  );
});

test('111457 CR8: legacy prose is ordinary spec content, not graduation metadata', () => {
  const body = `# Architecture

> Graduado del change 20260613-120000 (first).
> Graduado del change 20260613-120001 (second).

Normal truth.

> A regular quote.`;
  const host = parse(specBody(body, []));
  assert.equal(host.querySelector('details.change-references'), null);
  assert.match(host.textContent, /Graduado del change 20260613-120000/);
  assert.match(host.textContent, /Normal truth/);
  assert.match(host.textContent, /A regular quote/);
});

test('125850 CR7/CR8: table cells have explicit wrapping roles and a safe status badge', () => {
  const host = parse(
    tableRow({
      ...baseChange(),
      status: 'in-validation',
      depends_on: ['20260613-120000', '20260613-120001'],
    }),
  );
  assert.ok(host.querySelector('.cell-id.cell-nowrap'));
  assert.ok(host.querySelector('.cell-title.cell-nowrap'));
  assert.ok(host.querySelector('.cell-progress.cell-nowrap'));
  assert.ok(host.querySelector('.cell-deps:not(.cell-nowrap)'));
  const tag = host.querySelector('.status-tag');
  assert.equal(tag.textContent.trim(), 'In validation');
  assert.match(tag.getAttribute('style'), /--status-in-validation/);

  const unsafe = parse(statusTag('x); } body { color: red'));
  assert.match(unsafe.querySelector('.status-tag').getAttribute('style'), /--status-muted/);
});

test('125850 CR3/CR4: validation card and detail close control expose accessible hooks', () => {
  const closeHost = parse(closeButton());
  const close = closeHost.querySelector('button.close');
  assert.equal(close.getAttribute('aria-label'), 'Close detail');
  assert.ok(close.querySelector('svg'));
  const host = parse(validationPanel());
  assert.equal(
    host.querySelector('label[for="validation-reason"]')?.textContent,
    'Reason for rejection',
  );
  assert.ok(host.querySelector('[data-validation="pass"].button-primary'));
  assert.ok(host.querySelector('[data-validation="fail"].button-danger'));
  assert.equal(host.querySelector('.validation-error').getAttribute('role'), 'alert');
});

test('125850 CR3: validation submission disables controls pending and removes stale UI on success', async () => {
  const host = parse(validationPanel());
  let resolveRequest;
  const request = new Promise((resolve) => {
    resolveRequest = resolve;
  });
  const submission = runValidationSubmission({
    root: host,
    request: () => request,
    onSuccess: async () => host.replaceChildren(),
  });
  assert.ok(host.querySelector('.validation-actions').classList.contains('is-pending'));
  assert.ok([...host.querySelectorAll('button, input')].every((control) => control.disabled));

  resolveRequest({ ok: true, json: async () => ({ ok: true }) });
  assert.equal(await submission, true);
  assert.equal(host.querySelector('.validation-actions'), null);
});

test('125850 CR3: validation error re-enables controls and preserves the rejection reason', async () => {
  const host = parse(validationPanel());
  const input = host.querySelector('[data-validation-reason]');
  input.value = 'Still fails on device';
  const result = await runValidationSubmission({
    root: host,
    request: async () => ({ ok: false, json: async () => ({ error: 'Transition rejected' }) }),
    onSuccess: async () => assert.fail('error response must not call onSuccess'),
  });
  assert.equal(result, false);
  assert.ok([...host.querySelectorAll('button, input')].every((control) => !control.disabled));
  assert.equal(input.value, 'Still fails on device');
  const error = host.querySelector('.validation-error');
  assert.equal(error.hidden, false);
  assert.equal(error.textContent, 'Transition rejected');
});

test('005437 CR1/CR2/CR3: a reused validation panel is enabled after a successful verdict', async () => {
  const host = parse(validationPanel());
  const result = await runValidationSubmission({
    root: host,
    request: async () => ({ ok: true, json: async () => ({ ok: true }) }),
    // Lit reuses this subtree when the next in-validation change opens.
    onSuccess: async () => render(validationPanel(), host),
  });

  assert.equal(result, true);
  assert.equal(host.querySelector('.validation-actions').classList.contains('is-pending'), false);
  assert.ok([...host.querySelectorAll('button, input')].every((control) => !control.disabled));
});

test('005437 CR2: opening another validation panel clears the previous form error', async () => {
  const host = parse(validationPanel());
  await runValidationSubmission({
    root: host,
    request: async () => ({ ok: false, json: async () => ({ error: 'First change failed' }) }),
    onSuccess: async () => assert.fail('error response must not call onSuccess'),
  });
  assert.equal(host.querySelector('.validation-error').hidden, false);

  render(validationPanel(), host);
  resetValidationState(host);
  assert.equal(host.querySelector('.validation-error').hidden, true);
  assert.equal(host.querySelector('.validation-error').textContent, '');
  assert.ok([...host.querySelectorAll('button, input')].every((control) => !control.disabled));
});

test('150232 CR-retry: reopen and validation panels never share a grid container class', () => {
  // Regression: reopenPanel() (2 children) once reused .validation-controls,
  // whose 3-track grid template is owned by validationPanel() (3 children).
  // Sharing the class silently breaks whichever panel's child count doesn't
  // match the other's track count.
  const validation = parse(validationPanel());
  const validationControls = validation.querySelector('.validation-controls');
  assert.equal(validationControls.children.length, 3);
  assert.equal(validation.querySelector('.reopen-controls'), null);

  const reopen = parse(reopenPanel('done'));
  const reopenControls = reopen.querySelector('.reopen-controls');
  assert.equal(reopenControls.children.length, 2);
  assert.equal(reopen.querySelector('.validation-controls'), null);
});

test('150232 CR4: only a done change exposes an accessible reopen action', () => {
  const done = parse(reopenPanel('done'));
  assert.equal(
    done.querySelector('label[for="reopen-reason"]')?.textContent,
    'Reason for reopening',
  );
  assert.ok(done.querySelector('[data-reopen]'));
  assert.equal(done.querySelector('.validation-error').getAttribute('role'), 'alert');

  assert.equal(parse(reopenPanel('discarded')).querySelector('[data-reopen]'), null);
  assert.equal(parse(reopenPanel('in-progress')).querySelector('[data-reopen]'), null);
});

test('150232 CR4: reopen requires a reason and preserves the form on request failure', async () => {
  const host = parse(reopenPanel('done'));
  document.body.append(host);
  const input = host.querySelector('[data-reopen-reason]');
  let requestedReason;
  let successes = 0;
  bindReopenAction({
    root: host,
    request: async (reason) => {
      requestedReason = reason;
      return { ok: false, json: async () => ({ error: 'Reopen rejected' }) };
    },
    onSuccess: async () => {
      successes++;
    },
  });

  assert.equal(await host.querySelector('[data-reopen]').onclick(), false);
  assert.equal(requestedReason, undefined);
  assert.equal(
    host.querySelector('.validation-error').textContent,
    'A reopening reason is required.',
  );
  assert.equal(document.activeElement, input);

  input.value = 'Acceptance evidence was incomplete';
  assert.equal(await host.querySelector('[data-reopen]').onclick(), false);
  assert.equal(requestedReason, 'Acceptance evidence was incomplete');
  assert.equal(successes, 0);
  assert.equal(input.value, 'Acceptance evidence was incomplete');
  assert.equal(host.querySelector('.validation-error').textContent, 'Reopen rejected');
  assert.ok([...host.querySelectorAll('button, input')].every((control) => !control.disabled));
  host.remove();
});

test('150232 CR4: successful reopen sends the reason and keeps completion in caller control', async () => {
  const host = parse(reopenPanel('done'));
  host.querySelector('[data-reopen-reason]').value = 'Production validation found a regression';
  let requestedReason;
  let successes = 0;
  bindReopenAction({
    root: host,
    request: async (reason) => {
      requestedReason = reason;
      return { ok: true, json: async () => ({ ok: true }) };
    },
    onSuccess: async () => {
      successes++;
    },
  });

  assert.equal(await host.querySelector('[data-reopen]').onclick(), true);
  assert.equal(requestedReason, 'Production validation found a regression');
  assert.equal(successes, 1);
});

test('150228 CR1/CR2/CR6: detail controls expose and apply accessible layout presets', () => {
  const host = document.createElement('div');
  host.innerHTML = '<div id="overlay"><article id="detail"></article></div>';
  const detail = host.querySelector('#detail');
  render(detailPresentationControls('side', 'wide'), detail);
  const layout = detail.querySelector('[role="group"][aria-label="Layout"]');
  const width = detail.querySelector('[role="group"][aria-label="Width"]');
  assert.ok(layout);
  assert.ok(width);
  assert.equal(
    detail.querySelector('[data-detail-value="side"]').getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(
    detail.querySelector('[data-detail-value="wide"]').getAttribute('aria-pressed'),
    'true',
  );

  bindDetailPresentation(host);
  detail.querySelector('[data-detail-value="floating"]').click();
  detail.querySelector('[data-detail-value="full"]').click();
  applyDetailPresentation(host);

  assert.equal(host.querySelector('#overlay').dataset.detailMode, 'floating');
  assert.equal(detail.dataset.detailSize, 'full');
  assert.equal(appState.detailMode, 'floating');
  assert.equal(appState.detailSize, 'full');
  assert.equal(
    detail.querySelector('[data-detail-value="floating"]').getAttribute('aria-pressed'),
    'true',
  );
});

test('20260704-103715 CR1/CR2/CR3: detail toolbar groups persistent actions and optional stage navigation', () => {
  const change = parse(
    detailToolbar('floating', 'wide', [
      { key: 'request', heading: 'Request' },
      { key: 'investigation', heading: 'Investigation' },
      { key: 'plan', heading: 'Plan' },
    ]),
  );
  const toolbar = change.querySelector('.detail-toolbar');
  assert.ok(toolbar);
  assert.ok(toolbar.querySelector('.detail-presentation'));
  assert.ok(toolbar.querySelector('.close'));
  assert.equal(toolbar.querySelector('.pipeline').getAttribute('aria-label'), 'Change sections');
  assert.deepEqual(
    [...toolbar.querySelectorAll('[data-go]')].map((button) => button.textContent),
    ['Request', 'Investigation', 'Plan'],
  );

  const spec = parse(detailToolbar('side', 'compact'));
  assert.ok(spec.querySelector('.detail-toolbar .detail-presentation'));
  assert.ok(spec.querySelector('.detail-toolbar .close'));
  assert.equal(spec.querySelector('.pipeline'), null);
});

test('20260704-103715 CR2/CR5: stage navigation cannot keep moving a replacement document', () => {
  let options;
  scrollToStage({
    scrollIntoView(value) {
      options = value;
    },
  });

  assert.deepEqual(options, { behavior: 'auto', block: 'start' });
});

test('20260704-103715 CR1/CR2/CR4/CR5: detail CSS keeps the toolbar fixed and disables scroll anchoring', () => {
  const css = fs.readFileSync(new URL('../src/viewer/public/styles.css', import.meta.url), 'utf8');

  assert.match(css, /\.detail\s*\{[^}]*overflow-anchor:\s*none/s);
  assert.match(css, /\.detail-toolbar\s*\{[^}]*position:\s*sticky/s);
  assert.match(css, /\.pipeline\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(css, /\.stage\s*\{[^}]*scroll-margin-top:/s);
});

test('125850 CR5: real diagram lightbox clones SVG and closes by button, Escape, or backdrop', () => {
  const fixture = document.createElement('div');
  fixture.innerHTML = `<div class="hidden" id="lightbox"><button type="button">Close</button><div class="canvas"></div></div>
    <div class="origin" tabindex="0"><svg viewBox="0 0 20 10"><text>diagram</text></svg></div>`;
  document.body.append(fixture);
  const overlay = fixture.querySelector('#lightbox');
  const canvas = fixture.querySelector('.canvas');
  const close = fixture.querySelector('button');
  const origin = fixture.querySelector('.origin');
  const source = origin.querySelector('svg');
  const lightbox = createDiagramLightbox({ overlay, canvas, closeButton: close });

  assert.equal(lightbox.open(origin), true);
  assert.equal(overlay.classList.contains('hidden'), false);
  assert.ok(canvas.querySelector('svg'));
  assert.notEqual(canvas.querySelector('svg'), source);
  assert.equal(document.activeElement, close);
  close.click();
  assert.equal(overlay.classList.contains('hidden'), true);
  assert.equal(canvas.children.length, 0);
  assert.equal(document.activeElement, origin);

  lightbox.open(origin);
  assert.equal(
    lightbox.handleKeydown(new window.KeyboardEvent('keydown', { key: 'Escape' })),
    true,
  );
  assert.equal(document.activeElement, origin);

  lightbox.open(origin);
  overlay.click();
  assert.equal(overlay.classList.contains('hidden'), true);
  assert.equal(document.activeElement, origin);
  fixture.remove();
});

test('105206 CR4: every filter menu closes only for an outside pointer target', () => {
  const typeMenu = document.createElement('details');
  const ownerMenu = document.createElement('details');
  const statusMenu = document.createElement('details');
  const inside = document.createElement('button');
  const outside = document.createElement('button');
  typeMenu.append(inside);
  typeMenu.open = true;
  ownerMenu.open = true;
  statusMenu.open = true;

  assert.equal(closeFilterMenusOnOutsideClick([typeMenu, ownerMenu, statusMenu], inside), true);
  assert.equal(typeMenu.open, true);
  assert.equal(ownerMenu.open, false);
  assert.equal(statusMenu.open, false);

  ownerMenu.open = true;
  statusMenu.open = true;
  assert.equal(closeFilterMenusOnOutsideClick([typeMenu, ownerMenu, statusMenu], outside), true);
  assert.equal(typeMenu.open, false);
  assert.equal(ownerMenu.open, false);
  assert.equal(statusMenu.open, false);
});

test('125850 CR9: sort indicator is a bounded SVG icon', () => {
  const host = parse(sortIndicator(1));
  const icon = host.querySelector('svg.sort-indicator');
  assert.equal(icon.getAttribute('width'), '10');
  assert.equal(icon.getAttribute('height'), '10');
  assert.equal(icon.getAttribute('viewBox'), '0 0 10 10');
});

test('105456 CR6: spec history resolves metadata, navigation and unavailable ids', () => {
  const changes = [
    { ...baseChange(), id: '20260613-120000', title: 'First origin', owner: 'Ana' },
    { ...baseChange(), id: '20260613-120001', title: 'Second origin' },
  ];
  const host = parse(
    specBody(
      '# Architecture\n\nPersistent truth.',
      ['20260613-120000', '20260613-120001', '20990101-000000'],
      changes,
    ),
  );
  const details = host.querySelector('details.change-references');
  assert.ok(details);
  assert.equal(details.open, false);
  assert.equal(details.querySelector('.reference-count').textContent, '3');
  assert.equal(details.querySelectorAll('button[data-change]').length, 2);
  assert.equal(details.querySelector('button').dataset.change, '20260613-120000');
  assert.match(details.textContent, /First origin.*feature.*draft.*@Ana/s);
  assert.match(details.textContent, /20990101-000000.*Unavailable.*unavailable/s);
  assert.match(host.textContent, /Persistent truth/);
});

test('105456 CR5/CR7: common reference component separates local and external entries', () => {
  const changes = [{ ...baseChange(), id: 'B', title: 'Related B', owner: 'Ana' }];
  const host = parse(
    referenceDetails(
      'Related changes',
      [
        { id: 'B', direction: 'outgoing' },
        { id: 'other-project:20260701-090000', direction: 'outgoing' },
      ],
      changes,
      '↔',
    ),
  );
  assert.match(host.querySelector('summary').textContent, /Related changes.*2/s);
  assert.match(host.textContent, /Related B.*feature.*draft.*@Ana/s);
  assert.equal(host.querySelector('[data-change="B"]')?.tagName, 'BUTTON');
  assert.equal(
    host.querySelector('[data-external="other-project:20260701-090000"]')?.tagName,
    'BUTTON',
  );
});

test('111457 request: structured graduation history resolves a change for navigation', () => {
  const found = { id: '20260613-120000', title: 'Origin' };
  let opened;
  openChangeById(found.id, { repo: { changes: [found] } }, (id) => {
    opened = id;
  });
  assert.equal(opened, found.id);

  opened = undefined;
  openChangeById('missing', { repo: { changes: [found] } }, (id) => {
    opened = id;
  });
  assert.equal(opened, undefined);
});

test('222619 CR1: graph empty state does not render invalid dimensions', () => {
  const host = parse(graphSvg([]));
  assert.equal(host.querySelector('.empty')?.textContent, 'No changes match the current filters.');
  assert.equal(host.querySelector('svg'), null);
  assert.doesNotMatch(host.innerHTML, /Infinity|NaN/);
});

test('222619 CR2: graph with changes keeps finite svg dimensions and nodes', () => {
  const host = parse(
    graphSvg([
      baseChange(),
      {
        ...baseChange(),
        id: '20260613-120001',
        title: 'dependent',
        depends_on: ['20260613-120000'],
      },
    ]),
  );
  const svg = host.querySelector('svg');
  assert.ok(svg, 'graph renders an svg');
  assert.doesNotMatch(svg.getAttribute('viewBox'), /Infinity|NaN/);
  assert.doesNotMatch(svg.getAttribute('height'), /Infinity|NaN/);
  assert.equal(host.querySelectorAll('.node').length, 2);
  assert.equal(host.querySelectorAll('.edge').length, 1);
});

test('105456 CR5: graph renders deduplicated dashed undirected relation edges', () => {
  const host = parse(
    graphSvg([
      { ...baseChange(), id: 'A', title: 'A', related_to: ['B'] },
      { ...baseChange(), id: 'B', title: 'B', related_to: ['A'] },
    ]),
  );
  assert.equal(host.querySelectorAll('.relation-edge').length, 1);
  assert.equal(host.querySelectorAll('.edge').length, 0);
});

const nodeX = (host, id) => {
  const transform = host.querySelector(`.node[data-id="${id}"]`)?.getAttribute('transform') ?? '';
  const match = transform.match(/translate\((\d+),/);
  return match ? Number(match[1]) : Number.NaN;
};

test('162104 CR1: graph shared dependencies do not collapse depth', () => {
  const changes = [
    { ...baseChange(), id: 'A', title: 'A' },
    { ...baseChange(), id: 'B', title: 'B', depends_on: ['A'] },
    { ...baseChange(), id: 'C', title: 'C', depends_on: ['A'] },
    { ...baseChange(), id: 'D', title: 'D', depends_on: ['B', 'C'] },
  ];
  const host = parse(graphSvg(changes));
  assert.ok(nodeX(host, 'D') > nodeX(host, 'B'));
  assert.ok(nodeX(host, 'D') > nodeX(host, 'C'));
  assert.equal(host.querySelectorAll('.edge').length, 4);
});

test('162104 CR2: graph with a real cycle stays finite', () => {
  const host = parse(
    graphSvg([
      { ...baseChange(), id: 'A', title: 'A', depends_on: ['B'] },
      { ...baseChange(), id: 'B', title: 'B', depends_on: ['A'] },
    ]),
  );
  const svg = host.querySelector('svg');
  assert.ok(svg, 'graph renders an svg');
  assert.doesNotMatch(svg.getAttribute('viewBox'), /Infinity|NaN/);
  assert.equal(host.querySelectorAll('.node').length, 2);
});

test('162104 CR3: simple graph still places dependents after dependencies', () => {
  const host = parse(
    graphSvg([
      { ...baseChange(), id: 'A', title: 'A' },
      { ...baseChange(), id: 'B', title: 'B', depends_on: ['A'] },
    ]),
  );
  assert.ok(nodeX(host, 'B') > nodeX(host, 'A'));
});

// 20260711-155721 — metricsHtml: KPI cards, hand-rolled throughput SVG,
// common-scale time-in-status bars, and the explicit empty state.

test('155721 CR5: zero visible changes render an explicit empty state, no NaN/Infinity', () => {
  const host = parse(metricsHtml({}, 0));
  assert.ok(host.querySelector('.empty'));
  assert.equal(host.querySelector('.metrics-cards'), null);
  assert.doesNotMatch(host.innerHTML, /NaN|Infinity/);
});

test('155721 CR4/CR5: KPI cards render all seven values without NaN even with no closed changes', () => {
  const metrics = {
    count: 0,
    p50CycleMs: 0,
    p85CycleMs: 0,
    blockedMs: 0,
    validationWaitMs: 0,
    reviewRetries: 0,
    wip: { 'in-progress': 2 },
    aging: [],
    throughput: [],
    timeInStatus: [],
    byType: [],
    byOwner: [],
  };
  const host = parse(metricsHtml(metrics, 2));
  const cards = host.querySelectorAll('.metric-card');
  assert.equal(cards.length, 7);
  assert.doesNotMatch(host.innerHTML, /NaN|Infinity/);
  assert.match(host.querySelector('.metrics-cards').textContent, /WIP/);
});

test('155721 CR4: throughput renders an svg with one bar, a date label and a numeric value per day', () => {
  const metrics = {
    count: 2,
    p50CycleMs: HOUR,
    p85CycleMs: HOUR,
    blockedMs: 0,
    validationWaitMs: 0,
    reviewRetries: 0,
    wip: {},
    aging: [],
    throughput: [
      { date: '2026-07-01', count: 1 },
      { date: '2026-07-02', count: 3 },
    ],
    timeInStatus: [],
    byType: [],
    byOwner: [],
  };
  const host = parse(metricsHtml(metrics, 2));
  const svgEl = host.querySelector('svg.throughput-svg');
  assert.ok(svgEl, 'renders a throughput svg');
  assert.equal(svgEl.querySelectorAll('.tp-bar').length, 2);
  const values = [...svgEl.querySelectorAll('.tp-value')].map((n) => n.textContent);
  assert.deepEqual(values, ['1', '3']);
  const dates = [...svgEl.querySelectorAll('.tp-date')].map((n) => n.textContent);
  assert.deepEqual(dates, ['2026-07-01', '2026-07-02']);
  assert.doesNotMatch(svgEl.outerHTML, /NaN|Infinity/);
});

test('155721 CR4: time-in-status bars share one common scale across states', () => {
  const metrics = {
    count: 1,
    p50CycleMs: HOUR,
    p85CycleMs: HOUR,
    blockedMs: 0,
    validationWaitMs: 0,
    reviewRetries: 0,
    wip: {},
    aging: [],
    throughput: [],
    timeInStatus: [
      { state: 'in-progress', totalMs: 4 * HOUR, avgMs: 4 * HOUR },
      { state: 'in-review', totalMs: 2 * HOUR, avgMs: 2 * HOUR },
    ],
    byType: [],
    byOwner: [],
  };
  const host = parse(metricsHtml(metrics, 1));
  const bars = [...host.querySelectorAll('.bar-row .bar')];
  assert.equal(bars.length, 2);
  const widths = bars.map((b) => Number.parseFloat(b.style.width));
  // Same max (4h) drives both widths, so in-review is exactly half of in-progress.
  assert.equal(widths[0], 100);
  assert.equal(widths[1], 50);
  const values = [...host.querySelectorAll('.bar-row .mono')].map((n) => n.textContent);
  assert.deepEqual(values, ['4.0 h', '2.0 h']);
});

test('155721 CR3/CR4: byType and byOwner render as separate tables with visible values', () => {
  const metrics = {
    count: 2,
    p50CycleMs: HOUR,
    p85CycleMs: HOUR,
    blockedMs: 0,
    validationWaitMs: 0,
    reviewRetries: 0,
    wip: {},
    aging: [],
    throughput: [],
    timeInStatus: [],
    byType: [{ type: 'bug', closed: 2, avgCycleMs: 3 * HOUR }],
    byOwner: [
      { owner: 'alice', closed: 1, avgCycleMs: 2 * HOUR },
      { owner: 'unassigned', closed: 1, avgCycleMs: 4 * HOUR },
    ],
  };
  const host = parse(metricsHtml(metrics, 2));
  const tables = host.querySelectorAll('table.grid');
  assert.equal(tables.length, 2);
  assert.match(tables[0].textContent, /bug/);
  assert.match(tables[1].textContent, /alice/);
  assert.match(tables[1].textContent, /Unassigned/);
});

test('155721 CR6: below the KPI cards the content is a grid of four titled panels', () => {
  const metrics = {
    count: 1,
    p50CycleMs: HOUR,
    p85CycleMs: HOUR,
    blockedMs: 0,
    validationWaitMs: 0,
    reviewRetries: 0,
    wip: { 'in-progress': 1 },
    aging: [{ id: '20260701-000001', ms: HOUR }],
    throughput: [{ date: '2026-07-01', count: 1 }],
    timeInStatus: [{ state: 'in-progress', totalMs: HOUR, avgMs: HOUR }],
    byType: [{ type: 'bug', closed: 1, avgCycleMs: HOUR }],
    byOwner: [{ owner: 'alice', closed: 1, avgCycleMs: HOUR }],
  };
  const host = parse(metricsHtml(metrics, 1));
  const grid = host.querySelector('.metrics-grid');
  assert.ok(grid, 'renders the quadrant grid');
  const panels = grid.querySelectorAll('.metrics-panel');
  assert.equal(panels.length, 4);
  for (const panel of panels) assert.ok(panel.querySelector('.metrics-h'));
  assert.ok(panels[0].querySelector('svg.throughput-svg'), 'throughput lives in the first panel');
});

// 20260628-113924 UI tests

// Future schema: Raw tab only, save button absent, textarea readonly
test('113924 CR10: future schema shows readonly raw and no save button', () => {
  const root = parse(
    projectsViewTemplate(
      [{ id: 'aaa111', name: 'alpha', path: '/repos/alpha', alive: true }],
      'aaa111',
      {
        content: 'schema_version: 2\nproject_id: "aaa111"\n',
        revision: 'rev',
        schemaVersion: 2,
        supported: 1,
        config: { schema_version: 2, project_id: 'aaa111' },
      },
      false,
    ),
  );
  // No save button inside the config section for future schema
  const configSection = root.querySelector('.config-section');
  assert.equal(
    configSection?.querySelectorAll('button[type="submit"]').length ?? 0,
    0,
    'no submit button in config section for future schema',
  );
  // Textarea is readonly
  const ta = root.querySelector('textarea[readonly]');
  assert.ok(ta, 'textarea must be readonly for future schema');
  // No Form tab
  const tabs = root.querySelectorAll('[data-config-mode]');
  const formTab = [...tabs].find((b) => b.dataset.configMode === 'form');
  assert.equal(formTab, undefined, 'no Form tab for future schema');
});

// Form mode: project_name field, lifecycle section, types with stages
test('113924 CR3 form: form renders project_name, lifecycle statuses, type stages and internal fields', () => {
  const root = parse(
    projectsViewTemplate(
      [{ id: 'aaa111', name: 'alpha', path: '/repos/alpha', alive: true }],
      'aaa111',
      {
        content: '',
        revision: 'rev',
        schemaVersion: 1,
        supported: 1,
        config: {
          schema_version: 1,
          project_id: 'aaa111',
          project_name: 'alpha',
          language: 'es',
          tdd: true,
          statuses: ['draft', 'approved', 'in-progress', 'done'],
          stages: ['request', 'plan', 'log'],
          types: { feature: { stages: ['request', 'plan', 'log'], review_required: true } },
          release: { impacts: { feature: 'minor' } },
          changes_dir: '.changeledger/changes',
          specs_dir: '.changeledger/specs',
        },
      },
      false,
    ),
  );
  // project_name field
  const projectNameInput = root.querySelector('input[name="project_name"]');
  assert.ok(projectNameInput, 'project_name input must be present');
  assert.equal(projectNameInput.value, 'alpha');

  // Lifecycle section shows statuses
  const lifecycleSection = [...root.querySelectorAll('fieldset legend')].find((l) =>
    l.textContent.includes('Lifecycle'),
  );
  assert.ok(lifecycleSection, 'Lifecycle fieldset must be present');

  assert.equal(
    root.querySelector('textarea[name="statuses"]').value,
    'draft\napproved\nin-progress\ndone',
  );
  assert.equal(root.querySelector('textarea[name="stages"]').value, 'request\nplan\nlog');
  assert.equal(root.querySelector('textarea[name="stages_feature"]').value, 'request\nplan\nlog');

  // Internal section shows project_id
  const internalText = root.querySelector('.config-group-internal')?.textContent ?? '';
  assert.match(internalText, /aaa111/);
  assert.doesNotMatch(internalText, /project_name/);
});

// Native <dialog>: no inline markup in template, mockable via setConfirmImpl
test('113924 CR1: showConfirm — no inline markup, mockable for tests', async () => {
  const root = parse(
    projectsViewTemplate(
      [{ id: 'aaa111', name: 'alpha', path: '/repos/alpha', alive: true }],
      'aaa111',
      {
        content: '',
        revision: 'rev',
        schemaVersion: 1,
        supported: 1,
        config: { project_id: 'aaa111' },
      },
      false,
    ),
  );
  // No inline confirm overlay in the template
  assert.equal(root.querySelector('[data-confirm-yes]'), null);
  assert.equal(root.querySelector('.config-confirm-overlay'), null);

  // showConfirm is mockable — returns the impl result
  let prompted = null;
  setConfirmImpl((msg) => {
    prompted = msg;
    return true;
  });
  const val = await showConfirm('Are you sure?');
  setConfirmImpl(null);
  assert.equal(val, true);
  assert.equal(prompted, 'Are you sure?');
});

test('113924 CR7: migration preview error is shown in UI', () => {
  const root = parse(
    projectsViewTemplate(
      [{ id: 'aaa111', name: 'alpha', path: '/repos/alpha', alive: true }],
      'aaa111',
      {
        content: '',
        revision: 'rev',
        schemaVersion: 0,
        supported: 1,
        config: { project_id: 'aaa111' },
      },
      false,
      { error: 'Migration failed: invalid YAML' },
    ),
  );
  // Error shown, not the preview YAML
  const error = root.querySelector('.project-error');
  assert.match(error?.textContent ?? '', /Migration failed/);
  assert.equal(error?.getAttribute('role'), 'alert');
  assert.equal(error?.getAttribute('aria-live'), 'assertive');
  // Retry button shown
  assert.ok(root.querySelector('[data-preview-migration]'), 'Retry preview button must be present');
});

test('113924 CR7: successful migration preview shows version summary and candidate', () => {
  const root = parse(
    projectsViewTemplate(
      [{ id: 'aaa111', name: 'alpha', path: '/repos/alpha', alive: true }],
      'aaa111',
      {
        content: 'language: en',
        revision: 'rev',
        schemaVersion: 0,
        supported: 1,
        config: { project_id: 'aaa111' },
      },
      false,
      {
        summary: 'Config migration 0 → 1 (dry run)',
        changes: ['added schema_version: 1'],
        yaml: 'schema_version: 1\nlanguage: en\n',
      },
    ),
  );
  assert.equal(
    root.querySelector('.config-migration-summary')?.textContent,
    'Config migration 0 → 1 (dry run)',
  );
  assert.match(
    root.querySelector('.config-migration-yaml')?.textContent ?? '',
    /schema_version: 1/,
  );
  assert.ok(root.querySelector('[data-apply-migration]'));
});

// CR11: dirty state guard
test('113924 CR11: bindProjectViewActions marks dirty and fires markDirty handler', () => {
  const root = parse(
    projectsViewTemplate(
      [{ id: 'aaa111', name: 'alpha', path: '/repos/alpha', alive: true }],
      'aaa111',
      {
        content: '',
        revision: 'rev',
        schemaVersion: 1,
        supported: 1,
        config: { project_id: 'aaa111', language: 'en', types: {}, statuses: [], stages: [] },
      },
      false,
    ),
  );
  let dirtyCalls = 0;
  bindProjectViewActions(root, {
    markDirty: () => {
      dirtyCalls++;
    },
  });
  // Simulate input on the form editor
  const formEditor = root.querySelector('[data-config-form]');
  if (formEditor) {
    formEditor.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(dirtyCalls, 1, 'markDirty called on input');
  }
});

test('113924 CR3 lifecycle: statuses and stages render as editable controls', () => {
  const root = parse(
    projectsViewTemplate(
      [{ id: 'aaa111', name: 'alpha', path: '/repos/alpha', alive: true }],
      'aaa111',
      {
        content: '',
        revision: 'rev',
        schemaVersion: 1,
        supported: 1,
        config: {
          project_id: 'aaa111',
          statuses: ['draft', 'approved', 'in-progress', 'in-validation', 'done', 'my-custom'],
          stages: ['request', 'plan', 'log'],
          types: {},
          language: 'en',
        },
      },
      false,
    ),
  );
  assert.match(root.querySelector('textarea[name="statuses"]')?.value ?? '', /my-custom/);
  assert.equal(root.querySelector('textarea[name="stages"]')?.value, 'request\nplan\nlog');
});

test('113924 CR4: form emits only fields changed by the human', () => {
  const config = {
    project_id: 'aaa111',
    project_name: 'alpha',
    language: 'es',
    tdd: true,
    changes_dir: '.changeledger/changes',
    specs_dir: '.changeledger/specs',
    statuses: [
      'draft',
      'approved',
      'in-progress',
      'in-review',
      'in-validation',
      'blocked',
      'done',
      'discarded',
    ],
    stages: ['request', 'investigation', 'proposal', 'specification', 'plan', 'log'],
    types: {
      feature: { stages: ['request', 'plan', 'log'], review_required: true },
      experiment: { stages: ['request', 'log'] },
    },
    release: { impacts: { feature: 'minor' } },
    readiness: { target_patterns: ['src/**'], verification_patterns: ['test/**'] },
  };
  const root = parse(
    projectsViewTemplate(
      [{ id: 'aaa111', name: 'alpha', path: '/repos/alpha', alive: true }],
      'aaa111',
      { content: '', revision: 'rev', schemaVersion: 1, supported: 1, config },
      false,
    ),
  );
  const form = root.querySelector('[data-config-form]');
  form.elements.language.value = 'en';
  assert.deepEqual(collectFormPatch(form, config), { language: 'en' });
});

test('225637 CR4/CR5: form edits and clears git.integration_branch', () => {
  const config = {
    schema_version: 3,
    project_id: 'aaa111',
    project_name: 'alpha',
    language: 'en',
    tdd: true,
    changes_dir: '.changeledger/changes',
    specs_dir: '.changeledger/specs',
    statuses: [
      'draft',
      'approved',
      'in-progress',
      'in-review',
      'in-validation',
      'blocked',
      'done',
      'discarded',
    ],
    stages: ['request', 'investigation', 'proposal', 'specification', 'plan', 'log'],
    types: {},
    git: { integration_branch: 'dev', custom: 'keep' },
  };
  const root = parse(
    projectsViewTemplate(
      [{ id: 'aaa111', name: 'alpha', path: '/repos/alpha', alive: true }],
      'aaa111',
      { content: '', revision: 'rev', schemaVersion: 3, supported: 3, config },
      false,
    ),
  );
  const form = root.querySelector('[data-config-form]');
  assert.equal(form.elements.integration_branch.value, 'dev');
  form.elements.integration_branch.value = 'develop';
  assert.deepEqual(collectFormPatch(form, config), { git: { integration_branch: 'develop' } });
  form.elements.integration_branch.value = '';
  assert.deepEqual(collectFormPatch(form, config), { git: { integration_branch: null } });
});

test('113924 CR3: custom type decisions can be configured without assumed defaults', () => {
  const config = {
    project_id: 'aaa111',
    statuses: [],
    stages: ['request', 'log'],
    types: { experiment: { stages: ['request', 'log'] } },
  };
  const root = parse(
    projectsViewTemplate(
      [{ id: 'aaa111', name: 'alpha', path: '/repos/alpha', alive: true }],
      'aaa111',
      { content: '', revision: 'rev', schemaVersion: 1, supported: 1, config },
      false,
    ),
  );
  const form = root.querySelector('[data-config-form]');
  assert.equal(form.elements.review_required_experiment.value, '');
  assert.equal(form.elements.impact_experiment.value, '');
  form.elements.review_required_experiment.value = 'true';
  form.elements.impact_experiment.value = 'minor';
  assert.deepEqual(collectFormPatch(form, config), {
    types: { experiment: { review_required: true } },
    release: { impacts: { experiment: 'minor' } },
  });
});

// showToast: exported and testable (just verifies it doesn't throw in test env)
test('113924: showToast does not throw when toast-container is absent', () => {
  assert.doesNotThrow(() => showToast('test error'));
});

test('113924: showPrompt is mockable via setPromptImpl', async () => {
  let prompted = null;
  setPromptImpl((msg) => {
    prompted = msg;
    return 'typed-value';
  });
  const val = await showPrompt('Type the name');
  setPromptImpl(null);
  assert.equal(val, 'typed-value');
  assert.equal(prompted, 'Type the name');
});

test('113924 CR12: dialogs and prompt input expose accessible names', async () => {
  const prototype = window.HTMLDialogElement.prototype;
  const originalShowModal = prototype.showModal;
  const originalClose = prototype.close;
  prototype.showModal = function showModal() {
    this.open = true;
  };
  prototype.close = function close() {
    this.open = false;
  };
  try {
    const confirmPromise = showConfirm('Discard unsaved changes?');
    const confirmDialog = document.body.querySelector('dialog');
    const confirmTitle = document.getElementById(confirmDialog.getAttribute('aria-labelledby'));
    assert.equal(confirmTitle?.textContent, 'Discard unsaved changes?');
    confirmDialog.querySelector('.cl-confirm-no').click();
    assert.equal(await confirmPromise, false);

    const promptPromise = showPrompt('Type the project name');
    const promptDialog = document.body.querySelector('dialog');
    const promptTitle = document.getElementById(promptDialog.getAttribute('aria-labelledby'));
    const input = promptDialog.querySelector('.cl-prompt-input');
    const label = promptDialog.querySelector(`label[for="${input.id}"]`);
    assert.equal(promptTitle?.textContent, 'Type the project name');
    assert.equal(label?.textContent, 'Confirmation value');
    promptDialog.querySelector('.cl-confirm-no').click();
    assert.equal(await promptPromise, null);
  } finally {
    if (originalShowModal === undefined) delete prototype.showModal;
    else prototype.showModal = originalShowModal;
    if (originalClose === undefined) delete prototype.close;
    else prototype.close = originalClose;
  }
});

test('113924: requestUnregisterConfirmation uses showPrompt when no ask override', async () => {
  setPromptImpl(() => 'alpha');
  const result = await requestUnregisterConfirmation({ name: 'alpha' });
  setPromptImpl(null);
  assert.equal(result, 'alpha');
});

// 20260711-155720 specs grid: excerpt, order, safe interpolation
const spec = (overrides) => ({
  title: 'Spec',
  updated: '2026-07-01T00:00:00Z',
  tags: [],
  body: '# Spec\n\nSome prose here.',
  ...overrides,
});

test('155720 CR2: card shows a plain-text excerpt of the first prose paragraph, skipping graduation history', () => {
  const host = parse(
    specsListHtml(
      [
        spec({
          body: `# Architecture

> Graduado del change 20260613-120000 (first).
> Graduado del change 20260613-120001 (second).

ChangeLedger separa **almacén** (fuente de verdad) de \`presentación\` [ver detalle](x).

## Componentes`,
        }),
      ],
      (d) => d,
    ),
  );
  const excerpt = host.querySelector('.spec-excerpt');
  assert.ok(excerpt);
  assert.equal(
    excerpt.textContent,
    'ChangeLedger separa almacén (fuente de verdad) de presentación ver detalle.',
  );
});

test('155720 CR2: excerpt is inserted as text, never interpretable HTML', () => {
  const host = parse(specsListHtml([spec({ body: `# T\n\n${XSS} some prose` })], (d) => d));
  assert.equal(host.querySelector('img'), null);
  assert.match(host.querySelector('.spec-excerpt').textContent, /some prose/);
});

test('155720 CR3: cards are ordered by updated descending', () => {
  const host = parse(
    specsListHtml(
      [
        spec({ title: 'Oldest', updated: '2026-01-01T00:00:00Z' }),
        spec({ title: 'Newest', updated: '2026-07-01T00:00:00Z' }),
        spec({ title: 'Middle', updated: '2026-04-01T00:00:00Z' }),
      ],
      (d) => d,
    ),
  );
  assert.deepEqual(
    [...host.querySelectorAll('.spec-title')].map((el) => el.textContent),
    ['Newest', 'Middle', 'Oldest'],
  );
});

test('113924: requestUnregisterConfirmation still accepts legacy ask override', () => {
  let message = '';
  const answer = requestUnregisterConfirmation({ name: 'alpha' }, (value) => {
    message = value;
    return 'alpha';
  });
  assert.equal(answer, 'alpha');
  assert.match(message, /Type "alpha"/);
  assert.match(message, /No repository files will be deleted/);
});

test('124934: clearing a choice filter preserves Lit markers for the next render', () => {
  const fixture = document.createElement('div');
  fixture.innerHTML = '<div id="type-filter"></div><section id="board"></section>';
  document.body.append(fixture);
  const selected = new Set(['bug']);
  appState.repo = { changes: [], statuses: ['draft'] };
  appState.currentView = 'board';

  try {
    const renderFilter = () =>
      renderChoiceFilter(
        fixture.querySelector('#type-filter'),
        'Type',
        ['bug', 'feature'],
        selected,
        () => {},
        () => selected.clear(),
      );
    renderFilter();
    fixture.querySelector('[data-clear]').click();

    assert.doesNotThrow(renderFilter);
    assert.equal(fixture.querySelector('[data-choice-summary]').textContent, 'All types');
  } finally {
    fixture.remove();
  }
});

test('124934: clearing statuses preserves Lit markers for the next render', () => {
  const fixture = document.createElement('div');
  fixture.innerHTML = '<div id="status-filter"></div><section id="board"></section>';
  document.body.append(fixture);
  appState.repo = { changes: [], statuses: ['draft', 'approved'] };
  appState.filters.statuses = new Set(['draft']);
  appState.currentView = 'board';

  try {
    renderStatusFilter();
    fixture.querySelector('[data-clear-status]').click();

    assert.doesNotThrow(renderStatusFilter);
    assert.equal(fixture.querySelector('[data-status-summary]').textContent, 'All statuses');
  } finally {
    fixture.remove();
  }
});
