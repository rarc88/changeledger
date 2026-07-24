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
  const legacySeparator = [' ', '—', ' '].join('');
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

- **2026-06-14T09:00:00Z**${legacySeparator}created
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

test('195318 CR3: fix writes fail closed but dry-run remains available for a future schema', () => {
  const fixture = repo('- [ ] Update src/foo.mjs (CR1) — verify: pnpm test');
  const configFile = path.join(fixture.root, '.changeledger', 'config.yml');
  fs.writeFileSync(
    configFile,
    fs.readFileSync(configFile, 'utf8').replace(/^schema_version: \d+$/m, 'schema_version: 4'),
  );
  const before = fs.readFileSync(fixture.file, 'utf8');

  const write = output();
  assert.equal(fix([fixture.id], fixture.root, write), 1);
  assert.equal(write.lines.length, 1);
  assert.match(
    write.lines[0],
    /^ {2}error {2}\(repo\): config schema 4 is newer than supported schema 3; update ChangeLedger before writing \(project: .+\) \(repo: .+\)$/,
  );
  assert.equal(fs.readFileSync(fixture.file, 'utf8'), before);

  const preview = output();
  assert.equal(fix([fixture.id, '--dry-run'], fixture.root, preview), 0);
  assert.equal(fs.readFileSync(fixture.file, 'utf8'), before);
  assert.ok(preview.lines.some((line) => line.includes('dry run')));
});

function graduationRepo({ ambiguous = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-fix-graduation-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  init(root);
  const changesDir = path.join(root, '.changeledger', 'changes');
  const specsDir = path.join(root, '.changeledger', 'specs');
  fs.mkdirSync(specsDir, { recursive: true });
  const events = [
    ['20260614-090000', '2026-06-14T09:00:00Z'],
    ['20260614-100000', '2026-06-14T10:00:00Z'],
    ['20260614-110000', '2026-06-14T11:00:00Z'],
  ];
  for (const [id, timestamp] of events) {
    fs.writeFileSync(
      path.join(changesDir, `${id}-fixture.md`),
      `---
id: "${id}"
title: Change ${id}
type: chore
status: done
created: ${timestamp}
depends_on: []
---

## Request

Fixture.

## Plan

## Log

- **${timestamp}** \`[graduation]\` spec: \`${ambiguous && id === events[0][0] ? 'other.md' : 'arch.md'}\`
`,
    );
  }
  const specFile = path.join(specsDir, 'arch.md');
  fs.writeFileSync(
    specFile,
    `---
title: Arch
updated: 2026-06-14T12:00:00Z
tags: [architecture]
---

## Arch

> Graduado del change 20260614-090000 (first).
> Actualizado por el change 20260614-100000 (second).

Durable body.
`,
  );
  return { root, specFile };
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

test('CR1 regression: an em dash inside the description does not hide a hyphen resolution suffix', () => {
  const { root, file, id } = repo(
    '- [x] Update src/baz.mjs — with a note (CR1) - 2026-01-01T12:00:00Z',
  );
  const out = output();
  const code = fix([id], root, out);
  assert.equal(code, 0);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.includes('- [x] Update src/baz.mjs — with a note (CR1) — 2026-01-01T12:00:00Z'));
  assert.ok(out.lines.some((l) => l.includes('resolution suffix hyphen normalized to em dash')));
});

test('CR1 regression: a valid em-dash suffix after a hyphenated description stays untouched', () => {
  const line = '- [x] Update src/a-b.mjs - narrow case (CR1) — 2026-01-01T12:00:00Z';
  const { root, file, id } = repo(line);
  const out = output();
  const code = fix([id], root, out);
  assert.equal(code, 0);
  assert.ok(fs.readFileSync(file, 'utf8').includes(line), 'valid suffix line must not be modified');
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

test('125007 CR8: --structured-sections previews and migrates tasks and Log events', () => {
  const { root, file } = repo(
    '- [x] Preserve — punctuation | intact (CR1) — 2026-06-14T09:05:00Z\n- [!] Publish (CR1) — waiting upstream',
  );
  const before = fs.readFileSync(file, 'utf8');
  const preview = output();
  assert.equal(fix(['--structured-sections', '--dry-run'], root, preview), 0);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.ok(preview.lines.some((line) => line.includes('**Resolved:**')));
  assert.ok(preview.lines.some((line) => line.includes('`[note]` created')));

  assert.equal(fix(['--structured-sections'], root, output()), 0);
  const migrated = fs.readFileSync(file, 'utf8');
  assert.match(
    migrated,
    /- \[x\] Preserve — punctuation \| intact \(CR1\)\n {2}- \*\*Resolved:\*\* `2026-06-14T09:05:00Z`/,
  );
  assert.match(migrated, /- \[!\] Publish \(CR1\)\n {2}- \*\*Blocked:\*\* waiting upstream/);
  assert.match(migrated, /- \*\*2026-06-14T09:00:00Z\*\* `\[note\]` created/);
});

test('125007 CR8: ambiguous blocked metadata leaves the whole file untouched', () => {
  const line = '- [!] Publish — external dependency (CR1) — waiting — platform';
  const { root, file } = repo(line);
  const before = fs.readFileSync(file, 'utf8');
  const out = output();
  assert.equal(fix(['--structured-sections'], root, out), 0);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.ok(out.lines.some((entry) => entry.includes('requires manual fix')));
  assert.ok(out.lines.some((entry) => entry.includes('ambiguous legacy task metadata')));
});

test('111457 CR5: --graduation-links migrates legacy and Log provenance in order', () => {
  const { root, specFile } = graduationRepo();
  const out = output();
  assert.equal(fix(['--graduation-links'], root, out), 0);
  const text = fs.readFileSync(specFile, 'utf8');
  assert.match(
    text,
    /^graduated_from: \["20260614-090000", "20260614-100000", "20260614-110000"\]$/m,
  );
  assert.doesNotMatch(text, /(?:Graduado del|Actualizado por el) change/);
  assert.match(text, /## Arch\n\nDurable body\.\n$/);
});

test('111457 CR6: --graduation-links --dry-run prints the exact spec diff without writing', () => {
  const { root, specFile } = graduationRepo();
  const before = fs.readFileSync(specFile, 'utf8');
  const out = output();
  assert.equal(fix(['--graduation-links', '--dry-run'], root, out), 0);
  assert.equal(fs.readFileSync(specFile, 'utf8'), before);
  assert.ok(out.lines.some((line) => line.includes('--- arch.md (dry run)')));
  assert.ok(out.lines.some((line) => line.includes('+ graduated_from:')));
  assert.ok(out.lines.some((line) => line.includes('- > Graduado del change')));
});

test('111457 CR7: ambiguous legacy provenance fails without modifying any spec', () => {
  const { root, specFile } = graduationRepo({ ambiguous: true });
  const before = fs.readFileSync(specFile, 'utf8');
  const out = output();
  assert.equal(fix(['--graduation-links'], root, out), 1);
  assert.equal(fs.readFileSync(specFile, 'utf8'), before);
  assert.ok(out.lines.some((line) => line.includes('arch.md')));
  assert.ok(out.lines.some((line) => line.includes('20260614-090000')));
});
