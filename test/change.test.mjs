import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseChange } from '../src/change.mjs';

const SAMPLE = `---
id: "0001"
title: Bootstrap
type: feature
status: in-progress
created: 2026-06-13T13:30:00Z
depends_on: []
---

## Request

Build the thing.

## Plan

- [x] First task
  - **Criteria:** CR1
  - **Resolved:** \`2026-06-13T13:30:00Z\`
- [ ] Second task
  - **Criteria:** CR2, CR3
- [!] Third task
  - **Blocked:** blocked by upstream

## Log

- Something happened.
`;

test('parses frontmatter with types', () => {
  const c = parseChange(SAMPLE);
  assert.equal(c.frontmatter.id, '0001');
  assert.equal(c.frontmatter.type, 'feature');
  assert.equal(c.frontmatter.status, 'in-progress');
  assert.equal(c.frontmatter.created, '2026-06-13T13:30:00Z');
  assert.deepEqual(c.frontmatter.depends_on, []);
});

test('splits body into stages by ## heading', () => {
  const c = parseChange(SAMPLE);
  assert.deepEqual(
    c.stages.map((s) => s.key),
    ['request', 'plan', 'log'],
  );
  assert.match(c.stages[0].body, /Build the thing/);
});

test('extracts tasks from the plan stage with state', () => {
  const c = parseChange(SAMPLE);
  assert.equal(c.tasks.length, 3);
  assert.equal(c.tasks[0].state, 'done');
  assert.equal(c.tasks[1].state, 'todo');
  assert.equal(c.tasks[2].state, 'blocked');
});

test('parses task criteria, resolution timestamp and block reason', () => {
  const c = parseChange(SAMPLE);
  assert.deepEqual(c.tasks[0].criteria, ['CR1']);
  assert.equal(c.tasks[0].resolvedAt, '2026-06-13T13:30:00Z');
  assert.equal(c.tasks[0].text, 'First task');
  assert.deepEqual(c.tasks[1].criteria, ['CR2', 'CR3']);
  assert.equal(c.tasks[2].reason, 'blocked by upstream');
});

test('125007 CR1: parses structured metadata without truncating task punctuation', () => {
  const c = parseChange(`---
id: "0001"
title: X
type: feature
status: in-progress
created: 2026-06-13T13:30:00Z
depends_on: []
---

## Plan

- [x] Preserve wording — with an internal dash | and colon: value
  - **Criteria:** CR1
  - **Resolved:** \`2026-06-13T13:30:00Z\`
`);
  assert.equal(c.tasks[0].text, 'Preserve wording — with an internal dash | and colon: value');
  assert.deepEqual(c.tasks[0].criteria, ['CR1']);
  assert.equal(c.tasks[0].resolvedAt, '2026-06-13T13:30:00Z');
});

test('125007 CR4: reports task metadata structure defects for validation', () => {
  const c = parseChange(`---
id: "0001"
title: X
type: feature
status: in-progress
created: 2026-06-13T13:30:00Z
depends_on: []
---

## Plan

- [x] Missing metadata (CR1)
- [ ] Pending metadata (CR1)
  - **Resolved:** \`2026-06-13T13:30:00Z\`
- [x] Invalid timestamp (CR1)
  - **Resolved:** \`not-iso\`
`);
  assert.deepEqual(
    c.taskIssues.map((issue) => issue.message),
    [
      'invalid task metadata structure for task #1',
      'invalid task metadata structure for task #2',
      'invalid task metadata structure for task #3',
    ],
  );
});

// 20260729-203257 CR1: a description wrapped onto an indented second physical
// line is one logical task. The old positional parser dropped the continuation
// and, with it, any trace on it.
test('203257 CR1: an indented continuation joins the description and keeps the trace', () => {
  const c = parseChange(`---
id: "0001"
title: X
type: feature
status: in-progress
created: 2026-06-13T13:30:00Z
depends_on: []
---

## Plan

- [ ] Descripción que envuelve
  a una segunda línea física
  - **Criteria:** CR2
`);
  assert.equal(c.tasks.length, 1);
  assert.equal(c.tasks[0].text, 'Descripción que envuelve a una segunda línea física');
  assert.deepEqual(c.tasks[0].criteria, ['CR2']);
  assert.deepEqual(c.taskIssues, []);
});

// 20260729-203257 CR2: nothing inside `## Plan` is discarded in silence.
test('203257 CR2: a non-indented undecidable Plan line is a named issue', () => {
  const c = parseChange(`---
id: "0001"
title: X
type: feature
status: draft
created: 2026-06-13T13:30:00Z
depends_on: []
---

## Plan

- [ ] Tarea uno
  - **Criteria:** CR1
Prosa suelta que no es tarea
- [ ] Tarea dos
  - **Criteria:** CR2
`);
  assert.deepEqual(
    c.taskIssues.map((issue) => issue.message),
    ['unrecognized Plan line: "Prosa suelta que no es tarea"'],
  );
  assert.equal(c.tasks.length, 2);
});

// 20260729-203257 CR3: the trace comes from the `Criteria` child only; every
// parenthesis in the description is prose, whatever it looks like.
test('203257 CR3: parentheses in the description are prose, not trace', () => {
  const c = parseChange(`---
id: "0001"
title: X
type: feature
status: in-progress
created: 2026-06-13T13:30:00Z
depends_on: []
---

## Plan

- [ ] Hacer cosas (CR1) (support)
  - **Criteria:** CR2
`);
  assert.deepEqual(c.tasks[0].criteria, ['CR2']);
  assert.equal(c.tasks[0].text, 'Hacer cosas (CR1) (support)');
  assert.deepEqual(c.taskIssues, []);
});

test('203257 CR3: a non-CRn token in Criteria is a named issue', () => {
  const c = parseChange(`---
id: "0001"
title: X
type: feature
status: in-progress
created: 2026-06-13T13:30:00Z
depends_on: []
---

## Plan

- [ ] Hacer cosas
  - **Criteria:** CR1, banana
`);
  assert.deepEqual(
    c.taskIssues.map((issue) => issue.message),
    ['invalid Criteria value "banana" for task #1'],
  );
});

// The four descriptive children are legal in any state and at most once each.
test('203257 CR1: Target, Verify, Criteria and Support are parsed as task fields', () => {
  const c = parseChange(`---
id: "0001"
title: X
type: feature
status: in-progress
created: 2026-06-13T13:30:00Z
depends_on: []
---

## Plan

- [x] Implementar
  - **Target:** \`src/task.mjs\`
  - **Verify:** \`node --test test/change.test.mjs\`
  - **Criteria:** CR1, CR2
  - **Resolved:** \`2026-06-13T13:30:00Z\`
- [ ] Ejecutar el gate
  - **Support:** cierre operativo
`);
  assert.deepEqual(c.taskIssues, []);
  assert.equal(c.tasks[0].target, '`src/task.mjs`');
  assert.equal(c.tasks[0].verify, '`node --test test/change.test.mjs`');
  assert.deepEqual(c.tasks[0].criteria, ['CR1', 'CR2']);
  assert.equal(c.tasks[0].resolvedAt, '2026-06-13T13:30:00Z');
  assert.equal(c.tasks[1].support, 'cierre operativo');
  assert.deepEqual(c.tasks[1].criteria, []);
});

test('203257 CR1: a repeated descriptive child is a structure issue', () => {
  const c = parseChange(`---
id: "0001"
title: X
type: feature
status: in-progress
created: 2026-06-13T13:30:00Z
depends_on: []
---

## Plan

- [ ] Implementar
  - **Target:** \`src/task.mjs\`
  - **Target:** \`src/check.mjs\`
`);
  assert.deepEqual(
    c.taskIssues.map((issue) => issue.message),
    ['invalid task metadata structure for task #1'],
  );
});

test('parses acceptance criterion steps', () => {
  const c = parseChange(`---
id: "0001"
title: X
type: feature
status: approved
created: 2026-06-13T13:30:00Z
depends_on: []
---

## Specification

### CR1 — Works
- **Given** input
- **When** action
- **Then** output
- **And** extra
`);
  assert.deepEqual(c.criteria, ['CR1']);
  assert.deepEqual(c.criterionBlocks, [{ id: 'CR1', steps: ['Given', 'When', 'Then', 'And'] }]);
});

test('computes progress', () => {
  const c = parseChange(SAMPLE);
  assert.deepEqual(c.progress, { total: 3, done: 1, blocked: 1 });
});

test('throws when frontmatter is missing', () => {
  assert.throws(() => parseChange('## Request\n\nno frontmatter'), /frontmatter/i);
});

test('162050 CR1: headings inside fenced code blocks do not create stages', () => {
  const c = parseChange(`---
id: "0001"
title: X
type: bug
status: approved
created: 2026-06-13T13:30:00Z
depends_on: []
---

## Request

Real request.

## Investigation

\`\`\`md
## Request
\`\`\`

Still investigation.
`);
  assert.deepEqual(
    c.stages.map((s) => s.key),
    ['request', 'investigation'],
  );
  assert.match(c.stages[1].body, /## Request/);
  assert.match(c.stages[1].body, /Still investigation/);
});

test('162050 CR2: headings after a closed fence still create stages', () => {
  const c = parseChange(`---
id: "0001"
title: X
type: bug
status: approved
created: 2026-06-13T13:30:00Z
depends_on: []
---

## Request

\`\`\`md
## Not a stage
\`\`\`

## Investigation

Real investigation.
`);
  assert.deepEqual(
    c.stages.map((s) => s.key),
    ['request', 'investigation'],
  );
  assert.match(c.stages[1].body, /Real investigation/);
});

test('162050 CR3: an unclosed fence keeps later headings in the current body', () => {
  const c = parseChange(`---
id: "0001"
title: X
type: bug
status: approved
created: 2026-06-13T13:30:00Z
depends_on: []
---

## Request

\`\`\`md
## Investigation
`);
  assert.deepEqual(
    c.stages.map((s) => s.key),
    ['request'],
  );
  assert.match(c.stages[0].body, /## Investigation/);
});
