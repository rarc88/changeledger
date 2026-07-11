import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { marked } from 'marked';

// app.js reads `marked`/`DOMPurify` as globals (the browser loads them from
// /vendor). Provide the real libraries so safeHtml behaves exactly as in the
// browser, then import the module.
const { window } = new JSDOM('<!DOCTYPE html><body></body>');
globalThis.document = window.document;
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
  isVisible,
  passesTombstones,
  projectMutation,
  projectsViewTemplate,
  requestUnregisterConfirmation,
  bindReopenAction,
  reopenPanel,
  detailToolbar,
  detailPresentationControls,
  restoreInitialViewerShell,
  resetValidationState,
  scrollToStage,
  runValidationSubmission,
  setConfirmImpl,
  setPromptImpl,
  showConfirm,
  showNoProjects,
  showPrompt,
  showToast,
  stageBlock,
  sortIndicator,
  statusTag,
  statusSummary,
  syncViewerShell,
  tableRow,
  taskList,
} = await import('../src/viewer/public/app.js');
const { state: appState } = await import('../src/viewer/public/app-state.js');
const { closeButton, splitGraduationHistory, specBody, validationPanel } = await import(
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

test('125850 CR6: graduation history is separated only from the leading spec preamble', () => {
  const body = `# Architecture

> Graduado del change 20260613-120000 (first).
> Graduado del change 20260613-120001 (second).

Normal truth.

> A regular quote.`;
  const split = splitGraduationHistory(body);
  assert.equal(split.entries.length, 2);
  assert.match(split.before, /# Architecture/);
  assert.match(split.after, /Normal truth/);
  assert.match(split.after, /> A regular quote/);
});

test('125850 CR6: non-provenance blockquotes remain untouched', () => {
  const body = '# Architecture\n\n> A regular quote.\n\nTruth.';
  assert.deepEqual(splitGraduationHistory(body), { before: '', entries: [], after: body });
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

test('125850 CR6: spec body renders graduation entries inside a collapsed details list', () => {
  const host = parse(
    specBody(`# Architecture

> Graduado del change 20260613-120000 (first).
> Graduado del change 20260613-120001 (second).

Persistent truth.`),
  );
  const details = host.querySelector('details.graduation-history');
  assert.ok(details);
  assert.equal(details.open, false);
  assert.equal(details.querySelector('.history-count').textContent, '2');
  assert.equal(details.querySelectorAll('li').length, 2);
  assert.match(host.textContent, /Persistent truth/);
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
