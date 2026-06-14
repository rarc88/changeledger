import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseChange } from '../src/change.mjs';
import {
  appendLog,
  setArchived,
  setOwner,
  setReviewed,
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

- [ ] First (CR1)
- [ ] Second
- [!] Third — was blocked

## Log

- **2026-06-13T12:00:00Z** — created
`;

test('setStatus changes only the frontmatter status', () => {
  const out = setStatus(DOC, 'approved');
  assert.equal(parseChange(out).frontmatter.status, 'approved');
});

test('appendLog adds a timestamped entry at the end of Log', () => {
  const out = appendLog(DOC, '2026-06-13T13:00:00Z', 'moved to approved');
  assert.match(out, /- \*\*2026-06-13T13:00:00Z\*\* — moved to approved\n?$/);
});

test('setTask done marks the task and appends the timestamp, keeping criteria', () => {
  const out = setTask(DOC, 1, 'done', { iso: '2026-06-13T13:00:00Z' });
  const t = parseChange(out).tasks[0];
  assert.equal(t.state, 'done');
  assert.deepEqual(t.criteria, ['CR1']);
  assert.equal(t.resolvedAt, '2026-06-13T13:00:00Z');
});

test('setTask block marks [!] with a reason', () => {
  const out = setTask(DOC, 2, 'blocked', { reason: 'waiting upstream' });
  const t = parseChange(out).tasks[1];
  assert.equal(t.state, 'blocked');
  assert.equal(t.reason, 'waiting upstream');
});

test('setTask done replaces an existing blocked suffix', () => {
  const out = setTask(DOC, 3, 'done', { iso: '2026-06-13T14:00:00Z' });
  const t = parseChange(out).tasks[2];
  assert.equal(t.state, 'done');
  assert.equal(t.resolvedAt, '2026-06-13T14:00:00Z');
  assert.equal(t.reason, undefined);
});

test('setTask throws on a missing task index', () => {
  assert.throws(() => setTask(DOC, 9, 'done', { iso: 'x' }), /no task #9/);
});

test('setOwner adds the owner line after depends_on', () => {
  const out = setOwner(DOC, 'ana');
  assert.equal(parseChange(out).frontmatter.owner, 'ana');
  assert.match(out, /depends_on: \[\]\nowner: ana\n/);
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

test('appendLog creates the Log section when absent', () => {
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
  const out = appendLog(noLog, '2026-06-13T13:00:00Z', 'status: draft → approved');
  const log = parseChange(out).stages.find((s) => s.key === 'log');
  assert.ok(log, 'a ## Log section is created');
  assert.match(out, /## Log\n\n- \*\*2026-06-13T13:00:00Z\*\* — status: draft → approved\n$/);
});

test('setReviewed adds and removes the reviewed flag', () => {
  const on = setReviewed(DOC, true);
  assert.equal(parseChange(on).frontmatter.reviewed, true);
  const off = setReviewed(on, false);
  assert.equal('reviewed' in parseChange(off).frontmatter, false);
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
