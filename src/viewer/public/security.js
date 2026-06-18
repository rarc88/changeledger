export function initMermaid() {
  if (typeof mermaid === 'undefined') return;
  // securityLevel 'strict' is explicit: change/spec bodies are untrusted input,
  // so diagram text must not run scripts or click handlers.
  mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' });
}

// Renders untrusted Markdown to sanitized HTML. Marked does not strip active
// HTML (event handlers, javascript: URLs, <script>), so every body that reaches
// innerHTML passes through DOMPurify first. Repo documents are untrusted even
// locally — opening the viewer must not let a document run code in its origin.
export function safeHtml(markdown) {
  if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
    return '<p class="empty">Markdown rendering is unavailable because a required viewer dependency failed to load.</p>';
  }
  const html = marked.parse(markdown || '');
  return DOMPurify.sanitize(html, { FORBID_TAGS: ['style'] });
}

// Replace ```mermaid code blocks (rendered by marked as <pre><code>) with live
// diagrams. Uses textContent so escaped chars (-->, etc.) are decoded first.
export function renderMermaid(root) {
  if (typeof mermaid === 'undefined') return;
  const blocks = root.querySelectorAll('pre > code.language-mermaid');
  blocks.forEach((code) => {
    const div = document.createElement('div');
    div.className = 'mermaid';
    div.textContent = code.textContent;
    code.parentElement.replaceWith(div);
  });
  const nodes = root.querySelectorAll('.mermaid');
  if (nodes.length) mermaid.run({ nodes });
}

// Escapes a value for HTML text and double-quoted attribute contexts. Every
// untrusted document/config field (id, type, status, stage heading, timestamps,
// dependency ids…) passes through this before reaching innerHTML — sanitizing
// the Markdown body is not enough on its own.
export const esc = (s) =>
  String(s ?? '').replace(
    /['&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

// A value interpolated into a CSS custom-property name (`var(--TYPE)`) must be a
// bare identifier; anything else is dropped to a neutral, defined fallback so a
// crafted `type` cannot break out of the declaration or inject extra rules.
export const cssIdent = (s) => (/^[A-Za-z][\w-]*$/.test(String(s ?? '')) ? String(s) : 'muted');
