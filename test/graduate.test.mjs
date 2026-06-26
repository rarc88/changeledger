import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parseChange } from '../src/change.mjs';
import { graduate, pendingGraduation, skipGraduation } from '../src/commands/graduate.mjs';
import { init } from '../src/commands/init.mjs';
import { newChange } from '../src/commands/new.mjs';
import { loadRepo } from '../src/repo.mjs';
import { parseSpec } from '../src/spec.mjs';

// Isolate the global registry so init() doesn't touch the real home.
process.env.CHANGELEDGER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-grad-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  init(root);
  const file = path.join(root, '.changeledger', 'changes', '20260613-120000-x.md');
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

// Writes an existing spec with a known body and a stale `updated`.
function seedSpec(root, name, body) {
  const specsDir = path.join(root, '.changeledger', 'specs');
  fs.mkdirSync(specsDir, { recursive: true });
  const file = path.join(specsDir, name);
  fs.writeFileSync(
    file,
    `---\ntitle: Arch\nupdated: 2020-01-01T00:00:00Z\ntags: [architecture]\n---\n${body}`,
  );
  return file;
}

test('CR1: graduate --into links an existing spec without touching its body', () => {
  const { root, file, id } = repo();
  const specFile = seedSpec(root, 'architecture.md', '\n# Arch\n\nCuerpo intacto.\n');

  graduate(id, 'architecture', root, { into: true });

  const after = fs.readFileSync(specFile, 'utf8');
  assert.match(after, /Cuerpo intacto\./); // body preserved
  assert.doesNotMatch(after, /2020-01-01T00:00:00Z/); // updated refreshed
  const change = parseChange(fs.readFileSync(file, 'utf8'));
  assert.match(
    change.stages.find((s) => s.key === 'log').body,
    /graduado a spec `architecture.md`/,
  );
  assert.equal(change.frontmatter.reviewed, true);
});

test('CR2: graduate --into on a missing spec errors without writing', () => {
  const { root, file, id } = repo();
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(
    () => graduate(id, 'ghost', root, { into: true }),
    /^Error: Spec "ghost\.md" does not exist — drop --into to create it$/,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('CR3: graduate without --into on an existing spec still errors', () => {
  const { root, id } = repo();
  graduate(id, 'auth', root); // creates auth.md
  assert.throws(() => graduate(id, 'auth', root), /^Error: Spec "auth\.md" already exists$/);
});

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

test('162020 CR1: graduate rejects a slug that normalizes to empty without writing', () => {
  const { root, file, id } = repo();
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(
    () => graduate(id, '!!!', root),
    /slug must contain at least one ASCII letter or number/,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(fs.existsSync(path.join(root, '.changeledger', 'specs', '.md')), false);
});

test('162020 CR2: graduate keeps valid slug behavior', () => {
  const { root, file, id } = repo();
  const specFile = graduate(id, 'architecture-note', root);
  assert.equal(path.basename(specFile), 'architecture-note.md');
  const change = parseChange(fs.readFileSync(file, 'utf8'));
  assert.match(
    change.stages.find((s) => s.key === 'log').body,
    /graduado a spec `architecture-note.md`/,
  );
});

test('162020 CR3: new and graduate share slug normalization behavior', () => {
  const { root, id } = repo();
  const changeFile = newChange(
    {
      type: 'chore',
      slug: 'Árbol Técnico',
      title: 'x',
      now: '2026-06-13T12:00:01Z',
    },
    root,
  );
  const specFile = graduate(id, 'Árbol Técnico', root);
  assert.equal(path.basename(changeFile), '20260613-120001-arbol-tecnico.md');
  assert.equal(path.basename(specFile), 'arbol-tecnico.md');
});

test('CR1/CR2: graduate with no specs_dir in config lands where loadRepo reads', () => {
  const { root, id } = repo();
  // Drop the specs_dir key so graduate and loadRepo must agree on the default.
  const configFile = path.join(root, '.changeledger', 'config.yml');
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
  assert.ok(!fs.existsSync(path.join(root, '.changeledger', 'specs', 'x.md')));
});

// Write a bare change file with a given id and status.
function writeChange(root, id, status, extra = '') {
  const file = path.join(root, '.changeledger', 'changes', `${id}-y.md`);
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
  const specsDir = path.join(root, '.changeledger', 'specs');
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

test('185958 CR1: validation failure before mutateFileAtomic leaves changeFile untouched', () => {
  const { root, file, id } = repo();
  const before = fs.readFileSync(file, 'utf8');
  // spec doesn't exist; --into requires it to exist → should throw before any write
  assert.throws(() => graduate(id, 'missing-spec', root, { into: true }), /does not exist/);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'changeFile must not be modified');
});

test('185958 CR3: spec write failure leaves changeFile unmodified', () => {
  const { root, file, id } = repo();
  const before = fs.readFileSync(file, 'utf8');
  const specsDir = path.join(root, '.changeledger', 'specs');
  const specName = path.join(specsDir, 'auth.md');
  // Make specName a directory — writeFileAtomic will fail trying to write a file at a dir path
  fs.mkdirSync(specName, { recursive: true });
  assert.throws(() => graduate(id, 'auth', root));
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'changeFile must not be modified');
  fs.rmdirSync(specName); // cleanup
});

test('185958 CR4: orphaned spec (write OK, log failed) is detectable and recoverable', () => {
  const { root, file, id } = repo();
  // Simulate orphaned spec: spec exists, but changeFile has no reviewed flag
  const specsDir = path.join(root, '.changeledger', 'specs');
  fs.mkdirSync(specsDir, { recursive: true });
  fs.writeFileSync(
    path.join(specsDir, 'auth.md'),
    '---\ntitle: Auth\nupdated: 2026-06-13T12:00:00Z\ntags: []\n---\n\n# Auth\n',
  );
  // Retry without --into → "already exists" (CR4 detectable state)
  assert.throws(() => graduate(id, 'auth', root), /already exists/);
  // Retry with --into → succeeds (CR4 recoverable)
  assert.doesNotThrow(() => graduate(id, 'auth', root, { into: true }));
  assert.equal(parseChange(fs.readFileSync(file, 'utf8')).frontmatter.reviewed, true);
});

test('185958 CR5: happy path --into and new spec unchanged', () => {
  const { root, id } = repo();
  // New spec case
  const specFile = graduate(id, 'auth', root);
  assert.ok(fs.existsSync(specFile));
  // --into case on a second done change
  const f2 = writeChange(root, '20260615-120000', 'done');
  const { id: id2 } = parseChange(fs.readFileSync(f2, 'utf8')).frontmatter;
  assert.doesNotThrow(() => graduate(id2, 'auth', root, { into: true }));
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
