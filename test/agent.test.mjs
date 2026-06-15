import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parseChange } from '../src/change.mjs';
import { archive, list, log, owner, review, show, status, task } from '../src/commands/agent.mjs';
import { init } from '../src/commands/init.mjs';
import { newChange } from '../src/commands/new.mjs';

// Isolate the global registry so init() doesn't touch the real home.
process.env.SPEC_LEDGER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-home-'));

function repoWithChange() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-agent-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
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

test('status rejects an illegal lifecycle jump without writing', () => {
  const { root, file, id } = repoWithChange();
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => status(id, 'done', root), /invalid lifecycle transition: draft → done/);
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
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
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

test('status to in-progress auto-assigns owner handle when empty', () => {
  const { root, file, id } = repoWithChange();
  status(id, 'approved', root);
  status(id, 'in-progress', root, { ownerHandle: () => 'raruiz' });
  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.owner, 'raruiz');
  assert.match(c.stages.find((s) => s.key === 'log').body, /owner → raruiz \(auto\)/);
});

test('status to in-progress does not overwrite an explicit owner', () => {
  const { root, file, id } = repoWithChange();
  owner(id, 'leo', root);
  status(id, 'approved', root);
  status(id, 'in-progress', root, { ownerHandle: () => 'raruiz' });
  assert.equal(parseChange(fs.readFileSync(file, 'utf8')).frontmatter.owner, 'leo');
});

test('status to in-progress tolerates a missing owner handle', () => {
  const { root, file, id } = repoWithChange();
  status(id, 'approved', root);
  status(id, 'in-progress', root, { ownerHandle: () => '' });
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

// Review gate (change 20260615-150510). repoWithChange() is a `feature`, which
// the seeded config marks review_required.

function repoWithChore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-agent-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  init(root);
  const file = newChange(
    { type: 'chore', slug: 'c', title: 'C', now: '2026-06-13T12:00:00Z' },
    root,
  );
  const id = parseChange(fs.readFileSync(file, 'utf8')).frontmatter.id;
  return { root, file, id };
}

const reach = (id, root, target) => {
  for (const s of ['approved', 'in-progress', 'in-review']) {
    status(id, s, root);
    if (s === target) return;
  }
};

test('CR3: status blocks in-progress → done for a review_required type', () => {
  const { root, file, id } = repoWithChange();
  reach(id, root, 'in-progress');
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(
    () => status(id, 'done', root),
    /feature changes must be reviewed before done — move to in-review first/,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('CR4: a chore goes in-progress → done directly', () => {
  const { root, file, id } = repoWithChore();
  status(id, 'approved', root);
  status(id, 'in-progress', root);
  status(id, 'done', root);
  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.status, 'done');
  assert.match(c.stages.find((s) => s.key === 'log').body, /in-progress → done/);
});

test('CR5: status rejects approved → in-review without writing', () => {
  const { root, file, id } = repoWithChange();
  status(id, 'approved', root);
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(
    () => status(id, 'in-review', root),
    /invalid lifecycle transition: approved → in-review/,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('CR12: status rejects draft → done without writing', () => {
  const { root, file, id } = repoWithChange();
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => status(id, 'done', root), /invalid lifecycle transition: draft → done/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('CR6: review pass moves to done and marks the delegation', () => {
  const { root, file, id } = repoWithChange();
  reach(id, root, 'in-review');
  review(id, 'pass', {}, root);
  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.status, 'done');
  assert.match(
    c.stages.find((s) => s.key === 'log').body,
    /review → done \(delegated subagent, clean context\)/,
  );
});

test('CR7: review fail --retry returns to in-progress with the reason', () => {
  const { root, file, id } = repoWithChange();
  reach(id, root, 'in-review');
  review(id, 'fail', { mode: 'retry', reason: 'CR3 not met' }, root);
  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.status, 'in-progress');
  assert.match(
    c.stages.find((s) => s.key === 'log').body,
    /review → in-progress \(retry\): CR3 not met/,
  );
});

test('CR8: review fail --block escalates to blocked with the reason', () => {
  const { root, file, id } = repoWithChange();
  reach(id, root, 'in-review');
  review(id, 'fail', { mode: 'block', reason: 'spec is ambiguous' }, root);
  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.status, 'blocked');
  assert.match(c.stages.find((s) => s.key === 'log').body, /review → blocked: spec is ambiguous/);
});

test('CR9: review requires status in-review', () => {
  const { root, file, id } = repoWithChange();
  status(id, 'approved', root);
  status(id, 'in-progress', root);
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(
    () => review(id, 'pass', {}, root),
    /review requires status in-review \(current: in-progress\)/,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('CR10: review fail requires a reason', () => {
  const { root, file, id } = repoWithChange();
  reach(id, root, 'in-review');
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(
    () => review(id, 'fail', { mode: 'retry' }, root),
    /fail requires a reason — sl review <id> fail --retry\|--block "<reason>"/,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});
