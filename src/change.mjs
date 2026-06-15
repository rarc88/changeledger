// Parses a Spec Ledger change file: frontmatter + stages + tasks.
// Stage bodies are kept raw (markdown) — the viewer renders them.

import { parseYaml } from './yaml.mjs';

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;
const TASK = /^- \[( |x|!)\]\s+(.*)$/;
const STATE_BY_MARK = { ' ': 'todo', x: 'done', '!': 'blocked' };

// The lifecycle graph. Each status lists the statuses it may move to via the
// CLI. Moves outside this graph (reopening a done change, un-approving) are not
// the CLI's job — edit the file directly. `in-progress → done` is allowed here
// but gated below when the change's type requires review.
const TRANSITIONS = {
  draft: ['approved'],
  approved: ['in-progress'],
  'in-progress': ['in-review', 'blocked', 'done'],
  'in-review': ['done', 'in-progress', 'blocked'],
  blocked: ['in-progress'],
  done: [],
};

// Enforces a lifecycle move. Throws on an edge outside the graph, and on the
// review gate (a `review_required` type cannot jump from in-progress to done —
// it must pass through in-review). See AGENTS.md §5.
export function assertTransition({ type, from, to, reviewRequired = false }) {
  if (!(TRANSITIONS[from] ?? []).includes(to)) {
    throw new Error(`invalid transition: ${from} → ${to}`);
  }
  if (reviewRequired && from === 'in-progress' && to === 'done') {
    throw new Error(`${type} changes must be reviewed before done — move to in-review first`);
  }
}

export function parseChange(text) {
  const fm = text.match(FRONTMATTER);
  if (!fm) throw new Error('Change is missing its frontmatter block');
  const frontmatter = parseYaml(fm[1]);
  const body = text.slice(fm[0].length);

  const stages = splitStages(body);
  const plan = stages.find((s) => s.key === 'plan');
  const tasks = plan ? parseTasks(plan.body) : [];
  const spec = stages.find((s) => s.key === 'specification');
  const criteria = spec ? parseCriteria(spec.body) : [];
  const progress = {
    total: tasks.length,
    done: tasks.filter((t) => t.state === 'done').length,
    blocked: tasks.filter((t) => t.state === 'blocked').length,
  };

  return { frontmatter, stages, tasks, criteria, progress };
}

// Acceptance criteria declared in `## Specification` as `### CRn — name` blocks.
function parseCriteria(specBody) {
  const ids = [];
  for (const line of specBody.split('\n')) {
    const m = line.match(/^###\s+(CR\d+)\b/);
    if (m) ids.push(m[1]);
  }
  return ids;
}

function splitStages(body) {
  const stages = [];
  let current = null;
  for (const line of body.split('\n')) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      current = { key: m[1].trim().toLowerCase(), heading: m[1].trim(), body: '' };
      stages.push(current);
    } else if (current) {
      current.body += `${line}\n`;
    }
  }
  for (const s of stages) s.body = s.body.trim();
  return stages;
}

function parseTasks(planBody) {
  const tasks = [];
  for (const line of planBody.split('\n')) {
    const m = line.trim().match(TASK);
    if (!m) continue;
    const state = STATE_BY_MARK[m[1]];
    let rest = m[2].trim();
    let resolvedAt;
    let reason;

    const dash = rest.indexOf(' — ');
    if (dash !== -1) {
      const suffix = rest.slice(dash + 3).trim();
      rest = rest.slice(0, dash).trim();
      if (state === 'done') resolvedAt = suffix;
      else if (state === 'blocked') reason = suffix;
    }

    let criteria = [];
    const crMatch = rest.match(/\(([^)]*\bCR\d+[^)]*)\)\s*$/);
    if (crMatch) {
      criteria = crMatch[1].match(/CR\d+/g) ?? [];
      rest = rest.slice(0, crMatch.index).trim();
    }

    tasks.push({ text: rest, state, criteria, resolvedAt, reason });
  }
  return tasks;
}
