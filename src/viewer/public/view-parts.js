import { cssIdent } from './security.js';
import { html, markdownHtml, nothing } from './templates.js';

const MARK = { done: '✓', todo: '○', blocked: '✕' };

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
    <td class="mono">#${c.id}</td>
    <td>${c.title}</td>
    <td>
      <span class="type-tag" style=${`--type-color: var(--${cssIdent(c.type)})`}>${c.type}</span>
    </td>
    <td>${c.status}</td>
    <td class="mono">${prog}</td>
    <td class="mono">${(c.depends_on || []).join(', ') || '—'}</td>
  </tr>`;
}
