import { cssIdent } from './security.js';
import { html, markdownHtml, nothing } from './templates.js';

const MARK = { done: '✓', todo: '○', blocked: '✕' };

export const humanizeStatus = (status) => {
  const text = String(status ?? '').replaceAll('-', ' ');
  return text ? text[0].toUpperCase() + text.slice(1) : '';
};

export function statusSummary(statuses) {
  if (!statuses.size) return 'All statuses';
  if (statuses.size === 1) return humanizeStatus([...statuses][0]);
  return `${statuses.size} statuses`;
}

export function statusTag(status) {
  return html`<span
    class="status-tag"
    style=${`--status-color: var(--status-${cssIdent(status)}, var(--status-muted))`}
  ><i aria-hidden="true"></i>${humanizeStatus(status)}</span>`;
}

export function sortIndicator(direction) {
  const path = direction > 0 ? 'M2.5 6.5 5 4l2.5 2.5' : 'M2.5 3.5 5 6l2.5-2.5';
  return html`<svg class="sort-indicator" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
    <path d=${path}></path>
  </svg>`;
}

export function closeButton(label = 'Close detail', extraClass = '') {
  return html`<button type="button" class=${`icon-button close ${extraClass}`.trim()} aria-label=${label} title=${label}>
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.75 3.75 12.25 12.25M12.25 3.75 3.75 12.25"></path>
    </svg>
  </button>`;
}

export function validationPanel() {
  return html`<section class="validation-actions" aria-labelledby="validation-title">
    <div class="validation-copy">
      <span class="validation-kicker">Human checkpoint</span>
      <h2 id="validation-title">Ready for your verdict</h2>
      <p>Test the complete change, then accept it or send it back with a precise reason.</p>
    </div>
    <div class="validation-controls">
      <button type="button" class="button button-primary" data-validation="pass">Accept change</button>
      <div class="rejection-field">
        <label for="validation-reason">Reason for rejection</label>
        <input id="validation-reason" data-validation-reason type="text" placeholder="What still needs work?" />
        <p class="validation-error" role="alert" hidden></p>
      </div>
      <button type="button" class="button button-danger" data-validation="fail">Reject with reason</button>
    </div>
  </section>`;
}

export function splitGraduationHistory(body) {
  const lines = String(body ?? '').split('\n');
  let cursor = 0;
  while (cursor < lines.length && !lines[cursor].trim()) cursor += 1;
  if (/^#\s+/.test(lines[cursor] ?? '')) {
    cursor += 1;
    while (cursor < lines.length && !lines[cursor].trim()) cursor += 1;
  }
  const start = cursor;
  const entries = [];
  while (/^>\s+Graduado del change\s+/.test(lines[cursor] ?? '')) {
    entries.push(lines[cursor].replace(/^>\s+/, ''));
    cursor += 1;
  }
  if (!entries.length) return { before: '', entries: [], after: String(body ?? '') };
  while (cursor < lines.length && !lines[cursor].trim()) cursor += 1;
  return {
    before: lines.slice(0, start).join('\n').trim(),
    entries,
    after: lines.slice(cursor).join('\n'),
  };
}

export function specBody(body) {
  const { before, entries, after } = splitGraduationHistory(body);
  if (!entries.length) return html`<div class="stage-content">${markdownHtml(after)}</div>`;
  return html`<div class="stage-content spec-content">
    ${before ? markdownHtml(before) : nothing}
    <details class="graduation-history">
      <summary>
        <span class="history-icon" aria-hidden="true">↳</span>
        <span>Graduation history</span>
        <span class="history-count">${entries.length}</span>
      </summary>
      <ol>${entries.map((entry) => html`<li>${entry}</li>`)}</ol>
    </details>
    ${markdownHtml(after)}
  </div>`;
}

export function card(c) {
  const pct = c.progress.total ? Math.round((c.progress.done / c.progress.total) * 100) : 0;
  const blocked = c.progress.blocked
    ? html`<span class="flag-blocked">● ${c.progress.blocked} blocked</span>`
    : nothing;
  return html`
    <div
      class=${`card ${c.archived ? 'archived' : ''}`}
      data-id=${c.id}
      style=${`--type-color: var(--${cssIdent(c.type)})`}
    >
      <div class="card-top">
        <span class="card-id">#${c.id}</span>
        <span class="type-tag">${c.type}</span>
      </div>
      <div class="card-title">${c.title}</div>
      ${c.progress.total ? html`<div class="progress"><i style=${`width:${pct}%`}></i></div>` : nothing}
      <div class="card-meta">
        ${c.progress.total ? html`<span>${c.progress.done}/${c.progress.total} tasks</span>` : nothing}
        ${c.owner ? html`<span class="owner">@${c.owner}</span>` : nothing}
        ${blocked}
      </div>
    </div>`;
}

export function stageBlock(c, s) {
  const content = s.key === 'plan' && c.tasks.length ? taskList(c.tasks) : markdownHtml(s.body);
  return html`
    <div class="stage" id=${`stage-${s.key}`}>
      <h2>${s.heading}</h2>
      <div class="stage-content">${content}</div>
    </div>`;
}

export function taskList(tasks) {
  return html`<ul class="tasks">
    ${tasks.map((t) => {
      const cr = (t.criteria || []).map((x) => html`<span class="cr">${x}</span>`);
      const when = t.resolvedAt ? html`<span class="when">${t.resolvedAt}</span>` : nothing;
      const reason = t.reason ? html`<span class="reason">— ${t.reason}</span>` : nothing;
      return html`<li class=${`task ${t.state}`}>
        <span class="mark">${MARK[t.state]}</span>
        <span class="text">${t.text} ${cr} ${reason}</span>
        ${when}
      </li>`;
    })}
  </ul>`;
}

export function tableRow(c) {
  const pct = c.progress.total ? Math.round((c.progress.done / c.progress.total) * 100) : 0;
  const prog = c.progress.total
    ? `${c.progress.done}/${c.progress.total}${c.progress.blocked ? ` · ${c.progress.blocked}!` : ''} (${pct}%)`
    : '—';
  return html`<tr data-id=${c.id}>
    <td class="mono cell-id cell-nowrap">#${c.id}</td>
    <td class="cell-title cell-nowrap">${c.title}</td>
    <td class="cell-type cell-nowrap">
      <span class="type-tag" style=${`--type-color: var(--${cssIdent(c.type)})`}>${c.type}</span>
    </td>
    <td class="cell-status cell-nowrap">${statusTag(c.status)}</td>
    <td class="mono cell-progress cell-nowrap">${prog}</td>
    <td class="mono cell-deps">${(c.depends_on || []).join(', ') || '—'}</td>
  </tr>`;
}
