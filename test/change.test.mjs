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

- [x] First task (CR1) — 2026-06-13T13:30:00Z
- [ ] Second task (CR2, CR3)
- [!] Third task — blocked by upstream

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

test('parses task suffix from the last em dash separator', () => {
  const c = parseChange(`---
id: "0001"
title: X
type: feature
status: in-progress
created: 2026-06-13T13:30:00Z
depends_on: []
---

## Plan

- [x] Preserve wording — with an internal dash (CR1) — 2026-06-13T13:30:00Z
`);
  assert.equal(c.tasks[0].text, 'Preserve wording — with an internal dash');
  assert.deepEqual(c.tasks[0].criteria, ['CR1']);
  assert.equal(c.tasks[0].resolvedAt, '2026-06-13T13:30:00Z');
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
