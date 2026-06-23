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
  card,
  cssIdent,
  esc,
  isVisible,
  passesTombstones,
  stageBlock,
  statusTag,
  statusSummary,
  tableRow,
  taskList,
} = await import('../src/viewer/public/app.js');
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
