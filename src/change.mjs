// Parses a ChangeLedger change file: frontmatter + stages + tasks.
// Stage bodies are kept raw (markdown) — the viewer renders them.

import { parseTaskBlocks } from './task.mjs';
import { parseYaml } from './yaml.mjs';

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;

// Fixed in code, like the six statuses of the lifecycle (20261024-121022): a
// `change` carries the stages it needs, in this order, and an `epic` groups
// children and is never implemented. No configuration key declares either.
export const CANONICAL_STAGES = Object.freeze(['request', 'specification', 'plan', 'log']);
export const CHANGE_TYPES = Object.freeze(['change', 'epic']);

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

// What the human approves, declared in `## Request` as `### Objective` and
// `### Frontier`. Any other `###` heading there is free prose and closes the
// subsection before it; a heading inside a code fence is body, as in
// `splitStages`. Returns one entry per subsection: found ones in document
// order, then the missing ones; `filled` is true when at least one non-blank
// line sits under the heading.
const REQUEST_SECTIONS = ['Objective', 'Frontier'];

export function parseRequestSections(requestBody) {
  const filled = new Map();
  let current = null;
  const isFenced = fenceTracker();
  for (const line of requestBody.split('\n')) {
    const fenced = isFenced(line);
    const heading = fenced ? null : line.match(/^###\s+(Objective|Frontier)\s*$/);
    if (heading) {
      current = heading[1];
      if (!filled.has(current)) filled.set(current, false);
    } else if (!fenced && /^###\s/.test(line)) {
      current = null;
    } else if (current && line.trim()) {
      filled.set(current, true);
    }
  }
  return [
    ...[...filled].map(([name, isFilled]) => ({ name, present: true, filled: isFilled })),
    ...REQUEST_SECTIONS.filter((name) => !filled.has(name)).map((name) => ({
      name,
      present: false,
      filled: false,
    })),
  ];
}

// Line-by-line code-fence state shared by `splitStages` and
// `parseRequestSections`, so both agree on where a heading is. The returned
// function answers, for each line in order, whether it is a fence delimiter or
// lies inside a fence; a fence closes only on a run of its own character at
// least as long as the opener, and an unterminated one runs to the end of the
// input.
function fenceTracker() {
  let fence = null;
  return (line) => {
    const fenceMark = line.match(/^(`{3,}|~{3,})/);
    if (!fenceMark) return fence !== null;
    if (!fence) fence = { char: fenceMark[1][0], length: fenceMark[1].length };
    else if (fenceMark[1][0] === fence.char && fenceMark[1].length >= fence.length) fence = null;
    return true;
  };
}

// One walk over the body, fence-aware: each stage keeps its lines exactly as
// this walk saw them.
function walkStages(body) {
  const stages = [];
  let current = null;
  const isFenced = fenceTracker();
  for (const line of body.split('\n')) {
    const m = isFenced(line) ? null : line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      current = { key: m[1].trim().toLowerCase(), heading: m[1].trim(), source: '' };
      stages.push(current);
    } else if (current) {
      current.source += `${line}\n`;
    }
  }
  return stages;
}

// The stages every reader consumes, each body trimmed as a whole.
function splitStages(body) {
  return walkStages(body).map(({ key, heading, source }) => ({
    key,
    heading,
    body: source.trim(),
  }));
}

// The untrimmed lines of one stage, for a reader that must count the same
// fence delimiters `walkStages` counted (`parseRequestSections`): trimming
// the first line would turn an indented fence line, no delimiter here, into
// one there. Null when the stage is absent.
export function stageSource(text, key) {
  const fm = text.match(FRONTMATTER);
  const body = fm ? text.slice(fm[0].length) : text;
  return walkStages(body).find((s) => s.key === key)?.source ?? null;
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
    `change ${change.frontmatter.id} belongs to ${parent}: persistent truth is reconciled by the parent — use \`changeledger graduate ${change.frontmatter.id} --skip\``,
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
  // An archived child still holds the parent open — archiving hides a
  // document, it does not resolve the work — but `list --parent` hides it by
  // default, so a bare id would name something the caller cannot find
  // (20261020-172221 D3).
  const open = openChildren(changes, id).map((c) => {
    const hidden = c.frontmatter.archived === true ? ', archived: `list --parent --all`' : '';
    return `${c.frontmatter.id} (${c.frontmatter.status}${hidden})`;
  });
  if (open.length === 0) return null;
  return `change ${id} still has unresolved children: ${open.join(', ')} — close or discard them first`;
}

export function assertChildrenResolved(changes, id) {
  const message = childrenOpenError(changes, id);
  if (message) throw new Error(message);
}
