import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parseChange } from '../src/change.mjs';
import { graduate, pendingGraduation, skipGraduation } from '../src/commands/graduate.mjs';
import { init } from '../src/commands/init.mjs';
import { loadRepo } from '../src/repo.mjs';
import { parseSpec } from '../src/spec.mjs';

// Isolate the global registry so init() doesn't touch the real home.
process.env.SPEC_LEDGER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-home-'));

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-grad-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  init(root);
  const file = path.join(root, '.sl', 'changes', '20260613-120000-x.md');
  fs.writeFileSync(
    file,
    `---
id: "20260613-120000"
title: Login OAuth
type: feature
status: done
created: 2026-06-13T12:00:00Z
depends_on: []
---

## Specification

El sistema soporta login OAuth.

## Log

- **2026-06-13T12:00:00Z** — created
`,
  );
  return { root, file, id: '20260613-120000' };
}

test('graduate creates a seeded spec and links it in the change Log', () => {
  const { root, file, id } = repo();
  const specFile = graduate(id, 'auth', root);
  assert.equal(path.basename(specFile), 'auth.md');

  const spec = parseSpec(fs.readFileSync(specFile, 'utf8'));
  assert.equal(spec.frontmatter.title, 'Login OAuth');
  assert.deepEqual(spec.frontmatter.tags, ['feature']);
  assert.match(spec.body, /soporta login OAuth/);
  assert.match(spec.body, new RegExp(`Graduado del change ${id}`));

  const change = parseChange(fs.readFileSync(file, 'utf8'));
  assert.match(change.stages.find((s) => s.key === 'log').body, /graduado a spec `auth.md`/);
});

test('CR1/CR2: graduate with no specs_dir in config lands where loadRepo reads', () => {
  const { root, id } = repo();
  // Drop the specs_dir key so graduate and loadRepo must agree on the default.
  const configFile = path.join(root, '.sl', 'config.yml');
  const stripped = fs.readFileSync(configFile, 'utf8').replace(/^specs_dir:.*\n/m, '');
  fs.writeFileSync(configFile, stripped);

  const specFile = graduate(id, 'auth', root);
  assert.ok(fs.existsSync(specFile), 'spec file written to disk');

  const repoData = loadRepo(root);
  assert.ok(
    repoData.specs.some((s) => s.name === 'auth.md'),
    'loadRepo sees the graduated spec',
  );
});

test('graduate refuses to overwrite an existing spec', () => {
  const { root, id } = repo();
  graduate(id, 'auth', root);
  assert.throws(() => graduate(id, 'auth', root), /already exists/);
});

test('graduate throws on an unknown change id', () => {
  const { root } = repo();
  assert.throws(() => graduate('99999999-000000', 'x', root), /No change with id/);
});

test('CR4: graduate refuses a non-done change and creates no spec', () => {
  const { root } = repo();
  const f = writeChange(root, '20260104-000000', 'in-progress');
  const before = fs.readFileSync(f, 'utf8');
  assert.throws(() => graduate('20260104-000000', 'x', root), /only done changes/);
  assert.equal(fs.readFileSync(f, 'utf8'), before);
  assert.ok(!fs.existsSync(path.join(root, '.sl', 'specs', 'x.md')));
});

// Write a bare change file with a given id and status.
function writeChange(root, id, status, extra = '') {
  const file = path.join(root, '.sl', 'changes', `${id}-y.md`);
  fs.writeFileSync(
    file,
    `---\nid: "${id}"\ntitle: Y\ntype: feature\nstatus: ${status}\ncreated: 2026-01-01T00:00:00Z\ndepends_on: []\n${extra}---\n\n## Log\n`,
  );
  return file;
}

test('graduate marks the change reviewed (CR1)', () => {
  const { root, file, id } = repo();
  graduate(id, 'auth', root);
  assert.equal(parseChange(fs.readFileSync(file, 'utf8')).frontmatter.reviewed, true);
});

test('skipGraduation marks reviewed, logs the reason, creates no spec (CR2)', () => {
  const { root, file, id } = repo();
  const out = skipGraduation(id, 'bug fix, sin verdad persistente', root);
  assert.equal(out, file);
  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.reviewed, true);
  assert.match(
    c.stages.find((s) => s.key === 'log').body,
    /graduation skipped: bug fix, sin verdad persistente$/m,
  );
  const specsDir = path.join(root, '.sl', 'specs');
  assert.equal(fs.existsSync(specsDir) && fs.readdirSync(specsDir).length > 0, false);
});

test('skipGraduation without a reason logs the bare marker (CR3)', () => {
  const { root, file, id } = repo();
  skipGraduation(id, '', root);
  const log = parseChange(fs.readFileSync(file, 'utf8')).stages.find((s) => s.key === 'log').body;
  assert.match(log, /graduation skipped$/m);
});

test('skipGraduation refuses a non-done change and writes nothing (CR6)', () => {
  const { root } = repo();
  const f = writeChange(root, '20260102-000000', 'in-progress');
  const before = fs.readFileSync(f, 'utf8');
  assert.throws(() => skipGraduation('20260102-000000', 'x', root), /only done changes/);
  assert.equal(fs.readFileSync(f, 'utf8'), before);
});

test('pendingGraduation lists only unreviewed done changes (CR4)', () => {
  const { root } = repo(); // base 20260613-120000 is done, unreviewed
  writeChange(root, '20260101-000000', 'done', 'reviewed: true\n');
  writeChange(root, '20260103-000000', 'draft');
  const ids = pendingGraduation(root).map((c) => c.id);
  assert.ok(ids.includes('20260613-120000'));
  assert.ok(!ids.includes('20260101-000000'));
  assert.ok(!ids.includes('20260103-000000'));
});
