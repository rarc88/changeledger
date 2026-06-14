import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parseChange } from '../src/change.mjs';
import { archive, list, log, owner, show, status, task } from '../src/commands/agent.mjs';
import { init } from '../src/commands/init.mjs';
import { newChange } from '../src/commands/new.mjs';

// Isolate the global registry so init() doesn't touch the real home.
process.env.SPEC_LEDGER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-home-'));

function repoWithChange() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-agent-'));
  init(root);
  const file = newChange(
    { type: 'feature', slug: 'x', title: 'X', now: '2026-06-13T12:00:00Z' },
    root,
  );
  // give it a task to operate on
  const text = fs.readFileSync(file, 'utf8').replace('## Plan\n', '## Plan\n\n- [ ] do it\n');
  fs.writeFileSync(file, text);
  const id = parseChange(text).frontmatter.id;
  return { root, file, id };
}

test('status moves the lifecycle and logs the transition', () => {
  const { root, file, id } = repoWithChange();
  status(id, 'approved', root);
  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.status, 'approved');
  assert.match(c.stages.find((s) => s.key === 'log').body, /draft → approved/);
});

test('status rejects an invalid value without writing', () => {
  const { root, file, id } = repoWithChange();
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => status(id, 'weird', root), /Invalid status/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('task done marks the task with a timestamp', () => {
  const { root, file, id } = repoWithChange();
  task(id, 'done', 1, '', root);
  const t = parseChange(fs.readFileSync(file, 'utf8')).tasks[0];
  assert.equal(t.state, 'done');
  assert.match(t.resolvedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('log appends a timestamped entry', () => {
  const { root, file, id } = repoWithChange();
  log(id, 'a note', root);
  assert.match(fs.readFileSync(file, 'utf8'), /— a note\n?$/);
});

test('new --owner writes the owner into the frontmatter', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-owner-'));
  init(root);
  const file = newChange(
    { type: 'feature', slug: 'x', title: 'X', owner: 'ana', now: '2026-06-13T12:00:00Z' },
    root,
  );
  assert.equal(parseChange(fs.readFileSync(file, 'utf8')).frontmatter.owner, 'ana');
});

test('owner sets and clears the responsible', () => {
  const { root, file, id } = repoWithChange();
  owner(id, 'ana', root);
  assert.equal(parseChange(fs.readFileSync(file, 'utf8')).frontmatter.owner, 'ana');
  owner(id, '-', root);
  assert.equal('owner' in parseChange(fs.readFileSync(file, 'utf8')).frontmatter, false);
});

test('archive sets and clears the archived flag', () => {
  const { root, file, id } = repoWithChange();
  archive(id, true, root);
  assert.equal(parseChange(fs.readFileSync(file, 'utf8')).frontmatter.archived, true);
  archive(id, false, root);
  assert.equal('archived' in parseChange(fs.readFileSync(file, 'utf8')).frontmatter, false);
});

test('list filters by status and show returns the change', () => {
  const { root, id } = repoWithChange();
  assert.equal(list({ status: 'approved' }, root).length, 0);
  assert.equal(list({ status: 'draft' }, root).length, 1);
  assert.equal(show(id, root).frontmatter.title, 'X');
});
