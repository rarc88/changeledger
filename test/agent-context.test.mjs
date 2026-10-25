import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { status } from '../src/commands/agent.mjs';
import { buildAgentContext } from '../src/commands/agent-context.mjs';
import { buildAgentPrompt } from '../src/commands/agent-prompt.mjs';
import { init } from '../src/commands/init.mjs';
import { VERSION } from '../src/framing.mjs';
import { REVIEW_VERDICTS } from '../src/lifecycle.mjs';
import { STATE_REF, writeActivation } from '../src/state-store.mjs';
import { assertWithinBudget, contextBudgets } from './budget-support.mjs';
import { initGitFixture } from './helpers/git-env.mjs';
import { buildTree, commitTree, updateRef } from './helpers/state-repo.mjs';

process.env.CHANGELEDGER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-context-home-'));
const execFileAsync = promisify(execFile);
const bin = path.resolve('bin/changeledger.mjs');
const agentBudget = contextBudgets.agent;

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-context-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Project rules\n');
  init(root);
  return root;
}

function addChange(root, status, id) {
  const text = `---
id: "${id}"
title: Delegated work
type: feature
status: ${status}
created: 2026-07-05T12:00:00Z
depends_on: []
---

## Request

Do the delegated work.

## Investigation

Observed constraint.

## Proposal

Chosen approach.

## Specification

### CR1 — Delegated result
- **Given** an input
- **When** the delegate acts
- **Then** the exact result exists

## Plan

- [ ] Update the example module
  - **Target:** \`src/example.mjs\`
  - **Verify:** \`node --test test/example.test.mjs\`
  - **Criteria:** CR1

## Log

- Initial note.
`;
  fs.writeFileSync(path.join(root, '.changeledger', 'changes', `${id}-delegated-work.md`), text);
  return text;
}

// 20260808-151641 CR7 (correction round) — agent-context is a read-only
// consumer of `resolveChange` too; on an activated repo it must resolve the
// role's change from the state-ref snapshot, never a worktree phantom. Same
// doc-only-in-ref-vs-only-in-worktree shape as context.test.mjs's CR7:
// `worktreeId` only exists on disk, `refId` only in the seeded state ref, and
// the snapshot config is the worktree's own (byte-identical) so `types` stays
// resolvable.
function activatedAgentContextFixture({ broken = false } = {}) {
  const root = repo();
  initGitFixture(root);

  const refId = '20260808-000005';
  const worktreeId = '20260808-000006';
  addChange(root, 'in-review', worktreeId);

  const refText = `---
id: "${refId}"
title: Delegated work
type: feature
status: in-review
created: 2026-07-05T12:00:00Z
depends_on: []
---

## Request

Do the delegated work.
`;

  const configText = fs
    .readFileSync(path.join(root, '.changeledger', 'config.yml'), 'utf8')
    .replace(/^language: en$/m, 'language: es');
  const files = {
    '.changeledger-state/manifest.yml': 'format_version: 1\nproject_id: demo\n',
    '.changeledger-state/config.yml': configText,
    '.changeledger-state/changes/delegated-work.md': refText,
  };
  if (broken) files['.changeledger-state/changes/broken.md'] = 'no frontmatter here\n';
  const tree = buildTree(root, files);
  const revision = commitTree(root, tree, { message: 'chore: state' });
  updateRef(root, STATE_REF, revision);
  writeActivation(root, { stateRef: STATE_REF });

  return { root, refId, worktreeId, refText };
}

test('20260808-151641 CR7: agent-context resolves the snapshot change, not a worktree phantom, in an activated repo', () => {
  const { root, refId, worktreeId, refText } = activatedAgentContextFixture();

  const out = buildAgentContext('review', refId, root);
  assert.match(out, new RegExp(`change: #${refId}`));
  assert.ok(out.includes(refText.trim()));

  assert.throws(() => buildAgentContext('review', worktreeId, root), /No change with id/);
});

test('agent-context uses the activated config policy', () => {
  const { root, refId } = activatedAgentContextFixture();

  assert.match(buildAgentContext('review', refId, root), /Effective policy: language=es/);
});

test('20260808-171107 CR5: activated agent-context resolves an unknown id before an unrelated malformed change', () => {
  const { root } = activatedAgentContextFixture({ broken: true });

  assert.throws(
    () => buildAgentContext('review', `${'20990101'}-000000`, root),
    /No change with id "20990101-000000"/,
  );
});

// 20260809-194236 CR1/CR2 — post-review of 171107's CR5: that fix covers an
// unrelated malformed sibling, but never the case where the malformed
// document IS the id the human asked for. `loadRepo`'s `repo.changeErrors`
// already carries the exact parse diagnostic; before this change
// `agent-context` never consulted it on that id's own resolution failure.
test('20260809-194236 CR1: the malformed document requested by id is named, not reported as unknown', () => {
  const root = repo();
  const id = '20990101-000000';
  fs.writeFileSync(
    path.join(root, '.changeledger', 'changes', `${id}-self.md`),
    'no frontmatter here\n',
  );

  assert.throws(
    () => buildAgentContext('review', id, root),
    (error) => {
      assert.match(error.message, /Change is missing its frontmatter block/);
      assert.doesNotMatch(error.message, /No change with id/);
      assert.match(error.message, new RegExp(`${id}-self\\.md`));
      return true;
    },
  );
});

test('20260809-194236 CR2: a genuinely unknown id keeps the "No change with id" message byte for byte', () => {
  const root = repo();
  const id = '20990101-000000';
  fs.writeFileSync(
    path.join(root, '.changeledger', 'changes', `${id}-self.md`),
    'no frontmatter here\n',
  );

  assert.throws(
    () => buildAgentContext('review', `${'20990101'}-999999`, root),
    (error) => {
      assert.equal(
        error.message,
        'No change with id "20990101-999999" (use the exact id; run `changeledger check` if a filename\'s id looks wrong)',
      );
      return true;
    },
  );
});

test('144327 CR7: role context is framed, self-contained and carries effective policy', () => {
  const root = repo();
  const id = '20260705-120001';
  const selected = addChange(root, 'in-review', id);
  const out = buildAgentContext('review', id, root);
  assert.equal(
    out.split('\n')[0],
    `===== CHANGELEDGER AGENT CONTEXT BEGIN — role: review — change: #${id} — v${VERSION} =====`,
  );
  assert.equal(
    out.trimEnd().split('\n').at(-1),
    '===== CHANGELEDGER AGENT CONTEXT END — if this line is missing, the output was truncated: stop and re-run =====',
  );
  assert.match(out, /Effective policy: language=en — tdd=on/);
  assert.match(out, /self-contained delegated context/i);
  assert.match(out, /do not run `changeledger context`/i);
  assert.match(out, /# Selected change[\s\S]*Do the delegated work/);
  assert.ok(out.includes(selected.trim()));
  assert.doesNotMatch(out, /# ChangeLedger — Core Contract/);
  assert.doesNotMatch(out, /This incremental context extends/);
});

test('144327 CR7: role and lifecycle guards fail before emitting a misleading capsule', () => {
  const root = repo();
  const approved = '20260705-120002';
  const progress = '20260705-120003';
  const review = '20260705-120004';
  addChange(root, 'approved', approved);
  addChange(root, 'in-progress', progress);
  addChange(root, 'in-review', review);

  assert.doesNotThrow(() => buildAgentContext('review', review, root));
  assert.throws(
    () => buildAgentContext('review', progress, root),
    /role review requires change status in-review; got in-progress/,
  );
  assert.throws(
    () => buildAgentContext('review', approved, root),
    /role review requires change status in-review; got approved/,
  );
  assert.throws(() => buildAgentContext('scaffolding', undefined, root), /valid roles: review$/);
});

// `review` is the only role that survives. The retired roles fail with the same closed-set message a never-existing one does, on
// the function and through the spawned CLI; no alias, no residue.
for (const retired of ['investigation', 'implementation', 'graduation-review']) {
  test(`the retired role "${retired}" fails with the one-role message`, async () => {
    const root = repo();
    const id = `${'20261024'}-200001`;
    addChange(root, 'in-review', id);
    assert.throws(
      () => buildAgentContext(retired, id, root),
      new RegExp(`^Error: Unknown role "${retired}" — valid roles: review$`),
    );
    const failure = await execFileAsync(process.execPath, [bin, 'agent-context', retired, id], {
      cwd: root,
    }).then(
      () => null,
      (e) => e,
    );
    assert.ok(failure, 'the CLI must fail');
    assert.equal(failure.code, 1);
    assert.match(failure.stderr, /Allowed choices are review\./);
    assert.doesNotMatch(failure.stdout, /AGENT CONTEXT BEGIN/);
  });
}

test('144327 CR8: delegated capsules expose no orchestrator mutation surface and fit budget', () => {
  const root = repo();
  const id = `${'20260705'}-120007`;
  addChange(root, 'in-review', id);

  const out = buildAgentContext('review', id, root);
  const base = out.split('\n# Selected change')[0];
  assertWithinBudget('review capsule', base, agentBudget);
  assert.doesNotMatch(
    base,
    /changeledger (status|task|log|review|graduate|archive|unarchive)/,
    'review exposes orchestrator mutation commands',
  );
  assert.doesNotMatch(base, /# Economical Delegation|Do not over-shard/);
  assert.match(base, /read-only/i);
});

// 183520 CR1/CR2: the capsule's checklist is conditional on the mandate the
// prompt declares, so a narrow mandate is not handed a full-audit order. Two
// tests, not one: CR2's fail-safe default is the half a rewrite is most likely
// to drop, and it must fail naming the default rather than hiding inside CR1.
//
// Tolerant concept patterns over flattened text, never the capsule's sentence:
// each is one half of the obligation and written in both directions, so
// rewording is free. Every pattern below was run against the pre-edit capsule
// and was red there, which is what proves none of them is satisfied by prose
// that already existed.
const mandateCapsule = (root, id) => {
  addChange(root, 'in-review', id);
  return buildAgentContext('review', id, root).split('\n# Selected change')[0].replace(/\s+/g, ' ');
};

test('183520 CR1: the review capsule bounds its checklist by the declared mandate', () => {
  const flat = mandateCapsule(repo(), '20260705-120008');
  for (const pattern of [
    // The mandate arrives in the prompt; the capsule does not invent one.
    /\b(prompt|delegation)\b[^.;]{0,70}\bmandate\b|\bmandate\b[^.;]{0,70}\b(prompt|declares?|declared)\b/i,
    // A narrower mandate makes the declared scope the inspection.
    /\b(narrow\w*|spot check|bounded)\b[^.;]{0,90}\b(inspect\w*|scope)\b|\b(inspect\w*|scope)\b[^.;]{0,90}\b(narrow\w*|spot check|bounded)\b/i,
    // What is noticed outside it is reported without widening the inspection.
    /\boutside\b[^.;]{0,70}\bwithout\b[^.;]{0,45}\bexpand|\bwithout\b[^.;]{0,45}\bexpand\w*[^.;]{0,70}\boutside\b/i,
  ]) {
    assert.match(
      flat,
      pattern,
      `the review capsule no longer bounds its checklist by mandate: ${pattern}`,
    );
  }
});

test('183520 CR2: with no mandate declared the review capsule applies the full audit', () => {
  const flat = mandateCapsule(repo(), '20260705-120009');
  assert.match(
    flat,
    /\b(no|without|absent|unstated)\b[^.;]{0,45}\bmandate\b[^.;]{0,90}\b(full|complete|whole)\b|\b(full|complete|whole)\b[^.;]{0,90}\b(no|without|absent|unstated)\b[^.;]{0,45}\bmandate\b/i,
    'the review capsule no longer defaults to the full audit when the prompt declares no mandate',
  );
});

// 20260728-212043 CR6: `agent` is the one entry that bounds both capsule
// classes. `144327 CR8` above only measures `buildAgentContext`'s capsules; the
// `changeledger agent-prompt <role>` capsules were never measured against
// any ceiling, so a regression there could grow silently. Portable — no repo
// fixture needed, `buildAgentPrompt` reads only the packaged templates.
//
// One `test()` per role, not a loop with a single assertion: a loop's first
// `assert.ok` throws and aborts the remaining iterations, so with the ceiling
// still at 350 only `investigation` would report while the rest stayed
// silently unexecuted. One independent test per role
// in the list below is what proves each measured capsule exceeds 350 tokens.
for (const role of ['review']) {
  test(`20260728-212043 CR6: ${role} prompt capsule fits the shared agent budget`, () => {
    assertWithinBudget(`${role} prompt capsule`, buildAgentPrompt(role), agentBudget);
  });
}

for (const retired of ['audit', 'post-review']) {
  test(`20261020-130304 CR2: the retired role "${retired}" never resolves as a role, no alias`, () => {
    const root = repo();
    assert.throws(
      () => buildAgentContext(retired, undefined, root),
      new RegExp(`^Error: Unknown role "${retired}" — valid roles: review$`),
    );
  });
}

test('201703 CR2: review context is allowed only for in-review and requires a change id', () => {
  const root = repo();
  const approved = '20260705-120010';
  const inReview = '20260705-120011';
  addChange(root, 'approved', approved);
  addChange(root, 'in-review', inReview);

  assert.doesNotThrow(() => buildAgentContext('review', inReview, root));
  assert.throws(
    () => buildAgentContext('review', approved, root),
    /role review requires change status in-review; got approved/,
  );
  assert.throws(
    () => buildAgentContext('review', undefined, root),
    /role review requires a change id/,
  );
  // An unknown role names the surviving set, so a retired one cannot look valid.
  assert.throws(() => buildAgentContext('scaffolding', undefined, root), /valid roles: review$/);
  const reviewOut = buildAgentContext('review', inReview, root);
  // Guard the obligation, not its phrasing. Matching the prose failed in both
  // directions: an anchor on the sentence's noun broke when the noun was
  // renamed with the obligation intact, and a looser pattern was satisfied by
  // "per-criterion PASS/FAIL evidence" while the capsule had stopped offering
  // the verdicts at all. So the guard holds the two verdicts the CLI accepts,
  // read from the CLI's own list and required as code spans — a convention the
  // repo already applies to every literal. Rewriting the paragraph around them
  // keeps this green; dropping or renaming a verdict does not. Scoped to the
  // base, so the appended change document cannot satisfy it.
  const base = reviewOut.split('\n# Selected change')[0];
  const literals = new Set([...base.matchAll(/`([a-z][a-z-]*)`/g)].map((m) => m[1]));
  for (const verdict of REVIEW_VERDICTS) {
    assert.ok(literals.has(verdict), `the capsule must offer the \`${verdict}\` verdict`);
  }
  assert.doesNotMatch(base, /fail-(retry|block)|--retry|--block/i);
});

test('144327 CR7: agent-context is wired through the CLI', async () => {
  const root = repo();
  const id = `${'20260705'}-120012`;
  addChange(root, 'in-review', id);
  const { stdout } = await execFileAsync(process.execPath, [bin, 'agent-context', 'review', id], {
    cwd: root,
  });
  assert.match(stdout, /^===== CHANGELEDGER AGENT CONTEXT BEGIN — role: review/);
  assert.match(stdout, /CHANGELEDGER AGENT CONTEXT END/);
});

// 20260726-141120 CR5 — the review capsule is unreachable for a change that
// never enters review: the lifecycle refuses the only status that would
// dispatch it, so the role guard is the last line rather than the only one.
// 20261024-121022 retargeted it from the retired `quick` type to the `epic`,
// the one type the lifecycle keeps out of `in-review`.

function addEpicChange(root, id = '20260726-141120') {
  fs.writeFileSync(
    path.join(root, '.changeledger', 'changes', `${id}-epic-fixture.md`),
    `---
id: "${id}"
title: Epic fixture
type: epic
status: in-progress
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

test('141120 CR5: an epic can never reach the status the review role needs', () => {
  const root = repo();
  const id = addEpicChange(root);
  assert.throws(
    () => status(id, 'in-review', root),
    /^Error: epic changes do not enter review — move to done instead$/,
  );
  assert.throws(
    () => buildAgentContext('review', id, root),
    /^Error: role review requires change status in-review; got in-progress$/,
  );
});

test('141120 CR5: the CLI refuses the review capsule and emits no BEGIN line', async () => {
  const root = repo();
  const id = addEpicChange(root);
  const failure = await execFileAsync(process.execPath, [bin, 'agent-context', 'review', id], {
    cwd: root,
  }).then(
    () => null,
    (e) => e,
  );
  assert.ok(failure, 'the CLI must fail');
  assert.equal(failure.code, 1);
  assert.match(
    failure.stderr,
    /^Error: role review requires change status in-review; got in-progress$/m,
  );
  assert.doesNotMatch(failure.stdout, /CHANGELEDGER AGENT CONTEXT BEGIN/);
});

// --- 20261002-113320: the delegate receives the selected change's tdd ---

// 20261024-121022 retargeted this from the retired `types.documentation.tdd`
// to the change's own `tdd: false`, the only override left.
test('113320 CR5: the policy line follows the selected change, else the global tdd', () => {
  const root = repo();
  const file = path.join(root, '.changeledger', 'config.yml');
  const config = parseYaml(fs.readFileSync(file, 'utf8'));
  config.tdd = true;
  fs.writeFileSync(file, stringifyYaml(config));
  const id = '20261002-113322';
  fs.writeFileSync(
    path.join(root, '.changeledger', 'changes', `${id}-doc-fixture.md`),
    `---
id: "${id}"
title: Doc fixture
type: change
tdd: false
status: in-review
created: 2026-10-02T11:33:20Z
depends_on: []
---

## Request

Document the topic.

### Investigation

Evidence.

## Specification

### CR1 — Claim
- **Given** the code
- **When** read
- **Then** it matches

## Log
`,
  );
  const other = `${'20261002'}-113323`;
  addChange(root, 'in-review', other);
  const policyOf = (out) => out.split('\n').find((line) => line.startsWith('Effective policy:'));
  assert.match(policyOf(buildAgentContext('review', id, root)), /tdd=off/);
  assert.match(policyOf(buildAgentContext('review', other, root)), /tdd=on/);
});
