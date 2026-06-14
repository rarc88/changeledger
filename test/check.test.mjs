import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkRepo } from '../src/check.mjs';

const config = {
  changes_dir: '.sl/changes',
  statuses: ['draft', 'approved', 'in-progress', 'blocked', 'done'],
  stages: ['request', 'investigation', 'proposal', 'specification', 'plan', 'log'],
  types: {
    feature: { stages: ['request', 'plan', 'log'] },
    bug: { stages: ['request', 'plan'] },
  },
};

// Build a valid feature change; override pieces per test.
function change(over = {}) {
  const fm = {
    id: '20260613-120000',
    title: 'X',
    type: 'feature',
    status: 'draft',
    created: '2026-06-13T12:00:00Z',
    depends_on: [],
    ...over.frontmatter,
  };
  return {
    name: over.name ?? `${fm.id}-x.md`,
    text: over.text,
    frontmatter: fm,
    stages: over.stages ?? [{ key: 'request' }, { key: 'plan' }, { key: 'log' }],
    tasks: over.tasks ?? [],
  };
}

const run = (changes) => checkRepo({ config, changes });
const msgs = (list) => list.map((e) => e.message);

test('a valid repo has no errors', () => {
  const { errors } = run([change()]);
  assert.deepEqual(errors, []);
});

test('CR1: missing frontmatter key is an error', () => {
  const c = change();
  delete c.frontmatter.title;
  assert.ok(msgs(run([c]).errors).some((m) => /missing frontmatter "title"/.test(m)));
});

test('CR1: created not ISO UTC is an error', () => {
  const { errors } = run([change({ frontmatter: { created: '2026-06-13' } })]);
  assert.ok(msgs(errors).some((m) => /created not ISO/.test(m)));
});

test('CR2: unknown type and status are errors', () => {
  const { errors } = run([change({ frontmatter: { type: 'nope', status: 'weird' } })]);
  assert.ok(msgs(errors).some((m) => /unknown type/.test(m)));
  assert.ok(msgs(errors).some((m) => /unknown status/.test(m)));
});

test('CR3: missing active stage is an error', () => {
  const { errors } = run([change({ stages: [{ key: 'request' }, { key: 'plan' }] })]);
  assert.ok(msgs(errors).some((m) => /missing active stage "## log"/.test(m)));
});

test('CR4: unknown stage heading is an error', () => {
  const { errors } = run([
    change({ stages: [{ key: 'request' }, { key: 'plan' }, { key: 'log' }, { key: 'banana' }] }),
  ]);
  assert.ok(msgs(errors).some((m) => /unknown stage "## banana"/.test(m)));
});

test('CR4: stages out of canonical order is an error', () => {
  const { errors } = run([
    change({ stages: [{ key: 'plan' }, { key: 'request' }, { key: 'log' }] }),
  ]);
  assert.ok(msgs(errors).some((m) => /out of canonical order/.test(m)));
});

test('CR5: dangling dependency is an error', () => {
  const { errors } = run([change({ frontmatter: { depends_on: ['99999999-000000'] } })]);
  assert.ok(msgs(errors).some((m) => /references missing change/.test(m)));
});

test('CR5: dependency cycle is an error', () => {
  const a = change({ frontmatter: { id: '20260613-120000', depends_on: ['20260613-130000'] } });
  const b = change({
    frontmatter: { id: '20260613-130000', depends_on: ['20260613-120000'] },
    name: '20260613-130000-y.md',
  });
  assert.ok(msgs(run([a, b]).errors).some((m) => /dependency cycle/.test(m)));
});

test('CR6: duplicate ids are an error', () => {
  const a = change();
  const b = change({ name: '20260613-120000-y.md' });
  assert.ok(msgs(run([a, b]).errors).some((m) => /duplicate id/.test(m)));
});

test('CR7: done with unfinished tasks is a warning, not an error', () => {
  const c = change({
    frontmatter: { status: 'done' },
    tasks: [{ state: 'done' }, { state: 'todo' }],
  });
  const { errors, warnings } = run([c]);
  assert.deepEqual(errors, []);
  assert.ok(msgs(warnings).some((m) => /not done/.test(m)));
});

test('id not matching filename is an error', () => {
  const { errors } = run([change({ name: 'wrong-name.md' })]);
  assert.ok(msgs(errors).some((m) => /filename does not match id/.test(m)));
});

test('config missing a required key is an error', () => {
  const bad = { ...config, statuses: undefined };
  delete bad.statuses;
  const { errors } = checkRepo({ config: bad, changes: [change()] });
  assert.ok(msgs(errors).some((m) => /config missing "statuses"/.test(m)));
});

test('config type referencing an unknown stage is an error', () => {
  const bad = { ...config, types: { feature: { stages: ['request', 'banana'] } } };
  const { errors } = checkRepo({ config: bad, changes: [] });
  assert.ok(msgs(errors).some((m) => /references unknown stage "banana"/.test(m)));
});

test('scoped check validates only the requested change', () => {
  const good = change();
  const bad = change({
    frontmatter: { id: '20260613-130000', type: 'nope' },
    name: '20260613-130000-y.md',
  });
  const { errors } = checkRepo({ config, changes: [good, bad] }, { id: good.frontmatter.id });
  assert.deepEqual(errors, []);
});

test('scoped check on a missing id is an error', () => {
  const { errors } = checkRepo({ config, changes: [change()] }, { id: 'nope' });
  assert.ok(msgs(errors).some((m) => /no change with id "nope"/.test(m)));
});

test('CR1: a merge conflict marker is an error with its line', () => {
  const c = change({ text: '---\nid: x\n---\n<<<<<<< HEAD\nfoo\n=======\nbar\n>>>>>>> branch\n' });
  const { errors } = run([c]);
  assert.ok(msgs(errors).some((m) => /merge conflict marker .* at line 4/.test(m)));
  assert.ok(msgs(errors).some((m) => /at line 6/.test(m)));
  assert.ok(msgs(errors).some((m) => /at line 8/.test(m)));
});

test('CR2: clean text does not false-positive', () => {
  const c = change({ text: '---\nid: x\n---\n## Request\n\na == b and a < b\n' });
  assert.deepEqual(
    msgs(run([c]).errors).filter((m) => /conflict marker/.test(m)),
    [],
  );
});

test('CR1: an external cross-project dep is not a missing-change error', () => {
  const c = change({ frontmatter: { depends_on: ['other:20260101-000000'] } });
  assert.deepEqual(
    msgs(run([c]).errors).filter((m) => /missing change/.test(m)),
    [],
  );
});

test('CR1: a local dangling dep is still an error alongside an external one', () => {
  const c = change({ frontmatter: { depends_on: ['other:20260101-000000', '20990101-000000'] } });
  assert.ok(msgs(run([c]).errors).some((m) => /missing change "20990101-000000"/.test(m)));
});

test('CR2: cycle graph ignores external deps', () => {
  const a = change({ frontmatter: { id: '20260613-120000', depends_on: ['ext:20260101-000000'] } });
  assert.deepEqual(
    msgs(run([a]).errors).filter((m) => /cycle/.test(m)),
    [],
  );
});

test('CR3: a non-boolean archived flag is an error', () => {
  const c = change({ frontmatter: { archived: 1 } });
  assert.ok(msgs(run([c]).errors).some((m) => /archived must be a boolean/.test(m)));
});

const spec = (over = {}) => ({
  name: over.name ?? 'arch.md',
  frontmatter: { title: 'T', updated: '2026-06-13T12:00:00Z', tags: [], ...over.frontmatter },
  body: over.body ?? '',
});
const runS = (changes, specs) => checkRepo({ config, changes, specs });

test('CR1: a change graduating to a missing spec is an error', () => {
  const c = change({ text: '## Log\n- **2026-06-13T12:00:00Z** — graduado a spec `ghost.md`\n' });
  assert.ok(msgs(runS([c], []).errors).some((m) => /missing spec "ghost.md"/.test(m)));
});

test('CR1: a spec referencing a missing change is an error', () => {
  const s = spec({ body: 'Graduado del change 20990101-000000' });
  assert.ok(
    msgs(runS([change()], [s]).errors).some((m) => /missing change "20990101-000000"/.test(m)),
  );
});

test('CR2: a spec with no link is an orphan warning, not an error', () => {
  const { errors, warnings } = runS([change()], [spec()]);
  assert.deepEqual(errors, []);
  assert.ok(msgs(warnings).some((m) => /orphan spec/.test(m)));
});

test('CR2: a spec backlinked to an existing change is not orphan', () => {
  const c = change({ frontmatter: { id: '20260613-120000' } });
  const s = spec({ body: 'Graduado del change 20260613-120000' });
  assert.deepEqual(
    msgs(runS([c], [s]).warnings).filter((m) => /orphan/.test(m)),
    [],
  );
});

test('CR3: a stale updated is a warning', () => {
  const c = change({
    frontmatter: { id: '20260613-120000', created: '2026-06-13T10:00:00Z' },
    text: '---\n---\n## Log\n- **2026-06-20T10:00:00Z** — graduado a spec `arch.md`\n',
  });
  const s = spec({ frontmatter: { updated: '2026-06-14T10:00:00Z' } });
  assert.ok(msgs(runS([c], [s]).warnings).some((m) => /older than linked change activity/.test(m)));
});

test('CR3: a non-ISO updated is an error', () => {
  const s = spec({ frontmatter: { updated: '2026-06-13' } });
  assert.ok(msgs(runS([change()], [s]).errors).some((m) => /updated not ISO/.test(m)));
});

test('CR1: a duplicate stage is an error', () => {
  const c = change({
    stages: [
      { key: 'request' },
      { key: 'proposal' },
      { key: 'proposal' },
      { key: 'plan' },
      { key: 'log' },
    ],
  });
  assert.ok(msgs(run([c]).errors).some((m) => /duplicate stage "## proposal"/.test(m)));
});

test('CR1: no duplicates does not false-positive', () => {
  assert.deepEqual(
    msgs(run([change()]).errors).filter((m) => /duplicate stage/.test(m)),
    [],
  );
});

test('CR2: a Log section is allowed on a type that does not scaffold it (chore)', () => {
  const cfg = { ...config, types: { ...config.types, chore: { stages: ['request', 'plan'] } } };
  const c = {
    name: '20260613-120000-x.md',
    frontmatter: {
      id: '20260613-120000',
      title: 'X',
      type: 'chore',
      status: 'approved',
      created: '2026-06-13T12:00:00Z',
      depends_on: [],
    },
    stages: [{ key: 'request' }, { key: 'plan' }, { key: 'log' }],
    tasks: [],
  };
  const { errors } = checkRepo({ config: cfg, changes: [c] });
  assert.deepEqual(
    msgs(errors).filter((m) => /not active for type/.test(m)),
    [],
  );
});
