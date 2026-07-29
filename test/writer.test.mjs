import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseChange } from '../src/change.mjs';
import {
  appendLogEvent,
  setArchived,
  setOwner,
  setReviewed,
  setSpecGraduatedFrom,
  setSpecUpdated,
  setStatus,
  setTask,
} from '../src/writer.mjs';

const DOC = `---
id: "20260613-120000"
title: X
type: feature
status: draft
created: 2026-06-13T12:00:00Z
depends_on: []
---

## Plan

- [ ] First
  - **Criteria:** CR1
- [ ] Second
- [!] Third
  - **Blocked:** was blocked

## Log

- **2026-06-13T12:00:00Z** \`[note]\` created
`;

test('setStatus changes only the frontmatter status', () => {
  const out = setStatus(DOC, 'approved');
  assert.equal(parseChange(out).frontmatter.status, 'approved');
});

test('122950 CR1: setStatus preserves every unrelated frontmatter byte', () => {
  const before = `---
# identity
id: "20260613-120000"
title: 'Own style'
type: feature
status: in-progress # lifecycle
created: 2026-06-13T12:00:00Z
depends_on: ["A", "B"]
metadata:
  status: nested
note: |
  status: literal
---

Body.
`;
  const expected = before.replace(
    'status: in-progress # lifecycle',
    'status: in-review # lifecycle',
  );
  assert.equal(setStatus(before, 'in-review'), expected);
});

test('setStatus throws when status is missing', () => {
  assert.throws(() => setStatus(DOC.replace(/^status:.*\n/m, ''), 'approved'), /missing status/);
});

test('appendLogEvent adds a typed entry at the end of Log', () => {
  const out = appendLogEvent(DOC, {
    at: '2026-06-13T13:00:00Z',
    type: 'note',
    message: 'moved — [status] | freely',
  });
  assert.match(out, /- \*\*2026-06-13T13:00:00Z\*\* `\[note\]` moved — \[status\] \| freely\n?$/);
});

test('setTask done marks the task and appends the timestamp, keeping criteria', () => {
  const out = setTask(DOC, 1, 'done', { iso: '2026-06-13T13:00:00Z' });
  const t = parseChange(out).tasks[0];
  assert.equal(t.state, 'done');
  assert.deepEqual(t.criteria, ['CR1']);
  assert.equal(t.resolvedAt, '2026-06-13T13:00:00Z');
  assert.match(
    out,
    /- \[x\] First\n {2}- \*\*Criteria:\*\* CR1\n {2}- \*\*Resolved:\*\* `2026-06-13T13:00:00Z`/,
  );
});

test('125007 CR1: setTask preserves punctuation in the task description', () => {
  const text = DOC.replace(
    '- [ ] First',
    '- [ ] Lote 1 — ReferralCode + Chatbot | `src/a:b.mjs` — mismo patrón',
  );
  const out = setTask(text, 1, 'done', { iso: '2026-07-19T10:22:32Z' });
  assert.match(
    out,
    /- \[x\] Lote 1 — ReferralCode \+ Chatbot \| `src\/a:b\.mjs` — mismo patrón\n {2}- \*\*Criteria:\*\* CR1\n {2}- \*\*Resolved:\*\* `2026-07-19T10:22:32Z`/,
  );
});

// 20260729-203257: the state child is the resolution, so it lands after the
// descriptive children instead of splitting the task from its own fields.
test('203257 CR1: setTask keeps the descriptive children and appends the state child last', () => {
  const text = DOC.replace(
    '- [ ] Second',
    '- [ ] Second\n  - **Target:** `src/writer.mjs`\n  - **Verify:** `node --test test/writer.test.mjs`\n  - **Criteria:** CR2',
  );
  const blocked = setTask(text, 2, 'blocked', { reason: 'waiting upstream' });
  assert.match(
    blocked,
    /- \[!\] Second\n {2}- \*\*Target:\*\* `src\/writer\.mjs`\n {2}- \*\*Verify:\*\* `node --test test\/writer\.test\.mjs`\n {2}- \*\*Criteria:\*\* CR2\n {2}- \*\*Blocked:\*\* waiting upstream/,
  );
  const done = setTask(blocked, 2, 'done', { iso: '2026-06-13T15:00:00Z' });
  const task = parseChange(done).tasks[1];
  assert.equal(task.state, 'done');
  assert.equal(task.target, '`src/writer.mjs`');
  assert.equal(task.verify, '`node --test test/writer.test.mjs`');
  assert.deepEqual(task.criteria, ['CR2']);
  assert.equal(task.reason, undefined);
  assert.equal(task.resolvedAt, '2026-06-13T15:00:00Z');
});

// A description wrapped onto an indented continuation is one logical task: the
// state child must land after the continuation, not inside the description.
test('203257 CR1: setTask appends the state child after a wrapped description', () => {
  const text = DOC.replace('- [ ] Second', '- [ ] Second que envuelve\n  a la línea siguiente');
  const out = setTask(text, 2, 'done', { iso: '2026-06-13T16:00:00Z' });
  assert.match(
    out,
    /- \[x\] Second que envuelve\n {2}a la línea siguiente\n {2}- \*\*Resolved:\*\* `2026-06-13T16:00:00Z`/,
  );
  assert.equal(parseChange(out).tasks[1].text, 'Second que envuelve a la línea siguiente');
});

test('125007 CR2: completing an already resolved task is byte-for-byte idempotent', () => {
  const once = setTask(DOC, 1, 'done', { iso: '2026-06-13T13:00:00Z' });
  const twice = setTask(once, 1, 'done', { iso: '2026-06-13T14:00:00Z' });
  assert.equal(twice, once);
});

test('setTask block marks [!] with a reason', () => {
  const reason = 'waiting upstream — platform | security: [status]';
  const out = setTask(DOC, 2, 'blocked', { reason });
  const t = parseChange(out).tasks[1];
  assert.equal(t.state, 'blocked');
  assert.equal(t.reason, reason);
  assert.match(
    out,
    /- \[!\] Second\n {2}- \*\*Blocked:\*\* waiting upstream — platform \| security: \[status\]/,
  );
});

test('setTask done replaces an existing blocked suffix', () => {
  const out = setTask(DOC, 3, 'done', { iso: '2026-06-13T14:00:00Z' });
  const t = parseChange(out).tasks[2];
  assert.equal(t.state, 'done');
  assert.equal(t.resolvedAt, '2026-06-13T14:00:00Z');
  assert.equal(t.reason, undefined);
});

test('125007 CR4: setTask rejects malformed metadata without producing output', () => {
  const malformed = DOC.replace('- [ ] Second', '- [x] Second');
  assert.throws(
    () => setTask(malformed, 2, 'done', { iso: '2026-06-13T14:00:00Z' }),
    /invalid task metadata structure for task #2/,
  );
});

test('125007 CR4: setTask rejects a non-ISO Resolved timestamp without writing', () => {
  const malformed = DOC.replace('- [ ] Second', '- [x] Second\n  - **Resolved:** `not-iso`');
  assert.throws(
    () => setTask(malformed, 2, 'done', { iso: '2026-06-13T14:00:00Z' }),
    /invalid task metadata structure for task #2/,
  );
});

test('setTask throws on a missing task index', () => {
  assert.throws(() => setTask(DOC, 9, 'done', { iso: 'x' }), /no task #9/);
});

test('setOwner adds the owner line after depends_on', () => {
  const out = setOwner(DOC, 'ana');
  assert.equal(parseChange(out).frontmatter.owner, 'ana');
  assert.match(out, /depends_on: \[\]\nowner: ana\n/);
});

test('setOwner throws when adding without depends_on anchor', () => {
  assert.throws(() => setOwner(DOC.replace(/^depends_on:.*\n/m, ''), 'ana'), /missing depends_on/);
});

test('setOwner updates an existing owner', () => {
  const out = setOwner(setOwner(DOC, 'ana'), 'leo');
  assert.equal(parseChange(out).frontmatter.owner, 'leo');
  assert.equal((out.match(/^owner:/gm) || []).length, 1);
});

test('setOwner with falsy value removes the owner line', () => {
  const out = setOwner(setOwner(DOC, 'ana'), null);
  assert.equal('owner' in parseChange(out).frontmatter, false);
});

test('122950 CR2: optional fields patch only their root pair', () => {
  const styled = `---
id: "20260613-120000"
title: |
  Styled
type: feature
status: done
created: 2026-06-13T12:00:00Z
depends_on: ["A", "B"]
owner: 'ana' # responsible
archived: true # cold
reviewed: true # graduated
metadata:
  owner: nested
---

Body.
`;
  assert.equal(setOwner(styled, 'leo'), styled.replace("owner: 'ana'", 'owner: leo'));
  assert.equal(setArchived(styled, false), styled.replace('archived: true # cold\n', ''));
  assert.equal(setReviewed(styled, false), styled.replace('reviewed: true # graduated\n', ''));

  const withoutOptional = styled
    .replace("owner: 'ana' # responsible\n", '')
    .replace('archived: true # cold\n', '')
    .replace('reviewed: true # graduated\n', '');
  assert.equal(
    setOwner(withoutOptional, 'leo'),
    withoutOptional.replace('depends_on: ["A", "B"]\n', 'depends_on: ["A", "B"]\nowner: leo\n'),
  );
});

test('appendLogEvent creates the Log section when absent', () => {
  const noLog = `---
id: "20260613-120000"
title: X
type: chore
status: draft
created: 2026-06-13T12:00:00Z
depends_on: []
---

## Request

x

## Plan

- [ ] do it
`;
  const out = appendLogEvent(noLog, {
    at: '2026-06-13T13:00:00Z',
    type: 'status',
    from: 'draft',
    to: 'approved',
  });
  const log = parseChange(out).stages.find((s) => s.key === 'log');
  assert.ok(log, 'a ## Log section is created');
  assert.match(out, /## Log\n\n- \*\*2026-06-13T13:00:00Z\*\* `\[status\]` draft → approved\n$/);
});

test('setReviewed adds and removes the reviewed flag', () => {
  const on = setReviewed(DOC, true);
  assert.equal(parseChange(on).frontmatter.reviewed, true);
  const off = setReviewed(on, false);
  assert.equal('reviewed' in parseChange(off).frontmatter, false);
});

test('setReviewed throws when adding without depends_on anchor', () => {
  assert.throws(
    () => setReviewed(DOC.replace(/^depends_on:.*\n/m, ''), true),
    /missing depends_on/,
  );
});

test('setReviewed is idempotent', () => {
  const once = setReviewed(DOC, true);
  const twice = setReviewed(once, true);
  assert.equal(twice.match(/^reviewed: true$/gm).length, 1);
});

test('setArchived adds and removes the archived flag', () => {
  const on = setArchived(DOC, true);
  assert.equal(parseChange(on).frontmatter.archived, true);
  const off = setArchived(on, false);
  assert.equal('archived' in parseChange(off).frontmatter, false);
});

test('setArchived throws when adding without depends_on anchor', () => {
  assert.throws(
    () => setArchived(DOC.replace(/^depends_on:.*\n/m, ''), true),
    /missing depends_on/,
  );
});

test('CR5: setSpecUpdated replaces only the updated line', () => {
  const spec = `---\ntitle: Arch\nupdated: 2020-01-01T00:00:00Z\ntags: [architecture]\n---\n\n# Arch\n\nBody.\n`;
  const out = setSpecUpdated(spec, '2026-06-15T17:30:00Z');
  assert.match(out, /^updated: 2026-06-15T17:30:00Z$/m);
  assert.doesNotMatch(out, /2020-01-01/);
  assert.match(out, /^title: Arch$/m);
  assert.match(out, /^tags: \[\s*architecture\s*\]$/m);
  assert.match(out, /# Arch\n\nBody\./);
});

test('122950 CR3: setSpecUpdated preserves tags, comments and body byte-for-byte', () => {
  const spec = `---
title: 'Arch'
updated: 2020-01-01T00:00:00Z # refreshed on graduation
tags: [architecture]
---

# Arch

Body.
`;
  assert.equal(
    setSpecUpdated(spec, '2026-07-15T12:00:00Z'),
    spec.replace('2020-01-01T00:00:00Z', '2026-07-15T12:00:00Z'),
  );
});

test('setSpecUpdated throws when updated is missing', () => {
  const spec = `---\ntitle: Arch\ntags: [architecture]\n---\n\n# Arch\n`;
  assert.throws(() => setSpecUpdated(spec, '2026-06-15T17:30:00Z'), /missing updated/);
});

test('111457 CR1/CR2: setSpecGraduatedFrom appends unique ids and preserves the body', () => {
  const spec = `---
title: Arch
updated: 2020-01-01T00:00:00Z
tags: [architecture]
graduated_from: ["20260613-120000"]
---

# Arch

Body.
`;
  const once = setSpecGraduatedFrom(spec, '20260613-130000');
  const twice = setSpecGraduatedFrom(once, '20260613-130000');
  assert.match(twice, /^graduated_from: \["20260613-120000", "20260613-130000"\]$/m);
  assert.equal(twice.slice(twice.indexOf('\n---\n') + 5), '\n# Arch\n\nBody.\n');
});

test('111457 CR1: setSpecGraduatedFrom creates the field after tags', () => {
  const spec = `---\ntitle: Arch\nupdated: 2020-01-01T00:00:00Z\ntags: [architecture]\n---\n\n# Arch\n`;
  const out = setSpecGraduatedFrom(spec, '20260613-120000');
  assert.match(out, /tags: \[architecture\]\ngraduated_from: \["20260613-120000"\]\n---/);
});

test('174430: frontmatter mutations preserve multiline and nested YAML values', () => {
  const doc = `---
id: "20260613-120000"
title: |
  First line
  status: not-frontmatter
type: feature
status: draft
created: 2026-06-13T12:00:00Z
depends_on: []
metadata:
  status: nested
---

## Request

Body.
`;
  const out = setStatus(doc, 'approved');
  assert.equal(parseChange(out).frontmatter.status, 'approved');
  assert.match(out, /status: not-frontmatter/);
  assert.match(out, /metadata:\n {2}status: nested/);
  assert.match(out, /## Request\n\nBody\./);
});

test('122950 CR4: invalid or duplicate root YAML fails without a transform', () => {
  assert.throws(
    () => setStatus(DOC.replace('status: draft', 'status: draft\nstatus: approved'), 'done'),
    /Map keys must be unique/,
  );
  assert.throws(
    () => setStatus(DOC.replace('depends_on: []', 'depends_on: [broken'), 'done'),
    /flow sequence/i,
  );
});
