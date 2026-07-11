import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fix } from '../src/commands/fix.mjs';
import { init } from '../src/commands/init.mjs';

// Isolate the global registry so init() doesn't touch the real home.
process.env.CHANGELEDGER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));

function repo(planLine) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-fix-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  init(root);
  const id = '20260614-090000';
  const file = path.join(root, '.changeledger', 'changes', `${id}-fixture.md`);
  fs.writeFileSync(
    file,
    `---
id: "${id}"
title: Format fixer fixture
type: feature
status: in-progress
created: 2026-06-14T09:00:00Z
depends_on: []
---

## Request

Fixture.

## Investigation

Fixture.

## Proposal

Fixture.

## Specification

### CR1 — Reorder verify

- **Given** a Plan with a misplaced verify suffix
- **When** \`changeledger fix\` runs
- **Then** the suffix is reordered before the CR block

## Plan

${planLine}

## Log

- **2026-06-14T09:00:00Z** — created
`,
  );
  return { root, file, id };
}

function output() {
  const lines = [];
  return {
    lines,
    log: (m) => lines.push(String(m)),
    error: (m) => lines.push(String(m)),
  };
}

test('CR1: reorders a misplaced verify suffix before the CR block', () => {
  const { root, file, id } = repo('- [ ] Update src/foo.mjs (CR1) — verify: pnpm test');
  const out = output();
  const code = fix([id], root, out);
  assert.equal(code, 0);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.includes('- [ ] Update src/foo.mjs; verify: pnpm test (CR1)'));
  assert.ok(!text.includes('(CR1) — verify:'));
});

test('CR2: --dry-run prints a diff and writes nothing', () => {
  const { root, file, id } = repo('- [ ] Update src/foo.mjs (CR1) — verify: pnpm test');
  const before = fs.readFileSync(file, 'utf8');
  const out = output();
  const code = fix([id, '--dry-run'], root, out);
  assert.equal(code, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.ok(out.lines.some((l) => l.includes('verify: pnpm test (CR1)')));
});

test('CR3: a second run is idempotent and reports nothing to fix', () => {
  const { root, file, id } = repo('- [ ] Update src/foo.mjs (CR1) — verify: pnpm test');
  const firstCode = fix([id], root, output());
  assert.equal(firstCode, 0);
  const fixedText = fs.readFileSync(file, 'utf8');

  const out = output();
  const secondCode = fix([id], root, out);
  assert.equal(secondCode, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), fixedText);
  assert.ok(out.lines.some((l) => l.includes('nothing to fix')));
});

test('CR4: a task referencing an unknown criterion is left untouched and flagged', () => {
  const line = '- [ ] Update src/bar.mjs (CR9) — verify: pnpm test';
  const { root, file, id } = repo(line);
  const out = output();
  const code = fix([id], root, out);
  assert.equal(code, 0);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.includes(line), 'unknown-criterion line must not be modified');
  assert.ok(out.lines.some((l) => l.includes('requires manual fix')));
  assert.ok(out.lines.some((l) => l.includes('CR9')));
});
