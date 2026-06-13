import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init } from '../src/commands/init.mjs';
import { newChange, idFromTimestamp } from '../src/commands/new.mjs';
import { parseChange } from '../src/change.mjs';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sl-cli-'));
}

test('init creates .sl/ with config and AGENTS.md', () => {
  const root = tmp();
  init(root);
  assert.ok(fs.existsSync(path.join(root, '.sl', 'config.yml')));
  assert.ok(fs.existsSync(path.join(root, '.sl', 'changes')));
  assert.ok(fs.existsSync(path.join(root, 'AGENTS.md')));
});

test('init refuses to overwrite an existing .sl/', () => {
  const root = tmp();
  init(root);
  assert.throws(() => init(root), /already exists/);
});

test('idFromTimestamp derives YYYYMMDD-HHMMSS from an ISO UTC instant', () => {
  assert.equal(idFromTimestamp('2026-06-13T15:04:02Z'), '20260613-150402');
});

test('new uses the English slug for the file and keeps the title as content', () => {
  const root = tmp();
  init(root);
  const file = newChange(
    { type: 'bug', slug: 'token-expiry', title: 'Token expira mal', now: '2026-06-13T15:00:00Z' },
    root,
  );
  assert.equal(path.basename(file), '20260613-150000-token-expiry.md');

  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.id, '20260613-150000');
  assert.equal(c.frontmatter.title, 'Token expira mal');
  assert.equal(c.frontmatter.type, 'bug');
  assert.equal(c.frontmatter.status, 'draft');
  assert.equal(c.frontmatter.created, '2026-06-13T15:00:00Z');
  assert.deepEqual(c.stages.map((s) => s.key), ['request', 'investigation', 'specification', 'plan', 'log']);
});

test('new normalizes the slug to kebab ascii', () => {
  const root = tmp();
  init(root);
  const file = newChange({ type: 'chore', slug: 'Fix CI Pipeline', title: 'x', now: '2026-06-13T15:00:00Z' }, root);
  assert.equal(path.basename(file), '20260613-150000-fix-ci-pipeline.md');
});

test('new bumps the id to stay unique within the same second', () => {
  const root = tmp();
  init(root);
  const now = '2026-06-13T15:00:00Z';
  const a = newChange({ type: 'chore', slug: 'one', title: 'one', now }, root);
  const b = newChange({ type: 'chore', slug: 'two', title: 'two', now }, root);
  assert.equal(path.basename(a), '20260613-150000-one.md');
  assert.equal(path.basename(b), '20260613-150001-two.md');

  const c = parseChange(fs.readFileSync(b, 'utf8'));
  assert.equal(c.frontmatter.id, '20260613-150001');
  assert.equal(c.frontmatter.created, '2026-06-13T15:00:01Z');
});

test('new rejects an unknown type', () => {
  const root = tmp();
  init(root);
  assert.throws(() => newChange({ type: 'nope', title: 't', now: 'x' }, root), /Unknown type/);
});
