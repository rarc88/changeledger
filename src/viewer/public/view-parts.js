import { cssIdent, esc, safeHtml } from './security.js';

const MARK = { done: '✓', todo: '○', blocked: '✕' };

export function card(c) {
  const pct = c.progress.total ? Math.round((c.progress.done / c.progress.total) * 100) : 0;
  const blocked = c.progress.blocked
    ? `<span class="flag-blocked">● ${c.progress.blocked} blocked</span>`
    : '';
  return `
    <div class="card ${c.archived ? 'archived' : ''}" data-id="${esc(c.id)}" style="--type-color: var(--${cssIdent(c.type)})">
      <div class="card-top">
        <span class="card-id">#${esc(c.id)}</span>
        <span class="type-tag">${esc(c.type)}</span>
      </div>
      <div class="card-title">${esc(c.title)}</div>
      ${c.progress.total ? `<div class="progress"><i style="width:${pct}%"></i></div>` : ''}
      <div class="card-meta">
        ${c.progress.total ? `<span>${c.progress.done}/${c.progress.total} tasks</span>` : ''}
        ${c.owner ? `<span class="owner">@${esc(c.owner)}</span>` : ''}
        ${blocked}
      </div>
    </div>`;
}

export function stageBlock(c, s) {
  const content = s.key === 'plan' && c.tasks.length ? taskList(c.tasks) : safeHtml(s.body);
  return `
    <div class="stage" id="stage-${esc(s.key)}">
      <h2>${esc(s.heading)}</h2>
      <div class="stage-content">${content}</div>
    </div>`;
}

export function taskList(tasks) {
  return (
    '<ul class="tasks">' +
    tasks
      .map((t) => {
        const cr = (t.criteria || []).map((x) => `<span class="cr">${esc(x)}</span>`).join(' ');
        const when = t.resolvedAt ? `<span class="when">${esc(t.resolvedAt)}</span>` : '';
        const reason = t.reason ? `<span class="reason">— ${esc(t.reason)}</span>` : '';
        return `<li class="task ${t.state}">
          <span class="mark">${MARK[t.state]}</span>
          <span class="text">${esc(t.text)} ${cr} ${reason}</span>
          ${when}
        </li>`;
      })
      .join('') +
    '</ul>'
  );
}

export function tableRow(c) {
  const pct = c.progress.total ? Math.round((c.progress.done / c.progress.total) * 100) : 0;
  const prog = c.progress.total
    ? `${c.progress.done}/${c.progress.total}${c.progress.blocked ? ` · ${c.progress.blocked}!` : ''} (${pct}%)`
    : '—';
  return `<tr data-id="${esc(c.id)}">
    <td class="mono">#${esc(c.id)}</td>
    <td>${esc(c.title)}</td>
    <td><span class="type-tag" style="--type-color: var(--${cssIdent(c.type)})">${esc(c.type)}</span></td>
    <td>${esc(c.status)}</td>
    <td class="mono">${prog}</td>
    <td class="mono">${(c.depends_on || []).map(esc).join(', ') || '—'}</td>
  </tr>`;
}
