import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseChange } from '../src/change.mjs';
import {
  appendLog,
  setArchived,
  setOwner,
  setReviewed,
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

test('setStatus throws when status is missing', () => {
  assert.throws(() => setStatus(DOC.replace(/^status:.*\n/m, ''), 'approved'), /missing status/);
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

test('setSpecUpdated throws when updated is missing', () => {
  const spec = `---\ntitle: Arch\ntags: [architecture]\n---\n\n# Arch\n`;
  assert.throws(() => setSpecUpdated(spec, '2026-06-15T17:30:00Z'), /missing updated/);
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
