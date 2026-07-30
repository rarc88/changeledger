import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildAgentContext } from '../src/commands/agent-context.mjs';
import {
  buildContext,
  emittedLines as contextEmittedLines,
  frameSections,
} from '../src/commands/context.mjs';
import { init } from '../src/commands/init.mjs';
import { REFERENCE } from '../src/contract.mjs';
import { assertTransition, CANONICAL_STATUSES, canTransition } from '../src/lifecycle.mjs';
import {
  assertWithinBudget,
  contextBudgets,
  emittedLines,
  sizedOutput,
  TOKENIZER_PACKAGE,
  tokenCount,
} from './budget-support.mjs';
import { contractFragmentNames } from './contract-support.mjs';

process.env.CHANGELEDGER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'context-home-'));

// The budget policy is observable in two ways at once — whether it throws and
// whether it warns — so both must be captured. Stubbing `process.emitWarning`
// keeps the observation synchronous (the 'warning' event fires a tick later) and
// the `finally` restore means no stub can outlive the block that installed it,
// so nothing leaks into the next test.
function captureBudget(run) {
  const warnings = [];
  const original = process.emitWarning;
  process.emitWarning = (message) => {
    warnings.push(String(message));
  };
  let thrown;
  try {
    run();
  } catch (error) {
    thrown = error;
  } finally {
    process.emitWarning = original;
  }
  return { warnings, thrown };
}

const bin = fileURLToPath(new URL('../bin/changeledger.mjs', import.meta.url));
const END_LINE =
  '===== CHANGELEDGER CONTEXT END — if this line is missing, the output was truncated: stop and re-run =====';

function publishedLines(text) {
  const match = text.split('\n')[0].match(/lines:(\d+)/);
  assert.ok(match, `BEGIN line publishes no lines:<N> — ${text.split('\n')[0]}`);
  return Number(match[1]);
}

// Real `changeledger context ... 2>&1 | head -<n>` pipeline, so the count is
// proven against actual CLI stdout and not only against the composed string.
function headPipeline(root, args, n) {
  const command = `node ${JSON.stringify(bin)} context${args
    .map((arg) => ` ${JSON.stringify(arg)}`)
    .join('')} 2>&1 | head -${n}`;
  return execFileSync('/bin/sh', ['-c', command], { cwd: root, encoding: 'utf8' });
}

function cliContext(root, args) {
  return execFileSync('node', [bin, 'context', ...args], { cwd: root, encoding: 'utf8' });
}

// Asserts the published N is the exact size of the CLI output: `head -N` keeps
// END as its last line and `head -(N-1)` loses it.
function assertHeadIsExact(root, args, n) {
  assert.equal(headPipeline(root, args, n).trimEnd().split('\n').at(-1), END_LINE);
  assert.notEqual(
    headPipeline(root, args, n - 1)
      .trimEnd()
      .split('\n')
      .at(-1),
    END_LINE,
  );
}

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'context-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Project\n');
  init(root);
  return root;
}

function addChange(root, status, id = '20260627-120000') {
  const text = `---
id: "${id}"
title: Context fixture
type: feature
status: ${status}
created: 2026-06-27T12:00:00Z
depends_on: []
---

## Request

Need exact context.

## Investigation

Current evidence.

## Proposal

Chosen behavior.

## Specification

### CR1 — Full criterion
- **Given** concrete input
- **When** context is requested
- **Then** exact criterion text is present

## Plan

- [ ] Update the example module
  - **Target:** \`src/example.mjs\`
  - **Verify:** \`node --test test/example.test.mjs\`
  - **Criteria:** CR1

## Log

- Decision retained.
`;
  fs.writeFileSync(path.join(root, '.changeledger', 'changes', `${id}-context-fixture.md`), text);
  return id;
}

function writeRawChange(
  root,
  { id, status, type = 'feature', dependsOn = [], relatedTo = [], title = 'Dep target' },
) {
  const deps = dependsOn.length ? `[ ${dependsOn.map((d) => `"${d}"`).join(', ')} ]` : '[]';
  const related = relatedTo.length ? `[ ${relatedTo.map((d) => `"${d}"`).join(', ')} ]` : '[]';
  const text = `---
id: "${id}"
title: ${title}
type: ${type}
status: ${status}
created: 2026-06-27T12:00:00Z
depends_on: ${deps}
related_to: ${related}
---

## Request

Body.

## Specification

### CR1 — Criterion
- **Given** input
- **When** action
- **Then** result

## Plan

- [ ] Update the x module
  - **Target:** \`src/x.mjs\`
  - **Verify:** \`node --test test/x.test.mjs\`
  - **Criteria:** CR1

## Log

- Note.
`;
  fs.writeFileSync(path.join(root, '.changeledger', 'changes', `${id}-${type}.md`), text);
  return id;
}

// A `draft` change whose Investigation carries exactly `filler` extra lines, so
// the total size of its change-id context is a linear function of `filler` and
// a caller can calibrate an exact target instead of hardcoding a blob.
function writeFillerChange(root, id, filler) {
  const lines = [
    '---',
    `id: "${id}"`,
    'title: Line count fixture',
    'type: feature',
    'status: draft',
    'created: 2026-07-26T13:07:27Z',
    'depends_on: []',
    '---',
    '',
    '## Request',
    '',
    'Need an exact line count.',
    '',
    '## Investigation',
    '',
    'Current evidence.',
    ...Array.from({ length: filler }, (_, index) => `Filler line ${index + 1}.`),
    '',
    '## Proposal',
    '',
    'Chosen behavior.',
    '',
    '## Specification',
    '',
    '### CR1 — Full criterion',
    '- **Given** concrete input',
    '- **When** context is requested',
    '- **Then** exact criterion text is present',
    '',
    '## Plan',
    '',
    '- [ ] Update the example module',
    '  - **Target:** `src/example.mjs`',
    '  - **Verify:** `node --test test/example.test.mjs`',
    '  - **Criteria:** CR1',
    '',
    '## Log',
    '',
    '- Decision retained.',
    '',
  ];
  fs.writeFileSync(
    path.join(root, '.changeledger', 'changes', `${id}-line-count-fixture.md`),
    lines.join('\n'),
  );
  return id;
}

function setConfig(root, replacements) {
  const file = path.join(root, '.changeledger', 'config.yml');
  let text = fs.readFileSync(file, 'utf8');
  for (const [pattern, value] of replacements) text = text.replace(pattern, value);
  fs.writeFileSync(file, text);
}

test('CR1/CR5/CR7: core context is deterministic and within its budget', () => {
  const root = repo();
  const first = buildContext(undefined, root);
  const second = buildContext(undefined, root);
  assert.equal(first, second);
  assert.match(first, /mode: core/);
  // 20260730-002730: the phrase-level pins over core's prose are retired. What
  // this criterion still owns is determinism, the mode label and the budget; the
  // carrier obligations are guarded by the curated concept set at the end of this
  // suite, tolerantly rather than by their wording.
  assertWithinBudget('core', first, contextBudgets.base.core);
});

test('213942 CR1-CR4: core teaches operational discovery without embedding or mutating state', () => {
  const root = repo();
  const id = addChange(root, 'approved');
  const changeFile = path.join(root, '.changeledger', 'changes', `${id}-context-fixture.md`);
  const configFile = path.join(root, '.changeledger', 'config.yml');
  const changeBefore = fs.readFileSync(changeFile, 'utf8');
  const configBefore = fs.readFileSync(configFile, 'utf8');

  const first = buildContext(undefined, root);
  const second = buildContext(undefined, root);

  assert.match(first, /`changeledger list --status approved`/);
  assert.match(first, /`changeledger list --pending graduation`/);
  assert.match(first, /`changeledger list --pending archive`/);
  assert.doesNotMatch(first, /`changeledger graduate --pending`/);
  assert.doesNotMatch(first, /`changeledger archive --graduated --dry-run`/);
  assert.match(first, /before (scanning|searching) files/i);
  assert.doesNotMatch(first, new RegExp(id));
  assert.doesNotMatch(first, /Context fixture/);
  assert.equal(first, second);
  assertWithinBudget('core', first, contextBudgets.base.core);
  assert.equal(fs.readFileSync(changeFile, 'utf8'), changeBefore);
  assert.equal(fs.readFileSync(configFile, 'utf8'), configBefore);
});

// 20260730-002730 retired `234939 CR1-CR10`: its 22 phrase invariants and the
// kept/moved/seat lists over `delegation.md` and `core.md` were the pins the
// decision removes. What survives is the structural half — a status that resumes
// composes the implement pack and no readiness pack — plus the core budget.
test('234939 structural remnant: a resumed status composes implement, within budget', () => {
  const root = repo();
  const blockedId = addChange(root, 'blocked', '20260629-230001');
  const validationId = addChange(root, 'in-validation', '20260629-230002');
  const reviewId = addChange(root, 'in-review', '20260629-230003');
  const core = buildContext(undefined, root);

  for (const [status, id] of [
    ['blocked', blockedId],
    ['in-validation', validationId],
    ['in-review', reviewId],
  ]) {
    const file = path.join(root, '.changeledger', 'changes', `${id}-context-fixture.md`);
    fs.writeFileSync(
      file,
      fs.readFileSync(file, 'utf8').replace(`status: ${status}`, 'status: in-progress'),
    );
    const resumed = buildContext(id, root);
    assert.match(resumed, /mode: implement/);
    assert.match(resumed, /# Implementing an Approved Change/);
    // 225213 CR5: the effective TDD rule rides the policy header + implement
    // pack; the full Definition of Ready authoring detail is spec-owned only.
    assert.match(resumed, /Effective policy:.*tdd=(on|off)/);
    assert.doesNotMatch(resumed, /# Definition of Ready/);
  }
  assertWithinBudget('core', core, contextBudgets.base.core);
});

// 20260730-002730 retired `234939 CR11-CR20`: its 129-entry phrase-to-pack array
// was the largest single cost of editing contract prose. The structural half is
// what survives — which pack composes which fragment, and that no pack carries a
// foreign one — and it survives unedited.
test('234939 structural remnant: pack composition and owned headings', () => {
  const root = repo();
  const doneId = addChange(root, 'done', '20260629-230010');
  const blockedId = addChange(root, 'blocked', '20260629-230011');
  const validationId = addChange(root, 'in-validation', '20260629-230012');
  const discardedId = addChange(root, 'discarded', '20260629-230013');
  const reviewId = addChange(root, 'in-review', '20260629-230014');
  const outputs = {
    core: buildContext(undefined, root),
    spec: buildContext('spec', root),
    implement: buildContext('implement', root),
    review: buildContext('review', root),
    reviewDelegate: buildAgentContext('review', reviewId, root),
    blocked: buildContext(blockedId, root),
    validation: buildContext(validationId, root),
    discarded: buildContext(discardedId, root),
    release: buildContext('release', root),
    close: buildContext(doneId, root),
  };
  for (const output of Object.values(outputs)) {
    assert.doesNotMatch(output, /\.changeledger\/AGENTS\.md/);
    assert.doesNotMatch(output, /changeledger register/);
  }
  for (const mode of ['spec', 'implement']) {
    assert.match(outputs[mode], /# Economical Delegation/);
  }
  // 225213 CR4: review no longer carries the general delegation guide.
  assert.doesNotMatch(outputs.review, /# Economical Delegation/);
  assert.match(outputs.implement, /# Handoff Triage/);
  assert.match(outputs.review, /# Handoff Triage/);

  const ownedHeadings = {
    core: ['# ChangeLedger — Core Contract'],
    spec: ['# Authoring a Change', '# Economical Delegation', '# Definition of Ready'],
    implement: ['# Implementing an Approved Change', '# Economical Delegation', '# Handoff Triage'],
    review: ['# Independent Review', '# Handoff Triage'],
    blocked: ['# Blocked — Resolve Before Implementing', '# Handoff Triage'],
    validation: ['# Human Validation — Stop'],
    discarded: ['# Discarded — Terminal'],
    release: ['# Portable Release Planning'],
    close: ['# Closing Accepted Work'],
  };
  const allHeadings = [...new Set(Object.values(ownedHeadings).flat())];
  for (const [context, owned] of Object.entries(ownedHeadings)) {
    for (const heading of owned) assert.match(outputs[context], new RegExp(heading));
    for (const foreign of allHeadings.filter((heading) => !owned.includes(heading))) {
      assert.doesNotMatch(
        outputs[context],
        new RegExp(foreign),
        `${context} unexpectedly includes foreign pack ${foreign}`,
      );
    }
  }
  assertWithinBudget('core', outputs.core, contextBudgets.base.core);
});

// 20260730-002730 retired the four phrase pins this test used to hold over the
// divergence rule's wording. Its retired formulation stays: the inverse rule —
// the document overriding the code by default — must never come back, and that is
// the retired-phrase sweep class the decision keeps.
test('212659 CR6 retired phrase: the document never wins by default over the code', () => {
  const root = repo();
  const normalize = (text) => text.replace(/\s+/g, ' ');
  for (const mode of [undefined, 'implement']) {
    assert.doesNotMatch(
      normalize(buildContext(mode, root)),
      /document wins when code and documentation disagree/i,
      `the ${mode ?? 'core'} pack reintroduced the retired reconciliation rule`,
    );
  }
});

// 20260730-002730: the verbatim sentence pin is retired; the budget it also
// measured is not. The obligation itself — branch off the declared integration
// branch — is not among the curated twelve, so it now rests on review.
test('210115 CR3: the implement pack holds its budget', () => {
  const root = repo();
  const output = buildContext('implement', root);
  assertWithinBudget('implement', output, contextBudgets.base.implement);
});

test('215632 CR1-CR3: release context treats routine delivery as operational work', () => {
  const root = repo();
  const id = addChange(root, 'done');
  const changeFile = path.join(root, '.changeledger', 'changes', `${id}-context-fixture.md`);
  const configFile = path.join(root, '.changeledger', 'config.yml');
  const changeBefore = fs.readFileSync(changeFile, 'utf8');
  const configBefore = fs.readFileSync(configFile, 'utf8');

  const first = buildContext('release', root);
  const second = buildContext('release', root);

  // 20260730-002730: the seven phrase pins over `release.md` prose are retired.
  // The composition facts stay — the release pack is framed, incremental, and
  // never embeds core — as does determinism and the no-mutation guarantee.
  assert.match(first, /# Portable Release Planning/);
  assert.doesNotMatch(first, /# ChangeLedger — Core Contract/);
  assert.match(first, /This incremental context extends the complete core context already read/);
  assert.equal(first, second);
  assert.equal(fs.readFileSync(changeFile, 'utf8'), changeBefore);
  assert.equal(fs.readFileSync(configFile, 'utf8'), configBefore);
});

test('CR2: change id infers implement and includes complete actionable stages', () => {
  const root = repo();
  const id = addChange(root, 'in-progress');
  const output = buildContext(id, root);
  assert.match(output, /mode: implement/);
  assert.doesNotMatch(output, /# ChangeLedger — Core Contract/);
  assert.match(output, /This incremental context extends the complete core context already read/);
  assert.match(output, /one-pass full-capture rule applies here/i);
  assert.match(output, /a partial view is invalid/i);
  assert.match(output, /# Implementing an Approved Change/);
  // 225213 CR5: implement carries the effective TDD signal, not the full DoR pack.
  assert.match(output, /Effective policy:.*tdd=(on|off)/);
  assert.match(output, /## Request[\s\S]*Need exact context/);
  assert.match(output, /### CR1 — Full criterion/);
  assert.match(output, /\*\*Then\*\* exact criterion text is present/);
  assert.match(output, /## Plan[\s\S]*src\/example\.mjs/);
  assert.match(output, /## Log[\s\S]*Decision retained/);
});

test('20260629-210543 CR2: every supported status produces incremental change context', () => {
  const expected = {
    draft: [/mode: spec/, /# Authoring a Change/],
    approved: [/mode: implement/, /# Implementing an Approved Change/],
    'in-progress': [/mode: implement/, /# Implementing an Approved Change/],
    'in-review': [/mode: review/, /# Independent Review/],
    blocked: [/mode: blocked/, /# Blocked — Resolve Before Implementing/],
    'in-validation': [/mode: validation/, /# Human Validation — Stop/],
    done: [/mode: close/, /# Closing Accepted Work/],
    discarded: [/mode: discarded/, /# Discarded — Terminal/],
  };
  const { version } = JSON.parse(
    fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  const end =
    '===== CHANGELEDGER CONTEXT END — if this line is missing, the output was truncated: stop and re-run =====';

  for (const [index, [status, patterns]] of Object.entries(expected).entries()) {
    const root = repo();
    const id = addChange(root, status, `20260627-13000${index}`);
    const output = buildContext(id, root);
    for (const pattern of patterns) assert.match(output, pattern);
    assert.match(output, /This incremental context extends the complete core context already read/);
    assert.doesNotMatch(output, /# ChangeLedger — Core Contract/);
    assert.match(output, new RegExp(`id: "${id}"`));
    assert.match(output, /# Selected change/);
    const mode = output.match(/^===== CHANGELEDGER CONTEXT BEGIN — mode: ([^—]+?)(?: —|$)/)?.[1];
    assert.ok(mode, `missing BEGIN mode for ${status}`);
    assert.match(
      output.split('\n')[0],
      new RegExp(
        `^===== CHANGELEDGER CONTEXT BEGIN — mode: ${mode} — change: #${id} — v${version} — lines:\\d+ =====$`,
      ),
    );
    assert.equal(output.trimEnd().split('\n').at(-1), end);
  }
});

test('CR3/CR4: explicit modes work and unknown input has the exact error', () => {
  const root = repo();
  const expected = {
    implement: /# Implementing an Approved Change/,
    review: /# Independent Review/,
    spec: /# Authoring a Change/,
    release: /# Portable Release Planning/,
  };
  const { version } = JSON.parse(
    fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  const end =
    '===== CHANGELEDGER CONTEXT END — if this line is missing, the output was truncated: stop and re-run =====';
  for (const [mode, heading] of Object.entries(expected)) {
    const output = buildContext(mode, root);
    assert.match(output, new RegExp(`mode: ${mode}`));
    assert.match(output, heading);
    assert.doesNotMatch(output, /# ChangeLedger — Core Contract/);
    assert.match(output, /This incremental context extends the complete core context already read/);
    assert.match(output, /one-pass full-capture rule applies here/i);
    assert.match(output, /a partial view is invalid/i);
    assert.match(
      output.split('\n')[0],
      new RegExp(
        `^===== CHANGELEDGER CONTEXT BEGIN — mode: ${mode} — v${version} — lines:\\d+/\\d+ =====$`,
      ),
    );
    assert.equal(output.trimEnd().split('\n').at(-1), end);
  }
  assert.throws(
    () => buildContext('bogus', root),
    /Unknown context "bogus" — valid modes: implement, review, spec, release \(or pass a change id\)/,
  );
});

test('CR8/CR9: lifecycle overlays guard blocked, validation, done and discarded', () => {
  const expected = {
    blocked: [/mode: blocked/, /Resolve Before Implementing/],
    'in-validation': [/mode: validation/, /Human Validation — Stop/],
    done: [/mode: close/, /Closing Accepted Work/],
    discarded: [/mode: discarded/, /Discarded — Terminal/],
  };
  for (const [index, [status, patterns]] of Object.entries(expected).entries()) {
    const root = repo();
    const id = addChange(root, status, `20260627-12000${index}`);
    const output = buildContext(id, root);
    for (const pattern of patterns) assert.match(output, pattern);
    assert.doesNotMatch(output, /# ChangeLedger — Core Contract/);
    assert.match(output, /This incremental context extends the complete core context already read/);
    assert.doesNotMatch(output, /mode: release/);
    if (status === 'blocked') assert.doesNotMatch(output, /# Implementing an Approved Change/);
  }
  const root = repo();
  assert.match(buildContext('release', root), /mode: release/);
});

test('213931 CR4/CR5/CR6: context output is delimited, versioned and within budget', () => {
  const root = repo();
  const id = addChange(root, 'approved');
  const { version } = JSON.parse(
    fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  // A bounded mode publishes its occupancy of the line ceiling; an unbounded
  // change-id capture publishes its count alone, so each shape has its own pin.
  const begin = (label) =>
    new RegExp(
      `^===== CHANGELEDGER CONTEXT BEGIN — mode: ${label} — v${version} — lines:\\d+/\\d+ =====$`,
    );
  const beginUnbounded = (label) =>
    new RegExp(
      `^===== CHANGELEDGER CONTEXT BEGIN — mode: ${label} — v${version} — lines:\\d+ =====$`,
    );
  const end =
    '===== CHANGELEDGER CONTEXT END — if this line is missing, the output was truncated: stop and re-run =====';

  const core = buildContext(undefined, root);
  assert.match(core.split('\n')[0], begin('core'));
  assert.equal(core.trimEnd().split('\n').at(-1), end);
  assert.doesNotMatch(core, /^Mode: core$/m);
  assertWithinBudget('core', core, contextBudgets.base.core);

  for (const mode of ['spec', 'implement', 'review', 'release']) {
    const output = buildContext(mode, root);
    assert.match(output.split('\n')[0], begin(mode));
    assert.equal(output.trimEnd().split('\n').at(-1), end);
    assert.doesNotMatch(output, /^Mode: /m);
  }

  const byId = buildContext(id, root);
  assert.match(byId.split('\n')[0], beginUnbounded(`implement — change: #${id}`));
  assert.equal(byId.trimEnd().split('\n').at(-1), end);
});

// 20260726-124833 CR2: the `rev:<hash>` segment existed only to serve `--have`.
// With the flag retired the BEGIN line carries no revision, in any mode, and the
// substring never appears anywhere in the composed output.
test('124833 CR2: no mode emits a rev: segment on the BEGIN line or anywhere else', () => {
  const root = repo();
  const id = addChange(root, 'approved');
  const { version } = JSON.parse(
    fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );

  const core = buildContext(undefined, root);
  assert.equal(
    core.split('\n')[0],
    `===== CHANGELEDGER CONTEXT BEGIN — mode: core — v${version} — lines:${emittedLines(core)}/${contextBudgets.base.core.lines} =====`,
  );

  for (const mode of ['spec', 'implement', 'review', 'release']) {
    const output = buildContext(mode, root);
    assert.equal(
      output.split('\n')[0],
      `===== CHANGELEDGER CONTEXT BEGIN — mode: ${mode} — v${version} — lines:${emittedLines(output)}/${contextBudgets.base[mode].lines} =====`,
    );
    assert.doesNotMatch(output, /rev:/);
  }

  const byId = buildContext(id, root);
  assert.equal(
    byId.split('\n')[0],
    `===== CHANGELEDGER CONTEXT BEGIN — mode: implement — change: #${id} — v${version} — lines:${emittedLines(byId)} =====`,
  );
  assert.doesNotMatch(byId, /rev:/);
  assert.doesNotMatch(core, /rev:/);
});

test('225213 CR8: core exposes the transversal effective policy without raw config', () => {
  const root = repo();
  setConfig(root, [
    [/^language: en$/m, 'language: es'],
    [/^tdd: true$/m, 'tdd: false'],
  ]);
  const core = buildContext(undefined, root);
  // Effective language and tdd resolved on one line, defaults already applied.
  assert.match(core, /Effective policy: language=es — tdd=off/);
  // Core points to per-context policy instead of the raw config file. The presence
  // pin over that sentence is retired (20260730-002730); the retired formulation it
  // replaced stays, and the `Effective policy:` header above is a framing sentinel.
  assert.doesNotMatch(core, /narrative content follows `\.changeledger\/config\.yml`/);
  // Delimited core stays within budget.
  assertWithinBudget('core', core, contextBudgets.base.core);
});

test('225213 CR8: core resolves defaults when config omits language and tdd', () => {
  const root = repo();
  // Remove explicit keys so defaults must be resolved (language=en, tdd=on).
  setConfig(root, [
    [/^language: en$/m, ''],
    [/^tdd: true$/m, ''],
  ]);
  const core = buildContext(undefined, root);
  assert.match(core, /Effective policy: language=en — tdd=on/);
});

test('225213 CR2: mode packs show the effective policy affecting the task', () => {
  const root = repo();
  setConfig(root, [[/^language: en$/m, 'language: es']]);
  for (const mode of ['spec', 'implement']) {
    const output = buildContext(mode, root);
    assert.match(output, /Effective policy: language=es — tdd=on/);
  }
  // Review cares about the content language it verifies.
  assert.match(buildContext('review', root), /Effective policy: language=es/);
});

test('210115 CR2: effective policy exposes the declared integration branch', () => {
  const root = repo();
  setConfig(root, [[/^ {2}integration_branch:$/m, '  integration_branch: dev']]);
  const output = buildContext('implement', root);
  assert.match(output, /Effective policy: language=en — tdd=on — integration_branch=dev/);
});

test('210115 CR2: effective policy omits integration_branch when undeclared', () => {
  const root = repo();
  const output = buildContext('implement', root);
  const policyLine = output.split('\n').find((line) => line.startsWith('Effective policy:'));
  assert.equal(policyLine, 'Effective policy: language=en — tdd=on');
});

test('225213 CR2: change-id context shows type-specific effective policy', () => {
  const root = repo();
  setConfig(root, [[/^language: en$/m, 'language: es']]);
  const id = writeRawChange(root, {
    id: '20260627-140000',
    status: 'in-progress',
    type: 'feature',
  });
  const output = buildContext(id, root);
  assert.match(output, /Effective policy: language=es/);
  assert.match(output, /tdd=on/);
  // feature requires review in the fixture config.
  assert.match(output, /review_required\(feature\)=yes/);
  // Active stages for the type are resolved, not left for the agent to infer.
  assert.match(output, /stages\(feature\)=[a-z, ]*specification/);
});

test('225213 CR2: change-id policy reflects a type without review', () => {
  const root = repo();
  const id = writeRawChange(root, {
    id: '20260627-140001',
    status: 'in-progress',
    type: 'audit',
  });
  const output = buildContext(id, root);
  // audit has no review_required in the fixture config → resolved to no.
  assert.match(output, /review_required\(audit\)=no/);
});

test('225213 CR3: change-id resolves local dependencies without inflating bodies', () => {
  const root = repo();
  const depId = writeRawChange(root, {
    id: '20260627-150000',
    status: 'done',
    title: 'Delivery layer',
  });
  const id = writeRawChange(root, {
    id: '20260627-150001',
    status: 'in-progress',
    title: 'Consumer',
    dependsOn: [depId, 'otherproj:20260101-000000'],
  });
  const output = buildContext(id, root);
  // Local dependency: id, title and current status on one line.
  assert.match(output, new RegExp(`#${depId} — Delivery layer — done`));
  // The dependency body is not embedded.
  assert.doesNotMatch(output, /## Request\s+Body\.\s+## Specification[\s\S]*Delivery layer/);
  // External reference stays a reference, not pretended resolved.
  assert.match(output, /otherproj:20260101-000000/);
  assert.match(output, /external reference/i);
});

test('225213 CR3: change without dependencies emits no dependency block', () => {
  const root = repo();
  const id = writeRawChange(root, { id: '20260627-150002', status: 'in-progress' });
  const output = buildContext(id, root);
  assert.doesNotMatch(output, /## Dependencies/);
});

test('105456 CR4: context resolves outgoing, incoming and external related changes', () => {
  const root = repo();
  const a = writeRawChange(root, {
    id: '20260627-160000',
    status: 'in-progress',
    title: 'Selected',
    relatedTo: ['20260627-160001', 'otherproj:20260101-000000'],
  });
  writeRawChange(root, { id: '20260627-160001', status: 'done', title: 'Outgoing target' });
  writeRawChange(root, {
    id: '20260627-160002',
    status: 'approved',
    title: 'Incoming source',
    relatedTo: [a],
  });

  const output = buildContext(a, root);
  assert.match(output, /## Related changes/);
  assert.match(output, /outgoing.*#20260627-160001.*Outgoing target.*done/);
  assert.match(output, /incoming.*#20260627-160002.*Incoming source.*approved/);
  assert.match(output, /outgoing.*otherproj:20260101-000000.*external reference/);
});

// 20260730-002730 retired `220014 CR1/CR4`: every one of its six asserts pinned a
// sentence of `core.md` or `validation.md`. `220014 CR2/CR3` below is structural —
// it walks the dependency graph — and is untouched.

test('220014 CR2/CR3: a direct or transitive dependency on an in-validation change is visible', () => {
  const root = repo();
  const blockedByA = writeRawChange(root, {
    id: '20260628-000010',
    status: 'in-validation',
    title: 'A — delivered, awaiting human',
  });
  const candidateB = writeRawChange(root, {
    id: '20260628-000011',
    status: 'approved',
    title: 'B — depends on A directly',
    dependsOn: [blockedByA],
  });
  const candidateC = writeRawChange(root, {
    id: '20260628-000012',
    status: 'approved',
    title: 'C — depends on B, transitively on A',
    dependsOn: [candidateB],
  });

  // CR2: B's own context surfaces A's in-validation status directly.
  const outputB = buildContext(candidateB, root);
  assert.match(
    outputB,
    new RegExp(`#${blockedByA} — A — delivered, awaiting human — in-validation`),
  );

  // CR3: C does not mention A directly, but walking its one declared
  // dependency (B) exposes the chain C -> B -> A without a new primitive.
  const outputC = buildContext(candidateC, root);
  assert.match(outputC, new RegExp(`#${candidateB} — B — depends on A directly — approved`));
  assert.doesNotMatch(outputC, new RegExp(blockedByA));
  const outputBAgain = buildContext(candidateB, root);
  assert.match(outputBAgain, /in-validation/);
});

test('225213 CR6: every base composition stays within its explicit budget', () => {
  const root = repo();
  // Budgets measured WITHOUT any selected change text — base compositions only.
  const budgets = contextBudgets.base;
  for (const [mode, budget] of Object.entries(budgets)) {
    const output = mode === 'core' ? buildContext(undefined, root) : buildContext(mode, root);
    assertWithinBudget(mode, output, budget);
  }
});

test('225213 CR6: status overlays stay within their explicit budget (no change text)', () => {
  const root = repo();
  // Overlay base = fragments + delimiters + policy header, empty change body.
  const budgets = contextBudgets.overlays;
  let i = 0;
  for (const [status, budget] of Object.entries(budgets)) {
    const id = writeRawChange(root, { id: `20260627-16000${i}`, status });
    i += 1;
    // Strip the selected change section to measure the base composition only.
    const output = buildContext(id, root);
    const base = output.split('\n# Selected change')[0];
    assertWithinBudget(`${status} overlay`, base, budget);
  }
});

test('225213 CR4/CR5/CR7: review drops general delegation while keeping its rules', () => {
  const root = repo();
  const reviewId = addChange(root, 'in-review', '20260705-120010');
  const review = buildContext('review', root);
  const delegate = buildAgentContext('review', reviewId, root);
  // Orchestrator review keeps independence, verdict mechanics and handoff. The
  // three phrase pins over the delegated capsule's prose are retired
  // (20260730-002730); the pack-composition and command surfaces stay.
  assert.match(review, /# Independent Review/);
  assert.match(review, /agent-context review <id>/);
  assert.match(review, /changeledger review <id> pass/);
  assert.match(review, /# Handoff Triage/);
  assert.match(delegate, /read-only/);
  assert.doesNotMatch(delegate, /changeledger review <id> pass/);
  // Review no longer carries the general delegation guide the reviewer does not need.
  assert.doesNotMatch(review, /# Economical Delegation/);
  assert.doesNotMatch(review, /Do not over-shard/);
  assert.doesNotMatch(review, /Delegation prompt contract/);

  // Implement keeps its actionable contract but drops authoring/config detail.
  const implement = buildContext('implement', root);
  assert.match(implement, /# Implementing an Approved Change/);
  assert.match(implement, /# Handoff Triage/);
});

test('134702/122950 CR1/CR2: the review gate is one ordered recipe owned by implement', () => {
  const root = repo();
  const validationId = addChange(root, 'in-validation', '20260715-122950');
  const norm = (s) => s.replace(/\s+/g, ' ');
  const implement = norm(buildContext('implement', root));
  const review = norm(buildContext('review', root));
  const core = norm(buildContext(undefined, root));

  // CR1: implement carries the complete ordered recipe, including post-mutation
  // gates. 20260730-002730 retired the three sentence pins around it; the recipe
  // is asserted by step order and command anchors, which is structure, not prose.
  assert.match(
    implement,
    // 20260722-124656 reordered steps 2 and 3: the local gate decides whether a
    // reviewable candidate exists, so it runs before the lifecycle claims review
    // started, and step 4 revalidates only what the transition altered.
    // 20260728-164620 inserted step 5, the implementation commit — one per
    // resolved selection since 20260729-111349 — so the reviewer is delegated
    // against a fixed range; every later step shifts by one.
    /1\..*Plan task.*2\..*formatter.*full gates.*3\..*`changeledger status <id> in-review`.*4\..*Reapply the formatter.*5\..*implementation commit.*6\..*`changeledger context review` once.*7\..*read-only reviewer.*8\..*`changeledger review <id> pass\|fail`.*9\..*formatter again.*affected checks.*`changeledger check`/,
  );
  assert.match(implement, /never `log`\+`status`/);
  assert.match(
    implement,
    /without `review_required`.*post-transition formatter.*affected-check gate/,
  );
  assert.match(review, /After recording any verdict.*formatter.*`changeledger check`/);
  assert.match(
    buildContext(validationId, root),
    /final lifecycle\s+mutation[\s\S]*`changeledger check`/,
  );

  // CR2: review names the orchestrator as the verdict recorder; recipe not duplicated.
  assert.match(review, /orchestrator records exactly one verdict/);
  assert.match(review, /reports.*never runs the verdict command/i);
  assert.doesNotMatch(review, /1\..*2\..*3\..*4\..*5\./);

  // CR2: the ordered recipe is owned by implement, not core or delegation.
  assert.doesNotMatch(core, /`changeledger status <id> in-review`.*`changeledger review <id> pass/);
});

// 20260722-124656 — the local gate decides whether a reviewable candidate exists.
// While it ran after the transition, a gate failure left the lifecycle asserting
// that review had begun and pushed the orchestrator towards a fabricated verdict.
test('124656 CR1/CR2/CR4/CR5: the local gate precedes the in-review transition', () => {
  const root = repo();
  const norm = (s) => s.replace(/\s+/g, ' ');
  const implement = norm(buildContext('implement', root));
  const reviewOutput = buildContext('review', root);

  // CR1: the gate step precedes the transition step in the ordered recipe. The
  // gate anchor is a tolerant concept match, not the step's sentence
  // (20260730-002730): rewording the step must not retarget this ordering.
  const gate = implement.search(/\bapply\b[^.]{0,30}\bformatter\b/i);
  const transition = implement.indexOf('`changeledger status <id> in-review`');
  assert.notEqual(gate, -1, 'implement no longer names the local gate step');
  assert.notEqual(transition, -1, 'implement no longer names the in-review transition');
  assert.ok(gate < transition, 'the local gate must precede the in-review transition');
  // 20260730-002730 retired the eight sentence pins this test carried around that
  // ordering. The order itself — a positional fact, not a wording — stays, in both
  // directions: no numbered step after the transition may re-run the local gate,
  // which `gate < transition` alone (first occurrence only) would not catch.
  assert.doesNotMatch(
    implement,
    /`changeledger status <id> in-review`\. \d+\.[^.]{0,30}\bformatter\b/i,
  );

  assertWithinBudget('review', reviewOutput, contextBudgets.base.review);
});

test('134704 CR1/CR2/CR3: graduation is one numbered recipe owned by the close overlay', () => {
  const root = repo();
  const norm = (s) => s.replace(/\s+/g, ' ');
  const doneId = addChange(root, 'done', '20260705-200000');
  const close = norm(buildContext(doneId, root));
  const core = norm(buildContext(undefined, root));

  // CR1: close carries a numbered recipe for a new spec, in order.
  assert.match(
    close,
    /1\..*`changeledger graduate <id> <spec-slug> --new`.*2\..*remove the explicit scaffold marker.*3\..*`changeledger graduate <id> <spec-slug> --into`/,
  );
  assert.match(close, /--new`.*leaves graduation pending/);
  // Existing-spec and skip remain explicit alternatives.
  assert.match(close, /For an existing spec/);
  assert.match(close, /changeledger graduate <id> --skip \[reason\]/);

  // CR3: the reviewed:true nuance sits with the recipe steps.
  assert.match(close, /sets `reviewed: true`/);

  // CR2: core keeps only the trigger; no two-step procedure summary.
  // 20260726-124835: the trigger shrank to the reload plus the owner, so not even
  // the `--skip` command survives in core. 20260730-002730 retired the pin over
  // the owner sentence; the command-absence claims are commands, not prose.
  assert.match(core, /reload `changeledger context <id>`/);
  assert.doesNotMatch(core, /changeledger graduate <id> --skip \[reason\]/);
  assert.doesNotMatch(core, /a new spec is a two-step/);
});

test('002730: the lifecycle matrix owns topology, owners and mechanisms', () => {
  const root = repo();
  const core = buildContext(undefined, root);
  const norm = core.replace(/\s+/g, ' ');

  // CR1: a matrix with transition / owner / mechanism columns covers every arc.
  assert.match(norm, /\| Transition \| Owner \| Mechanism \|/);
  const rows = [
    /draft → approved \| human \| viewer or `changeledger approve <id>` after an explicit prompt/,
    /approved → in-progress; blocked → in-progress; in-progress → in-review \| agent \| `changeledger status`/,
    /in-progress → in-validation \(no review\) \| agent \| `changeledger status`/,
    /in-review → in-validation \| orchestrator \| `changeledger review <id> pass`/,
    /in-review → in-progress \| orchestrator \| `changeledger review <id> fail --retry`/,
    /in-review → blocked \| orchestrator \| `changeledger review <id> fail --block`/,
    /in-validation → done \| human \| viewer or `changeledger validation <id> pass` after an explicit prompt/,
    /in-validation → in-progress \| agent or human \| viewer; agent `validation <id> fail "<reason>"`; human prompt adds `--human`/,
    /done → in-progress \(pending closure\) \| agent or human \| `changeledger reopen <id> "<reason>"` or viewer/,
    /→ discarded \| agent \(authorized\) \| `changeledger discard <id> "<reason>"`/,
  ];
  for (const row of rows) assert.match(norm, row, `matrix missing row ${row}`);

  assert.doesNotMatch(core, /human acceptance or rejection/);

  // CR1: status never owns done or discarded.
  assert.doesNotMatch(norm, /done \| agent \| `changeledger status`/);
  assert.doesNotMatch(norm, /discarded \| agent \| `changeledger status`/);

  // CR2: ownership prose and the parallel topology diagram are both gone.
  assert.doesNotMatch(norm, /The viewer owns `draft → approved`/);
  assert.doesNotMatch(core, /draft → approved → in-progress/);
  // CR2: the retired formulations stay retired. 20260730-002730 retired the four
  // phrase pins over the note's prose; the matrix rows above are table cells, not
  // sentences, and the non-inference invariant is curated entry 3.
});

test('144327 CR5: core discovers agent-prompt before a draft exists, within budget', () => {
  const root = repo();
  const core = buildContext(undefined, root);
  const norm = core.replace(/\s+/g, ' ');
  // The pointer's four roles are a command's argument set, not prose, so they stay;
  // 20260730-002730 retired the sentence that introduced them.
  assert.match(norm, /`changeledger agent-prompt <role>`/);
  assert.match(norm, /investigation \| implementation \| review \| post-review/);
  // The skeleton bodies are NOT inlined into the core, and the pointer is not
  // duplicated into the delegation fragment.
  assert.doesNotMatch(core, /Delegation skeleton — role:/);
  const contractDir = new URL('../templates/contract/', import.meta.url);
  const delegation = fs.readFileSync(new URL('delegation.md', contractDir), 'utf8');
  assert.doesNotMatch(delegation, /changeledger agent-prompt/);
  // Budget holds at the current values without another emergency adjustment.
  assertWithinBudget('core', core, contextBudgets.base.core);
});

test('230608 CR1/CR2: core defers exhaustive detail to owning packs', () => {
  const root = repo();
  const core = buildContext(undefined, root).replace(/\s+/g, ' ');
  // Both halves of this criterion are deferrals, so what it owns is the ABSENCE of
  // the exhaustive detail. 20260730-002730 retired the two sentence pins over the
  // deferral wording and kept the two retired-phrase claims, which are the sweep
  // class the decision preserves.
  assert.doesNotMatch(core, /ownership, expected output and integration criterion/);
  assert.doesNotMatch(core, /a new spec is a two-step/);
});

// 20260711-103756 CR5: the spec context documents the `quick` lane, its
// eligibility and the discard-and-recreate rule for scope growth.
test('103756 CR5: spec context documents the quick lane and its eligibility', () => {
  const root = repo();
  const spec = buildContext('spec', root).replace(/\s+/g, ' ');
  // 20260730-002730 retired the two eligibility sentence pins; the lane's name is a
  // configured enum value, not prose, and the budget is untouched.
  assert.match(spec, /`quick`/);
  assertWithinBudget('spec', buildContext('spec', root), contextBudgets.base.spec);
});

// 20260730-002730 retired `105456 CR8 correction`: all five of its asserts pinned
// sentences of `spec.md`. The frontmatter keys the rule is about — `depends_on`
// and `related_to` — are still pinned present by the authoring pack's own
// composition checks, which are structural.

// 20260726-141120 CR6 — a type without `review_required` can never reach
// `in-review`, so no reachable status composes the review mode. Reachability is
// derived from the lifecycle graph itself, not hardcoded, so closing or
// reopening the review entry is what this test observes.

function addQuickChange(root, status, id = '20260726-141120') {
  fs.writeFileSync(
    path.join(root, '.changeledger', 'changes', `${id}-quick-fixture.md`),
    `---
id: "${id}"
title: Quick fixture
type: quick
status: ${status}
created: 2026-07-26T14:11:20Z
depends_on: []
---

## Request

Small reversible work.

## Log

- Initial note.
`,
  );
  return id;
}

function reachableWithoutReview() {
  const seen = new Set(['draft']);
  const queue = ['draft'];
  while (queue.length) {
    const from = queue.shift();
    for (const to of CANONICAL_STATUSES) {
      if (seen.has(to) || !canTransition(from, to)) continue;
      try {
        assertTransition(from, to, { type: 'quick', reviewRequired: false });
      } catch {
        continue;
      }
      seen.add(to);
      queue.push(to);
    }
  }
  return [...seen];
}

// 20260726-141121 CR2 — `readiness` demands `CRn` blocks under `##
// Specification` and Plan tasks citing them. A type that never activates the
// `specification` stage cannot satisfy that, so composing the fragment
// contradicts the `Active stages(<type>)=` line printed in the same capture.
test('141121 CR2: draft types without specification compose no readiness fragment', () => {
  const root = repo();
  const cases = [
    ['audit', '20260726-141130'],
    ['chore', '20260726-141131'],
    ['quick', '20260726-141132'],
  ];
  for (const [type, id] of cases) {
    writeRawChange(root, { id, status: 'draft', type });
    const output = buildContext(id, root);
    assert.doesNotMatch(output, /# Definition of Ready/, `${type} still composes readiness`);
    assert.match(output, /# Authoring a Change/, `${type} lost the authoring fragment`);
    assert.match(output, /# Economical Delegation/, `${type} lost the delegation fragment`);
    const stages = output.split('\n').find((line) => line.startsWith(`Active stages(${type})=`));
    assert.ok(stages, `${type} is missing its active stages line`);
    assert.doesNotMatch(stages, /specification/, `${type} unexpectedly activates specification`);
  }
});

// 20260726-141121 CR3 — the filter is keyed on the configured stages, so every
// type that does activate `specification` must keep the spec pack whole, in the
// same order it had before the fix.
test('141121 CR3: draft types with specification keep the three spec fragments', () => {
  const root = repo();
  const expected = ['# Authoring a Change', '# Economical Delegation', '# Definition of Ready'];
  const cases = [
    ['feature', '20260726-141133'],
    ['bug', '20260726-141134'],
    ['refactor', '20260726-141135'],
  ];
  for (const [type, id] of cases) {
    writeRawChange(root, { id, status: 'draft', type });
    const output = buildContext(id, root);
    const headings = output.split('\n').filter((line) => expected.includes(line));
    assert.deepEqual(headings, expected, `${type} composed ${headings.join(', ')}`);
    const stages = output.split('\n').find((line) => line.startsWith(`Active stages(${type})=`));
    assert.match(stages, /specification/, `${type} no longer activates specification`);
  }
});

// 20260726-141121 CR4 — the bare `spec` mode resolves no change and therefore
// no type, so the type filter must not reach it: it keeps the readiness
// fragment and stays inside the `base.spec` budget it was measured against.
test('141121 CR4: the bare spec composition resolves no type and holds its budget', () => {
  const root = repo();
  const output = buildContext('spec', root);
  assert.doesNotMatch(output, /Active stages\(/);
  assert.match(output, /# Definition of Ready/);
  assertWithinBudget('spec', output, contextBudgets.base.spec);
});

// 20260726-141122 CR6 — `Repos tune recognition with` left the two readiness
// keys unowned: no subject was obliged to check them, so an agent starting work
// in a non-JS repo kept the JS-shaped defaults and could not approve a
// well-formed change. The duty is now explicit and addressed to the agent.
// 20260730-002730 retired the two verbatim pins of `141122 CR6`. What survives is
// its retired-phrase claim (the unowned `Repos tune recognition with` must not come
// back), the two configuration keys as identifiers rather than prose, and the budget.
test('002730: the readiness keys are named without the retired phrasing', () => {
  const root = repo();
  const output = buildContext('spec', root);
  const normalized = output.replace(/\s+/g, ' ');
  assert.doesNotMatch(normalized, /Repos tune recognition with/);
  assert.match(normalized, /`readiness\.target_patterns`/);
  assert.match(normalized, /`readiness\.verification_patterns`/);
  assertWithinBudget('spec', output, contextBudgets.base.spec);
});

// 20260729-203257 CR7 — the pack taught a grammar the parser no longer
// implements: traceability read off the last parenthesized group of the physical
// line, plus an ordering rule that can only exist where position carries meaning.
// Both phrases are swept out of every served fragment rather than the two
// rewritten here, and the four children are pinned present in the pack a human
// actually reads, so documenting them nowhere fails even if the fragments parse.
const RETIRED_POSITIONAL_PHRASES = [
  'final parenthesized block',
  'Verification must precede the final criteria block',
];

test('203257 CR7: the spec pack teaches the four task children and no positional rule', () => {
  const root = repo();
  const output = buildContext('spec', root);
  const normalized = output.replace(/\s+/g, ' ');
  for (const child of ['**Target:**', '**Verify:**', '**Criteria:**', '**Support:**']) {
    assert.ok(normalized.includes(child), `the spec pack documents no ${child} child`);
  }
  // The example, not only the rule: a reader copies the block.
  assert.match(normalized, /- \*\*Target:\*\* `src\/foo\.ts` - \*\*Verify:\*\* `pnpm test`/);
  assert.match(normalized, /- \*\*Criteria:\*\* CR1, CR2/);
  // 20260730-002730 retired the three sentence pins that stood here. The children,
  // the copyable example and the recursive retired-phrase sweep below are what the
  // criterion keeps; curated entry 12 guards the grammar's obligation tolerantly.
  assert.match(
    normalized,
    /`target_patterns`[^.]{0,60}`Target`[^.]{0,60}`verification_patterns`[^.]{0,40}`Verify`/,
  );
  // The shared enumeration reaches every depth: the `agent-contexts/` and
  // `agent-prompts/` capsules ship to consuming repos exactly like the top-level
  // fragments, so a top-level-only sweep would leave the retired phrases a seat
  // to survive in.
  const fragments = contractFragmentNames();
  // The sweep's own reach is asserted, not assumed.
  for (const seat of ['spec.md', 'readiness.md', 'agent-contexts/implementation.md']) {
    assert.ok(fragments.includes(seat), `the sweep does not reach ${seat}`);
  }
  for (const retired of RETIRED_POSITIONAL_PHRASES) {
    const holders = fragments.filter((name) =>
      contractFragment(name).replace(/\s+/g, ' ').includes(retired),
    );
    assert.deepEqual(holders, [], `a contract fragment still carries the retired "${retired}"`);
  }
  assertWithinBudget('spec', output, contextBudgets.base.spec);
});

test('141120 CR6: a quick change in-progress composes implement, never review', () => {
  const root = repo();
  const id = addQuickChange(root, 'in-progress');
  assert.match(buildContext(id, root).split('\n')[0], /mode: implement/);
});

test('141120 CR6: no status reachable by a type without review composes review', () => {
  const reachable = reachableWithoutReview();
  assert.ok(!reachable.includes('in-review'), 'in-review must be unreachable without review');
  for (const status of reachable) {
    const root = repo();
    const id = addQuickChange(root, status);
    assert.doesNotMatch(
      buildContext(id, root).split('\n')[0],
      /mode: review/,
      `status ${status} must not compose the review mode`,
    );
  }
});

// 20260726-130727 — the BEGIN line publishes `lines:<N>`, the exact total line
// count of the emitted output, so any consumer can build a deterministic
// `head -<N>` regardless of how large the context turns out to be.

test('130727 CR1: core publishes its exact line count and head -<N> keeps END last', () => {
  const root = repo();
  const composed = buildContext(undefined, root);
  const n = publishedLines(composed);
  assert.equal(n, emittedLines(composed));
  assert.equal(n, emittedLines(cliContext(root, [])));
  assertHeadIsExact(root, [], n);
});

test('130727 CR2: the spec mode publishes its exact line count', () => {
  const root = repo();
  const composed = buildContext('spec', root);
  const n = publishedLines(composed);
  assert.equal(n, emittedLines(composed));
  assert.equal(n, emittedLines(cliContext(root, ['spec'])));
  assertHeadIsExact(root, ['spec'], n);
});

test('130727 CR3: an unbounded change-id context publishes its exact line count', () => {
  const root = repo();
  const id = '20260726-130727';
  // Long embedded document: the output must exceed every fixed budget in
  // `budgets.yml`, which is exactly why a fixed `head -400` cannot serve it.
  writeFillerChange(root, id, 400);
  const composed = buildContext(id, root);
  const n = publishedLines(composed);
  const largestBudget = Math.max(
    ...Object.values(contextBudgets.base).map((budget) => budget.lines),
  );
  assert.ok(n > largestBudget, `change-id context is not unbounded: ${n} <= ${largestBudget}`);
  assert.equal(n, emittedLines(composed));
  assert.equal(n, emittedLines(cliContext(root, [id])));
  assertHeadIsExact(root, [id], n);
});

test('130727 CR4: the count stays exact across the 3-to-4 digit boundary', () => {
  for (const target of [999, 1000]) {
    const root = repo();
    const id = '20260726-130727';
    // Calibrated, never hardcoded: each filler line adds exactly one output
    // line, so measuring an unpadded build yields the padding this contract
    // needs today and re-derives it whenever a fragment changes.
    writeFillerChange(root, id, 0);
    const padding = target - emittedLines(buildContext(id, root));
    assert.ok(padding >= 0, `contract already exceeds ${target} lines by ${-padding}`);
    writeFillerChange(root, id, padding);

    const composed = buildContext(id, root);
    assert.equal(emittedLines(composed), target);
    assert.equal(publishedLines(composed), target);
    assert.equal(emittedLines(cliContext(root, [id])), target);
    assertHeadIsExact(root, [id], target);
  }
});

// 20260727-194234 — the commit unit had four homes: core plus a copy in review,
// validation and close. Retiring the three leaves one sede, so two sedes can no
// longer drift apart unnoticed.
const contractFragments = new URL('../templates/contract/', import.meta.url);

const RETIRED_COPIES = [
  'A review verdict alone needs no commit',
  "Handoff may use the implementation contract's checkpoint",
  'The validation transition alone does not require a dedicated commit',
  'Do not create separate commits whose only',
];

// 20260730-002730 retired the five pins this test held over each overlay's
// surviving sentence. What the criterion is actually about — what LEFT each overlay
// — is a retired-phrase sweep, the class the decision keeps, so that half stays.
test('194234 CR1/CR2/CR3: each overlay drops the retired copy', () => {
  const root = repo();
  // review: the verdict-commit rule goes.
  const review = buildContext('review', root);
  assert.doesNotMatch(review, /A review verdict alone needs no commit/);
  assert.doesNotMatch(review, /Handoff may use the implementation contract's checkpoint/);
  // in-validation overlay: the transition-commit rule goes.
  const validation = buildContext(addChange(root, 'in-validation'), root);
  assert.doesNotMatch(validation, /does not require a dedicated commit/);
  // close overlay: the prohibition goes.
  const close = buildContext(addChange(root, 'done'), root);
  assert.doesNotMatch(close, /Do not create separate commits whose only/);
});

// 20260730-002730 retired the single-home pin, which located the obligation by its
// sentence. The four retired copies stay: that sweep is what proves they did not
// grow back anywhere in the fragment tree.
test('194234 CR4: the retired commit-unit copies are absent from every fragment', () => {
  // Every fragment means every depth: the capsule subdirectories carried the copies
  // as readily as the top level, and this sweep was blind to them.
  const fragments = contractFragmentNames().map((name) => [name, contractFragment(name)]);
  for (const copy of RETIRED_COPIES) {
    const holders = fragments.filter(([, text]) => text.includes(copy)).map(([name]) => name);
    assert.deepEqual(holders, [], `retired copy still present: ${copy}`);
  }
});

// 20260730-002730 retired `143656 CR2`: both of its asserts grepped a sentence of
// `core.md`. Its two obligations are curated entry 6 (the commit unit) and the
// commit-class structure, guarded tolerantly instead of by wording.

// 20260729-185200 CR5 — the six drafting obligations, one guard per obligation and
// never per criterion, in the fragment that owns it and in the composed `spec`
// capture that carries it, so removing one obligation kills exactly one guard.
//
// 20260730-002730 kept the mechanism and retired its wording dependency: each
// pattern was the obligation's literal sentence, so every rewrite of `spec.md` or
// `readiness.md` paid a retarget here. Each is now a tolerant concept match —
// ordered keyword groups with alternations and bounded gaps — so deleting the
// obligation still fails while rewording it does not. Whitespace is flattened
// first: the obligations are wrapped prose and a guard must survive rewrapping.
const flattened = (text) => text.replace(/\s+/g, ' ');

const DRAFTING_OBLIGATIONS = [
  [
    'a Then states a measured fact, not an assumption',
    'spec.md',
    // Two halves, each required and each order-independent: the fact is measured, and
    // an assumption is refused. A single ordered pattern could not survive the passive
    // voice, which is exactly the fragility this change removes.
    [
      /`?then`?[^;]{0,90}\b(measured|verified|checked)\b/i,
      /\b(never|not|no|nor)\b[^;]{0,45}\bassum/i,
    ],
  ],
  [
    'a universally quantified criterion covers its domain or narrows',
    'spec.md',
    // The gap after the quantifier admits `.` because the obligation's own text
    // carries an `(e.g. …)` aside; the bound is what keeps it inside one sentence.
    /\bcriteri\w+\b[^;]{0,60}\b(universal\w*|quantif\w+)\b[^;]{0,90}\b(covers?|spans?)\b[^;]{0,40}\b(whole|domain|entire)\b[^;]{0,60}\bnarrow/i,
  ],
  [
    'sets come from the config, never a hand-written list',
    'spec.md',
    /\b(derive|read|take)\w*\b[^.;]{0,25}\bsets?\b[^.;]{0,40}config\.yml[^.;]{0,40}\b(instead|rather|not)\b[^.;]{0,45}\b(enumerat\w+|hand)/i,
  ],
  [
    'edited code is cited by symbol and test name, never by line number',
    'spec.md',
    /\bcite\b[^.:;]{0,60}\b(symbols?|names?)\b[^.:;]{0,60}\bnever\b[^.:;]{0,25}\bline numbers?\b/i,
  ],
  [
    'each external interface declares whether its output is stable',
    'readiness.md',
    /\bexternal\b[^.;]{0,30}\binterfaces?\b[^.;]{0,90}\bstate\w*\b[^.;]{0,45}\bstable\b/i,
  ],
  [
    'every ask in the Request maps to a criterion or is named as excluded',
    'readiness.md',
    /\bask\w*\b[^.;]{0,45}## Request[^.;]{0,60}\bcriteri\w+\b[^.;]{0,60}\b(excluded|exclusion|excludes)\b/i,
  ],
];

for (const [label, owner, obligation] of DRAFTING_OBLIGATIONS) {
  test(`185200 CR5: the spec pack obliges that ${label}`, () => {
    const fragment = flattened(fs.readFileSync(new URL(owner, contractFragments), 'utf8'));
    const composed = flattened(buildContext('spec', repo()));
    // An obligation whose concept needs two independent halves carries both; each is
    // asserted on its own so a failure names the half that was lost.
    for (const pattern of Array.isArray(obligation) ? obligation : [obligation]) {
      assert.match(fragment, pattern, `${owner} no longer states the obligation: ${pattern}`);
      assert.match(
        composed,
        pattern,
        `the composed spec capture no longer carries the obligation: ${pattern}`,
      );
    }
  });
}

// 20260730-165310 CR2/CR3/CR4 — the three obligations this change adds to the
// delegation contract. Each row was guarded by the mechanism `185200 CR5` above
// uses — the fragment that owns the obligation, and the composed pack that must
// carry it to the role that executes it — until 20260730-214503 retired the
// composed half: the fragment's transport into its pack is already guarded by
// `234939 structural remnant: pack composition and owned headings`, which fails
// if a fragment is dropped from a pack in `MODE_CONTEXT`, so a row here no longer
// needs to prove the transport itself. The mode column stays: it still labels
// the test title with where each obligation is read, but no longer selects a
// pack for the loop to build and assert against.
//
// Tolerant concept matches over flattened text, never the sentence: each pattern
// is one half of the obligation, so rewording is free and dropping a half fails
// with a message naming the half that went. Every half is written in both
// directions, the lesson `185200 CR5` records above: an ordered pattern dies on
// the passive voice, and a reword mutant of each obligation below was run against
// these patterns before they were kept.
const DELEGATION_OBLIGATIONS = [
  [
    'the review mandate is declared, recorded in the Log, and bounds the inspection',
    'review.md',
    'review',
    [
      /\b(declare|state|name)\w*\b[^.;]{0,45}\bmandate\b|\bmandate\b[^.;]{0,45}\b(declared|stated|named)\b/i,
      // The mandate must reach the Log through the note command, not a private note.
      /\bmandate\b[^.;]{0,80}`?changeledger log`?|`?changeledger log`?[^.;]{0,80}\bmandate\b/i,
      /\bwithin\b[^.;]{0,45}\bmandate\b|\bmandate\b[^.;]{0,45}\bbounds?\b/i,
      /\boutside\b[^.;]{0,60}\bwithout\b[^.;]{0,45}\bexpand|\bwithout\b[^.;]{0,45}\bexpand\w*[^.;]{0,60}\boutside\b/i,
    ],
  ],
  [
    'deliverable prose executes the edge of a universal quantifier or narrows to what was observed',
    'implement.md',
    'implement',
    [
      // The gaps are wide because a reword mutant that led with the quantifier and
      // named the audience last put 105 characters between the two halves and
      // turned this guard red; `[^.;]` is what still holds the match to one
      // sentence, and the count is only a second fence.
      /\b(test comments?|Log notes?)\b[^.;]{0,140}\bquantif\w+|\bquantif\w+[^.;]{0,140}\b(test comments?|Log notes?)\b/i,
      // The edge is executed, and executed BEFORE the sentence exists: the ordering
      // is the obligation, so it stays inside the same bounded window.
      /\b(edge|falsif\w+)\b[^.;]{0,100}\b(execut\w+|run|ran)\b[^.;]{0,100}\bbefore\b|\bbefore\b[^.;]{0,100}\b(execut\w+|run|ran)\b[^.;]{0,100}\b(edge|falsif\w+)\b/i,
      /\bnarrow\w*\b[^.;]{0,60}\b(observed|incident|measured)\b|\b(observed|incident|measured)\b[^.;]{0,60}\bnarrow\w*/i,
    ],
  ],
  [
    'confirming a correction requires returning the change to in-review before the fresh reviewer is delegated',
    'implement.md',
    'implement',
    [
      // Both halves were run against the pre-edit fragment and were red there: the
      // gate's own `in-review` step is fenced off by the `1.` and `3.` list numbering,
      // whose periods close the `[^.;]` window before any of these words is reached.
      /\b(confirm\w*)\b[^.;]{0,90}\bin-review\b|\bin-review\b[^.;]{0,90}\b(confirm\w*)\b/i,
      // The return PRECEDES the delegation — the ordering is the obligation, so both
      // directions keep it inside one sentence.
      /\bin-review\b[^.;]{0,70}\bbefore\b[^.;]{0,60}\b(delegat\w+|reviewer)\b|\b(delegat\w+|reviewer)\b[^.;]{0,70}\bafter\b[^.;]{0,60}\bin-review\b/i,
    ],
  ],
  [
    'the reviewer treats an unexecuted universal quantifier as a defect, not as style',
    'review.md',
    'review',
    [
      /\b(universal\w*|quantif\w+)\b[^.;]{0,120}\b(edge|falsif\w+)|\b(edge|falsif\w+)\b[^.;]{0,120}\b(universal\w*|quantif\w+)/i,
      // Defect and style ride one window on purpose. A first draft split them and
      // matched the unrelated `fail --retry` line ("fixable defect inside the
      // authorized contract") instead of this clause: a half that a pre-existing
      // sentence already satisfies guards nothing.
      /\bdefect\b[^.;]{0,90}\b(not|never)\b[^.;]{0,40}\bstyle\b|\bstyle\b[^.;]{0,40}\bdefect\b/i,
    ],
  ],
  // 20260730-214503 CR2 — the first guard of the new regime `DELEGATION_OBLIGATIONS`
  // and `CLASSIFICATION_OBLIGATIONS` adopt above (`DRAFTING_OBLIGATIONS` directly
  // above still asserts the composed spec capture and is untouched): fragment-only
  // by construction, since there is no seat other than `review.md` for the
  // orchestrator to read this rule from before it delegates the confirmation
  // review. Co-traveller proof against `handoff.md` is therefore not required to
  // show the transport is safe — that is CR1's point — but it was run once anyway:
  // all four halves below are red against `handoff.md` alone, none of them
  // borrowing a match from that fragment's unrelated prose.
  [
    'a confirmation review fails only for the named defect left open or a regression the correction introduced, with anything latent or adjacent reported as a follow-up for the orchestrator to judge',
    'review.md',
    'review',
    [
      // Confirm paired with fail, and confirm paired with defect/regression,
      // rather than one three-token chain: a reword mutant reordered defect and
      // regression ahead of "confirmation", which a strict confirm-fail-defect
      // chain does not survive. Anchoring both halves on "confirm" (never on
      // "fail" alone) is deliberate — `fail --retry "<reason>"` — fixable
      // defect inside the authorized contract already pairs fail with defect a
      // few words apart, and a half that drops the confirm anchor would be
      // satisfied by that unrelated bullet instead of this sentence. `\bfail\w*\b`
      // rather than `\bfails?\b` so "failure"/"failing" reword the verb freely.
      /\bconfirm\w*\b[^.;]{0,100}\bfail\w*\b|\bfail\w*\b[^.;]{0,100}\bconfirm\w*\b/i,
      /\bconfirm\w*\b[^.;]{0,120}\b(defect|regression)\b|\b(defect|regression)\b[^.;]{0,120}\bconfirm\w*\b/i,
      /\b(latent|adjacent)\b[^.;]{0,60}\bfollow-?ups?\b|\bfollow-?ups?\b[^.;]{0,60}\b(latent|adjacent)\b/i,
      // Both orders of the closing clause: the shipped sentence reads
      // follow-up...orchestrator...judge, but "go to the orchestrator as
      // follow-ups for it to judge" reverses it to orchestrator...follow-up...judge.
      /\bfollow-?ups?\b[^.;]{0,60}\borchestrator\b[^.;]{0,30}\bjudg\w*\b|\borchestrator\b[^.;]{0,60}\bjudg\w*\b[^.;]{0,60}\bfollow-?ups?\b|\borchestrator\b[^.;]{0,60}\bfollow-?ups?\b[^.;]{0,30}\bjudg\w*\b/i,
    ],
  ],
];

for (const [label, owner, mode, patterns] of DELEGATION_OBLIGATIONS) {
  test(`165310: the ${mode} pack obliges that ${label}`, () => {
    const fragment = flattened(fs.readFileSync(new URL(owner, contractFragments), 'utf8'));
    for (const pattern of patterns) {
      assert.match(fragment, pattern, `${owner} no longer states the obligation: ${pattern}`);
    }
  });
}

// 20260722-124655 CR1/CR2/CR3 — the post-failure classification. Each row was
// guarded, until 20260730-214503, by the same double-evidence mechanism as the
// two tables above: the fragment that owns the obligation, and the composed
// capture that must carry it to the role that executes it. That change retired
// the composed half here too: the fragment's transport into its pack is already
// guarded by `234939 structural remnant: pack composition and owned headings`,
// and the composed half's real cost was exactly the co-traveller class recorded
// below — every new pattern having to be proved against every fragment riding
// the same pack. Each row now asserts only the fragment that owns the
// obligation.
//
// A third table rather than rows in `DELEGATION_OBLIGATIONS`: two of these three
// seats are status overlays, and `blocked` and `in-validation` compose per change
// id, not per mode, so the row carries a fixture status where that table carries a
// mode string. The `review` row rides here too, with its two siblings, because the
// three are one obligation split across three seats and a failure should read as
// such.
//
// Tolerant concept matches over flattened text, never the sentence. A half that a
// pre-existing sentence already satisfies guards nothing — the lesson the reviewer
// quantifier entry above records, whose first draft matched the unrelated
// `fail --retry` line. The co-traveller fragment was where that trap sprang again
// here: `handoff.md` composed into the review pack as well as the blocked overlay,
// and its "Before handing completed or blocked work to the human, classify
// friction" line satisfied a first draft of this row's ordering and seat halves in
// the composed capture while proving nothing about `review.md`. All fifteen patterns
// below were therefore run three ways before being kept — against `handoff.md`
// alone, against the pre-change fragment, and against the shipped prose — and all
// fifteen were red on the first two. Red on a whole pattern is red on each of its
// alternatives, so the mirrors inherited that evidence; on the shipped prose it is
// the joined half that has to be green, never every alternative, since a mirror
// exists for the reword and not for the wording that shipped.
//
// The ordering halves carry an `(after|once)` mirror because the `before` form alone
// died on three rewords a reviewer wrote and ran — "Decide with the human, having
// stopped first", "Choosing between `--block` and `--retry` comes after the finding
// has been classified", "Iteration begins only once the rejection has been
// classified". Those three were re-run against the patterns as kept and are green,
// and deleting the obligation sentence still fails the row it belongs to.
const CLASSIFICATION_OBLIGATIONS = [
  [
    'a diagnosed failure is classified by class before correction starts',
    'blocked.md',
    { status: 'blocked' },
    [
      // The classification PRECEDES the correction: the ordering is the obligation,
      // so it is written in four shapes — `before` and its `(after|once)` mirror,
      // each with the correction on either side. A `before`-only half died on a
      // reviewer's reword; see the note above.
      /\bclassif\w+[^.;]{0,70}\bbefore\b[^.;]{0,50}\b(correct\w+|fix\w*|iterat\w+)\b|\bbefore\b[^.;]{0,50}\b(correct\w+|fix\w*|iterat\w+)\b[^.;]{0,70}\bclassif\w+|\b(correct\w+|fix\w*|iterat\w+)\b[^.;]{0,60}\b(after|once)\b[^.;]{0,70}\bclassif\w+|\b(after|once)\b[^.;]{0,70}\bclassif\w+[^.;]{0,60}\b(correct\w+|fix\w*|iterat\w+)\b/i,
      // Both diagnosed failures enter the taxonomy, not the reviewer's verdict alone.
      /\b(verdict|fail\w*)\b[^.;]{0,60}\b(rejection|reject\w+)\b|\b(rejection|reject\w+)\b[^.;]{0,60}\b(verdict|fail\w*)\b/i,
      // First class: an incomplete enumeration inside a strategy already verified.
      /\benumerat\w+[^.;]{0,80}\b(verified|strategy)\b|\b(verified|strategy)\b[^.;]{0,80}\benumerat\w+/i,
      // Its correction sweeps the class, not the flagged instance.
      /\b(sweep\w*|covers?|spans?)\b[^.;]{0,50}\bclass\b|\bclass\b[^.;]{0,60}\b(instead|not|rather)\b[^.;]{0,40}\binstance\b/i,
      // And no round count closes it while the class holds — the retired counter's
      // design is exactly what this half keeps out.
      /\brounds?\b[^.;]{0,80}\b(class|holds?)\b|\b(class|holds?)\b[^.;]{0,80}\brounds?\b/i,
      // Second class: a new class of defect goes to the human, not to another retry.
      /\bnew\b[^.;]{0,30}\bclass\b|\bclass\b[^.;]{0,30}\bnew\b/i,
      // Stopping and deciding ride one window in both orders: the human may be
      // named before or after either verb, which a reviewer's reword proved.
      /\b(stop|halt|pause|decid|choos)\w*[^.;]{0,60}\bhuman\b|\bhuman\b[^.;]{0,60}\b(stop|halt|pause|decid|choos)\w*/i,
      // The exits stay an illustration instead of a closed enumeration.
      /\b(illustrat\w+|examples?|non-?exhaustive)\b[^.;]{0,70}\b(clos\w+|exhaust\w+|enumerat\w+)\b|\b(clos\w+|exhaust\w+)\b[^.;]{0,70}\b(illustrat\w+|examples?)\b/i,
    ],
  ],
  [
    'the finding is classified before the fail verdict is chosen, with the taxonomy left in the blocked seat',
    'review.md',
    { mode: 'review' },
    [
      /\bclassif\w+[^.;]{0,90}(--retry|--block)|(--retry|--block)[^.;]{0,90}\bclassif\w+/i,
      // Anchored to the verdict CHOICE, not to a bare `classif…before`: `handoff.md`
      // rides this pack and already says "Before handing … work to the human,
      // classify friction", which satisfied the bare form in the composed capture
      // while proving nothing about `review.md`. The dash forms carry no leading
      // `\b` on purpose — a backtick before `--retry` is not a word boundary, so a
      // `\b` there would make that alternative unreachable.
      /\bclassif\w+[^.;]{0,70}\bbefore\b[^.;]{0,60}(?:\bchoos\w+|\bselect\w+|\bverdict\b|--retry|--block)|(?:\bchoos\w+|\bselect\w+|\bverdict\b|--retry|--block)[^.;]{0,70}\b(after|once)\b[^.;]{0,60}\bclassif\w+/i,
      // Pointer, not a copy: the classes are attributed to the blocked SEAT, and the
      // seat is `blocked` immediately followed by its context — `handoff.md`'s
      // "blocked work to the human, classify" satisfied a looser first draft.
      /\bblocked\b[^.;]{0,25}\bcontext\b[^.;]{0,70}\b(owns?|class\w*|taxonom\w+)\b|\b(class\w*|taxonom\w+)\b[^.;]{0,70}\bblocked\b[^.;]{0,25}\bcontext\b/i,
    ],
  ],
  [
    'a human rejection is classified the same way before the implementation iterates',
    'validation.md',
    { status: 'in-validation' },
    [
      /\b(rejection|reject\w+)\b[^.;]{0,80}\bclassif\w+|\bclassif\w+[^.;]{0,80}\b(rejection|reject\w+)\b/i,
      // Same four shapes as the blocked row's ordering half: `before` and its
      // `(after|once)` mirror, with the iteration on either side.
      /\bclassif\w+[^.;]{0,90}\bbefore\b[^.;]{0,60}\b(iterat\w+|correct\w+|implement\w*)\b|\bbefore\b[^.;]{0,60}\b(iterat\w+|correct\w+)\b[^.;]{0,90}\bclassif\w+|\b(iterat\w+|correct\w+|implement\w*)\b[^.;]{0,60}\b(after|once)\b[^.;]{0,90}\bclassif\w+|\b(after|once)\b[^.;]{0,90}\bclassif\w+[^.;]{0,60}\b(iterat\w+|correct\w+|implement\w*)\b/i,
      // The same classification as a review verdict, so the two paths cannot drift.
      /\b(same|like|way)\b[^.;]{0,80}\bverdict\b[^.;]{0,40}\bclassif\w+|\bclassif\w+[^.;]{0,60}\b(same|like|way)\b[^.;]{0,60}\bverdict\b/i,
      // The seat, anchored exactly as the review row's pointer is: `blocked` followed
      // by its context. The looser form this replaces matched `handoff.md`'s "blocked
      // work to the human, classify" when run against that text alone — latent here,
      // since the in-validation overlay composes `validation` alone, but the review
      // row proved the same shape false-satisfying one seat over.
      /\bblocked\b[^.;]{0,25}\bcontext\b[^.;]{0,70}\b(owns?|class\w*|taxonom\w+)\b|\b(class\w*|taxonom\w+)\b[^.;]{0,70}\bblocked\b[^.;]{0,25}\bcontext\b/i,
    ],
  ],
];

for (const [label, owner, seat, patterns] of CLASSIFICATION_OBLIGATIONS) {
  const where = seat.mode ? `${seat.mode} pack` : `${seat.status} overlay`;
  test(`124655: the ${where} obliges that ${label}`, () => {
    const fragment = flattened(fs.readFileSync(new URL(owner, contractFragments), 'utf8'));
    for (const pattern of patterns) {
      assert.match(fragment, pattern, `${owner} no longer states the obligation: ${pattern}`);
    }
  });
}

// 20260730-214504 CR1 — the migration route from pre-existing Plan tasks and
// legacy task metadata/Log events to the current grammar, named in `spec.md`
// because that is the capture a consumer already has open when `check` reports
// the readiness errors those old shapes cause. Fragment-only, following the
// regime `20260730-214503` established above for `DELEGATION_OBLIGATIONS` and
// `CLASSIFICATION_OBLIGATIONS`: the fragment's transport into the composed
// `spec` pack is already proven by the structural-composition test, so no
// composed half is asserted here. A sibling table rather than a row inside
// `DELEGATION_OBLIGATIONS` — that table's loop still titles every test
// `165310: the ${mode} pack …`, and this obligation belongs to a different
// change; a row there would misattribute a failure to `165310` instead of the
// change that actually owns it.
//
// Tolerant halves, each anchored on a CLI flag token that grep confirms is
// unique to this sentence in `spec.md` (`--plan-tags`, `--structured-sections`,
// `--dry-run` appear nowhere else in the fragment), so a delete mutant has
// nothing coincidental left to match. Each half is written in both directions
// and was run, before being kept, against a reword mutant (different verbs and
// clause order, same meaning) and stayed green, and against the fragment with
// the sentence deleted and went red.
const MIGRATION_OBLIGATIONS = [
  [
    'pre-existing Plan tasks without structured children migrate with `fix --plan-tags`, legacy task metadata or Log events migrate with `fix --structured-sections`, and both are previewable with `--dry-run`',
    'spec.md',
    [
      /\bstructured\b[^.;]{0,30}\bchildren\b[^.;]{0,90}--plan-tags|--plan-tags[^.;]{0,90}\bstructured\b[^.;]{0,30}\bchildren\b/i,
      /\b(metadata|log)\b[^.;]{0,90}--structured-sections|--structured-sections[^.;]{0,90}\b(metadata|log)\b/i,
      /\bpreview\w*\b[^.;]{0,40}--dry-run|--dry-run[^.;]{0,40}\bpreview\w*\b/i,
    ],
  ],
];

for (const [label, owner, patterns] of MIGRATION_OBLIGATIONS) {
  test(`214504 CR1: the spec pack obliges that ${label}`, () => {
    const fragment = flattened(fs.readFileSync(new URL(owner, contractFragments), 'utf8'));
    for (const pattern of patterns) {
      assert.match(fragment, pattern, `${owner} no longer states the obligation: ${pattern}`);
    }
  });
}

// Every entry of the budget file, labelled. A new top-level group must widen this
// list, not slip past it: it is the single place the whole file is enumerated.
function budgetEntries() {
  assert.deepEqual(Object.keys(contextBudgets).sort(), ['agent', 'base', 'blocks', 'overlays']);
  const entries = [
    ...Object.entries(contextBudgets.base),
    ...Object.entries(contextBudgets.overlays).map(([status, budget]) => [
      `${status} overlay`,
      budget,
    ]),
    ...Object.entries(contextBudgets.blocks).map(([block, budget]) => [`${block} block`, budget]),
    ['agent', contextBudgets.agent],
  ];
  assert.ok(entries.length >= 11, `too few entries checked: ${entries.length}`);
  return entries;
}

// Every group `budgets.yml` declares today, by dotted path paired with its live
// value. Unlike `budgetEntries()` above (which only checks shape and today's
// fit), this is keyed by the actual nesting so a mutation names exactly which
// path moved: `base.spec`, `blocks.core-commits`, `overlays.discarded`.
function declaredCeilings() {
  const out = { agent: contextBudgets.agent };
  for (const [name, budget] of Object.entries(contextBudgets.base)) out[`base.${name}`] = budget;
  for (const [name, budget] of Object.entries(contextBudgets.overlays)) {
    out[`overlays.${name}`] = budget;
  }
  for (const [name, budget] of Object.entries(contextBudgets.blocks)) {
    out[`blocks.${name}`] = budget;
  }
  return out;
}

// 20260728-195445: the single place every declared ceiling is pinned by its
// literal value. `194233 CR1` only checks shape (two integers) and `170429
// CR4` only checks that today's content still fits — neither one catches a
// ceiling raised to make a failure go away, which is exactly what a ceiling
// exists to prevent. This object is the one sede: a new group widens it here,
// not in a second copy.
const PINNED_CEILINGS = {
  'base.core': { tokens: 4000, lines: 400 },
  'base.spec': { tokens: 2500, lines: 250 },
  'base.implement': { tokens: 2500, lines: 250 },
  'base.review': { tokens: 2500, lines: 250 },
  'base.release': { tokens: 2500, lines: 250 },
  agent: { tokens: 1250, lines: 125 },
  'overlays.blocked': { tokens: 1250, lines: 125 },
  'overlays.in-validation': { tokens: 1250, lines: 125 },
  'overlays.done': { tokens: 1250, lines: 125 },
  'overlays.discarded': { tokens: 1250, lines: 125 },
  'blocks.core-commits': { tokens: 1250, lines: 125 },
};

test('195445 CR1: every declared ceiling is pinned by value', () => {
  const declared = declaredCeilings();
  for (const [path, budget] of Object.entries(declared)) {
    const pinned = PINNED_CEILINGS[path];
    assert.ok(pinned, `${path} has no pinned value`);
    assert.equal(
      budget.tokens,
      pinned.tokens,
      `${path} tokens ceiling moved: expected ${pinned.tokens}, got ${budget.tokens}`,
    );
    assert.equal(
      budget.lines,
      pinned.lines,
      `${path} lines ceiling moved: expected ${pinned.lines}, got ${budget.lines}`,
    );
  }
});

test('195445 CR2: an entry the pin does not cover fails', () => {
  const declaredPaths = Object.keys(declaredCeilings()).sort();
  const pinnedPaths = Object.keys(PINNED_CEILINGS).sort();
  assert.deepEqual(
    declaredPaths,
    pinnedPaths,
    'budgets.yml and the pin disagree on which ceilings exist',
  );
});

// 20260728-212043 CR1: `lines` stops being a hand-typed editorial limit and
// becomes a transport bound derived from `tokens`, the only dimension that
// declares cost. Every one of the eleven entries is swept from the same
// `declaredCeilings()` this file already uses to pin values, so a new group
// widens both checks together and neither can drift from the other.
test('20260728-212043 CR1: every lines ceiling is exactly its tokens ceiling divided by ten', () => {
  const declared = declaredCeilings();
  for (const [path, budget] of Object.entries(declared)) {
    const expectedLines = Math.floor(budget.tokens / 10);
    assert.equal(
      budget.lines,
      expectedLines,
      `${path} lines ceiling is not derived from tokens: tokens=${budget.tokens} lines=${budget.lines} expected=${expectedLines}`,
    );
  }
  assert.equal(contextBudgets.base.core.lines, 400, 'base.core.lines must derive to 400');
});

// 20260728-212043 CR7: the token ceilings themselves are three decided values —
// core, contexts, everything else — not eleven independent numbers.
//
// 20260730-002908 removed the last exception: `base.spec` sat on a 3450 scaffold
// whose exit condition was the authoring pack's refactor, and that refactor landed,
// so spec now takes the same 2500 contexts share as the others. There is no scaffold
// key left in the file and no entry outside the three values — the loop below sweeps
// every context including spec, so a future widening cannot reintroduce a private
// number without failing here.
test('20260728-212043 CR7: token ceilings are the three decided values, with no scaffolded exception', () => {
  assert.equal(contextBudgets.base.core.tokens, 4000, 'core token ceiling moved');
  for (const context of ['spec', 'implement', 'review', 'release']) {
    assert.equal(contextBudgets.base[context].tokens, 2500, `${context} token ceiling moved`);
  }
  assert.equal(contextBudgets.agent.tokens, 1250, 'agent token ceiling moved');
  for (const [status, budget] of Object.entries(contextBudgets.overlays)) {
    assert.equal(budget.tokens, 1250, `${status} overlay token ceiling moved`);
  }
  assert.equal(
    contextBudgets.blocks['core-commits'].tokens,
    1250,
    'core-commits block token ceiling moved',
  );
  // No entry may carry a scaffold marker any more, and the file must not regrow the
  // word: an exception announced only in prose is how 3450 outlived its exit condition.
  for (const [path, budget] of Object.entries(declaredCeilings())) {
    assert.equal(budget.scaffold, undefined, `${path} declares a scaffold exception again`);
  }
  assert.doesNotMatch(
    fs.readFileSync(new URL('../templates/contract/budgets.yml', import.meta.url), 'utf8'),
    /scaffold/,
    'the budget file regrew a scaffold marker',
  );
});

// 20260728-170429 replaced the byte dimension with tokens: this criterion now
// reads against the two dimensions the budget file declares today.
test('194233 CR1: every budget entry declares one flat threshold per dimension', () => {
  for (const [label, budget] of budgetEntries()) {
    // 20260730-002908 removed the `base.spec` exception: the scaffold marker is gone
    // with the ceiling it excused, so every entry — spec included — declares exactly
    // the two dimensions and nothing else.
    assert.deepEqual(
      Object.keys(budget).sort(),
      ['lines', 'tokens'],
      `${label} does not declare exactly lines and tokens`,
    );
    assert.equal(Number.isInteger(budget.lines), true, `${label} lines is not an integer`);
    assert.equal(Number.isInteger(budget.tokens), true, `${label} tokens is not an integer`);
  }
});

test('194233 CR2: the threshold is measured in emitted lines', () => {
  const budget = { lines: 200, tokens: 4000 };
  // 200 emitted lines is `split('\n').length === 201` under the old convention:
  // the exact boundary the previous counting unit reported as an overflow.
  const atLimit = sizedOutput(200, 2000);
  assert.equal(atLimit.split('\n').length, 201);
  const exact = captureBudget(() => assertWithinBudget('core', atLimit, budget));
  assert.ok(!exact.thrown, `the exact limit threw: ${exact.thrown?.message}`);
  const over = captureBudget(() => assertWithinBudget('core', sizedOutput(201, 2000), budget));
  assert.ok(over.thrown, 'line overflow did not throw');
  assert.equal(over.thrown.name, 'AssertionError');
  assert.equal(over.thrown.message, 'core exceeds 200 lines: 201');
});

// 20260728-170429 replaced the byte dimension with tokens: the criterion keeps its
// shape — crossing the cost dimension's threshold fails — under the new unit.
test('194233 CR3: crossing the token threshold throws', () => {
  // Calibrated, never hardcoded: BPE merges make a character count a poor proxy
  // for a token count, so the boundary is measured off the synthetic output
  // instead of assumed from its length.
  const output = sizedOutput(50, 4000);
  const tokens = tokenCount(output);
  const exact = captureBudget(() => assertWithinBudget('core', output, { lines: 200, tokens }));
  assert.ok(!exact.thrown, `the exact token limit threw: ${exact.thrown?.message}`);
  const over = captureBudget(() =>
    assertWithinBudget('core', output, { lines: 200, tokens: tokens - 1 }),
  );
  assert.ok(over.thrown, 'token overflow did not throw');
  assert.equal(over.thrown.message, `core exceeds ${tokens - 1} tokens: ${tokens}`);
});

test('194233 CR4: no budget path warns, under the threshold or over it', () => {
  const budget = { lines: 200, tokens: 4000 };
  const under = captureBudget(() => assertWithinBudget('core', sizedOutput(199, 2000), budget));
  assert.ok(!under.thrown, `a compliant output threw: ${under.thrown?.message}`);
  assert.deepEqual(under.warnings, []);
  // Every real entry stays silent too, so no lenient branch survives anywhere.
  for (const [label, budget] of budgetEntries()) {
    const over = captureBudget(() =>
      assertWithinBudget(label, sizedOutput(budget.lines + 1), budget),
    );
    assert.ok(over.thrown, `${label} did not throw past its threshold`);
    assert.deepEqual(over.warnings, [], `${label} warned instead of failing`);
  }
  const source = fs.readFileSync(new URL('./budget-support.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /emitWarning/);
});

// Occupancy published in the BEGIN line: `lines:<n>/<limit>` as the last segment,
// so an agent reads how much of the ceiling it has spent without running anything.
function publishedOccupancy(text) {
  const begin = text.split('\n')[0];
  const match = begin.match(/— lines:(\d+)\/(\d+) =====$/);
  assert.ok(match, `BEGIN line publishes no occupancy — ${begin}`);
  return { lines: Number(match[1]), lineLimit: Number(match[2]) };
}

// 20260728-170429 retired the byte segment, so the published occupancy is the line
// dimension alone: the token ceiling never reaches a consuming repo.
test('194233 CR5: the BEGIN line publishes its line occupancy', () => {
  const root = repo();
  for (const [mode, budget] of Object.entries(contextBudgets.base)) {
    const composed = mode === 'core' ? buildContext(undefined, root) : buildContext(mode, root);
    const published = publishedOccupancy(composed);
    assert.equal(published.lineLimit, budget.lines, `${mode} publishes a foreign line limit`);
    assert.equal(
      published.lines,
      emittedLines(composed),
      `${mode} line occupancy is not the real size`,
    );
    // The real CLI stdout, not only the composed string.
    const cli = cliContext(root, mode === 'core' ? [] : [mode]);
    assert.equal(publishedOccupancy(cli).lines, emittedLines(cli));
  }
  // An unbounded change-id capture has no entry in budgets.yml, so it publishes
  // its exact count and invents no ceiling.
  const id = '20260727-194233';
  writeFillerChange(root, id, 10);
  const unbounded = buildContext(id, root);
  assert.equal(publishedLines(unbounded), emittedLines(unbounded));
  assert.doesNotMatch(unbounded.split('\n')[0], /\/\d+ =====$/);
});

// 20260728-170429: with bytes retired the published figure is the line count, and
// a wider figure cannot add a line — it stays on the same BEGIN line. So the
// criterion now demands exactness across the 3-to-4 digit crossing of that count.
test('194233 CR6: the published line count is exact across a power-of-ten crossing', () => {
  const budget = { lines: 2000, tokens: 400000 };
  // Calibrated, never hardcoded: measure the framing overhead on an empty body,
  // then sweep the fillers that place the total across the 999 → 1000 boundary and
  // demand the published figure equal the real size at every step, so the widening
  // digit cannot desynchronize the count.
  const overhead = emittedLines(frameSections('core', undefined, [''], budget));
  const boundary = 1000 - overhead;
  let crossed = false;
  for (let filler = boundary - 5; filler <= boundary + 5; filler += 1) {
    const framed = frameSections('core', undefined, ['y\n'.repeat(filler)], budget);
    const published = publishedOccupancy(framed);
    assert.equal(published.lines, emittedLines(framed), `desynced at filler ${filler}`);
    if (published.lines >= 1000) crossed = true;
  }
  assert.ok(crossed, 'the sweep never crossed the 1000-line boundary');
});

test('194233 CR7: assertWithinBudget has a single definition', () => {
  const suites = fs
    .readdirSync(fileURLToPath(new URL('.', import.meta.url)))
    .filter((name) => name.endsWith('.mjs'));
  // Anchored at line start so this very assertion, which names the helper inside
  // a string, cannot count itself as a definition.
  const definitions = suites.filter((name) =>
    /^(export )?function assertWithinBudget\(/m.test(
      fs.readFileSync(new URL(name, import.meta.url), 'utf8'),
    ),
  );
  assert.deepEqual(definitions, ['budget-support.mjs']);
  const agentSuite = fs.readFileSync(new URL('./agent-context.test.mjs', import.meta.url), 'utf8');
  assert.match(
    agentSuite,
    /import \{[^}]*assertWithinBudget[^}]*\} from '\.\/budget-support\.mjs'/,
  );
});

// 20260726-124835 — core is rewritten as a routing contract: what the human
// wants, and who does the work, both decided before any stage context is loaded.
// The composed core is the surface under test, since that is what an agent pays.
function composedCore() {
  return buildContext(undefined, repo()).replace(/\s+/g, ' ');
}

test('124835 CR1: core exposes the eleven blocks in the decided order', () => {
  const core = buildContext(undefined, repo());
  const blocks = [
    '# ChangeLedger — Core Contract',
    '## Classify intent before acting',
    "## Protect the orchestrator's context",
    '## Invariants',
    '## When no change is needed',
    '## Stage exit gates',
    '## Complexity ceiling',
    '## Commits',
    '## Lifecycle',
    '## Context modes',
    '## Operational discovery',
  ];
  const positions = blocks.map((block) => {
    const at = core.indexOf(`\n${block}\n`);
    assert.notEqual(at, -1, `core is missing the block ${block}`);
    return at;
  });
  assert.deepEqual(
    positions,
    [...positions].sort((a, b) => a - b),
    `core blocks are out of order: ${blocks}`,
  );
  // The two retired headings, and nothing else, leave the fragment.
  assert.doesNotMatch(core, /## Read complete context before acting/);
  assert.doesNotMatch(core, /## Files and delegation/);
  assert.equal(core.match(/^## /gm).length, blocks.length - 1);
});

// 20260730-002730: the identity sentences this criterion pinned are retired. The
// intent table survives whole — its rows are `| intent | first action |` cells, a
// routing structure rather than prose, and the mutant that swapped two rows' actions
// is exactly what they still catch. So is the retired persistent-truth wording.
test('124835 CR2/CR3: the intent table routes every observed intent', () => {
  const core = composedCore();
  assert.ok(core.includes('| Intent | First action |'));
  assert.ok(!core.includes("Documents under `.changeledger/` are ChangeLedger's persistent truth"));
  // Every observed intent routes to exactly one first action, asserted as the
  // whole `| intent | action |` row the way the work→owner table already is.
  // Checking the label and the action independently pinned neither pairing: a
  // mutant that swapped the actions of two rows kept this test green.
  for (const row of [
    '| asks, explores or wants understanding | answer from the repo: `changeledger search <terms>` before reading code |',
    '| reports a problem or asks for new work | conversation first, then `changeledger context spec` only once the human authorizes documenting it |',
    '| names a change or says "continue" | `changeledger context <id>` |',
    '| asks what is pending | `changeledger list --status <s>`, `--pending graduation`, `--pending archive` |',
    '| asks to review finished work | `changeledger context review` in a fresh clean context |',
    '| asks to release | `changeledger context release` |',
    '| requests an edit no change covers | ask the human: `quick` type or operational edit |',
    '| gives a verdict | transmit it with the lifecycle command; never infer one |',
  ]) {
    assert.ok(core.includes(row), `core is missing the intent row ${row}`);
  }
});

// 20260730-002730: the prose literals about context economy and model sizing are
// retired. What this criterion still owns is the work→owner table — rows, not
// sentences — and the portability sweep, which is the reason the criterion exists:
// the contract must never name a provider's catalogue.
test('124835 CR4/CR5: work is split by owner and no model catalogue is named', () => {
  const core = composedCore();
  for (const row of [
    '| Work | Owner |',
    '| reading or searching beyond ~3 files to answer one question | subagent |',
    // 20260729-111349 REPLACED: the row named "any implementation task", whose
    // quantifier pushed one delegation per Plan task. The obligation is preserved —
    // implementation work with its own verify command is still the subagent's — and
    // only the per-task quantifier is retired.
    '| implementation work with its own verify command | subagent |',
    '| independent review of finished work | subagent with a fresh clean context |',
    '| reading a change document, a spec or CLI output | orchestrator |',
    '| talking to the human, deciding scope, integrating results | orchestrator, never delegated |',
  ]) {
    assert.ok(core.includes(row), `core is missing the ownership row ${row}`);
  }
  // Tiers are relative on purpose: ChangeLedger runs on any host, so the contract
  // never names a provider's catalogue, which changes and is not portable.
  const lowered = core.toLowerCase();
  for (const vendor of [
    'claude',
    'opus',
    'sonnet',
    'haiku',
    'gpt',
    'gemini',
    'llama',
    'anthropic',
    'openai',
  ]) {
    assert.ok(!lowered.includes(vendor), `core names the model catalogue: ${vendor}`);
  }
});

// 20260730-002730 retired `124835 CR6/CR7`: all 38 of its entries were literal
// sentences of core.md's invariants, exit gates, ceiling and commits blocks. The
// carrier obligations among them are curated entries 2, 3, 4, 6 and 7; the rest
// rest on review, per the guard perimeter now declared in AGENTS.md.

// 20260730-002730: the 22 lifecycle/mode/discovery sentence pins are retired. The
// matrix's SHAPE is not prose and stays: exactly ten rows of owner+mechanism, so a
// transition that loses its owner column still fails here.
test('124835 CR8/CR9: the transition matrix keeps ten owner+mechanism rows', () => {
  const raw = buildContext(undefined, repo());
  const matrix = raw
    .slice(raw.indexOf('| Transition | Owner | Mechanism |'))
    .split('\n\n')[0]
    .split('\n')
    .slice(2);
  assert.equal(matrix.length, 10, `the transition matrix has ${matrix.length} rows, not 10`);
  for (const row of matrix) {
    assert.equal(row.split('|').length, 5, `matrix row is not owner+mechanism: ${row}`);
  }
});

test('124835 CR10: core stops carrying what it no longer governs', () => {
  const core = buildContext(undefined, repo());
  const normalized = core.replace(/\s+/g, ' ');
  const retired = [
    // Capture — the bootstrap owns it since 20260726-124834.
    'Running `changeledger context` is discovery, not compliance',
    'Capture the first invocation completely in one pass',
    'read through the `CHANGELEDGER CONTEXT END` line',
    'exceptional recovery',
    'new human message alone does not trigger a reload',
    // Regression guard only: 20260726-124833 already removed both.
    '--have',
    'rev:<hash>',
    // Tool operation and the delegation prompt contract — delegation.md owns them.
    // Trimmed by 20260730-002730 to the words that discriminate: `spec.md` legitimately
    // says "Files remain the source of truth and may be edited directly", so the longer
    // literal overlapped live fragment prose. "Files are" is core's retired wording alone.
    'Files are the source of truth',
    'CLI helpers are optional and preferred for error-prone operations',
    'Delegate only with a clear boundary and benefit',
    'ownership, expected output and integration criterion',
    "must not revert others' work",
    'Do not over-shard or overlap write surfaces without an explicit integration plan',
    "Size the model to the task's difficulty and risk",
    // Stage detail — implement, review and close own it. The in-validation stop
    // is NOT on this list: the 20260726-124835 amendment restored it to core,
    // because deciding whether to keep working is a core-only decision, so no
    // criterion may demand its absence (CR6 demands its presence).
    'commit the approved change document before code',
    'use a fresh clean-context reviewer before human validation',
    'changeledger graduate <id> --skip [reason]',
  ];
  for (const literal of retired) {
    assert.ok(!normalized.includes(literal), `core still carries ${literal}`);
  }
  // The END sentinel is emitted by the framing, so retiring the capture section
  // cannot cost the one line every consumer uses to prove the output is whole.
  assert.equal(core.trimEnd().split('\n').at(-1), END_LINE);
});

// 20260726-124835 CR11 — the rewrite pushed stage detail out of core, and this test
// proved every rule that left was still owned somewhere.
//
// 20260730-002730 retired it whole. The first pass kept its two `doesNotMatch` halves
// on the ground that anti-duplication is "independent of how either sentence is
// worded" — that claim was wrong, and measured wrong: rewording `core.md`'s live
// sentence leaves the pin over `spec.md` matching a string that exists nowhere, so it
// passes while forbidding nothing. An absence pin only guards something when the
// phrase is genuinely retired, which neither of these is. Second seats of the
// post-review rule and the rendered-view rule now rest on review.

// 20260727-194233 retired the target band: this criterion now reads against the
// single threshold, which is the same ceiling the strict target used to guard.
test('130728 CR4: the current core composition clears its threshold', () => {
  const root = repo();
  const budget = contextBudgets.base.core;
  const core = buildContext(undefined, root);
  const lines = emittedLines(core);
  const tokens = tokenCount(core);
  // Strictly below, not merely within: the gate must leave real headroom rather
  // than pass by sitting exactly on the ceiling.
  assert.ok(lines < budget.lines, `core is not below its line threshold: ${lines}/${budget.lines}`);
  assert.ok(
    tokens < budget.tokens,
    `core is not below its token threshold: ${tokens}/${budget.tokens}`,
  );
  // The 225213 CR6 sweep itself: every base pack clears its own threshold.
  const sweep = captureBudget(() => {
    for (const [mode, entry] of Object.entries(contextBudgets.base)) {
      assertWithinBudget(mode, mode === 'core' ? core : buildContext(mode, root), entry);
    }
  });
  assert.ok(!sweep.thrown, `the base sweep threw: ${sweep.thrown?.message}`);
});

// 20260726-124837 — commit behaviour gets a single seat. Committing happens in
// every phase (authoring, implementation, correction, closure), so core owns it
// and `implement.md` keeps only branch and worktree discipline. The composed
// packs are the surface under test, because that is what an agent actually reads.
function contractFragment(file) {
  return fs.readFileSync(new URL(`../templates/contract/${file}`, import.meta.url), 'utf8');
}

// The `## Commits` block as it occupies lines in the fragment: heading included,
// trailing blank separator excluded, so the count is what a reader would count.
function commitsBlockLines() {
  const lines = contractFragment('core.md').split('\n');
  const start = lines.indexOf('## Commits');
  assert.notEqual(start, -1, 'core.md has no `## Commits` block');
  let end = lines.findIndex((line, at) => at > start && line.startsWith('## '));
  if (end === -1) end = lines.length;
  while (end > start && lines[end - 1].trim() === '') end -= 1;
  return lines.slice(start, end);
}

test('124837 CR1: the attribution judgment is gone from the whole contract', () => {
  const root = repo();
  const judgment = 'later work could obscure attribution';
  for (const mode of [undefined, 'implement']) {
    assert.ok(
      !buildContext(mode, root).replace(/\s+/g, ' ').includes(judgment),
      `the ${mode ?? 'core'} pack still carries the attribution judgment`,
    );
  }
  // The whole contract, at every depth: the judgment could sit in a capsule
  // subfragment and this loop would never have opened the file.
  for (const file of contractFragmentNames()) {
    assert.ok(
      !contractFragment(file).replace(/\s+/g, ' ').includes(judgment),
      `${file} still carries the attribution judgment`,
    );
  }
});

// 20260730-002730 retired `124837 CR2 / 164620 CR1`: its six entries were literal
// sentences of core's `## Commits` block. The commit unit and the exactly-one baseline
// are curated entry 6; the granularity test itself rests on review.

// 20260730-002730: the five Git-rule presence pins are retired. The absence half —
// implement must carry no commit unit or message mechanics — is what this criterion
// decided, and it is anti-duplication, not a wording.
test('124837 CR3: implement carries no commit unit or message mechanics', () => {
  const root = repo();
  const implement = buildContext('implement', root).replace(/\s+/g, ' ');
  for (const literal of [
    'baseline commit',
    'one per completed Plan task',
    'lifecycle-only transition',
    'type(scope): description [#<id>]',
    'ChangeLedger: [#A] [#B]',
    'check --commits',
  ]) {
    assert.ok(!implement.includes(literal), `the implement pack still carries ${literal}`);
  }
});

// 20260730-002730 retired `124837 CR4`, `124837 CR5 / 164620 H4` and `124837 CR6`:
// each was a list of literal sentences from core's `## Commits` block — the message
// mechanics, the surviving combined-commit form and the staged-set rule. None of the
// three is among the twelve carrier obligations, so all three now rest on review.

// 20260728-212043: `base.core.lines` and the bootstrap's `head -400` literal in
// `src/contract.mjs` are now the same number by design, not a ceiling with a
// reserve above it — a reserve implied the `head` informed of size, which
// `170429` already rejected; the `END` sentinel is the only validity check.
// With equality neither can drift without the other moving too. The cut itself
// is parsed out of the published `REFERENCE` block rather than copied as a
// second literal, so the two can never diverge without this assertion's feet
// moving under it.
function bootstrapHeadCut(reference = REFERENCE) {
  const declared = reference.match(/head -(\d+)/);
  assert.ok(
    declared,
    'the published bootstrap declares no `head -<n>` cut for the core ceiling to equal',
  );
  return Number(declared[1]);
}

// A bootstrap that stopped declaring its cut is a real failure of this criterion —
// the ceiling would have nothing to equal — and it has to be reported as that. The
// parse destructures the match, so a REFERENCE without `head -<n>` destructured
// `null` and threw a TypeError about destructuring: a stack trace that names the
// expression and never the fact, which is the one thing a reader needs here.
test('194157 CR4: a bootstrap that declares no head cut is named, not destructured', () => {
  const withoutCut = REFERENCE.replace(/head -\d+/g, 'head');
  assert.doesNotMatch(withoutCut, /head -\d/, 'the stripped reference still declares a cut');
  assert.throws(() => bootstrapHeadCut(withoutCut), {
    name: 'AssertionError',
    message: /the published bootstrap declares no `head -<n>` cut/,
  });
});

test('124837 CR7 / 212043 CR2: the core pack line ceiling equals the bootstrap cut', () => {
  const core = buildContext(undefined, repo());
  assertWithinBudget('core', core, contextBudgets.base.core);
  // The `## Commits` block has its own named entry, so one section cannot quietly
  // eat the budget the whole pack shares.
  assertWithinBudget(
    'core-commits block',
    commitsBlockLines().join('\n'),
    contextBudgets.blocks['core-commits'],
  );
  // The two numbers are the same by design: base.core.lines can never diverge
  // from the bootstrap's head cut in either direction, or either a consuming
  // repo's capture truncates early (cut too low) or the declared ceiling stops
  // meaning what it claims (cut too high).
  const headCut = bootstrapHeadCut();
  assert.equal(
    contextBudgets.base.core.lines,
    headCut,
    `base.core.lines (${contextBudgets.base.core.lines}) must equal the bootstrap's head -${headCut} cut`,
  );
});

// 20260728-212043 CR5: the core pack is the one outlier in density — almost all
// tables, ~13.4 tokens per emitted line against ~10.3 for the rest — so with
// both ceilings now derived from the same floor of 10, the token ceiling has to
// be the one that runs out first. A density that fell back to the ~10 floor
// would mean the tokens ceiling stopped being the operative gate, which is the
// signal to raise the `head` cut deliberately rather than let lines silently
// take over as the limit.
test('20260728-212043 CR5: core density exceeds the derivation floor, so tokens gates before lines', () => {
  const core = buildContext(undefined, repo());
  const observedLines = emittedLines(core);
  const observedTokens = tokenCount(core);
  const density = observedTokens / observedLines;
  assert.ok(
    density > 10,
    `core density dropped to ${density.toFixed(2)} tokens per line — raise the head cut deliberately`,
  );
});

// Every obligation that left `implement.md` had to be provably rehomed. 20260730-002730
// retired the 14 pairs that proved it by literal sentence — that mapping was rewritten
// every time either wording moved, three times in three days. The retired wordings
// themselves stay swept: this is the class the decision keeps, and it is what proves the
// obligations really left rather than being duplicated.
test('124837 CR8: the wordings that left implement.md are gone from every fragment', () => {
  // Per-fragment, not a joined whole: a join can accidentally paste one fragment's
  // tail against the next one's head into an artefact match that no fragment
  // actually carries, and a joined failure cannot name which file to fix. Every
  // fragment, capsule subdirectories included: an obligation rehomed into a
  // capsule instead of really leaving is exactly what this must catch.
  const fragments = contractFragmentNames();
  for (const retired of [
    'Commit completed units',
    'Do not create a dedicated commit for a lifecycle-only transition',
    'Commit messages use the canonical shape',
  ]) {
    const holders = fragments.filter((name) =>
      contractFragment(name).replace(/\s+/g, ' ').includes(retired),
    );
    assert.deepEqual(holders, [], `a contract fragment still carries the retired "${retired}"`);
  }
});

// 20260728-170429 — the budget unit becomes tokens plus lines, and bytes go. The
// two dimensions do different jobs: tokens are the cost actually paid on every
// message, lines are the transport the bootstrap `head` has to cover. Bytes were a
// proxy that overstated whitespace ×6.6, so a capture that added no content could
// break its ceiling and a tight ceiling pushed normative prose out of a fragment.

// Byte measurement, as source text. The pattern escapes the `.` and the `(`, so
// its own source text does not match it: it cannot count itself as an occurrence.
const BYTE_MEASURE = /Buffer\.byteLength\(/;

// A measured size compared against a numeric literal — a ceiling written into the
// suite instead of read from the budget file. The left side has to be a
// measurement, so a loop bound is not swept: `emittedLines(...)`, `tokenCount(...)`,
// any `.length`, or the local names the suites measure into. Same self-exclusion:
// every alternative here is followed by `|` or `)`, never by a comparison, so the
// pattern's own source text does not match it.
const LITERAL_CEILING =
  /(?:emittedLines\([^)]*\)|tokenCount\([^)]*\)|\.length|\blines\b|\btokens\b|\bbytes\b)\s*<=?\s*\d/;

// Only the suites that measure a composed capture. `cli-bin.test.mjs` bounds the
// CLI root help, which is not a capture and has no entry in the budget file, so it
// is not in this class and this change does not own it.
const CAPTURE_SUITES = ['context.test.mjs', 'agent-context.test.mjs', 'budget-support.mjs'];

function suiteSource(name) {
  return fs.readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
}

test('170429 CR1: the budget is expressed in tokens and lines, never in bytes', () => {
  for (const [label, budget] of budgetEntries()) {
    // 20260730-002908: the `base.spec` scaffold exception is gone; see `194233 CR1`
    // and `212043 CR7`. Every entry declares exactly the two dimensions.
    assert.deepEqual(
      Object.keys(budget).sort(),
      ['lines', 'tokens'],
      `${label} does not declare exactly lines and tokens`,
    );
  }
  // The file as text, not only the parsed shape: no stray byte dimension survives.
  const raw = fs.readFileSync(
    new URL('../templates/contract/budgets.yml', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(raw, /bytes/, 'the budget file still declares a byte dimension');
  // No suite measures bytes at all any more, so none can compare them to a ceiling.
  const measuring = CAPTURE_SUITES.filter((name) => BYTE_MEASURE.test(suiteSource(name)));
  assert.deepEqual(measuring, [], 'a suite still measures bytes');
});

test('170429 CR2: the tokenizer is a devDependency pinned to an exact version', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const pinned = manifest.devDependencies?.[TOKENIZER_PACKAGE];
  assert.ok(pinned, `${TOKENIZER_PACKAGE} is not a devDependency`);
  // Exact, with no range: a BPE update must not silently move ten ceilings.
  assert.match(
    pinned,
    /^\d+\.\d+\.\d+$/,
    `${TOKENIZER_PACKAGE} is not pinned to an exact version: ${pinned}`,
  );
  assert.equal(
    manifest.dependencies?.[TOKENIZER_PACKAGE],
    undefined,
    'the tokenizer leaked into runtime dependencies, so every consuming repo would install it',
  );
  // No contract fragment gains the unit's declaration: a consuming repo inherits
  // the line ceiling its `head` needs, never a token ceiling only our tests apply.
  // The shared enumeration covers the versioned `agent-contexts/` and
  // `agent-prompts/` fragments too: they compose into agent capsules and ship to
  // consuming repos exactly like the top-level ones.
  const declaring = contractFragmentNames().filter((name) => /token/i.test(contractFragment(name)));
  assert.deepEqual(declaring, [], 'a contract fragment declares the token unit');
});

test('170429 CR3: no size ceiling lives hardcoded in a suite that measures a capture', () => {
  for (const name of CAPTURE_SUITES) {
    assert.doesNotMatch(
      suiteSource(name),
      LITERAL_CEILING,
      `${name} hardcodes a size ceiling instead of reading it from the budget file`,
    );
  }
  // The two absorbed orphans have named entries, so lowering either one fails the
  // gate with the entry in the message.
  assert.equal(Number.isInteger(contextBudgets.base.core.lines), true);
  assert.equal(Number.isInteger(contextBudgets.blocks['core-commits'].lines), true);
});

test('170429 CR4: every declared ceiling is met by today content', () => {
  const root = repo();
  const sweep = captureBudget(() => {
    for (const [mode, budget] of Object.entries(contextBudgets.base)) {
      const output = mode === 'core' ? buildContext(undefined, root) : buildContext(mode, root);
      assertWithinBudget(mode, output, budget);
    }
    let index = 0;
    for (const [status, budget] of Object.entries(contextBudgets.overlays)) {
      const id = writeRawChange(root, { id: `20260728-17042${index}`, status });
      index += 1;
      const base = buildContext(id, root).split('\n# Selected change')[0];
      assertWithinBudget(`${status} overlay`, base, budget);
    }
    assertWithinBudget(
      'core-commits block',
      commitsBlockLines().join('\n'),
      contextBudgets.blocks['core-commits'],
    );
  });
  assert.ok(!sweep.thrown, `a declared ceiling is not met today: ${sweep.thrown?.message}`);
  assert.deepEqual(sweep.warnings, [], 'a budget path warned instead of passing or failing');
});

test('170429 CR5: the BEGIN line publishes lines and nothing else', () => {
  const root = repo();
  const id = addChange(root, 'approved');
  const { version } = JSON.parse(
    fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  // Exact strings, never a partial match: a partial regex let the byte segment
  // survive unnoticed once already.
  const core = buildContext(undefined, root);
  assert.equal(
    core.split('\n')[0],
    `===== CHANGELEDGER CONTEXT BEGIN — mode: core — v${version} — lines:${emittedLines(core)}/${contextBudgets.base.core.lines} =====`,
  );
  for (const mode of ['spec', 'implement', 'review', 'release']) {
    const output = buildContext(mode, root);
    assert.equal(
      output.split('\n')[0],
      `===== CHANGELEDGER CONTEXT BEGIN — mode: ${mode} — v${version} — lines:${emittedLines(output)}/${contextBudgets.base[mode].lines} =====`,
    );
  }
  // A change-id capture embeds a document of any size, so it keeps publishing its
  // count with no ceiling at all.
  const byId = buildContext(id, root);
  assert.equal(
    byId.split('\n')[0],
    `===== CHANGELEDGER CONTEXT BEGIN — mode: implement — change: #${id} — v${version} — lines:${emittedLines(byId)} =====`,
  );
  for (const capture of [core, byId]) {
    assert.doesNotMatch(capture.split('\n')[0], /bytes:/);
    assert.doesNotMatch(capture.split('\n')[0], /tokens:/);
  }
  // The real CLI stdout, not only the composed string.
  assert.equal(cliContext(root, []).split('\n')[0], core.split('\n')[0]);
});

test('170429 CR2: the token count comes from the pinned reference tokenizer', () => {
  // The unit is not "what a model sees" but "tokens according to a pinned
  // tokenizer", so the count must be the tokenizer's and not a character proxy.
  assert.equal(tokenCount(''), 0);
  assert.equal(tokenCount('hello world'), 2);
  // A count no character heuristic reproduces: the ratio moves with the content.
  const dense = 'x'.repeat(400);
  assert.ok(tokenCount(dense) < dense.length, 'the count is a character count');
});

test('195445 CR3: the emitted-lines counter has a single home', () => {
  // `test/budget-support.mjs` must re-export the exact function
  // `src/commands/context.mjs` exports — not an equivalent local copy.
  assert.strictEqual(contextEmittedLines, emittedLines);
});

test('195445 CR4: the canonical counter counts a final line with no trailing newline', () => {
  assert.equal(contextEmittedLines('a\nb\n'), 2);
  assert.equal(contextEmittedLines('a\nb'), 2);
  assert.equal(contextEmittedLines(''), 0);
  assert.equal(contextEmittedLines('\n'), 1);

  // The core capture the CLI emits publishes, in its BEGIN line, the same
  // number the canonical counter returns for that same text.
  const root = repo();
  const core = buildContext(undefined, root);
  assert.equal(publishedLines(core), contextEmittedLines(core));
});

// 20260728-164620 — the commit unit becomes the change, not the Plan task. The
// per-task rule failed the granularity test core itself states (a Plan task is
// never reverted, referenced by id nor implemented apart), nothing verified it,
// and delegating a whole Plan made it unsatisfiable. Five classes replace four,
// and the implementation work lands before the review is delegated so
// `baseline..HEAD` is an artifact the orchestrator cannot edit afterwards.
// 20260729-111349: five classes are PRESERVED, and so is the ordering that closes
// the range. What is REPLACED is the Implementation class's quantifier — the unit is
// the resolved selection of work, with no fixed number per change — so the literal
// below is the class's new wording; `111349 CR1` owns the proof that the retired
// count left every fragment.
// 20260730-002730: the five class literals are retired — curated entry 6 guards the
// unit itself. The retired unit and its formula stay swept: that is the class the
// decision keeps, and it is what stops the per-task count coming back.
test('164620 CR1: the retired per-task unit and its formula stay out of core', () => {
  const core = composedCore();
  for (const retired of [
    '**Task**:',
    'one per completed Plan task',
    'n + 1',
    'n + 2',
    'never defer them and reconstruct mixed diffs at the end',
  ]) {
    assert.ok(!core.includes(retired), `core still carries the retired ${retired}`);
  }
});

// The ordering is a positional fact, not a wording, so it survives 20260730-002730 —
// with tolerant anchors, so rewording either step does not retarget the comparison.
test('164620 CR2: the implementation commit precedes the review delegation', () => {
  const root = repo();
  const core = composedCore();
  assert.ok(core.includes('`baseline..HEAD`'), 'core does not name the reviewable range');

  const implement = buildContext('implement', root).replace(/\s+/g, ' ');
  const commit = implement.search(/\bimplementation commits?\b[^.]{0,40}`changeledger commit`/i);
  const delegate = implement.search(/\bdelegat\w+\b[^.]{0,60}\breviewer\b/i);
  assert.notEqual(commit, -1, 'the ordered gate has no implementation commit step');
  assert.notEqual(delegate, -1, 'the ordered gate no longer delegates the review');
  assert.ok(
    commit < delegate,
    'the implementation commit must precede the review delegation in the ordered gate',
  );
  assert.ok(
    implement.includes('`baseline..HEAD`'),
    'the implement pack does not name the range the reviewer inspects',
  );
});

// 20260730-002730: the class declaration and review.md's two verdict sentences are
// retired as pins — curated entry 9 guards the correction obligation tolerantly. The
// anti-duplication half stays: review.md must not grow a second copy of the class.
test('164620 CR3: review.md does not duplicate the Correction class declaration', () => {
  const review = contractFragment('review.md').replace(/\s+/g, ' ');
  assert.ok(!review.includes('**Correction**'), 'review.md duplicates the class declaration');
});

// 20260730-002730: the mandatory-handoff sentence and its record-why duty are retired
// as pins. What stays is the retired multiplicity: the optional zero-or-one must not
// come back, which is the sweep class the decision keeps.
test('164620 CR4: the retired zero-or-one handoff multiplicity stays out of core', () => {
  const core = composedCore();
  assert.ok(
    !core.includes('**Handoff**: zero or one'),
    'core still declares the handoff as an optional zero-or-one',
  );
});

test('164620 CR6: the rewritten block and the core pack clear their declared ceilings', () => {
  // Both dimensions are read from the budget file; this criterion writes neither.
  const entry = contextBudgets.blocks['core-commits'];
  assert.deepEqual(Object.keys(entry).sort(), ['lines', 'tokens']);
  const sweep = captureBudget(() => {
    assertWithinBudget('core-commits block', commitsBlockLines().join('\n'), entry);
    assertWithinBudget('core', buildContext(undefined, repo()), contextBudgets.base.core);
  });
  assert.ok(!sweep.thrown, `a declared ceiling is not met: ${sweep.thrown?.message}`);
  assert.deepEqual(sweep.warnings, [], 'a budget path warned instead of passing or failing');
});

// 20260730-002730: the five window literals and the correction's five are retired.
// What stays is the anti-duplication claim — the stage fact must not be restated in
// core's taxonomy — the three retired false formulations, and the positional fact the
// correction actually rests on: the window spans two transitions because the in-review
// transition precedes the commit step.
test('164620 CR7: core does not duplicate the implement pack dirty-window declaration', () => {
  const block = commitsBlockLines().join('\n').replace(/\s+/g, ' ');
  for (const duplicated of ['changeledger status <id> in-progress', 'expected delta']) {
    assert.ok(
      !block.includes(duplicated),
      `the core commits block duplicates the dirty-window declaration: ${duplicated}`,
    );
  }
});

test('164620 CR7 correction: the three false formulations of the expected set stay gone', () => {
  const implement = buildContext('implement', repo()).replace(/\s+/g, ' ');
  for (const falsehood of [
    'that single path is the only expected delta',
    'any other modified path is what "unrelated changes" means here',
    'plus one `[status]` Log line',
  ]) {
    assert.ok(!implement.includes(falsehood), `the implement pack reintroduced ${falsehood}`);
  }
  // The count of `[status]` lines is a consequence of the installed gate order, not
  // an independent claim: the in-review transition is step 3 and the commit step 5,
  // so the window spans both transitions. Moving either one must revisit the prose.
  const transition = implement.indexOf('`changeledger status <id> in-review`');
  const commit = implement.search(/\bimplementation commits?\b[^.]{0,40}`changeledger commit`/i);
  assert.notEqual(commit, -1, 'the ordered gate has no implementation commit step');
  assert.ok(
    transition < commit,
    'the in-review transition no longer precedes the commit step, so the window no longer spans two transitions',
  );
});

// 20260728-164620 emptied the second form of the combined commit on the ground that with
// the change as the unit, every Plan task travelled in one commit by design.
// 20260729-111349 retired that ground — the unit is the resolved selection and the number
// of implementation commits is not fixed — and the conclusion survives on the opposite
// premise: each resolved selection is committed on its own, so separating Plan tasks is
// always possible and "several Plan tasks are inseparable" can never be the reason
// separation is impossible. The clause stays retired rather than left pinned, which is
// what the first pass did.
test('164620 H4/H5: the emptied combined-commit form and the stale unit sentence are gone', () => {
  // 20260730-002730: this criterion is a retirement, and both of its halves are
  // absence claims — the class the decision keeps. The two presence pins that had
  // been attached to them are retired.
  const core = composedCore();
  assert.ok(
    !core.includes('several Plan tasks are inseparable'),
    'core still offers inseparable Plan tasks as a reason to combine commits',
  );
  const implement = buildContext('implement', repo()).replace(/\s+/g, ' ');
  assert.ok(
    !implement.includes('they do not relax intermediate commits for already verified units'),
    'implement still promises not to relax intermediate commits, which the new unit removed',
  );
});

// 20260729-111349 — the commit unit is the RESOLVED SELECTION of work, not the whole
// change. `164620 CR1` translated a decision about DELEGATION into a rule about
// commits and added a quantifier nobody decided, "exactly one". The block's own
// granularity test never justified the jump it made: it applied the discriminant to a
// single Plan task, concluded correctly that a task alone fails it, and then landed on
// the whole change. Between the two sits the resolved selection, which passes the test
// — it reverts alone, and better than the change would. What is retired is the number,
// never the guarantee: the reviewable range stays closed because every selection is
// committed before the review is delegated (`111349 CR4`).
const RETIRED_COMMIT_COUNT_LITERALS = [
  '**Implementation**: exactly one',
  'never one per Plan task',
  'the change is the implementation unit',
  'a change yields two commits',
  'they all travel in the one implementation commit',
  'any implementation task',
];

test('111349 CR1/CR2/CR3/CR5: no fragment fixes the number of implementation commits', () => {
  // The shared enumeration reaches the `agent-contexts/` and `agent-prompts/`
  // fragments, which ship to consuming repos exactly like the top-level ones.
  const fragments = contractFragmentNames();
  assert.ok(fragments.length > 1, 'the fragment sweep found nothing to check');
  for (const retired of RETIRED_COMMIT_COUNT_LITERALS) {
    const holders = fragments.filter((name) =>
      contractFragment(name).replace(/\s+/g, ' ').includes(retired),
    );
    assert.deepEqual(holders, [], `a contract fragment still carries the retired "${retired}"`);
  }
  // 20260730-002730 retired the ten presence literals that stood here. This criterion
  // is a retirement of a count, and the recursive sweep above is what verifies it;
  // curated entry 6 guards the unit that replaced it.
});

// 20260730-002730 retired `111349 CR4`: both of its asserts pinned a sentence of core's
// `## Commits` block. The ordering it guarantees is still verified structurally by
// `164620 CR2`, which compares the commit step's position against the delegation step's.

// The graduated spec is the repo's persistent truth for this rule, and it carried the
// narrow formulation in Spanish.
//
// 20260730-002730 retired this test's presence pins. The decision retires phrase-level
// guards over every `.md` in the repo, and these pinned literal Spanish sentences of
// `.changeledger/specs/git-traceability.md` — the same class, in a file the change's own
// premise wrongly assumed had no tests. What survives is the absence half: the five
// superseded formulations, plus the two-formulation miscount, must never come back. That
// is the retired-phrase sweep the decision keeps, and it is also what still holds when
// the surrounding prose is rewritten.
function graduatedGitSpec() {
  return fs
    .readFileSync(new URL('../.changeledger/specs/git-traceability.md', import.meta.url), 'utf8')
    .replace(/\s+/g, ' ');
}

test('111349 CR6: the graduated spec regrows no superseded commit formulation', () => {
  const spec = graduatedGitSpec();
  for (const falsehood of [
    '**La unidad de commit es el change, y las clases son contables.**',
    '**Implementation**, exactamente uno con el trabajo completo del change',
    'así que el change es la unidad de implementación',
    'un change produce **dos** commits',
    'todas viajan en el único commit de implementación',
    // Three retired formulations, not two: a spec that counts only two has dropped the
    // fixed per-change count from the list and left it free to return as a rediscovery.
    'Dos formulaciones anteriores quedaron retiradas',
  ]) {
    assert.ok(!spec.includes(falsehood), `the graduated spec still states "${falsehood}"`);
  }
});

// 20260729-111349 CR7 — `implement.md` was the fragment that survived the first pass of
// this change and went on contradicting core in four places, step 5 of its ordered gate
// worst of all: "Create the one implementation commit with `changeledger commit`". The
// reason it survived is the reason the whole class survives in this repo: every guard
// watched `core.md` alone. This one reads the directory and sweeps every fragment,
// `agent-contexts/` and `agent-prompts/` capsules included, so reintroducing the single
// commit anywhere fails.
test('111349 CR7: no fragment demands one implementation commit per change', () => {
  const fragments = contractFragmentNames();
  // The sweep's own reach is asserted, not assumed: a guard that silently stopped
  // covering the seat the defect lived in would pass while proving nothing.
  assert.ok(fragments.length > 1, 'the fragment sweep found nothing to check');
  for (const seat of ['core.md', 'implement.md', 'agent-contexts/implementation.md']) {
    assert.ok(fragments.includes(seat), `the sweep does not reach ${seat}`);
  }
  // The broader literal subsumes the exact one CR7 measures; both are listed so the
  // failure message names what came back.
  for (const singular of ['the one implementation commit', 'one implementation commit']) {
    const holders = fragments.filter((name) =>
      contractFragment(name).replace(/\s+/g, ' ').includes(singular),
    );
    assert.deepEqual(holders, [], `a contract fragment still demands "${singular}"`);
  }
  // 20260730-002730: the three plural pins and the eight-literal preserved-window list
  // are retired. The single-seat half stays — implement must not restate core's timing
  // rule — because it is anti-duplication, not a wording, and it is the claim 124837
  // closed when it made core the only home of every commit rule.
  const implement = buildContext('implement', repo()).replace(/\s+/g, ' ');
  assert.ok(
    !implement.includes('each resolved selection is committed as it resolves'),
    "the implement pack restates core's commit-timing rule instead of pointing at it",
  );
});

// 20260729-143656 correction: the retired hash-pin map covered two things no
// remaining guard did — the retired phrase surviving anywhere in the recursive
// tree, and the fragment inventory itself. `124837 CR1`/`164620 CR1` only ever
// swept `composedCore()`, so `implement.md` (not composed into core) was never
// checked; and no test pinned the file list, so a new fragment passed silently.
test('143656 CR4: retired phrases stay retired recursively and the fragment inventory is pinned', () => {
  const fragments = contractFragmentNames();
  const retired = 'reconstruct mixed diffs';
  const holders = fragments.filter((name) =>
    contractFragment(name).replace(/\s+/g, ' ').includes(retired),
  );
  assert.deepEqual(holders, [], `a contract fragment still carries the retired "${retired}"`);

  // The exact top-level inventory, read from today's tree: a new fragment must
  // widen this list, not slip past it. Derived from the same shared enumeration as
  // the sweep above, so these pinned lists are also that enumeration's reach test:
  // a helper that stopped seeing a directory fails here with the names it lost.
  const groupOf = (name) => (name.includes('/') ? name.slice(0, name.indexOf('/') + 1) : '');
  const inventory = (group) =>
    fragments.filter((name) => groupOf(name) === group).map((name) => name.slice(group.length));
  const topLevel = inventory('');
  assert.deepEqual(topLevel, [
    'blocked.md',
    'close.md',
    'core.md',
    'delegation.md',
    'discarded.md',
    'handoff.md',
    'implement.md',
    'readiness.md',
    'release.md',
    'review.md',
    'spec.md',
    'validation.md',
  ]);

  // Same guard for the two composed capsule subdirectories.
  const agentContexts = inventory('agent-contexts/');
  assert.deepEqual(agentContexts, [
    'implementation.md',
    'investigation.md',
    'post-review.md',
    'review.md',
  ]);
  const agentPrompts = inventory('agent-prompts/');
  assert.deepEqual(agentPrompts, [
    'implementation.md',
    'investigation.md',
    'post-review.md',
    'review.md',
  ]);

  // The three groups above are asserted complete, not just individually present:
  // without this, a fourth first-path-segment directory drops out of every
  // inventory silently instead of failing with the group's own name.
  const groups = [...new Set(fragments.map(groupOf))].sort();
  assert.deepEqual(groups, ['', 'agent-contexts/', 'agent-prompts/']);
});

// 20260729-162015 — the delegation doctrine has a single seat, and core is it.
//
// 20260730-002730 retired the inverse-direction pin and the three unit-definition
// clauses: all four were literal sentences of `core.md`, and the single-seat rule in
// both directions is curated entry 10, which guards the same obligation tolerantly.
// What stays is the one-definition-not-two claim, which is anti-duplication.
test('162015 CR3/CR4: delegation.md points at the unit instead of redefining it', () => {
  const delegation = contractFragment('delegation.md').replace(/\s+/g, ' ');
  assert.doesNotMatch(delegation, /A good delegation unit is/);
});

// 20260730-002730 retired `162015 CR5`: it pinned the eight evidence-contract clauses
// verbatim in three packs at once — 24 literal-sentence asserts, the single densest
// retarget cost in the suite. Curated entry 11 replaces it: the section must reach spec
// and implement with its full set of obligations, and the reviewer clauses must reach
// review and not implement, both verified by structure rather than by wording.

// ---------------------------------------------------------------------------
// 20260729-002730 CR2 — the curated concept guard.
//
// The phrase-level pins over `templates/contract/` prose are retired: every one of
// them charged a retarget, a mutant and review scrutiny to each rewrite of a
// sentence, and that cost is what the decision removes. Twelve carrier obligations
// keep a guard anyway, because losing one in silence is a different failure class
// from rewording one (finding 38: normative prose lost with nothing noticing, three
// times, exploit proven live).
//
// Each entry matches by CONCEPT, never by sentence: ordered keyword groups with
// alternations and bounded gaps, over whitespace-flattened text. The bound is what
// keeps a match inside one sentence; the alternations are what let the sentence be
// rewritten. Deleting the obligation from its fragment fails the entry with a
// message naming what was lost; rewording it while keeping the obligation does not.
//
// One `test()` per entry, never a loop with twelve assertions: a loop's first
// failure aborts the rest, so eleven obligations could be lost while one reported.
const CONCEPT_GUARDS = [
  {
    entry: 1,
    obligation: 'the human intent is classified before acting, on every message',
    verify: (pack) => {
      assert.match(
        pack('core'),
        /\b(classif\w+|identif\w+|determin\w+|read\w*)\b[^.;]{0,40}\bintent\b[^.;]{0,70}\b(every|each|any)\b[^.;]{0,25}\bmessages?\b/i,
        'core no longer obliges classifying the human intent on every message',
      );
      assert.match(
        pack('core'),
        /\|\s*Intent\s*\|\s*First action\s*\|/,
        'core no longer routes intent to a first action',
      );
    },
  },
  {
    entry: 2,
    obligation: 'authorization gates artifact creation, and a draft is never executed',
    verify: (pack) => {
      assert.match(
        pack('core'),
        /\b(no|not|never)\b[^.;]{0,30}\bartifacts?\b[^.;]{0,50}\bhuman\b[^.;]{0,30}\bauthoriz/i,
        'core no longer forbids creating an artifact without human authorization',
      );
      assert.match(
        pack('core'),
        // Both voices: "never implement a draft" and "a draft is never implemented".
        /\bnever\b[^.;]{0,30}\bimplement\w*\b[^.;]{0,30}`?drafts?`?|`?drafts?`?[^.;]{0,30}\b(never|not)\b[^.;]{0,30}\bimplement/i,
        'core no longer forbids implementing a draft',
      );
    },
  },
  {
    entry: 3,
    obligation: 'a verdict reaches the ledger by transmission, never by deduction',
    verify: (pack) => {
      assert.match(
        pack('core'),
        /\bverdicts?\b[^.;]{0,55}\b(never|not)\b[^.;]{0,30}\binferr?/i,
        'core no longer forbids inferring a human verdict instead of transmitting it',
      );
    },
  },
  {
    entry: 4,
    obligation: 'work is serialized to a single change, off the default branch',
    verify: (pack) => {
      assert.match(
        pack('core'),
        /\bone\b\s+\bchange\b[^.;]{0,30}\bat\s+a\s+time\b/i,
        'core no longer limits work to one change at a time',
      );
      assert.match(
        pack('core'),
        /\bnon-?main\b|\b(not|never)\b[^.;]{0,25}`?main`?\s*branch/i,
        'core no longer requires a non-main branch',
      );
    },
  },
  {
    entry: 5,
    obligation: '`approve` judges the draft at `approved` severity and refuses an unready one',
    verify: (pack) => {
      assert.match(
        pack('spec'),
        /`?changeledger approve`?[^.:;]{0,90}\b(stricter|strict|approved|higher)\b[^.:;]{0,40}\bseverity\b/i,
        'the readiness pack no longer makes `approve` judge the draft at the stricter severity',
      );
      assert.match(
        pack('spec'),
        /\bunready\b[^.:;]{0,30}\bdraft\b[^.:;]{0,40}\b(refused|rejected|refuses)\b/i,
        'the readiness pack no longer refuses an unready draft',
      );
    },
  },
  {
    entry: 6,
    obligation: 'the resolved selection is the commit unit, with a single baseline',
    verify: (pack) => {
      assert.match(
        pack('core'),
        /\bimplementation\b[^.;]{0,55}\bresolved\b[^.;]{0,25}\bselection\b/i,
        'core no longer makes the resolved selection the implementation commit unit',
      );
      assert.match(
        pack('core'),
        /\bbaseline\b[^.;]{0,45}\bexactly\s+one\b|\bexactly\s+one\b[^.;]{0,45}\bbaseline\b/i,
        'core no longer requires exactly one baseline commit',
      );
    },
  },
  {
    entry: 7,
    obligation: 'the human owns the human lifecycle transitions',
    verify: (pack) => {
      // Owner cells, not prose: whoever rewrites the surrounding text, these two
      // arcs must still be attributed to the human in the transition matrix.
      for (const arc of [/draft\s*→\s*approved/, /in-validation\s*→\s*done/]) {
        const row = pack('core')
          .split('|')
          .map((cell) => cell.trim());
        const at = row.findIndex((cell) => arc.test(cell));
        assert.notEqual(at, -1, `the transition matrix no longer carries ${arc}`);
        assert.equal(
          row[at + 1],
          'human',
          `the transition matrix no longer gives the human ${arc} — owner is "${row[at + 1]}"`,
        );
      }
    },
  },
  {
    entry: 8,
    obligation:
      'the local gate runs before `in-review`, and the reviewer is fresh, clean and read-only',
    verify: (pack) => {
      const implement = pack('implement');
      const gate = implement.search(/\bapply\b[^.]{0,30}\bformatter\b/i);
      const transition = implement.indexOf('`changeledger status <id> in-review`');
      assert.notEqual(gate, -1, 'the implement pack no longer runs a local gate');
      assert.notEqual(
        transition,
        -1,
        'the implement pack no longer names the in-review transition',
      );
      assert.ok(
        gate < transition,
        'the local gate no longer precedes the in-review transition in the ordered gate',
      );
      assert.match(
        pack('review'),
        /\bfresh\b[^.;]{0,40}\bclean\b[^.;]{0,20}\bcontext\b/i,
        'the review pack no longer requires a fresh clean-context reviewer',
      );
      assert.match(
        pack('review'),
        /\b(read-only|reports?)\b[^.;]{0,80}\bnever\b[^.;]{0,40}\bverdict\b/i,
        'the review pack no longer keeps the reviewer read-only, reporting but not recording',
      );
    },
  },
  {
    entry: 9,
    obligation: 'a correction is withheld from history pending fresh confirmation',
    verify: (pack) => {
      assert.match(
        pack('implement'),
        /\bcorrection\b[^.;]{0,50}\b(uncommitted|not committed|without a commit)\b[^.;]{0,70}\b(fresh|human|confirms?|reviewer)\b/i,
        'the implement pack no longer keeps a correction uncommitted until it is confirmed',
      );
    },
  },
  {
    entry: 10,
    obligation: 'the single-seat rule binds core and overlay symmetrically',
    verify: (pack) => {
      assert.match(
        pack('core'),
        /\bcore\b[^.;]{0,30}\bnever\b[^.;]{0,25}\b(duplicat\w+|repeat\w+|restat\w+)/i,
        'core no longer says core never duplicates the stage overlay',
      );
      assert.match(
        pack('core'),
        /\boverlay\b[^.;]{0,100}\bwithout\b[^.;]{0,45}\b(repeating|restating|duplicating)\b[^.;]{0,35}\bcore\b/i,
        'core no longer says an overlay never repeats or contradicts core — the inverse direction',
      );
    },
  },
  {
    entry: 11,
    obligation: 'the evidence contract reaches implement as a whole section',
    verify: (pack) => {
      // 20260730-002908 moved the block from `delegation.md` to `implement.md`: the
      // author does not execute the evidence contract, so the spec pack no longer
      // serves it and this entry demands it in `implement` alone. Both directions
      // are asserted — present in implement, absent from spec — so the move cannot
      // be undone in either direction without a failure naming which way it went.
      //
      // The SECTION, not its clauses: the lead-in plus the count of obligations it
      // introduces. Rewording any clause is free; dropping one is not.
      const leadIn =
        /\b(every|each)\b\s+prompt\b[^.;]{0,70}\b(obligations?|clauses?|standards?)\b[^.;]{0,20}:/i;
      const implement = pack('implement');
      const at = implement.search(leadIn);
      assert.notEqual(
        at,
        -1,
        'the implement pack no longer introduces the implementer evidence contract as a section',
      );
      // Counted inside the section alone, bounded by the next heading: counting to the
      // end of the pack let the list items of every following fragment stand in for the
      // clauses, so dropping one survived. Proven with a mutant, not assumed.
      const tail = implement.slice(at);
      const nextHeading = tail.search(/\s#{1,3}\s/);
      const section = nextHeading === -1 ? tail : tail.slice(0, nextHeading);
      const clauses = section.split(/\s-\s/).length - 1;
      assert.ok(
        clauses >= 8,
        `the implement pack's evidence contract lists ${clauses} obligations, fewer than the eight it must carry`,
      );
      assert.doesNotMatch(
        pack('spec'),
        leadIn,
        'the spec pack regrew the implementer evidence contract the author never executes',
      );
      // The reviewer clauses ride review.md, and must not leak into implement.
      assert.match(
        pack('review'),
        /\bclaims?\b[^.;]{0,50}\b(confirmed|verified)\b[^.;]{0,60}\b(reasoned|inferred|deduced)\b/i,
        'the review pack no longer makes the reviewer mark claims as run or reasoned',
      );
    },
  },
  {
    entry: 12,
    obligation: 'the Plan task grammar teaches all four structured children',
    verify: (pack) => {
      for (const child of ['**Target:**', '**Verify:**', '**Criteria:**', '**Support:**']) {
        assert.ok(
          pack('spec').includes(child),
          `the spec pack no longer teaches the ${child} task child`,
        );
      }
      assert.match(
        pack('spec'),
        /\bchildren\b[^.;:]{0,50}\b(trace|traceability)\w*\b|\b(trace|traceability)\w*\b[^.;:]{0,50}\bchildren\b/i,
        'the spec pack no longer ties the structured children to traceability',
      );
    },
  },
];

for (const { entry, obligation, verify } of CONCEPT_GUARDS) {
  test(`002730 CR2 concept guard ${entry}: ${obligation}`, () => {
    const root = repo();
    const cache = new Map();
    const pack = (mode) => {
      if (!cache.has(mode)) {
        cache.set(mode, flattened(buildContext(mode === 'core' ? undefined : mode, root)));
      }
      return cache.get(mode);
    };
    verify(pack);
  });
}
