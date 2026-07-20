// Parses a ChangeLedger change file: frontmatter + stages + tasks.
// Stage bodies are kept raw (markdown) — the viewer renders them.

import { parseTaskBlocks } from './task.mjs';
import { parseYaml } from './yaml.mjs';

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;

export function parseChange(text) {
  const fm = text.match(FRONTMATTER);
  if (!fm) throw new Error('Change is missing its frontmatter block');
  const frontmatter = parseYaml(fm[1]);
  const body = text.slice(fm[0].length);

  const stages = splitStages(body);
  const plan = stages.find((s) => s.key === 'plan');
  const parsedTasks = plan ? parseTaskBlocks(plan.body) : { tasks: [], issues: [] };
  const { tasks } = parsedTasks;
  const spec = stages.find((s) => s.key === 'specification');
  const criterionBlocks = spec ? parseCriteria(spec.body) : [];
  const criteria = criterionBlocks.map((c) => c.id);
  const progress = {
    total: tasks.length,
    done: tasks.filter((t) => t.state === 'done').length,
    blocked: tasks.filter((t) => t.state === 'blocked').length,
  };

  return {
    frontmatter,
    stages,
    tasks,
    taskIssues: parsedTasks.issues,
    criteria,
    criterionBlocks,
    progress,
  };
}

// Acceptance criteria declared in `## Specification` as `### CRn — name` blocks.
function parseCriteria(specBody) {
  const blocks = [];
  let current = null;
  for (const line of specBody.split('\n')) {
    const m = line.match(/^###\s+(CR\d+)\b/);
    if (m) {
      current = { id: m[1], steps: [] };
      blocks.push(current);
      continue;
    }
    const step = line.match(/^-\s+\*\*(Given|When|Then|And)\*\*/);
    if (current && step) current.steps.push(step[1]);
  }
  return blocks;
}

function splitStages(body) {
  const stages = [];
  let current = null;
  let fence = null;
  for (const line of body.split('\n')) {
    const fenceMark = line.match(/^(`{3,}|~{3,})/);
    if (fenceMark) {
      if (!fence) fence = { char: fenceMark[1][0], length: fenceMark[1].length };
      else if (fenceMark[1][0] === fence.char && fenceMark[1].length >= fence.length) fence = null;
      if (current) current.body += `${line}\n`;
      continue;
    }

    const m = fence ? null : line.match(/^##\s+(.+?)\s*$/);
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
