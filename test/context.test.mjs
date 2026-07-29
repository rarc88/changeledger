import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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

- [ ] Update \`src/example.mjs\`; verify: \`node --test test/example.test.mjs\` (CR1)

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

- [ ] Update \`src/x.mjs\`; verify: \`node --test test/x.test.mjs\` (CR1)

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
    '- [ ] Update `src/example.mjs`; verify: `node --test test/example.test.mjs` (CR1)',
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
  // 20260726-124835: making and verifying the FIRST capture belongs to the
  // bootstrap, so core is asserted on what it now owns — routing by intent,
  // context economy, and that every capture it hands out is read complete.
  assert.match(first, /Work is documented before code/);
  assert.match(first, /Every context capture is read\s+complete in one pass/);
  assert.match(first, /a partial view is\s+invalid/);
  assert.match(first, /Classifying the human's intent is free and mandatory on every message/);
  assert.match(first, /never load one speculatively and never reload one\s+already held/);
  assert.match(first, /Escalate to a mode before acting/);
  assert.match(first, /If no approved or in-progress change applies/);
  assert.match(first, /ask the human whether a purely operational,\s+reversible edit/);
  assert.match(first, /If unsure, document\s+it in ChangeLedger/);
  assert.match(first, /implement,? review,? spec,? release|context implement/);
  assert.match(first, /extends the core\s+context already read;\s+it never repeats it/);
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

test('234939 CR1-CR10: restored invariants stay in their owning contexts', () => {
  const root = repo();
  const blockedId = addChange(root, 'blocked', '20260629-230001');
  const validationId = addChange(root, 'in-validation', '20260629-230002');
  const reviewId = addChange(root, 'in-review', '20260629-230003');
  const outputs = {
    core: buildContext(undefined, root),
    spec: buildContext('spec', root),
    implement: buildContext('implement', root),
    review: buildContext(reviewId, root),
    reviewDelegate: buildAgentContext('review', reviewId, root),
    blocked: buildContext(blockedId, root),
    validation: buildContext(validationId, root),
  };
  const normalized = Object.fromEntries(
    Object.entries(outputs).map(([context, output]) => [context, output.replace(/\s+/g, ' ')]),
  );
  const invariants = [
    // 20260726-124835: core stopped carrying file/CLI operating detail and the
    // delegation-prompt summary. What core still owns is the routing decision;
    // the prompt contract itself is asserted where delegation.md composes.
    ['core', /Every stage overlay is the authority for its stage; core never duplicates it/],
    ['core', /Reading code and writing code are the two heaviest consumers/],
    ['core', /the stage context owns what the prompt must contain/],
    [
      'spec',
      /The boundary must state what the delegate owns, what it returns and how the result integrates/,
    ],
    ['spec', /do not revert others' edits and report overlapping changes/],
    ['spec', /Do not create one subagent per file, line or tiny mechanical edit/],
    ['spec', /Use the strongest available models for ambiguous scope/],
    ['spec', /Keep each fact in one stage and link to it from the others/],
    [
      'spec',
      /For bugs, Investigation contains the root cause; for audits, it is the core analysis/,
    ],
    ['spec', /Proposal includes the chosen solution, discarded alternatives and scenarios/],
    ['spec', /use a Mermaid block and keep its text as the source/],
    // 20260711-160446: the delegation prompt contract requires the expected
    // baseline (branch or commit) for roles that write, in both packs that
    // compose delegation.md.
    [
      'spec',
      /for roles that write, the expected baseline \(branch or commit\) the delegate must verify/,
    ],
    [
      'implement',
      /for roles that write, the expected baseline \(branch or commit\) the delegate must verify/,
    ],
    ['implement', /ask the human whether to stash, commit, ignore or include them/],
    ['implement', /keep the correction uncommitted until the human confirms it/],
    ['implement', /Do not start another task or change while a correction waits/],
    [
      'implement',
      /After human acceptance, graduate or record a skip and include correction plus ledger in the final closure commit/,
    ],
    ['reviewDelegate', /Deep security, SAST and lint belong to dedicated tools/],
    ['reviewDelegate', /ChangeLedger does not reimplement them/],
    ['review', /run `changeledger context <id>` before modifying implementation/],
    ['blocked', /run `changeledger context <id>` before modifying implementation/],
    ['validation', /run `changeledger context <id>` before modifying implementation/],
  ];

  for (const [context, pattern] of invariants) {
    assert.match(normalized[context], pattern, `${context} is missing ${pattern}`);
  }

  const contractDir = new URL('../templates/contract/', import.meta.url);
  const fragments = Object.fromEntries(
    fs
      .readdirSync(contractDir)
      .filter((file) => file.endsWith('.md'))
      .map((file) => [
        file,
        fs.readFileSync(new URL(file, contractDir), 'utf8').replace(/\s+/g, ' '),
      ]),
  );
  // 20260726-124835: both rules left core.md, so they are asserted against the
  // equivalent wording delegation.md already owned, plus a retirement guard so
  // core cannot quietly grow a second copy of either one.
  assert.match(
    fragments['delegation.md'],
    /Do not create one subagent per file, line or tiny mechanical edit/,
  );
  assert.match(
    fragments['delegation.md'],
    /Use the strongest available models for ambiguous scope/,
  );
  assert.doesNotMatch(fragments['core.md'], /Do not over-shard or overlap write surfaces/);
  assert.doesNotMatch(fragments['core.md'], /Size the model to the task's difficulty and risk/);
  assert.match(
    fragments['delegation.md'],
    /parallel agents over the same files or conceptual surface/,
  );

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
    // 225213 CR5: the effective TDD rule now rides the policy header + implement
    // pack; the full Definition of Ready authoring detail is spec-owned only.
    assert.match(resumed, /Effective policy:.*tdd=(on|off)/);
    assert.doesNotMatch(resumed, /# Definition of Ready/);
  }
  assertWithinBudget('core', outputs.core, contextBudgets.base.core);
});

test('234939 CR11-CR20: dynamic packs retain the operational contract', () => {
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
  const normalized = Object.fromEntries(
    Object.entries(outputs).map(([context, output]) => [context, output.replace(/\s+/g, ' ')]),
  );
  const expected = [
    // 20260726-124835: the persistent-truth sentence, the conversation-first
    // rule and the authorization rule are restated by the rewritten identity and
    // invariants; the graduation command moved to the overlay that owns it, so
    // core keeps only the trigger and the owner. Its amendment keeps the
    // in-validation stop in core, repointed to the restored wording.
    [
      'core',
      /Work is documented before code: changes under `.changeledger\/changes\/` are authorized work/,
    ],
    ['core', /No artifact without explicit human authorization/],
    ['core', /never invent missing requirements/],
    ['core', /only once the human authorizes documenting it/],
    ['core', /Never implement a `draft`/],
    ['core', /It stops only that change/],
    ['core', /A human verdict is transmitted, never inferred/],
    ['core', /reload `changeledger context <id>`/],
    ['core', /the close overlay owns graduation and archive/],
    ['core', /`discarded` never reopens/],
    ['core', /A `done` change can reopen only to finish its original scope/],
    ['spec', /changeledger new <type> <slug> "<title>"/],
    ['spec', /One concern per change/],
    ['spec', /unrelated concerns.*separate changes/],
    ['spec', /materially expands observable scope.*explicit human authorization/],
    ['spec', /changeledger check \[id\]/],
    ['spec', /2026-06-13T15:04:02Z` becomes `20260613-150402/],
    ['spec', /Always English: frontmatter keys, enum values, stage headings, CR ids/],
    ['spec', /Configured language: title, stage prose, scenario content and task descriptions/],
    ['spec', /gh api user --jq \.login/],
    ['spec', /id: "20260613-134548"/],
    ['spec', /type: feature.*feature \| bug \| audit \| refactor \| chore/],
    ['spec', /release_impact: minor.*none \| patch \| minor \| major/],
    ['spec', /Use `depends_on` only for execution prerequisites/],
    ['spec', /Use optional `related_to` for useful context that must not impose execution order/],
    ['spec', /changeledger owner <id> <name\|->/],
    ['spec', /changeledger list.*--owner.*--pending/s],
    ['spec', /changeledger show <id> \[--json\]/],
    ['spec', /Use fixed English `##` headings in this order/],
    ['spec', /Default activation matrix/],
    ['spec', /Every behavioral requirement is a separate structured scenario/],
    ['spec', /Given.*concrete precondition.*When.*concrete action.*Then.*exact result/],
    ['spec', /Localized headings, translated keywords, inline criteria/],
    ['spec', /mentions of `CR1` earlier in the sentence are prose/],
    ['spec', /Update `src\/app\/foo\.ts` \(CR1\) — verify: `pnpm test`/],
    ['spec', /\[ \] Update `src\/app\/foo\.ts`; verify: `pnpm test` \(CR1\)/],
    [
      'spec',
      /\[x\] Update `src\/app\/foo\.ts`; verify: `pnpm test` \(CR1\).*Resolved:\*\* `2026-06-13T14:20:00Z`/s,
    ],
    [
      'spec',
      /\[!\] Update `src\/app\/foo\.ts`; verify: `pnpm test` \(CR1\).*Blocked:\*\* blocked reason/s,
    ],
    ['spec', /Resolution metadata is structural/],
    ['spec', /operational work such as test suites, reading, blast-radius analysis or scaffolding/],
    ['spec', /cannot replace a criterion for observable behaviour/],
    ['spec', /strong model documents and a less capable but able model implements/],
    ['spec', /set `tdd` to `false` only for exploratory repos/],
    [
      'spec',
      /actual inputs rather than “a valid input”, exact outputs\/effects and literal error messages/,
    ],
    ['spec', /Give every edge case its own criterion/],
    ['spec', /Write the failing test from the criterion, make it pass, then refactor/],
    [
      'spec',
      /colocated test, conventional test directory, concrete command or manual `verify:` clause/,
    ],
    // 20260726-124837: commit behaviour left `implement.md` for core's single
    // seat, so each of these is asserted against core's own wording instead. The
    // `implement` pack keeps branch and worktree discipline only.
    ['core', /Subjects follow `type\(scope\): description \[#<id>\]`/],
    ['implement', /Never implement approved changes on `main`, `master`, or `dev`/],
    ['core', /\*\*Baseline\*\*: exactly one, the approved change document, before any code/],
    // 20260728-164620: the per-task class became the per-change one, and the
    // handoff stopped being an optional zero-or-one.
    // 20260729-111349 REPLACED: the per-change count became the per-selection unit,
    // so the class is pinned by the unit it now names, not by a quantifier.
    ['core', /\*\*Implementation\*\*: one per resolved selection of work/],
    ['core', /is never a commit of its own; it travels inside the next real class/],
    ['core', /\*\*Handoff\*\*: mandatory whenever work stops/],
    ['implement', /Follow the Specification exactly/],
    ['implement', /Tick tasks as they become true, not in a batch at the end/],
    ['implement', /Leave no TODO\/FIXME, dead code or unrelated residue/],
    ['implement', /move to `in-review` if the type requires independent review/],
    // 20260728-164620 retired the reconstruction clause with the per-task unit it
    // depended on; the Correction class it declares instead is pinned here.
    ['core', /\*\*Correction\*\*: zero or more/],
    ['implement', /changeledger status <id> <status>/],
    ['implement', /changeledger task <id> done\|block <n> \[reason\]/],
    ['implement', /changeledger log <id> "<message>"/],
    [
      'implement',
      /question, module, package, test area, migration slice or independent verification/,
    ],
    ['implement', /one subagent per file, line or tiny mechanical edit/],
    [
      'implement',
      /strongest available models for ambiguous scope, architecture, security-sensitive reasoning and difficult reviews/,
    ],
    [
      'implement',
      /sufficient cheaper models for inventories, localized exploration, mechanical edits and narrow checks/,
    ],
    ['implement', /why the work is delegated/],
    ['implement', /owned files, area or investigation question/],
    ['implement', /expected output/],
    ['implement', /difficulty or risk that informed model choice/],
    ['implement', /integration criterion/],
    ['implement', /Request and Investigation may split independent codebase questions/],
    ['implement', /Implementation may split only when write sets are disjoint/],
    ['implement', /Configured review is special: a fresh clean-context subagent/],
    ['reviewDelegate', /do not trust the implementer's summary/],
    ['review', /model sized to the review difficulty/],
    ['reviewDelegate', /every `CRn`, every Plan task, tests, the actual diff/],
    ['reviewDelegate', /absence of TODO\/FIXME, dead code or unrelated residue/],
    ['reviewDelegate', /ChangeLedger does not reimplement them/],
    ['review', /changeledger review <id> pass/],
    ['review', /changeledger review <id> fail --retry "<reason>"/],
    ['review', /changeledger review <id> fail --block "<reason>"/],
    // 20260727-194234: the commit-unit rule moved to core; review keeps only
    // what belongs to its phase — what happens to an uncommitted correction.
    ['review', /A pass leaves `in-validation` for closure unless it confirms uncommitted/],
    [
      'review',
      /Types without `review_required` move directly from `in-progress` to `in-validation`/,
    ],
    ['close', /reviewed: true/],
    ['close', /Specs have no lifecycle or `status`/],
    ['close', /title: Short title updated: 2026-06-30T10:00:00Z tags: \[\]/],
    ['close', /changeledger context <id>.*lifecycle-specific close overlay/],
    ['close', /changeledger graduate <id> <spec-slug> --new/],
    ['close', /changeledger graduate <id> <spec-slug> --into/],
    ['close', /changeledger graduate <id> --skip \[reason\]/],
    ['close', /changeledger list --pending graduation/],
    ['close', /changeledger list --pending archive/],
    ['close', /changeledger archive <id>.*archived: false.*frontmatter/],
    ['close', /changeledger list.*changeledger show/],
    ['close', /`--into` records the same link in both directions/],
    ['close', /target spec appends the change id to `graduated_from`/],
    ['close', /changeledger fix --graduation-links/],
    ['close', /`graduado a spec`/],
    ['close', /seed from the change's Specification or Proposal/],
    ['close', /remove the explicit scaffold marker/],
    ['close', /`--into` refuses an unrefined marked scaffold/],
    ['close', /one final closure commit.*graduation/i],
    ['blocked', /blocked task, an external impediment or a review escalation/],
    ['blocked', /Inspect the relevant task when one exists and read the Log/],
    ['blocked', /resolution requires scope or product judgment, ask the human/],
    ['blocked', /# Handoff Triage/],
    ['blocked', /If independent, too large or materially broader/],
    ['blocked', /operational step such as verify, commit, graduate, archive or close/],
    ['blocked', /Create the draft only after explicit authorization/],
    ['blocked', /too vague for backlog/],
    ['blocked', /Do not mix independent concerns into active work/],
    ['blocked', /block otherwise-ready human validation/],
    ['blocked', /When a change reaches `done`, also share a brief retrospective/],
    ['validation', /The agent never accepts on the human's behalf/],
    ['validation', /`changeledger validation <id> pass`/],
    ['validation', /fail --human "<reason>"/],
    ['validation', /Never infer a decision from praise/],
    ['validation', /Do not modify the result or mark it done/],
    ['validation', /Rejection requires a reason and returns the same change to `in-progress`/],
    ['validation', /run `changeledger context <id>` before modifying implementation/],
    // 20260727-194234: same move; validation keeps the pointer to the closure
    // commit and the isolation of unconfirmed corrections.
    ['validation', /make the close overlay's final commit/],
    ['discarded', /Preserve its reason and dependencies/],
    ['discarded', /requires a new authorized change/],
    [
      'release',
      /`changeledger release plan --json` is the handoff contract for the operating agent/,
    ],
    ['release', /changeledger release init <version>/],
    ['release', /changeledger release record <version>/],
    [
      'release',
      /operating agent owns stack-specific version files, project gates, commits, tags and publishing/,
    ],
    ['release', /Do not create a change only to group those routine steps/],
    ['core', /discard reason is required and logged/],
    // 20260705-134703: ownership prose replaced by a transition→owner→mechanism matrix.
    ['core', /draft → approved \| human \| viewer or `changeledger approve <id>`/],
    ['core', /in-review → in-validation \| orchestrator \| `changeledger review <id> pass`/],
  ];

  for (const [context, pattern] of expected) {
    assert.match(normalized[context], pattern, `${context} is missing ${pattern}`);
  }
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

test('212659 CR6: pre-existing code/spec divergence is reported for human resolution', () => {
  const root = repo();
  const normalize = (text) => text.replace(/\s+/g, ' ');
  const core = normalize(buildContext(undefined, root));
  const implement = normalize(buildContext('implement', root));

  assert.match(core, /pre-existing divergence between specs and code.*reported to the human/i);
  assert.match(core, /Wait if it affects the current task/i);
  assert.match(core, /unrelated.*report it without expanding scope/i);
  assert.doesNotMatch(core, /document wins when code and documentation disagree/i);

  assert.match(implement, /approved change governs the code written within its scope/i);
  assert.match(
    implement,
    /pre-existing divergence not introduced by the current work.*human resolution/i,
  );
});

test('234939 CR10/CR11: reviewed fragment snapshots prevent silent contract loss', () => {
  const expected = {
    'blocked.md': '77efa1acf03835ca8122ff98f3bfbcef05c8fa47769e6b08c073e3ca225b1353',
    // 20260703-150230: existing traceability rules are preserved but their Git
    // boundaries are replaced: baseline first, lifecycle-only moves coalesced,
    // verified corrections remain meaningful, and graduation owns final closure.
    // 20260703-150232: terminal done is replaced by durable-closure finality.
    // 20260705-134704: the graduation bullets are replaced by a numbered new-spec
    // recipe with the reviewed:true nuance integrated per step; existing-spec and
    // skip stay as explicit alternatives. Rules preserved, none retired.
    // 20260711-103802: the archive/unarchive bullet is replaced — unarchive was
    // retired as unused CLI surface; reversal is now documented as a manual
    // `archived: false` frontmatter edit. Rule preserved, not retired.
    // 20260716-131649: listing unresolved graduation and archive candidates is
    // replaced by canonical `list --pending` queries; closure actions remain.
    // 20260718-111457: the Log-only graduation rule is replaced by the
    // bidirectional Log + graduated_from invariant and its explicit migration;
    // the closure modes, reviewed semantics and commit recipe are preserved.
    // 20260718-105457: the queries gain optional owner scoping; graduation stays
    // individual and archive preview/action equivalence is preserved per filter.
    // 20260727-194234: RETIRED to core.md — "Do not create separate commits whose
    //   only content is one of those transitions" is core's "A lifecycle
    //   transition ... is never a commit of its own; it travels inside the next
    //   real class". PRESERVED verbatim: the closure commit that coalesces
    //   pending lifecycle Log with the graduation decision and the durable spec
    //   edit, and the rule that without pending lifecycle the graduation or skip
    //   is itself the closure evidence. Those are close's own phase, not the
    //   commit unit, so they stay.
    'close.md': '6d8a85df319493b7f3914de60ca38010306342c85d893af7d5b57b8eb13a2028',
    // 20260701-213931: the anti-truncation rule was replaced, not retired — completeness is
    // now verified through the CHANGELEDGER CONTEXT END sentinel instead of a tool blocklist.
    // 20260701-230608: two rules replaced, none retired — the delegation-prompt summary now
    // reads as a minimum deferring to the task context, and rule 8 states the --new/--into
    // two-step so graduation is not presented as a settled binary.
    // 20260703-150229: anti-truncation is preserved and strengthened: deliberate one-pass
    // capture is now normal, sentinel recovery exceptional, and messages do not reload core.
    // 20260703-150232: done finality is replaced with one provisional reopen edge;
    // 20260710-105205 gives that correction to agent or human while durable closures remain irreversible.
    // 20260703-220014: rule 7 replaced — "Stop at in-validation" (read as a global pause) is
    // now a change-scoped stop that names the depends_on chain blocking the next candidate.
    // 20260705-134704: rule 8 trimmed — the --new/--into two-step parenthetical is removed and
    // deferred to the close overlay, which owns the full graduation recipe. Rule preserved.
    // 20260704-144327: the minimum delegation rule gains a pointer to `changeledger
    // agent-prompt <role>` for the full role skeleton; content stays on demand.
    // 20260705-134703 correction after human validation: the matrix now owns
    // topology as well as owner/mechanism; the parallel text diagram is retired,
    // equivalent status/viewer rows are grouped, and non-ownership rules remain.
    // 20260710-105205: acceptance remains human-only; rejection and provisional
    // reopening are replaced with explicit agent-or-human commands and actors.
    // 20260711-103756: the operational-exception sentence gains a pointer to the
    // new `quick` type for small, reversible, single-concern observable work.
    // Existing rules preserved, none retired.
    // 20260711-103758: additive — Operational discovery gains one bullet
    // pointing at `changeledger search`. Every existing rule preserved, none
    // retired or replaced.
    // 20260711-103759: additive — a new paragraph in "Read complete context
    // before acting" documents `--have <rev>` as a post-compaction revision
    // check. Every existing rule preserved, none retired or replaced.
    // 20260710-201703: additive — the role skeleton pointer in "Files and
    // delegation" gains the new read-only `audit` role for changes already in
    // `in-validation`. Every existing rule preserved, none retired or replaced.
    // 20260715-125139: human decisions gain viewer-or-conversation mechanisms;
    // the ownership boundary is preserved and strengthened against inference.
    // 20260716-131649: operational discovery replaces the graduate query with
    // canonical list queries for graduation and archive candidates.
    // 20260718-105457: those queries add optional owner scoping while keeping
    // per-change graduation and matching filtered archive semantics explicit.
    // 20260720-212659: universal document-wins semantics are replaced by
    // ChangeLedger-scoped persistent truth: pre-existing code/spec divergence
    // is reported for human resolution, while an approved change still governs
    // code written inside its authorized scope. No lifecycle rule is retired.
    // 20260726-141123: the delegation role named `audit` is renamed
    // `post-review`, with no compatibility alias, because it collided with the
    // configured change type of the same name. Its description is preserved in
    // the already-existing equivalent wording used by the CLI help and README
    // ("a read-only inspection of a change already in `in-validation`; it never
    // issues a verdict or moves the change"): the adjective now lives in the
    // role name itself. No rule is retired; the 20260710-201703 entry above
    // remains the historical record of when the role was introduced.
    // 20260726-124833: the post-compaction revision-check paragraph is RETIRED,
    // not replaced. `rev:<hash>` and `--have <rev>` are gone from the CLI, so
    // the rule they described has no mechanism left and no successor wording;
    // the 20260711-103759 entry above stays as the historical record of when it
    // was introduced. The surrounding one-pass full-capture rule and the
    // "a new human message alone does not trigger a reload" rule are preserved
    // verbatim — the latter is now the sole reason a retained capture is not
    // reloaded. Every other rule in the fragment is preserved.
    // 20260726-124835: core is rewritten as a routing contract, and the human's
    // amendment then RESTORED three rules the first pass had retired without a
    // criterion authorizing it. Every claim below is checked against the owning
    // file's actual sentence, not against similar words, so a reader grepping a
    // named literal finds it. Tally: 7 REPLACED entries, 3 RESTORED, 3 RETIRED
    // and 3 MOVED entries covering 7 moved rules, grouped by owning file; every
    // other rule of the old fragment is in the PRESERVED entry at the end.
    // REPLACED — "Documents under `.changeledger/` are ChangeLedger's persistent
    //   truth" and rule 3's "Capture every authorized change in
    //   `.changeledger/changes/`" by an identity that separates authorized work
    //   (changes) from persistent truth (specs) and names overlay authority;
    // REPLACED — "a new human message alone does not trigger a reload" by "never
    //   load one speculatively and never reload one already held", which keeps
    //   the same load-bearing reason a retained capture is not reloaded and adds
    //   the speculative-load half (see the 20260726-124833 entry above, which
    //   declared that rule load-bearing);
    // REPLACED — "The human authorizes scope, approves drafts and accepts the
    //   final result … praise, 'continue', or agent inference is not a decision"
    //   by "The human decides and the agent executes" plus the invariant "A human
    //   verdict is transmitted, never inferred; praise, 'continue' or agent
    //   advice is not a decision"; the matrix keeps `draft → approved` and
    //   `in-validation → done` as the human-owned rows that carry the rest;
    // RESTORED to core by the human's amendment, after the first pass wrongly
    //   classified it REPLACED — rule 1's precondition and prohibition. The first
    //   invariant now reads "No artifact without explicit human authorization,
    //   and none before there is enough clarity to document faithfully: a direct
    //   request such as “create the change” is authorization; never invent
    //   missing requirements". The REPLACED claim named an authorization-only
    //   invariant that carried neither obligation, and a repo-wide grep for
    //   "invent missing|missing requirement|faithful" over templates/ and src/
    //   returned nothing, so both were homeless;
    // REPLACED — "Delegate only with a clear boundary and benefit … ownership,
    //   expected output and integration criterion" by the work→owner table, "the
    //   stage context owns what the prompt must contain" and the portable
    //   delegate-sizing paragraph; delegation.md's "## Delegation prompt contract"
    //   keeps the element list and "The boundary must state what the delegate
    //   owns, what it returns and how the result integrates";
    // REPLACED — "Size the model to the task's difficulty and risk" by "Size the
    //   delegate to the work, not to the caller's convenience" with explicit
    //   tiers, stated without naming any provider's models;
    // REPLACED — "Do not over-shard or overlap write surfaces without an explicit
    //   integration plan" by "One owner per write surface; concurrent subagents
    //   must not share files", with delegation.md's "Do not run parallel agents
    //   over the same files or conceptual surface unless overlap and integration
    //   are explicit" still owning the general rule;
    // REPLACED — "Get a complete role skeleton to fill in with `changeledger
    //   agent-prompt <role>`" by "Get the prompt skeleton from `changeledger
    //   agent-prompt <role>`"; the four roles and the `post-review` semantics are
    //   preserved verbatim in core;
    // RETIRED — the FIRST-capture recipe of "Read complete context before
    //   acting": "Running `changeledger context` is discovery, not compliance",
    //   "Capture the first invocation completely in one pass", reading through
    //   the `CHANGELEDGER CONTEXT END` line and "exceptional recovery".
    //   20260726-124834 gave the bootstrap the exact bounded command and the END
    //   line as the validity condition of the first capture, so core had no
    //   mechanism left to own;
    // RETIRED — "Never request a preview, summary or voluntary line, byte or
    //   token cap": an unverifiable negative with no successor wording. The
    //   bootstrap's END-line validity condition is the check that replaced it for
    //   the first load;
    // RETIRED from the contract — "work performed without the CLI may diverge".
    //   No fragment carries it; README.md still states it as product narrative,
    //   which is not contract text an agent is handed;
    // RESTORED to core by the human's amendment — that EVERY capture is read
    //   complete, which is operation and not startup: `## Context modes` states
    //   "Every context capture is read complete in one pass — core, mode and
    //   change-id alike; a partial view is invalid". It replaces the narrower
    //   "Run each only after reading the complete base output" it stands in for,
    //   and it is the rule `INCREMENTAL_NOTICE` in src/commands/context.mjs
    //   points at when an incremental capture claims it "applies here";
    // MOVED to spec.md, not retired as the first pass recorded — "Files are the
    //   source of truth and may be edited directly" and "CLI helpers are optional
    //   and preferred for error-prone operations" live in
    //   templates/contract/spec.md §"Repository layout and creation" as "Files
    //   remain the source of truth and may be edited directly, but prefer the CLI
    //   for timestamps, enums and markers that are easy to mistype";
    // MOVED to delegation.md, not retired as the first pass recorded (its own
    //   entry said "preserved in delegation.md", which is a move) — "Coding agents
    //   must know they share the codebase and must not revert others' work" is
    //   "Tell coding delegates they share the codebase: stay inside assigned
    //   ownership, do not revert others' edits and report overlapping changes
    //   instead of silently resolving them";
    // RESTORED to core by the human's amendment — the scoped reading of the stop,
    //   which the first pass MOVED to validation.md alone: `## Lifecycle` now
    //   reads "It stops only that change: never accept on the human's behalf, but
    //   reject with a reason and start another approved change unless its direct
    //   or transitive `depends_on` chain reaches one in `in-validation`".
    //   "Keep working or idle?" is decided with core alone (20260703-220014 exists
    //   to establish that reading), and validation.md composes only for the
    //   change already stopped, so it cannot reach the orchestrator in time;
    // MOVED to their owning overlays, each named by what that overlay actually
    //   says — verbatim only in close.md, so the other three are quoted as they
    //   now read: "commit the approved change document before code" is
    //   implement.md's "After `approved → in-progress`, create a baseline commit
    //   of the approved change document before code"; "use a fresh clean-context
    //   reviewer before human validation" is review.md's "Review-required work
    //   must be checked by a fresh subagent with clean context and a model sized
    //   to the review difficulty"; rule 3's "An approved change governs code in
    //   scope" is implement.md's "the approved change governs the code written
    //   within its scope"; and "`changeledger graduate <id> --skip [reason]`" is
    //   verbatim in close.md. Core keeps one-line invariants pointing at each
    //   owner;
    // PRESERVED — the ten-row transition matrix with its owner and mechanism
    //   columns, the `changeledger status` note, the discard/reopen rules, "If no
    //   approved or in-progress change applies…" with the `quick` lane, "Humans
    //   consume changes in `changeledger view`", "Never implement a `draft`", the
    //   modes index and operational discovery with its effective-policy sentence,
    //   all verbatim modulo line wrapping; seven of the eight lifecycle states
    //   verbatim, the `in-validation` bullet extended by the restored scoped stop.
    //   Preserved but reworded, no obligation dropped: "Any pre-existing divergence
    //   … must be reported" as "Pre-existing divergence … is reported"; rule 5's
    //   "Keep lifecycle, tasks, ownership and Log current while working" without
    //   the trailing clause; rule 4's "implement one change at a time on a
    //   non-main branch" as "One change at a time, on a non-main branch".
    // ADDED — "Classify intent before acting", "Protect the orchestrator's
    //   context", "Stage exit gates", "Complexity ceiling" and "Commits".
    // 20260726-124837: `## Commits` becomes the single seat of commit behaviour,
    // because committing happens in authoring, implementation, correction and
    // closure alike, and the same rule existed in up to four potentially
    // divergent copies across eight fragments. Nothing about commits is retired
    // here — the block grows by importing what `implement.md` gave up, and every
    // imported obligation is pinned by name in the 124837 CR8 test.
    // REPLACED — "One commit per completed Plan task, plus one baseline commit of
    //   the change document before any code" by four closed classes with explicit
    //   multiplicities: Draft one per drafted document and never batched, Baseline
    //   exactly one before any code, Task one per completed Plan task, Handoff
    //   zero or one. The two old obligations are the Baseline and Task rows
    //   verbatim in meaning; Draft and Handoff are the two the summary had no room
    //   for and which `implement.md` (Handoff) or nothing at all (Draft) carried;
    // REPLACED — "A lifecycle transition is never a commit of its own — the Log is
    //   its record; the transition travels in the next real commit" by the same
    //   prohibition plus the discriminant that makes it decidable (revert,
    //   reference or implement independently) and the `n + 1` / `n + 2` counting
    //   formula. The obligation is preserved; what is added is how to measure it,
    //   which is the defect 20260726-124837 was opened for;
    // RETIRED — "`changeledger context implement` owns the full contract". Its
    //   target no longer exists: `implement.md` holds zero commit prose after this
    //   change, so the pointer would send a reader to an empty section. No
    //   obligation is lost — core is the owner it used to point away from;
    // PRESERVED — "Subjects follow `type(scope): description [#<id>]`;
    //   `changeledger commit` composes it", now extended with the full mechanics
    //   imported from `implement.md`. Every other block of the fragment is
    //   untouched.
    // PRESERVED (restored after review) — two obligations that left
    //   `implement.md` had reached no home and a clean-context reviewer caught it:
    //   the handoff checkpoint's duty to "record why" now rides the Handoff class
    //   ("record why it was needed"), and the combined-commit duty to "name every
    //   change sharing the surface" now rides the combined-commit sentence
    //   ("naming every change that shares the surface"). Verified by grepping the
    //   obligation itself, not similar words: both appear only in `core.md`.
    // 20260728-151336: REPLACED — "only merge commits and `chore(release)` prep
    //   are exempt" by "only merge commits, `chore(release)` prep and a
    //   `ChangeLedger: none — <reason>` body are exempt", so the same sentence
    //   now also names the declared operational commit exemption implemented in
    //   `src/git.mjs` (`commitMarkerViolation`/`lintCommitRange`) and composed by
    //   `changeledger commit --no-change <reason>`. No obligation moved fragment
    //   or file: grepped `templates/contract/` for "merge commits", "chore(release)"
    //   and "ChangeLedger: none" and every hit is this one line in `core.md`.
    //   Nothing is retired — the merge and `chore(release)` exemptions are
    //   preserved verbatim, only extended with the new third case.
    // 20260728-164620: the commit unit becomes the change, not the Plan task. The
    // block's own granularity test decided it — a Plan task is never reverted,
    // referenced by id nor implemented apart — and no lint ever enforced the
    // per-task rule, so retiring it loses no mechanical guarantee.
    // REPLACED — "A change branch carries four commit classes and no others" with its
    //   **Task** row ("one per completed Plan task, with that task's code, its test,
    //   its ticked box and its Log entries") by five classes whose **Implementation**
    //   row is "exactly one, the change's complete work — code, tests, ticked boxes
    //   and Log entries — created once the local gate passes and before the review is
    //   delegated". Nothing that travelled with the work is dropped: code, tests,
    //   boxes and Log still ride the commit; only the unit widens from task to change,
    //   and the ordering plus `baseline..HEAD` is what the widening buys;
    // REPLACED — "So `n` completed tasks yield `n + 1` commits, `n + 2` with a
    //   handoff, never one per transition" by "So a change yields two commits, one
    //   more per confirmed correction and one per handoff, never one per transition
    //   and never one per Plan task". "never one per transition" is preserved
    //   verbatim; what goes is the count's dependence on the number of tasks;
    // REPLACED — "**Handoff**: zero or one, only when work stops (review, blocked,
    //   session end) and document-only state would otherwise stay uncommitted" by
    //   "**Handoff**: mandatory whenever work stops in `blocked` or a session ends
    //   with uncommitted state". "record why it was needed" is preserved verbatim;
    //   what changes is that stopping now obliges the commit instead of allowing it;
    // RETIRED — "never defer them and reconstruct mixed diffs at the end". Not
    //   because it stopped mattering: a different commit unit replaces it. Under the
    //   per-task unit, deferring meant reconstructing several units' diffs at the end;
    //   with the change as the unit there is one diff, and deferring it to the end of
    //   the implementation IS the rule, so the clause became false rather than
    //   obsolete. It has no home by design — grepped `reconstruct mixed diffs` across
    //   `templates/contract/` recursively, capsules included, and no fragment holds
    //   it. `164620 CR5` is the standing guard, and the `124837 CR8` home list drops
    //   its pair with the reason written in place;
    // ADDED — the **Correction** class, "zero or more, each left uncommitted until a
    //   fresh reviewer confirms it": the practice already produced that commit and no
    //   fragment declared the class. `review.md` keeps what each verdict does with the
    //   correction, so core declares the class and nothing more. ADDED — "A single
    //   Plan task is not: it is reverted, referenced and implemented with the rest of
    //   the change", the discriminant applied to the unit this change retires;
    // RETIRED (correction round) — "or several Plan tasks are inseparable", the second
    //   form of the combined commit that 124837 added on the human's 2026-07-26
    //   decision. It is emptied, not merely unused: with the change as the unit every
    //   Plan task travels in the one implementation commit, so inseparable tasks can
    //   never be the reason separation is impossible. The clause is replaced by the
    //   explicit "Plan tasks are never a reason — they all travel in the one
    //   implementation commit", so the retired case is named rather than left to be
    //   rediscovered, and `164620 H4/H5` guards it. The shared-files form and the duty
    //   to record and name what was combined are preserved verbatim, so the obligation
    //   `124837 CR8` homes here ("If shared files make a combined commit unavoidable")
    //   still has its home;
    // PRESERVED — the Draft and Baseline rows verbatim, the granularity test, the
    //   lifecycle-transition prohibition and the change-document rationale, plus the
    //   message mechanics and the `pre-commit` staged-index rule. The dirty-window declaration
    //   this change also introduces went to `implement.md`, not here: it is a fact of
    //   the implementation stage, not of the class taxonomy (`164620 CR7`).
    // 20260729-111349: the commit unit is the resolved selection of work, not the whole
    // change. `164620 CR1` translated a decision about DELEGATION into a rule about
    // commits and added a quantifier nobody decided; the block's own granularity test
    // never justified jumping from "a Plan task alone is too small" to "the change is
    // the unit", because the resolved selection sits between them and passes the test.
    // REPLACED — "**Implementation**: exactly one, the change's complete work — code,
    //   tests, ticked boxes and Log entries — created once the local gate passes and
    //   before the review is delegated, so `baseline..HEAD` is a fixed range …" by
    //   "**Implementation**: one per resolved selection of work — its code, tests,
    //   ticked boxes and Log entries — created once the local gate passes and committed
    //   as soon as that selection is resolved, without waiting for the rest, so the
    //   number of implementation commits per change is not fixed". Nothing the class
    //   carried is dropped: code, tests, boxes and Log still ride the commit and the
    //   local gate still precedes it; only the quantifier goes;
    // PRESERVED (moved, not retired) — the ordering and everything it buys. "before the
    //   review is delegated", "`baseline..HEAD`", the fixed range the reviewer inspects
    //   and "the deliverable cannot change between the report and history" now live in
    //   their own sentence, "Every selection is committed before the review is
    //   delegated, so `baseline..HEAD` is closed the instant the review is delegated
    //   …". The guarantee had to leave the class because it is an obligation of
    //   SEQUENCE over every selection, which a count no longer expresses; `111349 CR4`
    //   is its standing guard;
    // REPLACED — "A single Plan task is not: it is reverted, referenced and implemented
    //   with the rest of the change, so the change is the implementation unit" by "A
    //   resolved selection of work is too: it reverts on its own, and better than the
    //   whole change would. A single Plan task on its own is not: alone it is reverted,
    //   referenced and implemented with the rest of its selection". The discriminant is
    //   preserved verbatim and still rejects the isolated task; what is retired is the
    //   unjustified jump from that rejection to the whole change;
    // REPLACED — "So a change yields two commits, one more per confirmed correction and
    //   one per handoff, never one per transition and never one per Plan task" by "So a
    //   change yields one commit per resolved selection, one more per confirmed
    //   correction and one per handoff, never one per transition". "never one per
    //   transition" is preserved verbatim; what goes is the fixed count of two and the
    //   per-task prohibition that the new unit makes meaningless — the selection IS a
    //   cut smaller than the change;
    // REPLACED — "Plan tasks are never a reason — they all travel in the one
    //   implementation commit" by "Plan tasks are never a reason — separating them is
    //   always possible, since each resolved selection is committed on its own". The
    //   conclusion is preserved: Plan tasks never license a combined commit. Only the
    //   premise changes, because there is no single implementation commit to rest on.
    //   The shared-files form and the duty to record and name every change sharing the
    //   surface are preserved verbatim, so the `124837 CR8` home still holds;
    // REPLACED — the ownership row "| any implementation task with its own verify
    //   command | subagent |" by "| implementation work with its own verify command |
    //   subagent |". The delegation obligation is preserved; the "any … task"
    //   quantifier is retired because it pushed one delegation per Plan task, the half
    //   of the human's decision the contract never recorded. How the group is sized
    //   (completeness and coupling) is deliberately NOT written here: it is CH-5b's
    //   content, and duplicating it would create a second seat for one rule;
    // PRESERVED — the Draft, Baseline, Correction and Handoff classes verbatim, the five
    //   classes and no others, the granularity test's own sentence, the
    //   lifecycle-transition prohibition, the change-document rationale, the whole
    //   message-mechanics paragraph and the `pre-commit` staged-index rule. Nothing is
    //   RETIRED by this change: every obligation the rewritten sentences carried is
    //   still in this fragment, verified by grepping each obligation itself —
    //   "before the review is delegated", "baseline..HEAD", "the deliverable cannot
    //   change", "never one per transition", "naming every change that shares the
    //   surface" and "with its own verify command" all still hit only `core.md`.
    'core.md': '04b83dbfed4157653e5a7f9414848e92dedb3ec27ff1c187c7c5e35e1be9c010',
    // 20260704-114323: the "configured review is special" rule is preserved
    // (fresh clean-context subagent) and extended, not replaced: it now states
    // the delegate stays read-only and the orchestrator alone records the verdict.
    // 20260711-160446: additive — the delegation prompt contract gains one
    // more required element, the expected baseline (branch or commit) a
    // writing delegate must verify. Every existing rule preserved, none
    // retired or replaced.
    'delegation.md': 'a1faba8da42f18f5ca12c0fd5514fa4b96b1e8fceefac67c4b84e3490f3c0fb5',
    'discarded.md': '6ef24e465b9aea0f160606ba7a2bc849a5e98f1c747f0fd8814b80786955b590',
    'handoff.md': '2275f8b6ac415c7f132b5cd324dd5556a5948332131d59a0893f20c46e26f330',
    // 20260703-220014: clarified that "one change at a time" is per-worktree, not
    // a claim that no other change may sit in in-validation concurrently.
    // 20260704-114323: mutation-command list extended (added `review <id>
    // pass|fail`), not retired. The in-review/in-validation sentence is
    // replaced: it now names loading `changeledger context review` and
    // recording the delegate's verdict as the orchestrator's own step, and
    // states that acceptance remains human-only while correction can be agent-owned.
    // Operational follow-up (no change id, budget rework): restored the
    // "load once, don't reload unless context was lost" clause that CR1
    // specified but had been trimmed to fit the original tight byte budget.
    // 20260705-134702: the review-gate paragraph is replaced by a numbered
    // 1..5 ordered recipe (tasks → status in-review → load review context →
    // delegate read-only reviewer → orchestrator records verdict); every rule
    // is preserved, none retired.
    // 20260711-103757: extended, not retired — documents the canonical
    // separate-brackets multi-id shape, that ledger meta-commits carry the
    // marker like any other commit, and the new `changeledger commit` /
    // `changeledger check --commits` helpers that enforce it.
    // 20260711-210115: additive — the work-branch rule gains one sentence:
    // when the config declares `git.integration_branch`, change branches are
    // created from it and integrated into it, with `main` reserved for
    // releases. Every existing rule preserved, none retired or replaced.
    // 20260711-225638: the multi-id placement rule is replaced, not retired:
    // one id remains in the subject, while two or more use the canonical
    // `ChangeLedger: [#A] [#B]` body line. Helper and lint enforcement remain.
    // 20260715-122950: the ordered review recipe is extended with formatter and
    // check gates after lifecycle mutations; host ownership is explicit. Existing
    // review, verdict and validation rules are preserved, none retired.
    // 20260720-212659: unconditional code-wins repair is replaced: the approved
    // change still governs code authored in scope, while a pre-existing
    // divergence is reported for human resolution. Execution discipline remains.
    // 20260726-124837: every commit rule is RETIRED from this fragment; core.md's
    // `## Commits` is the named home of each one, and the 124837 CR8 test asserts
    // each new home by literal so no claim below can rot unnoticed.
    // RETIRED to core.md — "After `approved → in-progress`, create a baseline
    //   commit of the approved change document before code" is "**Baseline**:
    //   exactly one, the approved change document, before any code";
    // RETIRED to core.md, and the judgment deliberately dropped — "Commit completed
    //   units with their tasks and Log when later work could obscure attribution"
    //   is the countable "**Implementation**: exactly one, the change's complete work
    //   — code, tests, ticked boxes and Log entries" (124837 landed it as "**Task**:
    //   one per completed Plan task"; 20260728-164620 widened the unit from the task
    //   to the change without dropping anything it carries). The trailing clause
    //   was the whole defect: it asked the agent to guess whether attribution
    //   could matter later, and the safe guess is always yes, so it invited the
    //   excess it meant to prevent. CR1 forbids that clause anywhere in the
    //   contract, so it has no home by design;
    // RETIRED to core.md — "Do not create a dedicated commit for a lifecycle-only
    //   transition. Coalesce it with the nearest meaningful commit" is "is never a
    //   commit of its own; it travels inside the next real class", now with the
    //   discriminant and a count that makes it measurable (124837's `n + 1` / `n + 2`
    //   formula; 20260728-164620 replaced it with the per-change count, because the
    //   formula depended on the per-task unit that change retires).
    //   The `in-progress → in-review` example is dropped as an instance of the
    //   rule, not an obligation of its own;
    // RETIRED to core.md by 124837 as "never defer them and reconstruct mixed diffs
    //   at the end", then RETIRED outright by 20260728-164620 — "Do not wait until
    //   the end to reconstruct mixed diffs" now has no home in any fragment, because
    //   a different commit unit replaces it: with the change as the unit, deferring to
    //   the end of the implementation is the rule. The `core.md` pin above carries the
    //   full classification and `164620 CR5` guards it;
    // RETIRED to core.md — "If a handoff precedes the next meaningful commit, one
    //   consolidated checkpoint persists pending state; record why and never create
    //   one per transition" is "**Handoff**: mandatory whenever work stops in
    //   `blocked` or a session ends with uncommitted state; record why it was needed"
    //   (124837 landed it as "zero or one, only when work stops"; 20260728-164620 made
    //   stopping oblige the commit), with "never one per transition" carried by the
    //   count. The "record why" clause reached no home on the first
    //   pass and a clean-context reviewer caught it; core carries it now;
    // RETIRED to core.md — the whole message-mechanics block: the canonical subject
    //   shape and its `feat(scope): description [#20260629-234939]` example, "One
    //   change keeps its marker at the end of the subject", the
    //   `ChangeLedger: [#A] [#B]` body line with "never a comma list in one
    //   bracket", the ledger meta-commit rule, the merge and `chore(release)`
    //   exemptions, `changeledger commit -m "<type>(<scope>): <desc>" [--id <id>]`
    //   with its single-`in-progress` resolution and its refusal to commit when
    //   ambiguous or non-conventional, and `changeledger check --commits [<base>]`
    //   before requesting review. The fenced example is retired as a duplicate
    //   rendering of the shape core states inline, not as a separate rule;
    // RETIRED to core.md — "If shared files make a combined commit unavoidable,
    //   record it in Log or the handoff and name every change sharing the surface"
    //   is core's combined-commit paragraph, which keeps the obligation to record
    //   what was combined and why, keeps the duty to name every change sharing the
    //   surface (restored after review — it reached no home on the first pass) and
    //   adds the second form the human decided on 2026-07-26, inseparable Plan
    //   tasks (20260728-164620 retired that second form: see the `core.md` pin above.
    //   The obligation this line homes is the shared-files form, which is untouched).
    //   The Log-or-handoff choice of venue narrows to the Log;
    // PRESERVED — the branch and worktree rules verbatim (never `main`/`master`/
    //   `dev`, branches created from and integrated into `git.integration_branch`
    //   with `main` reserved for releases, inspect the worktree first and ask
    //   before touching unrelated changes), "Implement one change at a time, even
    //   while another already-delivered change waits in `in-validation`", the
    //   `changeledger commit` entry of the mutation-command list, the review gate,
    //   and the whole `## Correction isolation` section: it governs when a
    //   correction may be committed relative to review and human validation, which
    //   is lifecycle isolation rather than commit-unit behaviour, and neither CR3
    //   nor the Plan asks for its removal.
    // 20260722-124656: REPLACED — the ORDER of the ordered review gate, not its
    //   content. "Apply the local formatter and full gates, including
    //   `changeledger check`, to the exact review candidate" and
    //   "`changeledger status <id> in-review`" trade places (was 2/3, now 3/2) and
    //   the tail renumbers 4..7 → 5..8. Both sentences survive verbatim, so no
    //   obligation moves fragment and none is retired; what changes is which one
    //   must already have passed when the lifecycle claims review started;
    // REPLACED — "Types without `review_required` move directly to
    //   `in-validation`" by "pass the same local gate before
    //   `changeledger status <id> in-validation`". The two obligations that
    //   sentence carried are preserved verbatim in the same sentence: these types
    //   apply the same post-transition formatter and affected-check gate, and they
    //   gain no review gate ("do not invent a review gate for them" stays in
    //   `review.md`, its only home — grepped). Only "move directly", which is what
    //   licensed skipping the gate, is replaced; the state-path half of that same
    //   phrase — that these types skip `in-review` entirely — survives verbatim at
    //   pre-existing `review.md` ("Types without `review_required` move directly
    //   from `in-progress` to `in-validation`"), which is its home and is pinned by
    //   the assertion above in this file, so no clause of the phrase is homeless;
    // ADDED — step 3 now states that the gate never runs after the transition and
    //   that the transition refuses an invalid candidate (the CR3 guard in
    //   `src/commands/agent.mjs`), and a new step 4 requires reapplying the
    //   formatter plus `changeledger check` to the document after the transition
    //   and repeating every affected verification if the candidate changes again
    //   before the reviewer sees it. Neither had a prior home: the old step 7
    //   (now 8) governs the VERDICT mutation, not this transition, and it is
    //   preserved verbatim. Nothing is retired from this fragment.
    // 20260728-164620: purely additive, two additions, nothing retired or reworded.
    // ADDED — a new step 5 of the ordered gate, "Create the one implementation commit
    //   with `changeledger commit`", placed before the review delegation so the
    //   reviewer inspects `baseline..HEAD` instead of a working tree; the tail
    //   renumbers 5..8 → 6..9 and every step survives verbatim. The class it creates
    //   is declared in core's `## Commits`, so this fragment states only WHEN the
    //   commit happens in the stage order, which is what the ordered gate owns;
    // ADDED — the expected dirty set of the implementation window: between
    //   `changeledger status <id> in-progress` and the implementation commit the change
    //   document stays modified AND so do the change's own code and tests, because that
    //   commit is the first to carry them, so a clean worktree is not a valid
    //   precondition there. (The correction round fixed this: the first pass wrote "the
    //   change document alone", which chained with the unrelated-work rule four lines
    //   above into an order to ask the human about the change's own in-flight code.)
    //   This obligation had no prior home anywhere — grepped
    //   `templates/contract/` recursively for "clean worktree", "worktree",
    //   "uncommitted" and "dirty". HOLDERS: `implement.md` (the unrelated-work
    //   inspection and correction isolation), `review.md` (correction isolation),
    //   `core.md` (the Correction and Handoff classes, plus the `approved` bullet's
    //   "Git/worktree checks"), `agent-contexts/implementation.md` (a delegate sharing
    //   the worktree must not overwrite others' work). END HOLDERS. None of them states
    //   which paths are expected to be dirty mid-implementation: the closest prior art
    //   is the delegate capsule, and it answers the opposite question — what a delegate
    //   may not touch, not what it should expect to find. `164620 H3` asserts the
    //   HOLDERS list names every fragment that hits, because the first version of this
    //   claim enumerated three categories and silently omitted two holders while its
    //   conclusion stayed true, which is how a pin comment rots. That gap is exactly
    //   why a delegation baseline
    //   deduced "clean" and cost a whole delegation on 20260728-195445. It binds here
    //   because this fragment owns the implementation stage; the core block must NOT
    //   repeat it (`164620 CR7` asserts both halves). The clause does not restate
    //   core's transition prohibition — it points at it, so 194234's single seat for
    //   "is never a commit of its own" is untouched, and this pack still does not
    //   compose that sentence.
    // 20260729-111349 CR7: this fragment was the seat that survived the first pass, going
    // on to demand a single implementation commit while core had already made the unit the
    // resolved selection. It survived because every guard watched `core.md`; `111349 CR7`
    // now sweeps every fragment in the directory. Four sites, all REPLACED, none retired:
    // REPLACED — step 5 of the ordered gate, "Create the one implementation commit with
    //   `changeledger commit`: the change's complete work plus the ledger state,
    //   transitions included. It precedes the review delegation, so the reviewer inspects
    //   `baseline..HEAD` instead of a working tree" by "Create every outstanding
    //   implementation commit with `changeledger commit`: each resolved selection carries
    //   its own work, and the last also carries the ledger state, transitions included.
    //   Every selection precedes the review delegation, so the reviewer inspects a closed
    //   `baseline..HEAD` instead of a working tree". Every obligation the step carried is
    //   preserved — the ledger state and transitions still ride an implementation commit,
    //   the commit still precedes the delegation, and the reviewer still inspects
    //   `baseline..HEAD` — and only the count changes. The step keeps its position, so
    //   `164620 CR2` (commit step before delegation step) and the two-transition window of
    //   `164620 CR7 correction` (in-review step before commit step) are untouched;
    // REPLACED — "Between `changeledger status <id> in-progress` and the implementation
    //   commit the change document stays modified" and "which that commit is the first to
    //   carry" by the plural forms, "and the implementation commits" and "which those
    //   commits are the first to carry". The window is the same window; what changes is
    //   that it now closes over N commits instead of one;
    // REPLACED — "Core's commit classes carry those transitions inside the implementation
    //   commit rather than a commit of its own" by "… inside the implementation commits
    //   rather than a commit of their own". This still POINTS at core's transition
    //   prohibition instead of restating it, so 194234's single seat for "is never a
    //   commit of its own" stays single and this pack still does not compose that
    //   sentence;
    // REPLACED — "never license leaving the implementation commit unmade before review" by
    //   "… the implementation commits unmade before review". The obligation is stronger,
    //   not weaker: no selection may be left uncommitted, where the singular could be read
    //   as satisfied by one commit;
    // ADDED — "The window is not one event: each resolved selection is committed as it
    //   resolves, so the expected delta shrinks selection by selection and what stays
    //   uncommitted is what no selection has resolved yet". Needed because the plural
    //   alone leaves a reader to guess WHEN each commit lands, and core's class states the
    //   rule while this fragment owns the stage's window;
    // PRESERVED verbatim — the whole expected-delta set, which has no other home: the
    //   `status` field and every `[status]` line the window accumulated, the two named
    //   transitions, the change's own code and tests, "Together they are the only expected
    //   delta", the "unrelated changes" definition, "a clean worktree is not a valid
    //   precondition anywhere in that window" and the delegation-baseline duty. Nothing in
    //   this fragment is RETIRED by this change, and the HOLDERS enumeration above is
    //   unaffected: no fragment gained or lost a "worktree", "uncommitted" or "dirty" hit.
    'implement.md': '3dfe16ef355909c9bd04165dc4270fa231b68f06a0f7678f717510ab4b3ee6e7',
    // 20260630-225208: the severity sentence was replaced, not retired — draft warns on
    // everything; approved/in-progress errors on readiness defects, coverage gaps stay warnings.
    // 20260726-141122: the subjectless `Repos tune recognition with
    // readiness.target_patterns and readiness.verification_patterns` is
    // replaced by an obligation with a named subject: when starting work in a
    // repo, the agent verifies both keys match that repo's stack and
    // configures them when they do not. The `verification_patterns:
    // ["verify:"]` recommendation for device/manual checks and every other
    // readiness rule are preserved verbatim; nothing is retired.
    'readiness.md': 'dbeacd7eea9ff743839d99b1ecf0fdc12785b5b7d37849853210aa3ed837c452',
    'release.md': '1d51cbad5171eea307deb9ed0a8759ef9db9b6d901943a4b46902364393f949a',
    // 20260705-134702: "Record exactly one verdict" names the orchestrator as recorder.
    // 20260704-144327 correction: the delegate checklist/tool boundary moves to the
    // self-contained review capsule; this fragment keeps orchestration and verdicts
    // and points to that single checklist owner. Rules moved, none retired.
    // 20260715-122950: additive post-verdict formatter/check gate; existing
    // independent-review and verdict rules are preserved, none retired.
    // 20260722-124656: REPLACED — "The candidate reaches review only after host
    //   formatter and full gates" by the same order plus what a failure means:
    //   "only after the host formatter and full gates pass; a failure there means
    //   no reviewable candidate exists yet". The obligation is preserved and made
    //   decidable; `implement.md` states the same order in its ordered gate, so the
    //   two fragments no longer contradict each other.
    // ADDED — the no-verdict return: when a local gate, not a reviewer, fails once
    //   the candidate already reached `in-review`, `changeledger status <id>
    //   in-progress` is the named path, and `changeledger review <id> fail --retry`
    //   is forbidden for a failure no reviewer emitted. This obligation had no
    //   prior home anywhere in the contract — grepped for "no-verdict" and for
    //   "status <id> in-progress" across `templates/contract/`, and `review.md` is
    //   the only holder — and this fragment owns the verdict commands, so it is
    //   where the prohibition binds. Nothing is retired or moved.
    // 20260727-194234: RETIRED to core.md — "A review verdict alone needs no
    //   commit" is core's "A lifecycle transition ... is never a commit of its
    //   own"; "Handoff may use the implementation contract's checkpoint" is
    //   core's Handoff class — "mandatory whenever work stops in `blocked` or a
    //   session ends with uncommitted state" since 20260728-164620, "zero or one, only
    //   when work stops" when 194234 retired the copy — which is also
    //   where the checkpoint now lives, so the pointer had lost its target.
    //   PRESERVED: what a pass does with an uncommitted correction, that retry
    //   keeps the diff isolated, and the whole `fail --retry` block — review-phase
    //   behaviour, not the commit unit.
    'review.md': 'c88c67ead5c241e8080cb776ac970c9c56a2e81e20b2f963d65e37c424d509c5',
    // 20260711-103756: the type enum and activation matrix gain the `quick`
    // row, plus a new paragraph documenting its eligibility and the
    // discard-and-recreate rule for scope growth. Existing rules preserved.
    // 20260711-103758: additive — a mandate to run `changeledger search` before
    // writing Investigation, plus the command's line in Authoring helpers.
    // Every existing rule preserved, none retired or replaced.
    // 20260715-125139: additive explicit-prompt requirement for conversational
    // draft approval; existing authoring authorization rules are preserved.
    // 20260716-131649: the list helper is extended with owner, pending and
    // archive-visibility filters; existing authoring rules are preserved.
    // 20260718-105456: additive related_to scaffold and non-blocking semantics;
    // correction first added search-result classification, then generalized it
    // to every discovery source and forbade leaving an explicit local id only in prose;
    // existing dependency execution and authoring rules are preserved.
    // 20260720-125007: task state metadata and Log events become explicit
    // structured records; the former punctuation-delimited forms are retired.
    // 20260726-141119: the activation matrix marks `specification` active for
    // `refactor`, so a type that requires independent review always carries
    // verifiable criteria. Every other row and rule is preserved.
    // 20260726-124836: REPLACED — "`approved → in-progress` assigns an absent
    //   owner via `gh api user --jq .login`, then `git config user.name`" by the
    //   full cycle: `new` resolves the identity at creation, an explicit
    //   `--owner` wins, and the `in-progress` assignment survives as the net that
    //   fills an owner still absent. The override command and the meaning of
    //   absence are preserved verbatim; no obligation is retired. A clean-context
    //   reviewer caught this fragment still stating the pre-change origin, which
    //   matters because this is the contract served to consuming repos.
    'spec.md': '408de70dc6cd431e39a02a6ce4fc17857b608a70f8a12aec24c551d5a076b285',
    // 20260703-220014: added that the stop is scoped to this change, names the blocking
    // depends_on chain and stops entirely only when every candidate is blocked.
    // 20260715-122950: additive final-mutation gate for reviewed and direct
    // validation paths; human-only acceptance rules are preserved, none retired.
    // 20260715-125139: viewer-only wording is replaced by viewer or explicit
    // conversation decisions; human ownership and non-inference are preserved.
    // Review correction restored Specification/Plan updates, wider-scope change
    // creation, host-only gates and lifecycle/graduation closure evidence.
    // 20260727-194234: RETIRED to core.md — "The validation transition alone
    //   does not require a dedicated commit" is core's "A lifecycle transition ...
    //   is never a commit of its own". PRESERVED verbatim: the pointer to the
    //   close overlay's final commit after acceptance and the isolation of
    //   unconfirmed corrections after rejection.
    'validation.md': 'b758e66cef7e1be231a02616f527ca0c62c00e265185b1091305cfa9dcd4f42b',
  };
  const contractDir = new URL('../templates/contract/', import.meta.url);
  const actualFiles = fs
    .readdirSync(contractDir)
    .filter((file) => file.endsWith('.md'))
    .sort();
  assert.deepEqual(actualFiles, Object.keys(expected), 'contract fragment inventory changed');

  for (const [file, digest] of Object.entries(expected)) {
    const normalized = fs
      .readFileSync(new URL(file, contractDir), 'utf8')
      .replace(/\s+/g, ' ')
      .trim();
    assert.equal(
      createHash('sha256').update(normalized).digest('hex'),
      digest,
      `${file} changed: classify every affected rule as preserved, replaced or retired; update this reviewed snapshot only intentionally`,
    );
  }
});

test('210115 CR3: implement instructs branching from the declared integration branch', () => {
  const root = repo();
  const output = buildContext('implement', root);
  const normalized = output.replace(/\s+/g, ' ');
  assert.match(
    normalized,
    /When the config declares `git\.integration_branch`, create change branches from it and integrate the finished result into it; `main` stays reserved for releases\./,
  );
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

  assert.match(first, /Routine release preparation is operational work\./);
  assert.doesNotMatch(first, /# ChangeLedger — Core Contract/);
  assert.match(first, /This incremental context extends the complete core context already read/);
  assert.match(first, /one-pass full-capture rule applies here/i);
  assert.match(first, /a partial view is invalid/i);
  assert.match(
    first,
    /Version bumps, release manifests, quality gates, packaging, commits, tags and publishing do not require a ChangeLedger change by themselves\./,
  );
  assert.match(first, /Do not create a change only to group those routine steps\./);
  assert.match(first, /functional fix, release-workflow change or persistent documentation/);
  assert.match(
    first,
    /rerun `changeledger release plan` before `changeledger release record <version>`/,
  );
  assert.match(first, /do not assume npm, GitHub or specific manifest filenames/i);
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
  // Core points to per-context policy instead of the raw config file.
  assert.match(core, /each context delivers the effective policy/i);
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

test('220014 CR1/CR4: core and validation scope the stop to one change, not the queue', () => {
  const root = repo();
  const validationId = addChange(root, 'in-validation', '20260628-000001');
  const core = buildContext(undefined, root).replace(/\s+/g, ' ');
  const validation = buildContext(validationId, root).replace(/\s+/g, ' ');
  // 20260726-124835 amendment: core owns the scoped reading again. Whether to
  // start another change or idle is decided before any overlay is loaded, so the
  // rule cannot live only in validation.md, which composes for one change.
  assert.match(core, /It stops only that change/);
  assert.match(
    core,
    /start another approved change unless its direct or transitive `depends_on` chain reaches one in `in-validation`/,
  );
  assert.match(
    validation,
    /start another approved change unless its direct or transitive `depends_on` chain reaches one in `in-validation`/,
  );
  assert.match(validation, /This stop is scoped to this change/);
  assert.match(validation, /stops entirely/);
  assert.match(validation, /does not invent work or touch delivered\s+results/);
});

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
  // Orchestrator review keeps independence, verdict mechanics and handoff.
  assert.match(review, /# Independent Review/);
  assert.match(review, /agent-context review <id>/);
  assert.match(review, /changeledger review <id> pass/);
  assert.match(review, /# Handoff Triage/);
  // The delegated capsule owns the inspection surface and read-only boundary.
  assert.match(delegate, /do not trust the implementer's summary/);
  assert.match(delegate, /every `CRn`, every Plan task, tests, the actual diff/);
  assert.match(delegate, /read-only/);
  assert.doesNotMatch(delegate, /changeledger review <id> pass/);
  // Review no longer carries the general delegation guide the reviewer does not need.
  assert.doesNotMatch(review, /# Economical Delegation/);
  assert.doesNotMatch(review, /Do not over-shard/);
  assert.doesNotMatch(review, /Delegation prompt contract/);

  // Implement keeps its actionable contract but drops authoring/config detail.
  const implement = buildContext('implement', root);
  assert.match(implement, /# Implementing an Approved Change/);
  assert.match(implement, /Tick\s+tasks as they become true/);
  assert.match(implement, /# Handoff Triage/);
});

test('134702/122950 CR1/CR2: the review gate is one ordered recipe owned by implement', () => {
  const root = repo();
  const validationId = addChange(root, 'in-validation', '20260715-122950');
  const norm = (s) => s.replace(/\s+/g, ' ');
  const implement = norm(buildContext('implement', root));
  const review = norm(buildContext('review', root));
  const core = norm(buildContext(undefined, root));

  // CR1: implement carries the complete ordered recipe, including post-mutation gates.
  assert.match(implement, /move to `in-review` if the type requires independent review/);
  assert.match(
    implement,
    // 20260722-124656 reordered steps 2 and 3: the local gate decides whether a
    // reviewable candidate exists, so it runs before the lifecycle claims review
    // started, and step 4 revalidates only what the transition altered.
    // 20260728-164620 inserted step 5, the single implementation commit, so the
    // reviewer is delegated against a fixed range; every later step shifts by one.
    /1\..*Plan task.*2\..*formatter.*full gates.*3\..*`changeledger status <id> in-review`.*4\..*Reapply the formatter.*5\..*implementation commit.*6\..*`changeledger context review` once.*7\..*read-only reviewer.*8\..*`changeledger review <id> pass\|fail`.*9\..*formatter again.*affected checks.*`changeledger check`/,
  );
  assert.match(implement, /never `log`\+`status`/);
  assert.match(implement, /do not reload it to record the verdict unless context was lost/);
  assert.match(
    implement,
    /`in-validation`: human accepts; agent rejects with `changeledger validation <id> fail/,
  );
  assert.match(
    implement,
    /without `review_required`.*post-transition formatter.*affected-check gate/,
  );
  assert.match(review, /After recording any verdict.*formatter.*`changeledger check`/);
  assert.match(
    buildContext(validationId, root),
    /final lifecycle\s+mutation[\s\S]*`changeledger check`/,
  );
  assert.match(implement, /mutations never run configurable hooks or external formatters/);

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
  const review = norm(reviewOutput);

  // CR1: the gate step precedes the transition step in the ordered recipe.
  const gate = implement.indexOf('Apply the local formatter and full gates');
  const transition = implement.indexOf('`changeledger status <id> in-review`');
  assert.notEqual(gate, -1, 'implement no longer names the local gate step');
  assert.notEqual(transition, -1, 'implement no longer names the in-review transition');
  assert.ok(gate < transition, 'the local gate must precede the in-review transition');
  assert.match(
    implement,
    /2\. Apply the local formatter and full gates, including `changeledger check`, to the exact review candidate\. 3\. `changeledger status <id> in-review`\./,
  );

  // CR1: review states the same order instead of contradicting it.
  assert.match(
    review,
    /The candidate reaches review only after the host formatter and full gates pass/,
  );
  assert.doesNotMatch(implement, /`changeledger status <id> in-review`\. \d+\. Apply the local/);

  // CR2: the no-verdict return is named and the fabricated verdict forbidden.
  assert.match(
    review,
    /return it with `changeledger status <id> in-progress`, the no-verdict path/,
  );
  assert.match(
    review,
    /never `changeledger review <id> fail --retry` for a failure no reviewer emitted/,
  );

  // CR4: only what the transition altered is revalidated, and any later
  // alteration of the candidate repeats the affected verifications.
  assert.match(
    implement,
    /Reapply the formatter to the change document and run `changeledger check`/,
  );
  assert.match(
    implement,
    /if the candidate changes again before the reviewer sees it, repeat every affected verification/,
  );

  // CR5: a type without review passes the same gate, and gains no review gate.
  assert.match(
    implement,
    /Types without `review_required` pass the same local gate before `changeledger status <id> in-validation`/,
  );
  assert.match(review, /do not invent a review gate for them/);

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
  assert.match(close, /`--into` refuses an unrefined marked scaffold/);
  // Existing-spec and skip remain explicit alternatives.
  assert.match(close, /For an existing spec/);
  assert.match(close, /changeledger graduate <id> --skip \[reason\]/);

  // CR3: the reviewed:true nuance sits with the recipe steps.
  assert.match(close, /sets `reviewed: true`/);

  // CR2: core keeps only the trigger; no two-step procedure summary.
  // 20260726-124835: the trigger shrank to the reload plus the owner, so not even
  // the `--skip` command survives in core.
  assert.match(core, /reload `changeledger context <id>`/);
  assert.match(core, /the close overlay owns graduation and archive/);
  assert.doesNotMatch(core, /changeledger graduate <id> --skip \[reason\]/);
  assert.doesNotMatch(core, /a new spec is a two-step/);
});

test('134703 CR1/CR2/CR3: one matrix owns lifecycle topology and mechanisms', () => {
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
  // 20260726-124835: the non-inference rule became an invariant, reworded.
  assert.match(
    norm,
    /A human verdict is transmitted, never inferred; praise, “continue” or agent advice is not a decision/,
  );

  // CR1: status never owns done or discarded.
  assert.doesNotMatch(norm, /done \| agent \| `changeledger status`/);
  assert.doesNotMatch(norm, /discarded \| agent \| `changeledger status`/);

  // CR2: ownership prose and the parallel topology diagram are both gone.
  assert.doesNotMatch(norm, /The viewer owns `draft → approved`/);
  assert.doesNotMatch(core, /draft → approved → in-progress/);
  // CR2: non-ownership rules survive as a note.
  assert.match(norm, /discard reason is required and logged/);
  assert.match(norm, /`discarded` never reopens/);
  assert.match(norm, /A `done` change can reopen only to finish its original scope/);
});

test('144327 CR5: core discovers agent-prompt before a draft exists, within budget', () => {
  const root = repo();
  const core = buildContext(undefined, root);
  const norm = core.replace(/\s+/g, ' ');
  // The minimum delegation rule points at the on-demand skeleton command.
  // 20260726-124835: same pointer and same four roles, shorter wording.
  assert.match(
    norm,
    /Get the prompt skeleton from `changeledger agent-prompt <role>` \(investigation \| implementation \| review \| post-review\)/,
  );
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
  // CR1: the delegation-prompt summary reads as a minimum, not a complete list.
  // 20260726-124835: core stopped listing the minimum elements at all and now
  // names the owner instead, which is the strongest form of the same deferral.
  assert.match(core, /the stage context owns what the prompt must contain/);
  assert.doesNotMatch(core, /ownership, expected output and integration criterion/);
  // CR2: graduation is not a settled binary — core offers graduate OR skip and
  // defers the --new/--into two-step to the close overlay (20260705-134704).
  assert.match(core, /the close overlay owns graduation and archive/);
  assert.doesNotMatch(core, /a new spec is a two-step/);
  assert.ok(core.length > 0);
});

// 20260711-103756 CR5: the spec context documents the `quick` lane, its
// eligibility and the discard-and-recreate rule for scope growth.
test('103756 CR5: spec context documents the quick lane and its eligibility', () => {
  const root = repo();
  const spec = buildContext('spec', root).replace(/\s+/g, ' ');
  assert.match(spec, /quick/);
  assert.match(spec, /single-concern work that adds no public surface\s+or persistent truth/);
  assert.match(spec, /discard and recreate it under the correct type/);
  assertWithinBudget('spec', buildContext('spec', root), contextBudgets.base.spec);
});

test('105456 CR8 correction: spec context makes agents populate discovered relations', () => {
  const root = repo();
  const spec = buildContext('spec', root).replace(/\s+/g, ' ');
  assert.match(
    spec,
    /during Investigation, classify every relevant change discovered.*regardless of whether it came from `search`, `list`, direct reading, context or conversation/,
  );
  assert.match(spec, /execution prerequisite.*`depends_on`/);
  assert.match(spec, /useful context without execution order.*`related_to`/);
  assert.match(spec, /explicit local change id must not remain only in prose/);
  assert.match(spec, /declare a local relation once, deriving its backlink/);
});

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
test('141122 CR6: readiness obliges the agent to match the two keys to the stack', () => {
  const root = repo();
  const output = buildContext('spec', root);
  const normalized = output.replace(/\s+/g, ' ');
  assert.doesNotMatch(normalized, /Repos tune recognition with/);
  assert.match(
    normalized,
    /When starting work in a repo, the agent verifies that `readiness\.target_patterns` and `readiness\.verification_patterns` match that repo's stack, and configures them when they do not\./,
  );
  assert.match(
    normalized,
    /For device\/manual checks, prefer the stable structural convention `verification_patterns: \["verify:"\]`/,
  );
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

test('194234 CR1/CR2/CR3: each overlay drops the copy and keeps its own phase', () => {
  const root = repo();
  // review: the verdict-commit rule goes, the correction rules stay.
  const review = buildContext('review', root);
  assert.doesNotMatch(review, /A review verdict alone needs no commit/);
  assert.doesNotMatch(review, /Handoff may use the implementation contract's checkpoint/);
  assert.match(
    review,
    /After `fail --retry`, the correction remains uncommitted until another fresh/,
  );
  assert.match(review, /After pass, commit correction \+ ledger before asking/);
  // in-validation overlay: the transition-commit rule goes, the pointers stay.
  const validation = buildContext(addChange(root, 'in-validation'), root);
  assert.doesNotMatch(validation, /does not require a dedicated commit/);
  assert.match(validation, /make the close overlay's final commit/);
  assert.match(validation, /After rejection, isolate\s+unconfirmed corrections/);
  // close overlay: the prohibition goes, the closure commit's content stays.
  const close = buildContext(addChange(root, 'done'), root);
  assert.doesNotMatch(close, /Do not create separate commits whose only/);
  assert.match(close, /one final closure commit that coalesces any/);
  assert.match(close, /the graduation\s+or skip itself remains the meaningful closure evidence/);
});

test('194234 CR4: the commit unit has a single home', () => {
  const root = repo();
  const fragments = fs
    .readdirSync(contractFragments)
    .filter((name) => name.endsWith('.md'))
    .map((name) => [name, fs.readFileSync(new URL(name, contractFragments), 'utf8')]);
  for (const copy of RETIRED_COPIES) {
    const holders = fragments.filter(([, text]) => text.includes(copy)).map(([name]) => name);
    assert.deepEqual(holders, [], `retired copy still present: ${copy}`);
  }
  // The obligation itself lives in core and nowhere else.
  const obligation = 'is never a commit of its own';
  const holders = fragments.filter(([, text]) => text.includes(obligation)).map(([name]) => name);
  assert.deepEqual(holders, ['core.md']);
  // And the packs that used to repeat it no longer compose it.
  assert.match(buildContext(undefined, root), new RegExp(obligation));
  for (const mode of ['review', 'implement']) {
    assert.doesNotMatch(buildContext(mode, root), new RegExp(obligation));
  }
  for (const status of ['in-validation', 'done']) {
    const id = addChange(root, status);
    assert.doesNotMatch(buildContext(id, root), new RegExp(obligation));
  }
});

test('194234 CR5: each retirement names its new home and the home holds it', () => {
  const suite = fs.readFileSync(new URL('./context.test.mjs', import.meta.url), 'utf8');
  const core = fs.readFileSync(new URL('core.md', contractFragments), 'utf8');
  for (const fragment of ['review.md', 'validation.md', 'close.md']) {
    // The comment block immediately above the pin is where the classification
    // lives; requiring the sede by name is what stops a vague "retired".
    const pin = suite.indexOf(`'${fragment}':`);
    assert.notEqual(pin, -1, `${fragment} has no snapshot pin`);
    const comment = suite.slice(Math.max(0, pin - 1200), pin);
    assert.match(comment, /RETIRED to core\.md/, `${fragment} does not name core.md as the home`);
  }
  // The named home really holds the obligation — grep of the obligation itself,
  // not of similar words.
  assert.match(core, /is never a commit of its own/);
  // 20260728-164620 reworded the class: the handoff is mandatory when work stops,
  // so the home is the same sentence under its new multiplicity.
  assert.match(core, /\*\*Handoff\*\*: mandatory whenever work stops/);
});

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
  'base.spec': { tokens: 3450, lines: 345 },
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
// core, contexts, everything else — not eleven independent numbers. `base.spec`
// is the one declared exception: it is above the 2500 contexts share because it
// measures 3110 tokens today, so lowering it now would break the tree. The
// scaffold marker lives in the entry itself (`194233 CR1` above pins its shape),
// so a future reader cannot mistake 3450 for a settled decision the way this
// change's own draft once did.
test('20260728-212043 CR7: token ceilings are the three decided values, and spec is marked scaffold', () => {
  assert.equal(contextBudgets.base.core.tokens, 4000, 'core token ceiling moved');
  for (const context of ['implement', 'review', 'release']) {
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
  assert.equal(contextBudgets.base.spec.tokens, 3450, 'spec token ceiling moved');
  assert.match(
    contextBudgets.base.spec.scaffold,
    /temporary/i,
    'spec must declare its scaffold status in the file itself',
  );
  assert.match(
    contextBudgets.base.spec.scaffold,
    /refactor/i,
    'spec scaffold marker must name its exit condition',
  );
});

// 20260728-170429 replaced the byte dimension with tokens: this criterion now
// reads against the two dimensions the budget file declares today.
test('194233 CR1: every budget entry declares one flat threshold per dimension', () => {
  for (const [label, budget] of budgetEntries()) {
    // 20260728-212043: `base.spec` alone also carries a `scaffold` marker
    // string, declaring in the file itself that its token ceiling is temporary
    // — see `212043 CR7` below. Every other entry stays exactly tokens+lines.
    const expectedKeys = label === 'spec' ? ['lines', 'scaffold', 'tokens'] : ['lines', 'tokens'];
    assert.deepEqual(
      Object.keys(budget).sort(),
      expectedKeys,
      `${label} does not declare exactly ${expectedKeys.join(' and ')}`,
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

test('124835 CR2/CR3: the identity and the intent table route before any load', () => {
  const core = composedCore();
  for (const literal of [
    'Work is documented before code',
    'changes under `.changeledger/changes/` are authorized work; specs under `.changeledger/specs/` are persistent truth',
    'The human decides and the agent executes',
    'Every stage overlay is the authority for its stage; core never duplicates it',
    "Classifying the human's intent is free and mandatory on every message",
    'never load one speculatively and never reload one already held',
    '| Intent | First action |',
  ]) {
    assert.ok(core.includes(literal), `core is missing ${literal}`);
  }
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

test('124835 CR4/CR5: work is split by owner and the delegate is sized portably', () => {
  const core = composedCore();
  for (const literal of [
    'Context exhaustion causes compaction, and compaction causes drift and invented facts',
    'Reading code and writing code are the two heaviest consumers',
    'delegate them by default',
    'inline only when trivially small',
    '| Work | Owner |',
    '| reading or searching beyond ~3 files to answer one question | subagent |',
    // 20260729-111349 REPLACED: the row named "any implementation task", whose
    // quantifier pushed one delegation per Plan task. The obligation is preserved —
    // implementation work with its own verify command is still the subagent's — and
    // only the per-task quantifier is retired. Sizing the group is CH-5b's content,
    // deliberately absent here rather than duplicated.
    '| implementation work with its own verify command | subagent |',
    '| independent review of finished work | subagent with a fresh clean context |',
    '| reading a change document, a spec or CLI output | orchestrator |',
    '| talking to the human, deciding scope, integrating results | orchestrator, never delegated |',
    'Every delegation is one level deep: a subagent never delegates further',
    'One owner per write surface',
    'concurrent subagents must not share files',
    'Get the prompt skeleton from `changeledger agent-prompt <role>` (investigation | implementation | review | post-review)',
    'the stage context owns what the prompt must contain',
    'A subagent returns findings or a diff receipt, not narrative',
    "Size the delegate to the work, not to the caller's convenience",
    'cheapest tier and low effort for mechanical lookups and bounded mechanical edits',
    'mid tier for bounded reasoning over a single surface',
    'top tier and high effort for deep analysis, ambiguity, cross-cutting design and adversarial review',
    'Default to mid tier when unsure',
    'Under-sizing a hard task produces rework the orchestrator pays for twice',
  ]) {
    assert.ok(core.includes(literal), `core is missing ${literal}`);
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

test('124835 CR6/CR7: invariants, exit gates, the ceiling and commits carry the decided text', () => {
  const core = composedCore();
  for (const literal of [
    'No artifact without explicit human authorization',
    // 20260726-124835 amendment: three obligations the rewrite retired without a
    // criterion are restored, because they govern the flow and core owns flow.
    // The documentation precondition and the anti-invention prohibition were
    // homeless — zero hits across templates/ and src/ — so nothing else carried
    // them.
    'enough clarity to document faithfully',
    'a direct request such as “create the change” is authorization',
    'never invent missing requirements',
    // The stop is scoped to one change: "keep working or idle?" is decided with
    // core alone, before any overlay is loaded.
    'It stops only that change',
    "never accept on the human's behalf",
    'reject with a reason and start another approved change',
    'unless its direct or transitive `depends_on` chain reaches one in `in-validation`',
    // The bootstrap owns the FIRST capture and its END validity condition; core
    // owns that every capture, incremental ones included, is read complete.
    'Every context capture is read complete in one pass',
    'a partial view is invalid',
    'Never implement a `draft`',
    'One change at a time, on a non-main branch',
    'Keep lifecycle, tasks, ownership and Log current',
    'Pre-existing divergence between specs and code is reported to the human, never reconciled by inference',
    'Wait if it affects the current task',
    'if unrelated, report it without expanding scope',
    'A human verdict is transmitted, never inferred',
    'praise, “continue” or agent advice is not a decision',
    'No silent repository edits when no change applies',
    'reload `changeledger context <id>`',
    'the close overlay owns graduation and archive',
    'If no approved or in-progress change applies, do not silently edit repository files',
    'ask the human whether a purely operational, reversible edit with no persistent truth or observable behavior change should be done directly',
    'If unsure, document it in ChangeLedger',
    'For small, reversible, single-concern work with observable behavior, use the `quick` type instead of bypassing documentation',
    'Every stage verifies its own output; no stage depends on the next one to learn whether its work is correct',
    'The exit transition of a stage is its self-verification point',
    'the implementer proves the change meets its criteria before requesting review',
    'The reviewer is the last line of defence, not a design oracle and not a source of requirements',
    "A review finding that the previous stage's own exit criteria should have caught is a defect of that stage, not a normal review round",
    'A change must be implementable and verifiable in one bounded pass',
    'If it cannot, split it before approval — an oversized change is the most common root cause of repeated review rounds',
    '`changeledger context spec` owns the sizing test and the split criteria',
    'After work has started, a failed verification is diagnosed, never auto-split: the blocked and review contexts own that classification',
    // 20260726-124837 replaced this block's four-line summary with the full seat
    // of commit behaviour; the 124837 CR2/CR4-CR6 tests own its text, and what
    // stays here is the per-unit and per-baseline obligation this criterion
    // decided, in the wording that now carries it. 20260728-164620 moved the unit
    // from the Plan task to the change, so the first literal is its class.
    // 20260729-111349 REPLACED the unit again — the resolved selection of work, with
    // no fixed number per change. The per-unit obligation this criterion decided is
    // preserved: the work still travels with its tests, boxes and Log, now per
    // selection instead of per change.
    '**Implementation**: one per resolved selection of work',
    '**Baseline**: exactly one, the approved change document, before any code',
    'is never a commit of its own; it travels inside the next real class',
    'Subjects follow `type(scope): description [#<id>]`',
  ]) {
    assert.ok(core.includes(literal), `core is missing ${literal}`);
  }
});

test('124835 CR8/CR9: lifecycle, modes and operational discovery survive the rewrite', () => {
  const raw = buildContext(undefined, repo());
  const core = raw.replace(/\s+/g, ' ');
  for (const literal of [
    '`draft`: documentation awaiting human approval; no implementation',
    '`approved`: ready to start after the Git/worktree checks',
    '`in-progress`: implementation underway',
    '`in-review`: independent review required',
    '`in-validation`: stop for human acceptance or a reasoned rejection',
    '`blocked`: an impediment or decision needs resolution',
    '`done`: the human accepted the complete result; provisional until durable closure',
    '`discarded`: terminal tombstone; never reopen it',
    '| Transition | Owner | Mechanism |',
    '`changeledger status <id> <status>` performs agent-owned moves and does not accept `approved`, `done`, `discarded` or reopening',
    'discard reason is required and logged',
    '`discarded` never reopens',
    'A `done` change can reopen only to finish its original scope',
    'Valid modes: implement, review, spec, release',
    '`changeledger context <change-id>`: infer the correct context from lifecycle',
    'extends the core context already read; it never repeats it',
    '`changeledger list --status approved`',
    '`changeledger list --pending graduation`',
    '`changeledger list --pending archive`',
    '`changeledger search <terms...>`',
    'before scanning files',
    'Each context delivers the effective policy that applies to its task, so you never read `.changeledger/config.yml` raw to operate',
  ]) {
    assert.ok(core.includes(literal), `core is missing ${literal}`);
  }
  // The matrix keeps exactly ten rows of three columns; 134703 owns their text.
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
    'Files are the source of truth and may be edited directly',
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

// 20260726-124835 CR11 — the rewrite pushes stage detail out of core, so every
// rule that leaves must be provably still owned somewhere, and the two sentences
// the human decided NOT to move must provably stay in core: relocating them into
// `delegation.md` and `spec.md` added 205 bytes to the composed `spec` pack,
// overflowing its hard byte cap by 41, so `budgets.yml` and every fragment other
// than `core.md` stay untouched by this change.
test('124835 CR11: retired rules keep their owner and the retained sentences stay in core', () => {
  const root = repo();
  const validationId = addChange(root, 'in-validation', '20260726-124801');
  const doneId = addChange(root, 'done', '20260726-124802');
  const norm = (text) => text.replace(/\s+/g, ' ');
  const core = norm(buildContext(undefined, root));
  const implement = norm(buildContext('implement', root));
  const review = norm(buildContext('review', root));
  const validation = norm(buildContext(validationId, root));
  const close = norm(buildContext(doneId, root));
  const contractDir = new URL('../templates/contract/', import.meta.url);
  const fragment = (file) => norm(fs.readFileSync(new URL(file, contractDir), 'utf8'));
  const delegation = fragment('delegation.md');

  for (const pattern of [
    /one subagent per file, line or tiny mechanical edit/,
    /parallel agents over the same files or conceptual surface/,
    /strongest available models for ambiguous scope/,
    /for roles that write, the expected baseline \(branch or commit\) the delegate must verify/,
  ]) {
    assert.match(delegation, pattern, `delegation.md is missing ${pattern}`);
  }

  // Retained in core, and absent from the fragment each one would have moved to.
  const postReview =
    /`post-review` is a read-only inspection of a change already in `in-validation`; it never issues a verdict or moves the change/;
  assert.match(core, postReview);
  assert.doesNotMatch(delegation, postReview);
  const viewer = /Humans consume changes in `changeledger view`; write for the rendered view/;
  assert.match(core, viewer);
  assert.doesNotMatch(fragment('spec.md'), viewer);

  // Each rule core stops carrying is asserted in the overlay that owns it.
  // 20260726-124837 reversed this one: the baseline commit came back to core as
  // part of the single seat of commit behaviour, and `implement.md` must no
  // longer carry it, so the claim is pinned in both directions.
  assert.match(
    core,
    /\*\*Baseline\*\*: exactly one, the approved change document, before any code/,
  );
  assert.doesNotMatch(implement, /baseline commit/);
  // Old rule 6 was classified MOVED to review.md and no test pinned it, so the
  // claim could rot silently — the exact defect class the review flagged for the
  // other moved rules. Pinned here in the overlay's own wording.
  assert.match(
    review,
    /Review-required work must be checked by a fresh subagent with clean context/,
  );
  assert.match(validation, /This stop is scoped to this change/);
  assert.match(
    validation,
    /direct or transitive `depends_on` chain reaches one in `in-validation`/,
  );
  assert.match(close, /changeledger graduate <id> --skip \[reason\]/);
});

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
  const contractDir = new URL('../templates/contract/', import.meta.url);
  for (const file of fs.readdirSync(contractDir).filter((name) => name.endsWith('.md'))) {
    assert.ok(
      !contractFragment(file).replace(/\s+/g, ' ').includes(judgment),
      `${file} still carries the attribution judgment`,
    );
  }
});

// 20260728-164620 took over the class list and the counting formula: five classes
// instead of four, and a per-change count instead of `n` per completed task. The
// `164620 CR1` test owns the new list; what survives here is everything 124837
// contributed that the new unit does not touch — the granularity test, the
// transition rule and the change-document rationale.
test('124837 CR2 / 164620 CR1: core owns the commit classes and the granularity test', () => {
  const core = composedCore();
  for (const literal of [
    '**Draft**: one per drafted change document, committed on its own — never several drafts in one commit',
    '**Baseline**: exactly one, the approved change document, before any code',
    'Granularity follows one test: whether the unit will be reverted, referenced or implemented independently',
    'A lifecycle transition is not — the Log already records it, so its commit would only duplicate that — and is never a commit of its own; it travels inside the next real class',
    'A change document is: a later implementation branch builds on it, `changeledger check --commits` references it by id, and it can be discarded alone',
    'never one per transition',
  ]) {
    assert.ok(core.includes(literal), `core is missing ${literal}`);
  }
});

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
  for (const literal of [
    'Never implement approved changes on `main`, `master`, or `dev`',
    'create or switch to a work branch or ask the human before continuing',
    'When the config declares `git.integration_branch`, create change branches from it and integrate the finished result into it; `main` stays reserved for releases',
    'Inspect the worktree first',
    'If unrelated changes exist, do not include them silently; ask the human whether to stash, commit, ignore or include them before changing the worktree',
  ]) {
    assert.ok(implement.includes(literal), `the implement pack lost the Git rule ${literal}`);
  }
});

test('124837 CR4: the message mechanics survive whole in core', () => {
  const core = composedCore();
  for (const literal of [
    'Subjects follow `type(scope): description [#<id>]` with the real id and conventional type',
    'One change keeps its marker at the end of the subject',
    'two or more keep the subject clean and use one canonical body line, `ChangeLedger: [#A] [#B]` — never a comma list in one bracket',
    'Ledger meta-commits (status, review, log, archive) carry markers like any other; only merge commits, `chore(release)` prep and a `ChangeLedger: none — <reason>` body are exempt',
    '`changeledger commit -m "<type>(<scope>): <desc>" [--id <id>]` composes and creates it, resolving the single `in-progress` change when `--id` is omitted and failing without committing if that is ambiguous or the subject is not conventional',
    'Run `changeledger check --commits [<base>]` before requesting review',
  ]) {
    assert.ok(core.includes(literal), `core is missing ${literal}`);
  }
});

// 20260728-164620 emptied the second of the two forms 124837 landed, so only the
// shared-files form survives; `164620 H4/H5` owns the retirement and its guard.
test('124837 CR5 / 164620 H4: the unavoidable combined commit keeps its surviving form', () => {
  const core = composedCore();
  for (const literal of [
    'A combined commit is legitimate only when separation is impossible: several changes share the same files',
    'Record in the Log what was combined and why',
  ]) {
    assert.ok(core.includes(literal), `core is missing ${literal}`);
  }
});

test('124837 CR6: the contract requires inspecting the staged set after a hook failure', () => {
  const core = composedCore();
  for (const literal of [
    'A failed `pre-commit` hook leaves the index staged, so inspect the staged set (`git diff --cached --name-only`) before retrying',
    "fixing the cause is not enough if the index kept the previous attempt's files",
  ]) {
    assert.ok(core.includes(literal), `core is missing ${literal}`);
  }
});

// 20260728-212043: `base.core.lines` and the bootstrap's `head -400` literal in
// `src/contract.mjs` are now the same number by design, not a ceiling with a
// reserve above it — a reserve implied the `head` informed of size, which
// `170429` already rejected; the `END` sentinel is the only validity check.
// With equality neither can drift without the other moving too. The cut itself
// is parsed out of the published `REFERENCE` block rather than copied as a
// second literal, so the two can never diverge without this assertion's feet
// moving under it.
function bootstrapHeadCut() {
  const [, cut] = REFERENCE.match(/head -(\d+)/);
  return Number(cut);
}

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

// Every obligation that left `implement.md` is asserted here in core's own
// wording, so the pin comment's "retired to core.md" claims cannot rot silently.
test('124837 CR8: no obligation leaves implement.md without a named home', () => {
  const core = contractFragment('core.md').replace(/\s+/g, ' ');
  for (const [left, home] of [
    [
      'create a baseline commit of the approved change document before code',
      '**Baseline**: exactly one, the approved change document, before any code',
    ],
    // 20260728-164620 moved this obligation's home from the per-task class to the
    // per-change one: the work still travels with its tests, boxes and Log, but as
    // one unit for the whole change. 20260729-111349 moved it once more, to the
    // resolved selection: PRESERVED, since "completed units travel with their tasks
    // and Log" is exactly what the per-selection class states, and the unit it names
    // is now the one the granularity test actually admits.
    [
      'Commit completed units with their tasks and Log',
      '**Implementation**: one per resolved selection of work — its code, tests, ticked boxes and Log entries',
    ],
    [
      'Do not create a dedicated commit for a lifecycle-only transition',
      'is never a commit of its own; it travels inside the next real class',
    ],
    ['Coalesce it with the nearest meaningful commit', 'it travels inside the next real class'],
    // 'Do not wait until the end to reconstruct mixed diffs' is deliberately NOT in
    // this list any more. 20260728-164620 retired it instead of rehoming it: with
    // the change as the commit unit, deferring to the end of the implementation is
    // the rule, so the obligation has no home by design. `164620 CR5` is its guard
    // — it requires the retirement to be classified at the `core.md` pin and greps
    // every fragment to prove the clause really left.
    [
      'one consolidated checkpoint persists pending state',
      '**Handoff**: mandatory whenever work stops',
    ],
    [
      'Commit messages use the canonical shape',
      'Subjects follow `type(scope): description [#<id>]`',
    ],
    [
      'One change keeps its marker at the end of the subject',
      'One change keeps its marker at the end of the subject',
    ],
    ['never a comma list in one bracket', 'never a comma list in one bracket'],
    [
      'Ledger meta-commits (status, review, log, archive) carry markers',
      'Ledger meta-commits (status, review, log, archive) carry markers like any other',
    ],
    [
      'only merge commits and `chore(release)` prep are exempt',
      'only merge commits, `chore(release)` prep and a `ChangeLedger: none — <reason>` body are exempt',
    ],
    [
      'composes and creates the commit for you',
      '`changeledger commit -m "<type>(<scope>): <desc>" [--id <id>]` composes and creates it',
    ],
    [
      'run it before requesting review',
      'Run `changeledger check --commits [<base>]` before requesting review',
    ],
    ['If shared files make a combined commit unavoidable', 'several changes share the same files'],
  ]) {
    assert.ok(core.includes(home), `the obligation "${left}" has no home in core.md: ${home}`);
  }
  // And it really left: the retired wording is gone from every fragment.
  const contractDir = new URL('../templates/contract/', import.meta.url);
  const whole = fs
    .readdirSync(contractDir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => contractFragment(name))
    .join('\n')
    .replace(/\s+/g, ' ');
  for (const retired of [
    'Commit completed units',
    'Do not create a dedicated commit for a lifecycle-only transition',
    'Commit messages use the canonical shape',
  ]) {
    assert.ok(!whole.includes(retired), `the contract still carries the retired ${retired}`);
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
    // 20260728-212043: `base.spec` also carries a `scaffold` marker string;
    // see `194233 CR1` and `212043 CR7` for why that entry alone is wider.
    const expectedKeys = label === 'spec' ? ['lines', 'scaffold', 'tokens'] : ['lines', 'tokens'];
    assert.deepEqual(
      Object.keys(budget).sort(),
      expectedKeys,
      `${label} does not declare exactly ${expectedKeys.join(' and ')}`,
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
  // Recursive: the versioned `agent-contexts/` and `agent-prompts/` fragments
  // compose into agent capsules and ship to consuming repos exactly like the
  // top-level ones, so a top-level-only scan would leave them unchecked.
  const contractDir = new URL('../templates/contract/', import.meta.url);
  const declaring = fs
    .readdirSync(contractDir, { recursive: true })
    .filter((name) => name.endsWith('.md'))
    .filter((name) => /token/i.test(contractFragment(name)));
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
test('164620 CR1: core declares five commit classes and no per-task unit', () => {
  const core = composedCore();
  for (const literal of [
    'A change branch carries five commit classes and no others',
    '**Draft**: one per drafted change document',
    '**Baseline**: exactly one, the approved change document, before any code',
    '**Implementation**: one per resolved selection of work',
    '**Correction**: zero or more',
    '**Handoff**: mandatory whenever work stops',
  ]) {
    assert.ok(core.includes(literal), `core is missing the class ${literal}`);
  }
  // The retired unit and its formula, by literal: neither the class nor the count.
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

test('164620 CR2: the implementation commit precedes the review delegation', () => {
  const root = repo();
  const core = composedCore();
  // The class itself states when it is created and what the ordering buys.
  assert.ok(
    core.includes('before the review is delegated'),
    'core does not order the implementation commit before the review delegation',
  );
  assert.ok(core.includes('`baseline..HEAD`'), 'core does not name the reviewable range');

  // And the ordered gate really places the commit step before the delegation step.
  const implement = buildContext('implement', root).replace(/\s+/g, ' ');
  const commit = implement.indexOf('implementation commit with `changeledger commit`');
  const delegate = implement.indexOf('Delegate to a fresh, read-only reviewer');
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

test('164620 CR3: Correction is a declared class and review.md keeps the verdict behaviour', () => {
  const core = composedCore();
  assert.ok(
    core.includes(
      '**Correction**: zero or more, each left uncommitted until a fresh reviewer confirms it',
    ),
    'core does not declare the Correction class',
  );
  // review.md stays the seat of what a verdict does with the correction, and does
  // not gain a second copy of the class declaration.
  const review = contractFragment('review.md').replace(/\s+/g, ' ');
  assert.match(
    review,
    /After `fail --retry`, the correction remains uncommitted until another fresh/,
  );
  assert.match(review, /After pass, commit correction \+ ledger before asking/);
  assert.ok(!review.includes('**Correction**'), 'review.md duplicates the class declaration');
});

test('164620 CR4: the handoff is mandatory when work stops, not an optional zero-or-one', () => {
  const core = composedCore();
  assert.ok(
    core.includes(
      '**Handoff**: mandatory whenever work stops in `blocked` or a session ends with uncommitted state',
    ),
    'core does not make the handoff mandatory',
  );
  assert.ok(
    !core.includes('**Handoff**: zero or one'),
    'core still declares the handoff as an optional zero-or-one',
  );
  assert.ok(core.includes('record why it was needed'), 'the handoff lost its record-why duty');
});

test('164620 CR5: the retired reconstruction clause is classified, not silently deleted', () => {
  const clause = 'never defer them and reconstruct mixed diffs at the end';
  const suite = fs.readFileSync(new URL('./context.test.mjs', import.meta.url), 'utf8');
  const pin = suite.indexOf("'core.md':");
  assert.notEqual(pin, -1, 'core.md has no snapshot pin');
  const comment = suite.slice(0, pin);
  const entry = comment.lastIndexOf('20260728-164620');
  assert.notEqual(entry, -1, 'the core.md pin has no 20260728-164620 classification entry');
  const classification = comment.slice(entry);
  assert.ok(
    classification.includes(clause),
    'the classification does not quote the retired clause itself',
  );
  assert.match(classification, /RETIRED/, 'the clause is not classified as retired');
  // Naming the replacement is the whole point: "retired" alone would read as
  // "stopped mattering", and what happened is that a different unit took over.
  assert.match(
    classification,
    /a different commit unit replaces it/,
    'the retirement does not name the different commit unit that replaces the clause',
  );
  // Grep of the obligation itself, not of similar words: no fragment holds it.
  const contractDir = new URL('../templates/contract/', import.meta.url);
  const holders = fs
    .readdirSync(contractDir, { recursive: true })
    .filter((name) => name.endsWith('.md'))
    .filter((name) =>
      contractFragment(name).replace(/\s+/g, ' ').includes('reconstruct mixed diffs'),
    );
  assert.deepEqual(holders, [], 'a fragment still carries the retired reconstruction clause');
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

test('164620 CR7: implement names the expected dirty set of the implementation window', () => {
  const implement = buildContext('implement', repo()).replace(/\s+/g, ' ');
  for (const literal of [
    'Between `changeledger status <id> in-progress` and the implementation commit',
    'the change document stays modified and uncommitted',
    'the only expected delta',
    // Plural since the correction round: the window spans the entry into
    // `in-progress` and the exit into `in-review`, both before the commit.
    'carry those transitions inside the implementation commit',
    'a clean worktree is not a valid precondition',
  ]) {
    assert.ok(implement.includes(literal), `the implement pack is missing ${literal}`);
  }
  // The stage fact belongs to the stage overlay; core's taxonomy must not repeat it.
  const block = commitsBlockLines().join('\n').replace(/\s+/g, ' ');
  for (const duplicated of ['changeledger status <id> in-progress', 'expected delta']) {
    assert.ok(
      !block.includes(duplicated),
      `the core commits block duplicates the dirty-window declaration: ${duplicated}`,
    );
  }
});

// 20260728-164620 correction round. The first pass wrote a dirty-window paragraph
// whose expected set was the change document alone. Chained with the unrelated-work
// rule four lines above it, that ordered an agent to stop and ask the human about
// the change's own in-flight code — and by this change's own design (one commit at
// the end) that code is modified for almost the whole window: the tree carried five
// modified paths, not one, right before this change's implementation commit. The
// prose is fixed and pinned in both directions, because a merely reworded paragraph
// leaves nothing stopping the next reader from restating the false claim.
test("164620 CR7 correction: the expected set covers the change's own work and every transition", () => {
  const implement = buildContext('implement', repo()).replace(/\s+/g, ' ');
  for (const literal of [
    "and so do the change's own code and tests",
    'Together they are the only expected delta',
    'every `[status]` line the window accumulated',
    'the entry into `in-progress` and the exit into `in-review`',
    '"unrelated changes" above means a path belonging to neither the change document nor the change\'s authorized scope',
  ]) {
    assert.ok(implement.includes(literal), `the implement pack is missing ${literal}`);
  }
  // The three false formulations, by literal: none may come back.
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
  const commit = implement.indexOf('implementation commit with `changeledger commit`');
  assert.notEqual(commit, -1, 'the ordered gate has no implementation commit step');
  assert.ok(
    transition < commit,
    'the in-review transition no longer precedes the commit step, so the window no longer spans two transitions',
  );
});

// The enumeration inside the `implement.md` pin comment claims to name every
// fragment that mentions a worktree, uncommitted state or dirtiness. Its first
// version omitted two holders while its conclusion stayed true, and this repo has
// already carried four false pin-map comments, so the enumeration is asserted
// rather than trusted.
test('164620 H3: the dirty-set grep claim names every fragment holding one of those words', () => {
  const suite = fs.readFileSync(new URL('./context.test.mjs', import.meta.url), 'utf8');
  const pin = suite.indexOf("'implement.md':");
  assert.notEqual(pin, -1, 'implement.md has no snapshot pin');
  const entry = suite.slice(0, pin).lastIndexOf('20260728-164620');
  assert.notEqual(entry, -1, 'the implement.md pin has no 20260728-164620 entry');
  // The enumeration is delimited, so the assertion reads the list itself and not the
  // surrounding prose. Without the delimiters the first version of this guard passed
  // a mutant that deleted `core.md` from the list, because the sentence explaining the
  // omission mentioned `core.md` too — a match anywhere in the block was enough.
  const block = suite.slice(entry, pin);
  const open = block.indexOf('HOLDERS:');
  const close = block.indexOf('END HOLDERS.');
  assert.notEqual(open, -1, 'the pin comment has no HOLDERS list');
  assert.ok(close > open, 'the HOLDERS list is not delimited by END HOLDERS.');
  const comment = block.slice(open, close);
  const contractDir = new URL('../templates/contract/', import.meta.url);
  const holders = fs
    .readdirSync(contractDir, { recursive: true })
    .filter((name) => name.endsWith('.md'))
    .filter((name) => /worktree|uncommitted|dirty/.test(contractFragment(name)))
    .map((name) => name.split(path.sep).join('/'));
  assert.ok(holders.length > 1, 'the grep found nothing to enumerate');
  for (const holder of holders) {
    assert.ok(
      comment.includes(holder),
      `the grep claim does not name ${holder}, which holds one of those words`,
    );
  }
});

// 20260728-164620 emptied the second form of the combined commit: with the change as
// the unit, every Plan task travels in one commit by design, so "several Plan tasks
// are inseparable" can never be the reason separation is impossible. The clause is
// retired rather than left pinned, which is what the first pass did.
test('164620 H4/H5: the emptied combined-commit form and the stale unit sentence are gone', () => {
  const core = composedCore();
  assert.ok(
    core.includes(
      'A combined commit is legitimate only when separation is impossible: several changes share the same files',
    ),
    'core lost the surviving combined-commit form',
  );
  assert.ok(
    !core.includes('several Plan tasks are inseparable'),
    'core still offers inseparable Plan tasks as a reason to combine commits',
  );
  assert.ok(
    core.includes(
      'Record in the Log what was combined and why, naming every change that shares the surface',
    ),
    'core lost the duty to record and name what was combined',
  );
  const implement = buildContext('implement', repo()).replace(/\s+/g, ' ');
  assert.ok(
    !implement.includes('they do not relax intermediate commits for already verified units'),
    'implement still promises not to relax intermediate commits, which the new unit removed',
  );
  // 20260729-111349 CR7 REPLACED the singular by the plural: with N selections the
  // exceptions must not license leaving ANY of them uncommitted before review. The
  // obligation is preserved word for word apart from the number.
  assert.ok(
    implement.includes(
      'they cover corrections only, and never license leaving the implementation commits unmade before review',
    ),
    'implement does not say what the correction exceptions actually cover',
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
  // Recursive: the `agent-contexts/` and `agent-prompts/` fragments ship to consuming
  // repos exactly like the top-level ones, so a top-level-only sweep proves less.
  const contractDir = new URL('../templates/contract/', import.meta.url);
  const fragments = fs
    .readdirSync(contractDir, { recursive: true })
    .filter((name) => name.endsWith('.md'))
    .map((name) => name.split(path.sep).join('/'));
  assert.ok(fragments.length > 1, 'the fragment sweep found nothing to check');
  for (const retired of RETIRED_COMMIT_COUNT_LITERALS) {
    const holders = fragments.filter((name) =>
      contractFragment(name).replace(/\s+/g, ' ').includes(retired),
    );
    assert.deepEqual(holders, [], `a contract fragment still carries the retired "${retired}"`);
  }
  const core = composedCore();
  for (const literal of [
    '**Implementation**: one per resolved selection of work',
    'committed as soon as that selection is resolved, without waiting for the rest',
    'the number of implementation commits per change is not fixed',
    // The granularity test is applied to the unit that passes it instead of jumping
    // from the task straight to the change.
    'A resolved selection of work is too: it reverts on its own',
    'A single Plan task on its own is not',
    // CR3: the combined commit no longer rests on there being one implementation commit.
    'Plan tasks are never a reason — separating them is always possible',
    // CR5: the ownership row names the work, and stops quantifying one delegation per task.
    '| implementation work with its own verify command | subagent |',
  ]) {
    assert.ok(core.includes(literal), `core is missing ${literal}`);
  }
  // CR3's surviving cause of legitimacy, verbatim: shared files across changes, with
  // the Log naming each one. Retiring the count must not widen the exception.
  for (const literal of [
    'A combined commit is legitimate only when separation is impossible: several changes share the same files',
    'Record in the Log what was combined and why, naming every change that shares the surface',
  ]) {
    assert.ok(core.includes(literal), `core lost the combined-commit rule ${literal}`);
  }
});

test('111349 CR4: every selection is committed before the review is delegated', () => {
  const core = composedCore();
  // The sequence obligation, not a count: with N implementation commits the range is
  // still closed at the instant of delegation, so the orchestrator cannot edit the
  // deliverable between the reviewer's report and history.
  assert.ok(
    core.includes('Every selection is committed before the review is delegated'),
    'core no longer obliges every selection to be committed before the review is delegated',
  );
  assert.ok(
    core.includes(
      '`baseline..HEAD` is closed the instant the review is delegated: the reviewer inspects a fixed range and the deliverable cannot change between the report and history',
    ),
    'core no longer states what the ordering buys: a closed range and an unchangeable deliverable',
  );
});

// The graduated spec is the repo's persistent truth for this rule, and it carried the
// narrow formulation in Spanish. No test asserted any `.changeledger/specs/**` content
// before this change, which is why the class escaped five times: the guard was prose.
// Matching happens on whitespace-normalized text, because pinning contract prose by raw
// substring breaks unrelated tests whenever a paragraph reflows.
function graduatedGitSpec() {
  return fs
    .readFileSync(new URL('../.changeledger/specs/git-traceability.md', import.meta.url), 'utf8')
    .replace(/\s+/g, ' ');
}

test('111349 CR6: the graduated spec carries the resolved selection, not the fixed count', () => {
  const spec = graduatedGitSpec();
  for (const falsehood of [
    '**La unidad de commit es el change, y las clases son contables.**',
    '**Implementation**, exactamente uno con el trabajo completo del change',
    'así que el change es la unidad de implementación',
    'un change produce **dos** commits',
    'todas viajan en el único commit de implementación',
  ]) {
    assert.ok(!spec.includes(falsehood), `the graduated spec still states "${falsehood}"`);
  }
  for (const literal of [
    '**La unidad de commit es la selección de trabajo resuelta.**',
    '**Implementation**, uno por selección de trabajo resuelta',
    'se commitea al resolverse, sin esperar a las demás',
    'Toda selección queda commiteada **antes** de delegar el review',
    'Una **selección de trabajo resuelta** también',
  ]) {
    assert.ok(spec.includes(literal), `the graduated spec is missing "${literal}"`);
  }
  // Three retired formulations, not two: the fixed per-change count is named as the
  // third, so it cannot come back as a rediscovery.
  assert.ok(
    spec.includes('Tres formulaciones anteriores quedaron retiradas'),
    'the graduated spec does not count three retired formulations',
  );
  assert.ok(
    !spec.includes('Dos formulaciones anteriores quedaron retiradas'),
    'the graduated spec still counts only two retired formulations',
  );
  assert.ok(
    spec.includes('fijar el número de commits de implementación por change'),
    'the graduated spec does not name the fixed per-change count as the third retired formulation',
  );
});

// 20260729-111349 CR7 — `implement.md` was the fragment that survived the first pass of
// this change and went on contradicting core in four places, step 5 of its ordered gate
// worst of all: "Create the one implementation commit with `changeledger commit`". The
// reason it survived is the reason the whole class survives in this repo: every guard
// watched `core.md` alone. This one reads the directory and sweeps every fragment,
// `agent-contexts/` and `agent-prompts/` capsules included, so reintroducing the single
// commit anywhere fails.
test('111349 CR7: no fragment demands one implementation commit per change', () => {
  const contractDir = new URL('../templates/contract/', import.meta.url);
  const fragments = fs
    .readdirSync(contractDir, { recursive: true })
    .filter((name) => name.endsWith('.md'))
    .map((name) => name.split(path.sep).join('/'));
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
  // The three measured `the implementation commit` sites now read in the plural, so each
  // describes the class instead of a unique per-change commit.
  const implement = buildContext('implement', repo()).replace(/\s+/g, ' ');
  for (const plural of [
    'Between `changeledger status <id> in-progress` and the implementation commits',
    'carry those transitions inside the implementation commits',
    'never license leaving the implementation commits unmade before review',
  ]) {
    assert.ok(implement.includes(plural), `the implement pack is missing ${plural}`);
  }
  // The window is N commits, not one event.
  assert.ok(
    implement.includes('each resolved selection is committed as it resolves'),
    'the implement pack still treats the implementation window as a single commit event',
  );
  // And admitting N must not cost the expected-delta set: it has no other home, so
  // simplifying the sentence would retire an obligation with nowhere to land.
  for (const preserved of [
    'the change document stays modified and uncommitted',
    "and so do the change's own code and tests",
    'Together they are the only expected delta',
    'every `[status]` line the window accumulated',
    'the entry into `in-progress` and the exit into `in-review`',
    '"unrelated changes" above means a path belonging to neither the change document nor the change\'s authorized scope',
    'a clean worktree is not a valid precondition',
    'a delegation baseline states this expected set instead of demanding a clean tree',
  ]) {
    assert.ok(implement.includes(preserved), `the window prose lost ${preserved}`);
  }
  // The ordered gate still has a commit step before the delegation — `164620 CR2` owns
  // the ordering — but it now closes out every outstanding selection.
  assert.ok(
    implement.includes('Create every outstanding implementation commit with `changeledger commit`'),
    'the ordered gate no longer commits every outstanding selection',
  );
});
