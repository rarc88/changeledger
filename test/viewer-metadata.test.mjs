import assert from 'node:assert/strict';
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
  bindProjectViewActions,
  card,
  closeStatusMenuOnOutsideClick,
  createDiagramLightbox,
  cssIdent,
  esc,
  isVisible,
  passesTombstones,
  projectMutation,
  projectsViewTemplate,
  requestUnregisterConfirmation,
  restoreInitialViewerShell,
  resetValidationState,
  runValidationSubmission,
  setConfirmImpl,
  showConfirm,
  showNoProjects,
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
const { graphSvg } = await import('../src/viewer/public/view-renderers.js');

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
      { content: 'language: es\n# <script>alert(1)</script>', revision: 'rev' },
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
      { content: 'project_name: alpha', revision: 'rev' },
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

test('125850 CR9: status menu closes only for an outside pointer target', () => {
  const menu = document.createElement('details');
  const inside = document.createElement('button');
  const outside = document.createElement('button');
  menu.append(inside);
  menu.open = true;
  assert.equal(closeStatusMenuOnOutsideClick(menu, inside), false);
  assert.equal(menu.open, true);
  assert.equal(closeStatusMenuOnOutsideClick(menu, outside), true);
  assert.equal(menu.open, false);
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

  // Type stages shown
  assert.match(root.querySelector('.config-type-stages')?.textContent ?? '', /request/);

  // Internal section shows project_id
  const internalText = root.querySelector('.config-group-internal')?.textContent ?? '';
  assert.match(internalText, /aaa111/);
  assert.match(internalText, /project_name/);
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
  assert.match(root.querySelector('.project-error')?.textContent ?? '', /Migration failed/);
  // Retry button shown
  assert.ok(root.querySelector('[data-preview-migration]'), 'Retry preview button must be present');
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

// Lifecycle section shows canonical badges and stage badges
test('113924 CR3 lifecycle: canonical statuses shown as badges, stages shown', () => {
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
  const canonical = root.querySelectorAll('.config-status-canonical');
  assert.ok(canonical.length > 0, 'canonical status badges present');
  const custom = root.querySelectorAll('.config-status-custom');
  assert.equal(custom.length, 1, 'one custom status badge');
  assert.equal(custom[0].textContent.trim(), 'my-custom');
  // Stages shown somewhere in config section
  assert.match(root.querySelector('.config-section')?.textContent ?? '', /request/);
});

// showToast: exported and testable (just verifies it doesn't throw in test env)
test('113924: showToast does not throw when toast-container is absent', () => {
  assert.doesNotThrow(() => showToast('test error'));
});
