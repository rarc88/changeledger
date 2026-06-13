import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseChange } from '../src/change.mjs';
import { appendLog, setStatus, setTask } from '../src/writer.mjs';

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
