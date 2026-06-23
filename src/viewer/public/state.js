// Tombstone visibility: archived and discarded changes are hidden by default and
// each revealed by its own toggle. Shared by every view (board/table via
// isVisible, and the graph) so no view can diverge on the rule.
export const passesTombstones = (c, f) =>
  (f.showArchived || !c.archived) && (f.showDiscarded || c.status !== 'discarded');

// Statuses that get a board column. `discarded` is terminal and off-board — it
// never shows as a lane even when its changes are revealed by the toggle.
export const boardStatuses = (statuses, showDiscarded = false) =>
  statuses.filter((s) => s !== 'discarded' || showDiscarded);

// Full-text haystack: id, title, type, stage headings/bodies and task text.
function haystack(c) {
  const stages = c.stages.map((s) => `${s.heading} ${s.body}`).join(' ');
  const tasks = c.tasks
    .map((t) => `${t.text} ${(t.criteria || []).join(' ')} ${t.reason || ''}`)
    .join(' ');
  return `${c.id} ${c.title} ${c.type} ${c.status} ${c.owner || ''} ${stages} ${tasks}`.toLowerCase();
}

// Whether a change is shown under the current filters. Exported as a pure
// predicate so the rule is testable.
export function isVisible(c, f) {
  if (!passesTombstones(c, f)) return false;
  if (f.type !== 'all' && c.type !== f.type) return false;
  if (f.owner !== 'all' && c.owner !== f.owner) return false;
  if (f.statuses.size && !f.statuses.has(c.status)) return false;
  const q = f.text.toLowerCase();
  if (!q) return true;
  return haystack(c).includes(q);
}
