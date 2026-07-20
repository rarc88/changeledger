import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildAgentContext } from '../src/commands/agent-context.mjs';
import { buildContext } from '../src/commands/context.mjs';
import { init } from '../src/commands/init.mjs';

process.env.CHANGELEDGER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'context-home-'));
const contextBudgets = JSON.parse(
  fs.readFileSync(new URL('../templates/contract/budgets.yml', import.meta.url), 'utf8'),
);

function assertWithinBudget(label, output, budget) {
  const lines = output.split('\n').length;
  const bytes = Buffer.byteLength(output, 'utf8');
  if (lines > budget.target.lines || bytes > budget.target.bytes) {
    process.emitWarning(
      `${label} exceeds target (${lines}/${budget.target.lines} lines, ${bytes}/${budget.target.bytes} bytes)`,
    );
  }
  assert.ok(lines <= budget.hard.lines, `${label} exceeds ${budget.hard.lines} lines: ${lines}`);
  assert.ok(bytes <= budget.hard.bytes, `${label} exceeds ${budget.hard.bytes} bytes: ${bytes}`);
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
  assert.match(first, /Running `changeledger context` is discovery, not compliance/);
  assert.match(first, /Capture the first invocation completely in one pass/);
  assert.match(first, /read through the `CHANGELEDGER CONTEXT END` line/);
  assert.match(first, /follow the\s+current mode/);
  assert.match(first, /exceptional recovery/);
  assert.match(first, /new\s+human message alone does not trigger a reload/i);
  assert.match(first, /If no approved or in-progress change applies/);
  assert.match(first, /ask the human whether a purely operational,\s+reversible edit/);
  assert.match(first, /If unsure, document it in ChangeLedger/);
  assert.match(first, /implement,? review,? spec,? release|context implement/);
  assert.match(first, /extends the core\s+context already read; it never repeats it/);
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
    ['core', /Files are the source of truth and may be edited directly/],
    ['core', /CLI helpers are optional and preferred for error-prone operations/],
    ['core', /Delegate only with a clear boundary and benefit/],
    ['core', /ownership, expected output and integration criterion/],
    ['core', /must not revert others' work/],
    ['core', /Do not over-shard or overlap write surfaces without an explicit integration plan/],
    ['core', /Size the model to the task's difficulty and risk/],
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
  assert.match(fragments['core.md'], /Do not over-shard or overlap write surfaces/);
  assert.match(fragments['core.md'], /Size the model to the task's difficulty and risk/);
  assert.match(fragments['delegation.md'], /one subagent per file, line or tiny mechanical edit/);
  assert.match(
    fragments['delegation.md'],
    /parallel agents over the same files or conceptual surface/,
  );
  assert.match(fragments['delegation.md'], /strongest available models for ambiguous scope/);

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
    ['core', /Documents under `.changeledger\/` are the source of truth/],
    ['core', /Work starts with conversation/],
    ['core', /human explicitly authorizes documentation/],
    ['core', /Never implement a `draft`/],
    // 20260703-220014: the global-sounding "Stop at in-validation" was replaced
    // with a change-scoped stop that lets the agent pick up independent queued work.
    ['core', /`in-validation` stops only that change/],
    ['core', /reload `changeledger context <id>`/],
    ['core', /changeledger graduate <id> --skip \[reason\]/],
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
      /\[x\] Update `src\/app\/foo\.ts`; verify: `pnpm test` \(CR1\) — 2026-06-13T14:20:00Z/,
    ],
    ['spec', /\[!\] Update `src\/app\/foo\.ts`; verify: `pnpm test` \(CR1\) — blocked reason/],
    ['spec', /parser removes `— verify: \.\.\.` before readiness checks/],
    [
      'spec',
      /running a test suite, reading before refactoring, evaluating blast radius or scaffolding/,
    ],
    ['spec', /not a substitute for a missing criterion on observable behaviour/],
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
    'core.md': '14ba2bdaf590565378f44a54b15e3b4aff6b44ad9b8d1162948b17068dcf7eb2',
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
    'implement.md': '93878b96dabcb8a35853d977a11cf200bb04248703789cb872425be353e24c88',
    // 20260630-225208: the severity sentence was replaced, not retired — draft warns on
    // everything; approved/in-progress errors on readiness defects, coverage gaps stay warnings.
    'readiness.md': '2b5e12497ae7d9d75e0f3a29e295796091db6b2ffb0587bdf598155ecb463422',
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
    // correction adds mandatory search-result classification during Investigation;
    // existing dependency execution and authoring rules are preserved.
    'spec.md': 'b78aeea566632cfc1d304ce8a93307951fb08fe564656eb0a354c5e818b5d029',
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
        `^===== CHANGELEDGER CONTEXT BEGIN — mode: ${mode} — change: #${id} — v${version} — rev:[0-9a-f]{12} =====$`,
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
        `^===== CHANGELEDGER CONTEXT BEGIN — mode: ${mode} — v${version} — rev:[0-9a-f]{12} =====$`,
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
  const begin = (label) =>
    new RegExp(
      `^===== CHANGELEDGER CONTEXT BEGIN — mode: ${label} — v${version} — rev:[0-9a-f]{12} =====$`,
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
  assert.match(byId.split('\n')[0], begin(`implement — change: #${id}`));
  assert.equal(byId.trimEnd().split('\n').at(-1), end);
});

// 20260711-103759: `rev:<12 hex>` lets an agent verify a retained capture is
// still current without reprinting the contract.
function extractRev(output) {
  return output.split('\n')[0].match(/rev:([0-9a-f]{12})/)?.[1];
}

test('103759 CR1: the core rev is stable across repeated invocations', () => {
  const root = repo();
  const first = buildContext(undefined, root);
  const second = buildContext(undefined, root);
  const firstRev = extractRev(first);
  assert.match(firstRev, /^[0-9a-f]{12}$/);
  assert.equal(firstRev, extractRev(second));
});

test('103759 CR2: the rev changes when the effective policy changes', () => {
  const root = repo();
  const before = extractRev(buildContext(undefined, root));
  setConfig(root, [[/^language: en$/m, 'language: es']]);
  const after = extractRev(buildContext(undefined, root));
  assert.notEqual(before, after);
});

test('103759 CR3: --have with the current rev returns a short unchanged confirmation', () => {
  const root = repo();
  const full = buildContext(undefined, root);
  const rev = extractRev(full);
  const short = buildContext(undefined, root, { have: rev });
  assert.match(short.split('\n')[0], /— unchanged =====$/);
  assert.match(short, new RegExp(`rev:${rev}`));
  assert.match(short, /unchanged/);
  assert.doesNotMatch(short, /# ChangeLedger — Core Contract/);
  assert.equal(
    short.trimEnd().split('\n').at(-1),
    '===== CHANGELEDGER CONTEXT END — if this line is missing, the output was truncated: stop and re-run =====',
  );
  assert.ok(short.length < full.length);
});

test('103759 CR4: --have with a stale or invented rev returns the full normal output', () => {
  const root = repo();
  const full = buildContext(undefined, root);
  const output = buildContext(undefined, root, { have: 'deadbeefcafe' });
  assert.equal(output, full);
  assert.match(output, /# ChangeLedger — Core Contract/);
  assert.equal(
    output.trimEnd().split('\n').at(-1),
    '===== CHANGELEDGER CONTEXT END — if this line is missing, the output was truncated: stop and re-run =====',
  );
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
  assert.match(core, /`in-validation` stops only that change/);
  assert.match(core, /start another approved change unless its `depends_on` chain/);
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
  assert.match(core, /reload `changeledger context <id>`/);
  assert.match(
    core,
    /graduate persistent truth or run `changeledger graduate <id> --skip \[reason\]`/,
  );
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
  assert.match(norm, /praise, “continue”, or agent inference is not a decision/);

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
  assert.match(
    norm,
    /Get a complete role skeleton to fill in with `changeledger agent-prompt <role>` \(investigation \| implementation \| review \| audit\)/,
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
  assert.match(
    core,
    /Each delegation prompt states at least ownership, expected output and integration criterion; the task context carries the full prompt contract/,
  );
  // CR2: graduation is not a settled binary — core offers graduate OR skip and
  // defers the --new/--into two-step to the close overlay (20260705-134704).
  assert.match(
    core,
    /graduate persistent truth or run `changeledger graduate <id> --skip \[reason\]`/,
  );
  assert.doesNotMatch(core, /a new spec is a two-step/);
  assert.ok(core.length > 0);
});

// 20260711-103756 CR5: the spec context documents the `quick` lane, its
// eligibility and the discard-and-recreate rule for scope growth.
test('103756 CR5: spec context documents the quick lane and its eligibility', () => {
  const root = repo();
  const spec = buildContext('spec', root).replace(/\s+/g, ' ');
  assert.match(spec, /quick/);
  assert.match(
    spec,
    /single-concern work that does\s+not expand public surface or persistent truth/,
  );
  assert.match(spec, /discard the change and\s+recreate it under the correct type/);
  assertWithinBudget('spec', buildContext('spec', root), contextBudgets.base.spec);
});

test('105456 CR8 correction: spec context makes agents populate discovered relations', () => {
  const root = repo();
  const spec = buildContext('spec', root).replace(/\s+/g, ' ');
  assert.match(
    spec,
    /during Investigation, classify every relevant result from `changeledger search`/,
  );
  assert.match(spec, /execution prerequisite.*`depends_on`/);
  assert.match(spec, /useful context without execution order.*`related_to`/);
  assert.match(spec, /unstructured nuance.*textual mention/);
  assert.match(spec, /Declare a local relation once.*incoming backlink is derived/);
});
