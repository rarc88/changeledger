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
  tableRow,
  taskList,
} = await import('../src/viewer/public/app.js');
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

test('210508 CR6: discarded changes are hidden by default and excluded from board columns', () => {
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
