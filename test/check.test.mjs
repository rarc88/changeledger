import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRepo } from '../src/check.mjs';

const config = {
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
  const { errors } = run([change({ stages: [{ key: 'plan' }, { key: 'request' }, { key: 'log' }] })]);
  assert.ok(msgs(errors).some((m) => /out of canonical order/.test(m)));
});

test('CR5: dangling dependency is an error', () => {
  const { errors } = run([change({ frontmatter: { depends_on: ['99999999-000000'] } })]);
  assert.ok(msgs(errors).some((m) => /references missing change/.test(m)));
});

test('CR5: dependency cycle is an error', () => {
  const a = change({ frontmatter: { id: '20260613-120000', depends_on: ['20260613-130000'] } });
  const b = change({ frontmatter: { id: '20260613-130000', depends_on: ['20260613-120000'] }, name: '20260613-130000-y.md' });
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
