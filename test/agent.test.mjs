import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { parseChange } from '../src/change.mjs';
import {
  archive,
  archiveGraduated,
  discard,
  list,
  log,
  owner,
  review,
  show,
  status,
  task,
  validation,
} from '../src/commands/agent.mjs';
import { init } from '../src/commands/init.mjs';
import { newChange } from '../src/commands/new.mjs';

const execFileAsync = promisify(execFile);

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
  assert.throws(() => status(id, 'done', root), /use human validation in the viewer/);
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

function repoWithArchiveCandidates() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-archive-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  init(root);
  const changesDir = path.join(root, '.sl', 'changes');
  const write = ({ id, status = 'done', reviewed = true, archived = false, log = '' }) => {
    const fm = [
      '---',
      `id: "${id}"`,
      'title: Candidate',
      'type: feature',
      `status: ${status}`,
      'created: 2026-06-13T12:00:00Z',
      ...(reviewed ? ['reviewed: true'] : []),
      ...(archived ? ['archived: true'] : []),
      'depends_on: []',
      '---',
    ].join('\n');
    const text = `${fm}\n\n## Request\n\nR\n\n## Investigation\n\nI\n\n## Proposal\n\nP\n\n## Specification\n\n### CR1 — C\n- **Given** x\n- **When** y\n- **Then** z\n\n## Plan\n\n- [x] do it (CR1) — 2026-06-13T12:00:00Z\n\n## Log\n${log}\n`;
    const file = path.join(changesDir, `${id}-candidate.md`);
    fs.writeFileSync(file, text);
    return file;
  };
  return { root, write };
}

test('212322 CR1/CR2: archiveGraduated dry-run lists candidates without writing', () => {
  const { root, write } = repoWithArchiveCandidates();
  const graduated = write({
    id: '20260613-120001',
    log: '- **2026-06-13T12:00:00Z** — graduado a spec `arch.md`',
  });
  const before = fs.readFileSync(graduated, 'utf8');
  const listed = archiveGraduated({ dryRun: true }, root);
  assert.deepEqual(
    listed.map((c) => c.id),
    ['20260613-120001'],
  );
  assert.equal(fs.readFileSync(graduated, 'utf8'), before);
});

test('212322 CR2: archiveGraduated archives graduated and skipped done changes', () => {
  const { root, write } = repoWithArchiveCandidates();
  const graduated = write({
    id: '20260613-120001',
    log: '- **2026-06-13T12:00:00Z** — graduado a spec `arch.md`',
  });
  const skipped = write({
    id: '20260613-120002',
    log: '- **2026-06-13T12:00:00Z** — graduation skipped: no durable truth',
  });
  const archived = archiveGraduated({}, root);
  assert.deepEqual(
    archived.map((c) => c.id),
    ['20260613-120001', '20260613-120002'],
  );
  for (const file of [graduated, skipped]) {
    const c = parseChange(fs.readFileSync(file, 'utf8'));
    assert.equal(c.frontmatter.archived, true);
    assert.match(c.stages.find((s) => s.key === 'log').body, /— archived/);
  }
});

test('212322 CR3/CR4: archiveGraduated skips active, unreviewed and already archived changes', () => {
  const { root, write } = repoWithArchiveCandidates();
  const active = write({
    id: '20260613-120001',
    status: 'in-progress',
    log: '- **2026-06-13T12:00:00Z** — graduado a spec `arch.md`',
  });
  const unreviewed = write({
    id: '20260613-120002',
    reviewed: false,
    log: '- **2026-06-13T12:00:00Z** — graduado a spec `arch.md`',
  });
  const alreadyArchived = write({
    id: '20260613-120003',
    archived: true,
    log: '- **2026-06-13T12:00:00Z** — graduado a spec `arch.md`\n- **2026-06-13T12:01:00Z** — archived',
  });
  const before = new Map(
    [active, unreviewed, alreadyArchived].map((file) => [file, fs.readFileSync(file, 'utf8')]),
  );
  assert.deepEqual(archiveGraduated({}, root), []);
  for (const [file, text] of before) assert.equal(fs.readFileSync(file, 'utf8'), text);
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

test('171002 CR1: status blocks review-required in-progress → in-validation', () => {
  const { root, file, id } = repoWithChange();
  reach(id, root, 'in-progress');
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(
    () => status(id, 'in-validation', root),
    /feature changes must be reviewed before validation — move to in-review first/,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('171002 CR5: a chore goes directly to in-validation, not done', () => {
  const { root, file, id } = repoWithChore();
  status(id, 'approved', root);
  status(id, 'in-progress', root);
  status(id, 'in-validation', root);
  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.status, 'in-validation');
  assert.match(c.stages.find((s) => s.key === 'log').body, /in-progress → in-validation/);
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
  assert.throws(() => status(id, 'done', root), /use human validation in the viewer/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('171002 CR1: review pass moves to validation and marks the delegation', () => {
  const { root, file, id } = repoWithChange();
  reach(id, root, 'in-review');
  review(id, 'pass', {}, root);
  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.status, 'in-validation');
  assert.match(
    c.stages.find((s) => s.key === 'log').body,
    /review → in-validation \(delegated subagent, clean context\)/,
  );
});

test('171002 CR2: human validation pass closes the complete change', () => {
  const { root, file, id } = repoWithChange();
  reach(id, root, 'in-review');
  review(id, 'pass', {}, root);
  validation(id, 'pass', {}, root);
  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.status, 'done');
  assert.match(c.stages.find((s) => s.key === 'log').body, /validation → done \(human accepted\)/);
});

test('171002 CR3: human rejection requires a reason and returns to in-progress', () => {
  const { root, file, id } = repoWithChange();
  reach(id, root, 'in-review');
  review(id, 'pass', {}, root);
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => validation(id, 'fail', {}, root), /requires a reason/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  validation(id, 'fail', { reason: 'fails on device' }, root);
  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.status, 'in-progress');
  assert.match(c.stages.find((s) => s.key === 'log').body, /human rejected\): fails on device/);
});

test('171002 CR2: generic status cannot close a change on behalf of the human', () => {
  const { root, file, id } = repoWithChore();
  status(id, 'approved', root);
  status(id, 'in-progress', root);
  status(id, 'in-validation', root);
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => status(id, 'done', root), /use human validation in the viewer/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
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

// 20260615-175734 — ids share a timestamp prefix, so a partial/ambiguous id must
// never resolve to "the first file whose name starts with it". Resolution is by
// exact frontmatter.id equality, and it must not write to the wrong change.
function repoWithTwoSamePrefix() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-agent-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  init(root);
  const fileA = newChange(
    { type: 'feature', slug: 'a', title: 'A', now: '2026-06-13T12:00:00Z' },
    root,
  );
  const fileB = newChange(
    { type: 'feature', slug: 'b', title: 'B', now: '2026-06-13T12:00:01Z' },
    root,
  );
  const idA = parseChange(fs.readFileSync(fileA, 'utf8')).frontmatter.id;
  const idB = parseChange(fs.readFileSync(fileB, 'utf8')).frontmatter.id;
  return { root, fileA, fileB, idA, idB };
}

test('175734 CR1: a full exact id resolves the right sibling and leaves the other untouched', () => {
  const { root, fileA, fileB, idB } = repoWithTwoSamePrefix();
  const beforeA = fs.readFileSync(fileA, 'utf8');
  status(idB, 'approved', root);
  assert.equal(parseChange(fs.readFileSync(fileB, 'utf8')).frontmatter.status, 'approved');
  assert.equal(fs.readFileSync(fileA, 'utf8'), beforeA, 'sibling must be byte-for-byte unchanged');
});

test('175734 CR2: a partial id shared by siblings is rejected without writing', () => {
  const { root, fileA, fileB } = repoWithTwoSamePrefix();
  const beforeA = fs.readFileSync(fileA, 'utf8');
  const beforeB = fs.readFileSync(fileB, 'utf8');
  assert.throws(() => status('20260613', 'approved', root), /No change with id "20260613"/);
  assert.equal(fs.readFileSync(fileA, 'utf8'), beforeA);
  assert.equal(fs.readFileSync(fileB, 'utf8'), beforeB);
});

test('175734 CR3: a filename whose frontmatter id differs is not an exact match', () => {
  const { root, fileA, idA } = repoWithTwoSamePrefix();
  // Corrupt the frontmatter id so the filename prefix no longer reflects it.
  fs.writeFileSync(
    fileA,
    fs.readFileSync(fileA, 'utf8').replace(`id: "${idA}"`, 'id: "20260613-999999"'),
  );
  // The filename still begins with idA, but no change has that exact frontmatter id.
  assert.throws(() => status(idA, 'approved', root), new RegExp(`No change with id "${idA}"`));
  // The real (corrupted) id resolves regardless of the filename.
  status('20260613-999999', 'approved', root);
  assert.equal(parseChange(fs.readFileSync(fileA, 'utf8')).frontmatter.status, 'approved');
});

// 20260615-210508 — discard requires a reason and writes a terminal status.
test('210508 CR1: discard without a reason throws and writes nothing', () => {
  const { root, file, id } = repoWithChange();
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(
    () => discard(id, '', root),
    /discard requires a reason — sl discard <id> "<reason>"/,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('210508 CR2: discard sets the terminal status and logs the reason', () => {
  const { root, file, id } = repoWithChange();
  discard(id, 'superseded by 20260613-120001', root);
  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.status, 'discarded');
  assert.match(
    c.stages.find((s) => s.key === 'log').body,
    /draft → discarded: superseded by 20260613-120001/,
  );
});

test('210508 CR3/CR4: cannot discard a done change, and discarded is terminal', () => {
  const { root, file, id } = repoWithChange();
  status(id, 'approved', root);
  status(id, 'in-progress', root);
  // Drive the feature through review and human validation to test terminal done.
  status(id, 'in-review', root);
  review(id, 'pass', {}, root);
  validation(id, 'pass', {}, root);
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(
    () => discard(id, 'too late', root),
    /invalid lifecycle transition: done → discarded/,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('210508 CR1: status refuses discarded and points to the discard verb', () => {
  const { root, file, id } = repoWithChange();
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => status(id, 'discarded', root), /use `sl discard <id> "<reason>"`/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

function repoWithTwoTasks() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-agent-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  init(root);
  const file = newChange(
    { type: 'feature', slug: 'race', title: 'Race', now: '2026-06-13T12:00:00Z' },
    root,
  );
  const text = fs
    .readFileSync(file, 'utf8')
    .replace('## Plan\n', '## Plan\n\n- [ ] first\n- [ ] second\n');
  fs.writeFileSync(file, text);
  return { root, file, id: parseChange(text).frontmatter.id };
}

test('212314 CR1: concurrent task mutations on the same change preserve both writes', async () => {
  const { root, file, id } = repoWithTwoTasks();
  const readyOne = path.join(root, 'ready-one');
  const readyTwo = path.join(root, 'ready-two');
  const go = path.join(root, 'go');
  const code = `
    import fs from 'node:fs';
    import { setTimeout as delay } from 'node:timers/promises';
    import { task } from ${JSON.stringify(pathToFileURL(path.resolve('src/commands/agent.mjs')).href)};
    fs.writeFileSync(process.argv[4], 'ready');
    while (!fs.existsSync(process.argv[5])) await delay(5);
    task(process.argv[1], 'done', Number(process.argv[2]), '', process.argv[3]);
  `;
  const child = (taskNumber, readyPath) =>
    execFileAsync(process.execPath, [
      '--input-type=module',
      '-e',
      code,
      id,
      String(taskNumber),
      root,
      readyPath,
      go,
    ]);

  const one = child(1, readyOne);
  const two = child(2, readyTwo);
  const deadline = Date.now() + 3000;
  while ((!fs.existsSync(readyOne) || !fs.existsSync(readyTwo)) && Date.now() < deadline) {
    await delay(5);
  }
  assert.ok(fs.existsSync(readyOne), 'first child reached the barrier');
  assert.ok(fs.existsSync(readyTwo), 'second child reached the barrier');
  fs.writeFileSync(go, 'go');
  await Promise.all([one, two]);

  assert.deepEqual(
    parseChange(fs.readFileSync(file, 'utf8')).tasks.map((t) => t.state),
    ['done', 'done'],
  );
});

test('212314 CR2: a lock on one change does not block mutating another change', () => {
  const first = repoWithTwoTasks();
  const secondFile = newChange(
    { type: 'feature', slug: 'other', title: 'Other', now: '2026-06-13T12:00:01Z' },
    first.root,
  );
  const secondText = fs
    .readFileSync(secondFile, 'utf8')
    .replace('## Plan\n', '## Plan\n\n- [ ] only\n');
  fs.writeFileSync(secondFile, secondText);
  const secondId = parseChange(secondText).frontmatter.id;

  const heldLock = path.join(path.dirname(first.file), `.${path.basename(first.file)}.lock`);
  fs.writeFileSync(heldLock, 'held');
  try {
    task(secondId, 'done', 1, '', first.root);
    assert.equal(parseChange(fs.readFileSync(secondFile, 'utf8')).tasks[0].state, 'done');
    assert.equal(parseChange(fs.readFileSync(first.file, 'utf8')).tasks[0].state, 'todo');
  } finally {
    fs.rmSync(heldLock, { force: true });
  }
});
