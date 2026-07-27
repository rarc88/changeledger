import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildAgentContext } from '../src/commands/agent-context.mjs';
import { buildContext, frameSections } from '../src/commands/context.mjs';
import { init } from '../src/commands/init.mjs';
import { assertTransition, CANONICAL_STATUSES, canTransition } from '../src/lifecycle.mjs';
import {
  assertWithinBudget,
  contextBudgets,
  emittedLines,
  sizedOutput,
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
    ['implement', /feat\(scope\): description \[#20260629-234939\]/],
    ['implement', /Never implement approved changes on `main`, `master`, or `dev`/],
    ['implement', /baseline commit of the approved change\s+document before code/],
    ['implement', /approved.*in-progress.*baseline commit/i],
    ['implement', /Do not create a dedicated commit for a\s+lifecycle-only transition/],
    ['implement', /coalesce it with the nearest meaningful commit/i],
    ['implement', /handoff.*one consolidated.*checkpoint/i],
    ['implement', /Follow the Specification exactly/],
    ['implement', /Tick tasks as they become true, not in a batch at the end/],
    ['implement', /Leave no TODO\/FIXME, dead code or unrelated residue/],
    ['implement', /move to `in-review` if the type requires independent review/],
    ['implement', /Do not wait until the end to reconstruct mixed diffs/],
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
    ['review', /review verdict alone needs no commit/i],
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
    ['validation', /validation transition alone does not require a dedicated commit/i],
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
    'close.md': '10960f9878b3011e6f463c7509e6fe2a86382319ac4e36fe3b9c011d5bd288a7',
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
    'core.md': 'cf16900fd01223e7f3cd87c111bf9e098088fd99a689c4c5f20ab0064b7a7572',
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
    'implement.md': 'e52078e83d25505f4771ffd6e3c0185503ac29cb90e0855301b799397d12cbb3',
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
    'review.md': '2c4413030668a069c595a567178f87e111520efab07dfead0aa31f0398acf687',
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
    'spec.md': '6c960405ab4e10ba003068ccf8ff590a433e10499c261925382e0e99e50ed59d',
    // 20260703-220014: added that the stop is scoped to this change, names the blocking
    // depends_on chain and stops entirely only when every candidate is blocked.
    // 20260715-122950: additive final-mutation gate for reviewed and direct
    // validation paths; human-only acceptance rules are preserved, none retired.
    // 20260715-125139: viewer-only wording is replaced by viewer or explicit
    // conversation decisions; human ownership and non-inference are preserved.
    // Review correction restored Specification/Plan updates, wider-scope change
    // creation, host-only gates and lifecycle/graduation closure evidence.
    'validation.md': 'f4b3e879e1c95cefa0c20e4da9960d1532383fb4f90aff480b382d4bbe49eec7',
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
        `^===== CHANGELEDGER CONTEXT BEGIN — mode: ${mode} — v${version} — lines:\\d+/\\d+ — bytes:\\d+/\\d+ =====$`,
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
  // A bounded mode publishes its occupancy of both ceilings; an unbounded
  // change-id capture publishes its count alone, so each shape has its own pin.
  const begin = (label) =>
    new RegExp(
      `^===== CHANGELEDGER CONTEXT BEGIN — mode: ${label} — v${version} — lines:\\d+/\\d+ — bytes:\\d+/\\d+ =====$`,
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
    `===== CHANGELEDGER CONTEXT BEGIN — mode: core — v${version} — lines:${emittedLines(core)}/${contextBudgets.base.core.lines} — bytes:${Buffer.byteLength(core, 'utf8')}/${contextBudgets.base.core.bytes} =====`,
  );

  for (const mode of ['spec', 'implement', 'review', 'release']) {
    const output = buildContext(mode, root);
    assert.equal(
      output.split('\n')[0],
      `===== CHANGELEDGER CONTEXT BEGIN — mode: ${mode} — v${version} — lines:${emittedLines(output)}/${contextBudgets.base[mode].lines} — bytes:${Buffer.byteLength(output, 'utf8')}/${contextBudgets.base[mode].bytes} =====`,
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
    /1\..*Plan task.*2\..*`changeledger status <id> in-review`.*3\..*formatter.*full gates.*4\..*`changeledger context review` once.*5\..*read-only reviewer.*6\..*`changeledger review <id> pass\|fail`.*7\..*formatter again.*affected checks.*`changeledger check`/,
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
  // `budgets.yml`, which is exactly why a fixed `head -200` cannot serve it.
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

test('194233 CR1: every budget entry declares one flat threshold per dimension', () => {
  // A new top-level group in budgets.yml must widen this sweep, not slip past it.
  assert.deepEqual(Object.keys(contextBudgets).sort(), ['agent', 'base', 'overlays']);
  const entries = [
    ...Object.entries(contextBudgets.base),
    ...Object.entries(contextBudgets.overlays).map(([status, budget]) => [
      `${status} overlay`,
      budget,
    ]),
    ['agent', contextBudgets.agent],
  ];
  assert.ok(entries.length >= 10, `too few entries checked: ${entries.length}`);
  for (const [label, budget] of entries) {
    assert.deepEqual(
      Object.keys(budget).sort(),
      ['bytes', 'lines'],
      `${label} does not declare exactly lines and bytes`,
    );
    assert.equal(Number.isInteger(budget.lines), true, `${label} lines is not an integer`);
    assert.equal(Number.isInteger(budget.bytes), true, `${label} bytes is not an integer`);
  }
  // Core's line ceiling is not a chosen number: it is the bootstrap's `head -200`.
  assert.deepEqual(contextBudgets.base.core, { lines: 200, bytes: 12000 });
});

test('194233 CR2: the threshold is measured in emitted lines', () => {
  const budget = { lines: 200, bytes: 12000 };
  // 200 emitted lines is `split('\n').length === 201` under the old convention:
  // the exact boundary the previous counting unit reported as an overflow.
  const atLimit = sizedOutput(200, 9000);
  assert.equal(atLimit.split('\n').length, 201);
  const exact = captureBudget(() => assertWithinBudget('core', atLimit, budget));
  assert.ok(!exact.thrown, `the exact limit threw: ${exact.thrown?.message}`);
  const over = captureBudget(() => assertWithinBudget('core', sizedOutput(201, 9000), budget));
  assert.ok(over.thrown, 'line overflow did not throw');
  assert.equal(over.thrown.name, 'AssertionError');
  assert.equal(over.thrown.message, 'core exceeds 200 lines: 201');
});

test('194233 CR3: crossing the byte threshold throws', () => {
  const budget = { lines: 200, bytes: 12000 };
  const exact = captureBudget(() => assertWithinBudget('core', sizedOutput(50, 12000), budget));
  assert.ok(!exact.thrown, `the exact byte limit threw: ${exact.thrown?.message}`);
  const over = captureBudget(() => assertWithinBudget('core', sizedOutput(50, 12001), budget));
  assert.ok(over.thrown, 'byte overflow did not throw');
  assert.equal(over.thrown.message, 'core exceeds 12000 bytes: 12001');
});

test('194233 CR4: no budget path warns, under the threshold or over it', () => {
  const budget = { lines: 200, bytes: 12000 };
  const under = captureBudget(() => assertWithinBudget('core', sizedOutput(199, 11999), budget));
  assert.ok(!under.thrown, `a compliant output threw: ${under.thrown?.message}`);
  assert.deepEqual(under.warnings, []);
  // Every real entry stays silent too, so no lenient branch survives anywhere.
  for (const [label, budget] of Object.entries(contextBudgets.base)) {
    const over = captureBudget(() =>
      assertWithinBudget(label, sizedOutput(budget.lines + 1, budget.bytes), budget),
    );
    assert.ok(over.thrown, `${label} did not throw past its threshold`);
    assert.deepEqual(over.warnings, [], `${label} warned instead of failing`);
  }
  const source = fs.readFileSync(new URL('./budget-support.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /emitWarning/);
});

// Occupancy published in the BEGIN line: `lines:<n>/<limit>` and
// `bytes:<n>/<limit>` as the last segments, so an agent reads how much of the
// ceiling it has spent without running anything.
function publishedOccupancy(text) {
  const begin = text.split('\n')[0];
  const match = begin.match(/— lines:(\d+)\/(\d+) — bytes:(\d+)\/(\d+) =====$/);
  assert.ok(match, `BEGIN line publishes no occupancy — ${begin}`);
  return {
    lines: Number(match[1]),
    lineLimit: Number(match[2]),
    bytes: Number(match[3]),
    byteLimit: Number(match[4]),
  };
}

test('194233 CR5: the BEGIN line publishes occupancy for both dimensions', () => {
  const root = repo();
  for (const [mode, budget] of Object.entries(contextBudgets.base)) {
    const composed = mode === 'core' ? buildContext(undefined, root) : buildContext(mode, root);
    const published = publishedOccupancy(composed);
    assert.equal(published.lineLimit, budget.lines, `${mode} publishes a foreign line limit`);
    assert.equal(published.byteLimit, budget.bytes, `${mode} publishes a foreign byte limit`);
    assert.equal(
      published.lines,
      emittedLines(composed),
      `${mode} line occupancy is not the real size`,
    );
    assert.equal(
      published.bytes,
      Buffer.byteLength(composed, 'utf8'),
      `${mode} byte occupancy is not the real size`,
    );
    // The real CLI stdout, not only the composed string.
    const cli = cliContext(root, mode === 'core' ? [] : [mode]);
    assert.equal(publishedOccupancy(cli).bytes, Buffer.byteLength(cli, 'utf8'));
  }
  // An unbounded change-id capture has no entry in budgets.yml, so it publishes
  // its exact count and invents no ceiling.
  const id = '20260727-194233';
  writeFillerChange(root, id, 10);
  const unbounded = buildContext(id, root);
  assert.equal(publishedLines(unbounded), emittedLines(unbounded));
  assert.doesNotMatch(unbounded.split('\n')[0], /bytes:/);
});

test('194233 CR6: the published byte count is exact across a power-of-ten crossing', () => {
  const budget = { lines: 200, bytes: 12000 };
  // Calibrated, never hardcoded: measure the framing overhead on an empty body,
  // then sweep the fillers that place the total across the 9xxx → 1xxxx boundary
  // and demand the published figure equal the real size at every step, so the
  // widening digit cannot desynchronize the count.
  const overhead = Buffer.byteLength(frameSections('core', undefined, [''], budget), 'utf8');
  const boundary = 10000 - overhead;
  let crossed = false;
  for (let filler = boundary - 30; filler <= boundary + 30; filler += 1) {
    const framed = frameSections('core', undefined, ['y'.repeat(filler)], budget);
    const published = publishedOccupancy(framed);
    assert.equal(
      published.bytes,
      Buffer.byteLength(framed, 'utf8'),
      `desynced at filler ${filler}`,
    );
    assert.equal(published.lines, emittedLines(framed));
    if (published.bytes >= 10000) crossed = true;
  }
  assert.ok(crossed, 'the sweep never crossed the 10000-byte boundary');
  // The non-convergence branch is reachable and named, not a comment: one pass
  // cannot settle a figure that its own width changes.
  assert.throws(
    () => frameSections('core', undefined, ['z'.repeat(boundary)], budget, 1),
    /did not converge/,
  );
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
    '| any implementation task with its own verify command | subagent |',
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
    'One commit per completed Plan task, plus one baseline commit of the change document before any code',
    'A lifecycle transition is never a commit of its own — the Log is its record; the transition travels in the next real commit',
    'Subjects follow `type(scope): description [#<id>]`; `changeledger commit` composes it',
    '`changeledger context implement` owns the full contract',
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
  assert.match(implement, /baseline commit of the approved change document before code/);
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
  const bytes = Buffer.byteLength(core, 'utf8');
  // Strictly below, not merely within: the gate must leave real headroom rather
  // than pass by sitting exactly on the ceiling.
  assert.ok(lines < budget.lines, `core is not below its line threshold: ${lines}/${budget.lines}`);
  assert.ok(bytes < budget.bytes, `core is not below its byte threshold: ${bytes}/${budget.bytes}`);
  // The 225213 CR6 sweep itself: every base pack clears its own threshold.
  const sweep = captureBudget(() => {
    for (const [mode, entry] of Object.entries(contextBudgets.base)) {
      assertWithinBudget(mode, mode === 'core' ? core : buildContext(mode, root), entry);
    }
  });
  assert.ok(!sweep.thrown, `the base sweep threw: ${sweep.thrown?.message}`);
});
