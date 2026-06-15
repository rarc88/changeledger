import assert from 'node:assert/strict';
import { test } from 'node:test';
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { marked } from 'marked';

// Mirrors the viewer's safeHtml pipeline (src/viewer/public/app.js): the same
// marked → DOMPurify chain and library versions the browser loads from /vendor.
const { window } = new JSDOM('');
const DOMPurify = createDOMPurify(window);
const safeHtml = (md) => DOMPurify.sanitize(marked.parse(md || ''));

test('CR1: active HTML in a document does not survive into the DOM', () => {
  const out = safeHtml('<img src=x onerror="window.__sl_xss=1">');
  assert.ok(!/onerror/i.test(out), 'event handler stripped');
  assert.ok(!/__sl_xss/.test(out));
});

test('CR1: a script element is removed', () => {
  const out = safeHtml('hi <script>window.__sl_xss=1</script> there');
  assert.ok(!/<script/i.test(out));
});

test('CR2: a javascript: link is neutralized', () => {
  const out = safeHtml('[click](javascript:window.__sl_xss=1)');
  assert.ok(!/javascript:/i.test(out), `still dangerous: ${out}`);
});

test('CR3: allowed markdown formatting is preserved', () => {
  const out = safeHtml(
    '# Title\n\n- item\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n`code` and [link](https://example.com)',
  );
  assert.match(out, /<h1[^>]*>Title<\/h1>/);
  assert.match(out, /<li>item<\/li>/);
  assert.match(out, /<table>/);
  assert.match(out, /<code>code<\/code>/);
  assert.match(out, /<a href="https:\/\/example\.com">link<\/a>/);
});

test('CR4: mermaid code blocks keep their language class for live rendering', () => {
  const out = safeHtml('```mermaid\ngraph TD; A-->B;\n```');
  assert.match(out, /class="language-mermaid"/);
});
