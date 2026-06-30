import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildContext } from '../src/commands/context.mjs';
import { init } from '../src/commands/init.mjs';

process.env.CHANGELEDGER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'context-home-'));

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

test('CR1/CR5/CR7: core context is deterministic and within its budget', () => {
  const root = repo();
  const first = buildContext(undefined, root);
  const second = buildContext(undefined, root);
  assert.equal(first, second);
  assert.match(first, /Mode: core/);
  assert.match(first, /Running `changeledger context` is discovery, not compliance/);
  assert.match(first, /Run it\s+directly, without piping, filtering, summarizing/);
  assert.match(first, /Read the\s+complete output and follow the current mode/);
  assert.match(first, /tools such as `head`,\s+`tail`, `sed` or `grep`/);
  assert.match(first, /stop and restore complete context/);
  assert.match(first, /If no approved or in-progress change applies/);
  assert.match(first, /ask the human whether a purely operational,\s+reversible edit/);
  assert.match(first, /If unsure, document it in ChangeLedger/);
  assert.match(first, /implement,? review,? spec,? release|context implement/);
  assert.match(first, /extends? the core context already read without repeating it/);
  assert.ok(first.split('\n').length <= 120);
  assert.ok(Buffer.byteLength(first, 'utf8') <= 8192);
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
  assert.match(first, /`changeledger graduate --pending`/);
  assert.match(first, /before (scanning|searching) files/i);
  assert.doesNotMatch(first, new RegExp(id));
  assert.doesNotMatch(first, /Context fixture/);
  assert.equal(first, second);
  assert.ok(first.split('\n').length <= 120);
  assert.ok(Buffer.byteLength(first, 'utf8') <= 8192);
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
    ['implement', /ask the human whether to stash, commit, ignore or include them/],
    ['implement', /keep the correction uncommitted until the human confirms it/],
    ['implement', /Do not start another task or change while a correction waits/],
    [
      'implement',
      /After human acceptance, graduate or record a skip, then commit the correction with its ledger truth/,
    ],
    ['review', /Deep security, SAST and lint belong to dedicated tools/],
    ['review', /ChangeLedger does not reimplement them/],
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
    assert.match(resumed, /Mode: implement/);
    assert.match(resumed, /# Implementing an Approved Change/);
    assert.match(resumed, /# Definition of Ready/);
  }
  assert.ok(outputs.core.split('\n').length <= 120);
  assert.ok(Buffer.byteLength(outputs.core, 'utf8') <= 8192);
});

test('234939 CR11-CR20: dynamic packs retain the operational contract', () => {
  const root = repo();
  const doneId = addChange(root, 'done', '20260629-230010');
  const blockedId = addChange(root, 'blocked', '20260629-230011');
  const validationId = addChange(root, 'in-validation', '20260629-230012');
  const discardedId = addChange(root, 'discarded', '20260629-230013');
  const outputs = {
    core: buildContext(undefined, root),
    spec: buildContext('spec', root),
    implement: buildContext('implement', root),
    review: buildContext('review', root),
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
    ['core', /Stop at `in-validation`/],
    ['core', /reload `changeledger context <id>`/],
    ['core', /changeledger graduate <id> --skip \[reason\]/],
    ['core', /`done` and `discarded` never reopen/],
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
    ['spec', /changeledger owner <id> <name\|->/],
    ['spec', /changeledger list \[--status S\] \[--type T\] \[--json\]/],
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
    ['implement', /Commit the approved change documentation before touching implementation code/],
    ['implement', /Follow the Specification exactly/],
    ['implement', /Tick tasks as they become true, not in a batch at the end/],
    ['implement', /Leave no TODO\/FIXME, dead code or unrelated residue/],
    ['implement', /move to `in-review` if the type requires independent review/],
    ['implement', /do not wait until the end to reconstruct mixed diffs/],
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
    ['review', /question, module, package, test area, migration slice or independent verification/],
    ['review', /do not trust the implementer's summary/],
    ['review', /model sized to the review difficulty/],
    ['review', /every `CRn`, every Plan task, tests, the actual diff/],
    ['review', /absence of TODO\/FIXME, dead code or unrelated residue/],
    ['review', /ChangeLedger does not reimplement them/],
    ['review', /changeledger review <id> pass/],
    ['review', /changeledger review <id> fail --retry "<reason>"/],
    ['review', /changeledger review <id> fail --block "<reason>"/],
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
    ['close', /changeledger graduate --pending/],
    ['close', /changeledger archive <id>.*changeledger unarchive <id>/],
    ['close', /changeledger list.*changeledger show/],
    ['close', /graduation link remains derivable from the Log marker/],
    ['close', /`graduado a spec`/],
    ['close', /seed from the change's Specification or Proposal/],
    ['close', /remove the explicit scaffold marker/],
    ['close', /`--into` refuses an unrefined marked scaffold/],
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
    ['validation', /Do not modify the result or mark it done/],
    ['validation', /Rejection requires a reason and returns the same change to `in-progress`/],
    ['validation', /run `changeledger context <id>` before modifying implementation/],
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
    ['core', /viewer owns `draft → approved` and `in-validation → done\|in-progress`/],
  ];

  for (const [context, pattern] of expected) {
    assert.match(normalized[context], pattern, `${context} is missing ${pattern}`);
  }
  for (const output of Object.values(outputs)) {
    assert.doesNotMatch(output, /\.changeledger\/AGENTS\.md/);
    assert.doesNotMatch(output, /changeledger register/);
  }
  for (const mode of ['spec', 'implement', 'review']) {
    assert.match(outputs[mode], /# Economical Delegation/);
  }
  assert.match(outputs.implement, /# Handoff Triage/);
  assert.match(outputs.review, /# Handoff Triage/);

  const ownedHeadings = {
    core: ['# ChangeLedger — Core Contract'],
    spec: ['# Authoring a Change', '# Economical Delegation', '# Definition of Ready'],
    implement: [
      '# Implementing an Approved Change',
      '# Economical Delegation',
      '# Definition of Ready',
      '# Handoff Triage',
    ],
    review: ['# Independent Review', '# Economical Delegation', '# Handoff Triage'],
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
  assert.ok(outputs.core.split('\n').length <= 120);
  assert.ok(Buffer.byteLength(outputs.core, 'utf8') <= 8192);
});

test('234939 CR10/CR11: reviewed fragment snapshots prevent silent contract loss', () => {
  const expected = {
    'blocked.md': '77efa1acf03835ca8122ff98f3bfbcef05c8fa47769e6b08c073e3ca225b1353',
    'close.md': 'fa3f83e7767fdee719d2f5319279207c3103739670c21c110a76375f6a49907c',
    'core.md': '5f7df2c4c22b1021b47ae5657985aa820a3f23f1de8c10fbb7e7ac290fc8ad23',
    'delegation.md': 'b74c378308f519bf0a0190baa5ab8b70bf100831acf7181733cc6209fd18cd88',
    'discarded.md': '6ef24e465b9aea0f160606ba7a2bc849a5e98f1c747f0fd8814b80786955b590',
    'handoff.md': '2275f8b6ac415c7f132b5cd324dd5556a5948332131d59a0893f20c46e26f330',
    'implement.md': 'ba9c5ee4e5e82bfda28364c27dccbf595ddb083d0fe026f297f977fda78414af',
    'readiness.md': 'e13225b2306857b4af10b15371265232f7bf86f49c8ca3bc5956329cdedea7bd',
    'release.md': '1d51cbad5171eea307deb9ed0a8759ef9db9b6d901943a4b46902364393f949a',
    'review.md': '4cd4b1b14fc6e0ea7aabff5cecaa9b57d47db4d633a87551a62077254078821a',
    'spec.md': '5117dfeddb1cc89ebc912876101ed80c4988ed18ea428bcc2ef41df8a390afe8',
    'validation.md': 'fe60be7ad4a6bf905f6416346eef0e7c9b7b8014e2784cec38645318f667c0e3',
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
  assert.match(
    first,
    /If the complete base output has not been read, stop and run `changeledger context`/,
  );
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
  assert.match(output, /Mode: implement/);
  assert.doesNotMatch(output, /# ChangeLedger — Core Contract/);
  assert.match(output, /This incremental context extends the complete core context already read/);
  assert.match(
    output,
    /If the complete base output has not been read, stop and run `changeledger context`/,
  );
  assert.match(output, /# Implementing an Approved Change/);
  assert.match(output, /# Definition of Ready/);
  assert.match(output, /## Request[\s\S]*Need exact context/);
  assert.match(output, /### CR1 — Full criterion/);
  assert.match(output, /\*\*Then\*\* exact criterion text is present/);
  assert.match(output, /## Plan[\s\S]*src\/example\.mjs/);
  assert.match(output, /## Log[\s\S]*Decision retained/);
});

test('20260629-210543 CR2: every supported status produces incremental change context', () => {
  const expected = {
    draft: [/Mode: spec/, /# Authoring a Change/],
    approved: [/Mode: implement/, /# Implementing an Approved Change/],
    'in-progress': [/Mode: implement/, /# Implementing an Approved Change/],
    'in-review': [/Mode: review/, /# Independent Review/],
    blocked: [/Mode: blocked/, /# Blocked — Resolve Before Implementing/],
    'in-validation': [/Mode: validation/, /# Human Validation — Stop/],
    done: [/Mode: close/, /# Closing Accepted Work/],
    discarded: [/Mode: discarded/, /# Discarded — Terminal/],
  };

  for (const [index, [status, patterns]] of Object.entries(expected).entries()) {
    const root = repo();
    const id = addChange(root, status, `20260627-13000${index}`);
    const output = buildContext(id, root);
    for (const pattern of patterns) assert.match(output, pattern);
    assert.match(output, /This incremental context extends the complete core context already read/);
    assert.doesNotMatch(output, /# ChangeLedger — Core Contract/);
    assert.match(output, new RegExp(`id: "${id}"`));
    assert.match(output, /# Selected change/);
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
  for (const [mode, heading] of Object.entries(expected)) {
    const output = buildContext(mode, root);
    assert.match(output, new RegExp(`Mode: ${mode}`));
    assert.match(output, heading);
    assert.doesNotMatch(output, /# ChangeLedger — Core Contract/);
    assert.match(output, /This incremental context extends the complete core context already read/);
    assert.match(
      output,
      /If the complete base output has not been read, stop and run `changeledger context`/,
    );
  }
  assert.throws(
    () => buildContext('bogus', root),
    /Unknown context "bogus" — valid modes: implement, review, spec, release \(or pass a change id\)/,
  );
});

test('CR8/CR9: lifecycle overlays guard blocked, validation, done and discarded', () => {
  const expected = {
    blocked: [/Mode: blocked/, /Resolve Before Implementing/],
    'in-validation': [/Mode: validation/, /Human Validation — Stop/],
    done: [/Mode: close/, /Closing Accepted Work/],
    discarded: [/Mode: discarded/, /Discarded — Terminal/],
  };
  for (const [index, [status, patterns]] of Object.entries(expected).entries()) {
    const root = repo();
    const id = addChange(root, status, `20260627-12000${index}`);
    const output = buildContext(id, root);
    for (const pattern of patterns) assert.match(output, pattern);
    assert.doesNotMatch(output, /# ChangeLedger — Core Contract/);
    assert.match(output, /This incremental context extends the complete core context already read/);
    assert.doesNotMatch(output, /Mode: release/);
    if (status === 'blocked') assert.doesNotMatch(output, /# Implementing an Approved Change/);
  }
  const root = repo();
  assert.match(buildContext('release', root), /Mode: release/);
});
