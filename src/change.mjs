// Parses a Spec Ledger change file: frontmatter + stages + tasks.
// Stage bodies are kept raw (markdown) — the viewer renders them.

import { parseYaml } from './yaml.mjs';

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;
const TASK = /^- \[( |x|!)\]\s+(.*)$/;
const STATE_BY_MARK = { ' ': 'todo', x: 'done', '!': 'blocked' };

export function parseChange(text) {
  const fm = text.match(FRONTMATTER);
  if (!fm) throw new Error('Change is missing its frontmatter block');
  const frontmatter = parseYaml(fm[1]);
  const body = text.slice(fm[0].length);

  const stages = splitStages(body);
  const plan = stages.find((s) => s.key === 'plan');
  const tasks = plan ? parseTasks(plan.body) : [];
  const progress = {
    total: tasks.length,
    done: tasks.filter((t) => t.state === 'done').length,
    blocked: tasks.filter((t) => t.state === 'blocked').length,
  };

  return { frontmatter, stages, tasks, progress };
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
      current.body += line + '\n';
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
