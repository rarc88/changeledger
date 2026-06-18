import { html, nothing, render, svg } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { safeHtml } from './security.js';

export { html, nothing, render, svg };

export function markdownHtml(markdown) {
  return unsafeHTML(safeHtml(markdown));
}
