import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { check } from '../src/commands/check.mjs';
import { fix } from '../src/commands/fix.mjs';
import { init } from '../src/commands/init.mjs';
import * as fixModule from '../src/fix.mjs';
import { STATE_REF, STATE_ROOT, writeActivation } from '../src/state-store.mjs';
import * as taskModule from '../src/task.mjs';
import { initGitFixture, sanitizedEnv } from './helpers/git-env.mjs';
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
type: change
status: in-progress
created: 2026-06-14T09:00:00Z
depends_on: []
---

## Request

Fixture.

## Specification

### CR1 — Repair mechanical defects

- **Given** a Plan with a mechanical format defect
- **When** \`changeledger fix\` runs
- **Then** the defect is repaired without touching anything else

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

  initGitFixture(root);
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
  return execFileSync('git', ['rev-parse', STATE_REF], {
    encoding: 'utf8',
    cwd: root,
    env: sanitizedEnv(),
  }).trim();
}

function stateDocText(root, revision, relPath) {
  return execFileSync('git', ['cat-file', 'blob', `${revision}:${STATE_ROOT}/${relPath}`], {
    encoding: 'utf8',
    cwd: root,
    env: sanitizedEnv(),
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
    fs.readFileSync(configFile, 'utf8').replace(/^schema_version: \d+$/m, 'schema_version: 8'),
  );
  const before = fs.readFileSync(fixture.file, 'utf8');

  const write = output();
  assert.equal(fix([fixture.id], fixture.root, write), 1);
  assert.deepEqual(write.lines, [
    '  error  (repo): config schema 8 is newer than supported schema 7; update ChangeLedger before writing',
  ]);
  assert.equal(fs.readFileSync(fixture.file, 'utf8'), before);

  const preview = output();
  assert.equal(fix([fixture.id, '--dry-run'], fixture.root, preview), 0);
  assert.equal(fs.readFileSync(fixture.file, 'utf8'), before);
  assert.ok(preview.lines.some((line) => line.includes('dry run')));
});

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

// 20260729-203257 CR6: `src/task.mjs` is the single seat for task-line
// recognition. Identity alone only catches unhooking the import — a local
// literal alongside the retained re-export would stay green — so the source
// sweep below closes the natural reintroduction: a copy of the seat's literal
// carries the `\[` escape the sweep forbids. An obfuscated character class
// such as `[[]` still evades both assertions; review owns that residue.
test('203257 CR6: src/fix.mjs takes task-line recognition from src/task.mjs by identity', () => {
  assert.equal(fixModule.matchLenientTaskLine, taskModule.matchLenientTaskLine);
  assert.equal(typeof taskModule.matchLenientTaskLine, 'function');
  assert.equal(fixModule.REORDERED_VERIFY, undefined, 'the positional reorder fixer is retired');
  const source = fs.readFileSync(new URL('../src/fix.mjs', import.meta.url), 'utf8');
  assert.ok(
    !source.includes('\\['),
    'src/fix.mjs declares its own bracket-matching literal instead of importing from src/task.mjs',
  );
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
      env: sanitizedEnv(),
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

// --- 20261024-121022 CR14: fix repairs the live documents --------------------
//
// A live document with a retired type, or with Investigation and Proposal as
// stages, is rewritten into the two-type, four-stage form; frozen history
// (archived or discarded) is never touched.

const LIVE_FEATURE = `---
id: "20260614-100000"
title: Live feature
type: feature
status: draft
created: 2026-06-14T10:00:00Z
depends_on: []
---

## Request

### Objective

Do the thing.

### Frontier

Inside: this.

## Investigation

Measured.

### Detail

A finding.

\`\`\`md
### not a heading
\`\`\`

## Proposal

Chosen path.

## Log

- **2026-06-14T10:00:00Z** \`[note]\` created
`;

const LIVE_FEATURE_FIXED = `---
id: "20260614-100000"
title: Live feature
type: change
status: draft
created: 2026-06-14T10:00:00Z
depends_on: []
---

## Request

### Objective

Do the thing.

### Frontier

Inside: this.

### Investigation

Measured.

#### Detail

A finding.

\`\`\`md
### not a heading
\`\`\`

### Proposal

Chosen path.

## Log

- **2026-06-14T10:00:00Z** \`[note]\` created
`;

const LIVE_QUICK = `---
id: "20260614-110000"
title: Live quick
type: quick
status: done
created: 2026-06-14T11:00:00Z
depends_on: []
---

## Request

### Objective

Small thing.

### Frontier

Only this.

## Log

- **2026-06-14T11:00:00Z** \`[note]\` created
`;

const ARCHIVED_BUG = `---
id: "20260614-120000"
title: Archived bug
type: bug
status: done
archived: true
created: 2026-06-14T12:00:00Z
depends_on: []
---

## Request

Old bug.

## Investigation

Old finding.

## Log

- **2026-06-14T12:00:00Z** \`[note]\` created
`;

function liveLedger(extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-fix-live-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  init(root);
  const changesDir = path.join(root, '.changeledger', 'changes');
  const files = {};
  for (const [name, text] of Object.entries({
    '20260614-100000-live-feature.md': LIVE_FEATURE,
    '20260614-110000-live-quick.md': LIVE_QUICK,
    '20260614-120000-archived-bug.md': ARCHIVED_BUG,
    ...extra,
  })) {
    files[name] = path.join(changesDir, name);
    fs.writeFileSync(files[name], text);
  }
  return { root, files };
}

test('20261024-121022 CR14: the dry run lists the repairs of the live documents and writes nothing', () => {
  const { root, files } = liveLedger();
  const out = output();
  assert.equal(fix(['--dry-run'], root, out), 0);

  const feature = out.lines.indexOf('--- 20260614-100000-live-feature.md (dry run)');
  assert.notEqual(feature, -1, out.lines.join('\n'));
  assert.deepEqual(out.lines.slice(feature + 1, feature + 4), [
    '  - type feature → change',
    '  - ## Investigation → ### Investigation under ## Request',
    '  - ## Proposal → ### Proposal under ## Request',
  ]);
  const quick = out.lines.indexOf('--- 20260614-110000-live-quick.md (dry run)');
  assert.notEqual(quick, -1, out.lines.join('\n'));
  assert.equal(out.lines[quick + 1], '  - type quick → change');
  assert.ok(out.lines.includes('20260614-120000-archived-bug.md: nothing to fix'));

  assert.equal(fs.readFileSync(files['20260614-100000-live-feature.md'], 'utf8'), LIVE_FEATURE);
  assert.equal(fs.readFileSync(files['20260614-110000-live-quick.md'], 'utf8'), LIVE_QUICK);
});

test('20261024-121022 CR14: fix folds the retired stages under the Request and leaves frozen history byte-identical', () => {
  const { root, files } = liveLedger();
  const out = output();
  assert.equal(fix([], root, out), 0);

  assert.equal(
    fs.readFileSync(files['20260614-100000-live-feature.md'], 'utf8'),
    LIVE_FEATURE_FIXED,
  );
  assert.equal(
    fs.readFileSync(files['20260614-110000-live-quick.md'], 'utf8'),
    LIVE_QUICK.replace('type: quick', 'type: change'),
  );
  assert.equal(fs.readFileSync(files['20260614-120000-archived-bug.md'], 'utf8'), ARCHIVED_BUG);
  assert.ok(out.lines.includes('fixed — 20260614-100000-live-feature.md:'));
  assert.ok(out.lines.includes('  - type quick → change'));
});

test('20261024-121022 CR14: a second fix changes nothing', () => {
  const { root, files } = liveLedger();
  assert.equal(fix([], root, output()), 0);
  const once = Object.fromEntries(
    Object.entries(files).map(([name, file]) => [name, fs.readFileSync(file, 'utf8')]),
  );

  const out = output();
  assert.equal(fix([], root, out), 0);
  for (const [name, file] of Object.entries(files)) {
    assert.equal(fs.readFileSync(file, 'utf8'), once[name], name);
    assert.ok(out.lines.includes(`${name}: nothing to fix`), name);
  }
});

test('20261024-121022 CR14: check is green on the ledger fix repaired', () => {
  const { root } = liveLedger();
  assert.equal(fix([], root, output()), 0);
  const errors = [];
  const code = check([], root, { log: () => {}, warn: () => {}, error: (m) => errors.push(m) });
  assert.deepEqual(errors, []);
  assert.equal(code, 0);
});

test('20261024-121022 CR14: an empty retired stage is removed and a discarded document is never rewritten', () => {
  const emptyStage = LIVE_QUICK.replace('id: "20260614-110000"', 'id: "20260614-130000"').replace(
    '## Log',
    '## Investigation\n\n## Log',
  );
  const discarded = ARCHIVED_BUG.replace('id: "20260614-120000"', 'id: "20260614-140000"').replace(
    'status: done\narchived: true',
    'status: discarded',
  );
  const { root, files } = liveLedger({
    '20260614-130000-empty-stage.md': emptyStage,
    '20260614-140000-discarded.md': discarded,
  });
  const out = output();
  assert.equal(fix([], root, out), 0);

  assert.equal(
    fs.readFileSync(files['20260614-130000-empty-stage.md'], 'utf8'),
    LIVE_QUICK.replace('id: "20260614-110000"', 'id: "20260614-130000"').replace(
      'type: quick',
      'type: change',
    ),
  );
  assert.ok(out.lines.includes('  - removed empty ## Investigation'));
  assert.equal(fs.readFileSync(files['20260614-140000-discarded.md'], 'utf8'), discarded);
});
