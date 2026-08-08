import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fix } from '../src/commands/fix.mjs';
import { init } from '../src/commands/init.mjs';
import * as fixModule from '../src/fix.mjs';
import { STATE_REF, STATE_ROOT, writeActivation } from '../src/state-store.mjs';
import * as taskModule from '../src/task.mjs';
import { buildTree, commitTree, updateRef } from './helpers/state-repo.mjs';

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

### CR1 — Repair mechanical defects

- **Given** a Plan with a mechanical format defect
- **When** \`changeledger fix\` runs
- **Then** the defect is repaired without touching anything else

### CR2 — Migrate the Plan task grammar

- **Given** a Plan written in the old positional grammar
- **When** \`changeledger fix --plan-tags\` runs
- **Then** the trace moves to structured children

## Plan

${planLine}

## Log

- **2026-06-14T09:00:00Z**${legacySeparator}created
`,
  );
  return { root, file, id };
}

// Activates a fresh copy of `repo(planLine)`: the change document is moved
// from the worktree into the state ref's snapshot before activation, so
// `fix` can only succeed by routing through the ref.
function activatedRepo(planLine) {
  const { root, file, id } = repo(planLine);
  const name = path.basename(file);
  const text = fs.readFileSync(file, 'utf8');
  fs.rmSync(file);
  const configText = fs.readFileSync(path.join(root, '.changeledger', 'config.yml'), 'utf8');

  execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' });
  const tree = buildTree(root, {
    '.changeledger-state/manifest.yml': 'format_version: 1\nproject_id: demo\n',
    '.changeledger-state/config.yml': configText,
    [`.changeledger-state/changes/${name}`]: text,
  });
  const revision = commitTree(root, tree, { message: 'chore: state' });
  updateRef(root, STATE_REF, revision);
  writeActivation(root, { stateRef: STATE_REF });
  return { root, id, name };
}

function stateRefTip(root) {
  return execFileSync('git', ['rev-parse', STATE_REF], { encoding: 'utf8', cwd: root }).trim();
}

function stateDocText(root, revision, relPath) {
  return execFileSync('git', ['cat-file', 'blob', `${revision}:${STATE_ROOT}/${relPath}`], {
    encoding: 'utf8',
    cwd: root,
  });
}

function output() {
  const lines = [];
  return {
    lines,
    log: (m) => lines.push(String(m)),
    error: (m) => lines.push(String(m)),
  };
}

test('161652 CR3/CR4: fix writes fail closed while dry-run stays available', () => {
  const fixture = repo('- [x] Update src/foo.mjs (CR1) - 2026-01-01T12:00:00Z');
  const configFile = path.join(fixture.root, '.changeledger', 'config.yml');
  fs.writeFileSync(
    configFile,
    fs.readFileSync(configFile, 'utf8').replace(/^schema_version: \d+$/m, 'schema_version: 6'),
  );
  const before = fs.readFileSync(fixture.file, 'utf8');

  const write = output();
  assert.equal(fix([fixture.id], fixture.root, write), 1);
  assert.deepEqual(write.lines, [
    '  error  (repo): config schema 6 is newer than supported schema 5; update ChangeLedger before writing',
  ]);
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

test('CR2: --dry-run prints a diff and writes nothing', () => {
  const { root, file, id } = repo('- [x] Update src/baz.mjs (CR1) - 2026-01-01T12:00:00Z');
  const before = fs.readFileSync(file, 'utf8');
  const out = output();
  const code = fix([id, '--dry-run'], root, out);
  assert.equal(code, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.ok(out.lines.some((l) => l.includes('(CR1) — 2026-01-01T12:00:00Z')));
});

test('CR3: a second run is idempotent and reports nothing to fix', () => {
  const { root, file, id } = repo('- [x] Update src/baz.mjs (CR1) - 2026-01-01T12:00:00Z');
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
  const line = '- [x] Update src/bar.mjs (CR9) - 2026-01-01T12:00:00Z';
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

// 20260729-203257 CR5 — the forms measured in the real corpus, in one fixture.
const LEGACY_PLAN = [
  '- [ ] Actualizar `src/a.mjs`; verify: `pnpm test` (CR1, CR2)',
  '- [ ] Ejecutar el gate completo (support)',
  '- [ ] Tarea plana',
  '- [ ] Revisar el (formato, ciclo) del documento',
].join('\n');

test('203257 CR5: --plan-tags moves the final marker and the verify clause to children', () => {
  const { root, file } = repo(LEGACY_PLAN);
  assert.equal(fix(['--plan-tags'], root, output()), 0);
  const migrated = fs.readFileSync(file, 'utf8');

  assert.match(
    migrated,
    /- \[ \] Actualizar `src\/a\.mjs`\n {2}- \*\*Verify:\*\* `pnpm test`\n {2}- \*\*Criteria:\*\* CR1, CR2\n/,
  );
  assert.match(migrated, /- \[ \] Ejecutar el gate completo\n {2}- \*\*Support:\*\*\n/);
  assert.ok(migrated.includes('- [ ] Tarea plana\n'), 'a flat task stays byte-identical');
  assert.ok(
    migrated.includes('- [ ] Revisar el (formato, ciclo) del documento\n'),
    'a non-final prose parenthesis stays byte-identical',
  );
  assert.ok(!migrated.includes('(CR1, CR2)'), 'the final marker leaves the description');
  assert.ok(!migrated.includes('; verify:'), 'the verify clause leaves the description');
});

test('203257 CR5: a second --plan-tags run is byte-identical', () => {
  const { root, file } = repo(LEGACY_PLAN);
  assert.equal(fix(['--plan-tags'], root, output()), 0);
  const once = fs.readFileSync(file, 'utf8');
  assert.equal(fix(['--plan-tags'], root, output()), 0);
  assert.equal(fs.readFileSync(file, 'utf8'), once);
});

test('203257 CR5: --plan-tags --dry-run prints the diff and writes nothing', () => {
  const { root, file } = repo(LEGACY_PLAN);
  const before = fs.readFileSync(file, 'utf8');
  const out = output();
  assert.equal(fix(['--plan-tags', '--dry-run'], root, out), 0);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.ok(out.lines.some((line) => line.includes('+   - **Criteria:** CR1, CR2')));
  assert.ok(out.lines.some((line) => line.includes('+   - **Verify:** `pnpm test`')));
});

test('203257 CR5: a repeated verify clause migrates only its criteria and is reported manual', () => {
  const { root, file } = repo(
    '- [ ] Actualizar `src/a.mjs`; verify: `pnpm test`; verify: `pnpm lint` (CR1)',
  );
  const out = output();
  assert.equal(fix(['--plan-tags'], root, out), 0);
  const migrated = fs.readFileSync(file, 'utf8');
  assert.match(
    migrated,
    /- \[ \] Actualizar `src\/a\.mjs`; verify: `pnpm test`; verify: `pnpm lint`\n {2}- \*\*Criteria:\*\* CR1\n/,
  );
  assert.ok(!migrated.includes('**Verify:**'), 'an ambiguous verify clause is not migrated');
  assert.ok(out.lines.some((line) => line.includes('requires manual fix')));
  assert.ok(out.lines.some((line) => /2 verify: clauses/.test(line)));
});

// 20260729-203257 CR6: `src/task.mjs` is the single seat for task-line
// recognition. Identity alone only catches unhooking the import — a local
// literal alongside the retained re-export would stay green — so the source
// sweep below closes the natural reintroduction: a copy of the seat's literal
// carries the `\[` escape the sweep forbids. An obfuscated character class
// such as `[[]` still evades both assertions; review owns that residue.
test('203257 CR6: src/fix.mjs takes task-line recognition from src/task.mjs by identity', () => {
  assert.equal(fixModule.matchTaskLine, taskModule.matchTaskLine);
  assert.equal(fixModule.matchLenientTaskLine, taskModule.matchLenientTaskLine);
  assert.equal(typeof taskModule.matchTaskLine, 'function');
  assert.equal(fixModule.REORDERED_VERIFY, undefined, 'the positional reorder fixer is retired');
  const source = fs.readFileSync(new URL('../src/fix.mjs', import.meta.url), 'utf8');
  assert.ok(
    !source.includes('\\['),
    'src/fix.mjs declares its own bracket-matching literal instead of importing from src/task.mjs',
  );
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

// 20260808-151643 — active-mode routing: one invocation of `fix` lands as
// exactly one CAS commit on the state ref.

test('CR3: fix on an active repo repairs the mechanical defect in one commit', () => {
  const { root, id, name } = activatedRepo('- [x] Update src/foo.mjs (CR1) - 2026-01-01T12:00:00Z');
  const before = stateRefTip(root);

  const out = output();
  assert.equal(fix([id], root, out), 0);

  const tip = stateRefTip(root);
  assert.notEqual(tip, before);
  assert.equal(
    execFileSync('git', ['rev-list', '--count', `${before}..${tip}`], {
      encoding: 'utf8',
      cwd: root,
    }).trim(),
    '1',
  );
  const fixedText = stateDocText(root, tip, `changes/${name}`);
  assert.match(fixedText, /2026-01-01T12:00:00Z$/m);
  assert.doesNotMatch(fixedText, / - 2026-01-01T12:00:00Z/);
  assert.equal(fs.existsSync(path.join(root, STATE_ROOT)), false);
});

test('CR3: fix --dry-run on an active repo writes nothing', () => {
  const { root, id } = activatedRepo('- [x] Update src/foo.mjs (CR1) - 2026-01-01T12:00:00Z');
  const before = stateRefTip(root);

  const out = output();
  assert.equal(fix([id, '--dry-run'], root, out), 0);

  assert.equal(stateRefTip(root), before);
  assert.ok(out.lines.some((line) => line.includes('dry run')));
});
