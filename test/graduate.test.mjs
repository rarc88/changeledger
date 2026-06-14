import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parseChange } from '../src/change.mjs';
import { graduate } from '../src/commands/graduate.mjs';
import { init } from '../src/commands/init.mjs';
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

test('graduate refuses to overwrite an existing spec', () => {
  const { root, id } = repo();
  graduate(id, 'auth', root);
  assert.throws(() => graduate(id, 'auth', root), /already exists/);
});

test('graduate throws on an unknown change id', () => {
  const { root } = repo();
  assert.throws(() => graduate('99999999-000000', 'x', root), /No change with id/);
});
