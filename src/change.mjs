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

// The two invariants the grouping parent imposes, pure over the changes handed
// to them so the same answer holds in an activated repo and a worktree layout.

// Persistent truth belongs to the epic, not to each child. Twenty children of
// one effort reconcile the same spec twenty times otherwise, which is the
// ceremony the grouping exists to remove: the parent reconciles once at
// closure and a child resolves its own decision with `--skip`.
export function assertParentOwnsGraduation(change) {
  const parent = change?.frontmatter?.parent;
  if (typeof parent !== 'string' || parent === '') return;
  throw new Error(
    `change ${change.frontmatter.id} belongs to epic ${parent}: persistent truth is reconciled by the parent — use \`changeledger graduate ${change.frontmatter.id} --skip\``,
  );
}

// An epic that closes with live children is a label, not a grouping: the work
// it names is still open and nothing says so. `discarded` counts as resolved —
// it is a recorded decision, not unfinished work. The predicate lives here and
// nowhere else: `check` reads it as a repo invariant and the write seats read
// it as a fail-fast guard, so a new route to `done` cannot disagree with the
// rule (20261020-172221 D1/D2).
export function openChildren(changes, id) {
  const wanted = String(id);
  return (changes ?? [])
    .filter((c) => String(c.frontmatter?.parent ?? '') === wanted)
    .filter((c) => !['done', 'discarded'].includes(c.frontmatter?.status));
}

// Names the subject by id, never by type: nothing restricts `parent` to the
// `epic` type and a message that asserts one lies about the document it names.
export function childrenOpenError(changes, id) {
  const open = openChildren(changes, id).map(
    (c) => `${c.frontmatter.id} (${c.frontmatter.status})`,
  );
  if (open.length === 0) return null;
  return `change ${id} still has unresolved children: ${open.join(', ')} — close or discard them first`;
}

export function assertChildrenResolved(changes, id) {
  const message = childrenOpenError(changes, id);
  if (message) throw new Error(message);
}
