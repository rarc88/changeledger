import { buildLedgerDocumentTree } from './ledger-browser.js';
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

export function detailPresentationControls(mode = 'side', size = 'wide') {
  const options = (values, selected, attr) =>
    values.map(
      ([value, label]) => html`<button
        type="button"
        class="detail-option"
        data-detail-setting=${attr}
        data-detail-value=${value}
        aria-pressed=${String(selected === value)}
      >${label}</button>`,
    );
  return html`<div class="detail-presentation" aria-label="Detail presentation">
    <div class="detail-choice" role="group" aria-label="Layout">
      ${options(
        [
          ['side', 'Side panel'],
          ['floating', 'Floating modal'],
        ],
        mode,
        'mode',
      )}
    </div>
    <div class="detail-choice" role="group" aria-label="Width">
      ${options(
        [
          ['compact', 'Compact'],
          ['wide', 'Wide'],
          ['full', 'Full'],
        ],
        size,
        'size',
      )}
    </div>
  </div>`;
}

export function detailToolbar(mode = 'side', size = 'wide', stages = []) {
  const navigation = stages.length
    ? html`<nav class="pipeline" aria-label="Change sections">
      ${stages.map(
        (stage) =>
          html`<button type="button" class="stage-chip" data-go=${`stage-${stage.key}`}>${stage.heading}</button>`,
      )}
    </nav>`
    : nothing;
  return html`<div class="detail-toolbar" aria-label="Detail tools">
    ${detailPresentationControls(mode, size)}
    ${navigation}
    ${closeButton('Close detail', 'detail-toolbar-close')}
  </div>`;
}

export function approvalPanel(change) {
  if (change?.status !== 'draft') return nothing;
  return html`<section class="validation-actions approval-actions" aria-labelledby="approval-title">
    <div class="validation-copy">
      <span class="validation-kicker">Human checkpoint</span>
      <h2 id="approval-title">Ready for approval</h2>
      <p>Review the proposal, then approve it to make this change ready for implementation.</p>
    </div>
    <div class="approval-controls">
      <button
        type="button"
        class="button button-primary detail-approve"
        data-approve
        aria-label=${`Approve change ${change.id}`}
      >Approve</button>
    </div>
  </section>`;
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

function resolvedReference(entry, changes) {
  const id = String(entry?.id ?? entry);
  const external = id.includes(':');
  const change = external ? undefined : changes.find((candidate) => String(candidate.id) === id);
  return { id, external, change, direction: entry?.direction };
}

export function referenceDetails(label, entries = [], changes = [], icon = '↳') {
  const refs = entries.map((entry) => resolvedReference(entry, changes));
  if (!refs.length) return nothing;
  return html`<details class="change-references">
    <summary>
      <span class="reference-icon" aria-hidden="true">${icon}</span>
      <span>${label}</span>
      <span class="reference-count">${refs.length}</span>
    </summary>
    <div class="reference-list">${refs.map(({ id, external, change, direction }) => {
      const attrs = external ? { external: id } : change ? { change: id } : {};
      const content = html`
        <span class="reference-id">#${id}</span>
        <span class="reference-copy">
          <strong>${change?.title ?? (external ? 'External change' : 'Unavailable')}</strong>
          <small>
            ${direction ? html`<span>${direction}</span>` : nothing}
            ${
              change
                ? html`<span>${change.type}</span><span>${change.status}</span>${
                    change.owner ? html`<span>@${change.owner}</span>` : nothing
                  }`
                : html`<span>${external ? 'external' : 'unavailable'}</span>`
            }
          </small>
        </span>`;
      return change || external
        ? html`<button
            type="button"
            class=${`reference-row${external ? ' external' : ''}`}
            data-change=${attrs.change ?? nothing}
            data-external=${attrs.external ?? nothing}
          >${content}</button>`
        : html`<div class="reference-row unavailable">${content}</div>`;
    })}</div>
  </details>`;
}

export function specBody(body, graduatedFrom = [], changes = []) {
  const entries = Array.isArray(graduatedFrom) ? graduatedFrom : [];
  if (!entries.length) return html`<div class="stage-content">${markdownHtml(body)}</div>`;
  return html`<div class="stage-content spec-content">
    ${referenceDetails('Graduation history', entries, changes, '↳')}
    ${markdownHtml(body)}
  </div>`;
}

function ledgerTreeNodes(nodes, selectedPath) {
  return nodes.map(
    (node) => html`<li>
      ${
        node.file
          ? html`<button
            type="button"
            class=${`ledger-file${selectedPath === node.path ? ' active' : ''}`}
            data-ledger-document=${node.path}
            aria-current=${selectedPath === node.path ? 'page' : nothing}
          >${node.name}</button>`
          : html`<span class="ledger-folder">${node.name}</span>
            <ul>${ledgerTreeNodes(node.children, selectedPath)}</ul>`
      }
    </li>`,
  );
}

export function ledgerDocumentBrowserHtml(browserState) {
  const documents = browserState?.documents ?? [];
  const treeStatus = browserState?.treeStatus ?? 'idle';
  const documentStatus = browserState?.documentStatus ?? 'idle';
  const selectedPath = browserState?.selectedPath ?? null;
  const document = browserState?.document ?? null;
  const tree =
    treeStatus === 'loading'
      ? html`<p class="empty" role="status">Loading documents</p>`
      : treeStatus === 'error'
        ? html`<p class="ledger-error" role="alert">${browserState.treeError}</p>`
        : treeStatus === 'ready' && !documents.length
          ? html`<p class="empty">No documents available</p>`
          : html`<ul class="ledger-tree-list">${ledgerTreeNodes(
              buildLedgerDocumentTree(documents),
              selectedPath,
            )}</ul>`;

  let article = html`<p class="empty ledger-select-document">Select a document</p>`;
  if (documentStatus === 'loading') {
    article = html`<p class="empty" role="status">Loading document</p>`;
  } else if (documentStatus === 'error') {
    article = html`<p class="ledger-error" role="alert">${browserState.documentError}</p>`;
  } else if (documentStatus === 'ready' && document) {
    article = html`<article class="ledger-article">
      <button type="button" class="ledger-back" data-ledger-back>Back to documents</button>
      <h1>${document.path}</h1>
      ${
        document.format === 'markdown'
          ? html`<div class="stage-content ledger-markdown">${markdownHtml(document.content)}</div>`
          : html`<pre class="ledger-source"><code>${document.content}</code></pre>`
      }
    </article>`;
  }

  return html`<div class="ledger-document-browser">
    <nav class="ledger-tree-panel" data-ledger-tree tabindex="-1" aria-label="Documents">
      ${tree}
    </nav>
    <section class="ledger-article-panel" aria-live="polite">${article}</section>
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
