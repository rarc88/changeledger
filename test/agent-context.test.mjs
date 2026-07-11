import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { buildAgentContext } from '../src/commands/agent-context.mjs';
import { init } from '../src/commands/init.mjs';
import { VERSION } from '../src/framing.mjs';

process.env.CHANGELEDGER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-context-home-'));
const execFileAsync = promisify(execFile);
const bin = path.resolve('bin/changeledger.mjs');
const agentBudget = JSON.parse(
  fs.readFileSync(new URL('../templates/contract/budgets.yml', import.meta.url), 'utf8'),
).agent;

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

- [ ] Update \`src/example.mjs\`; verify: \`node --test test/example.test.mjs\` (CR1)

## Log

- Initial note.
`;
  fs.writeFileSync(path.join(root, '.changeledger', 'changes', `${id}-delegated-work.md`), text);
  return text;
}

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

  assert.doesNotThrow(() => buildAgentContext('implementation', approved, root));
  assert.doesNotThrow(() => buildAgentContext('implementation', progress, root));
  assert.doesNotThrow(() => buildAgentContext('review', review, root));
  assert.throws(
    () => buildAgentContext('review', progress, root),
    /role review requires change status in-review; got in-progress/,
  );
  assert.throws(
    () => buildAgentContext('implementation', review, root),
    /role implementation requires change status approved or in-progress; got in-review/,
  );
  assert.throws(
    () => buildAgentContext('implementation', undefined, root),
    /role implementation requires a change id/,
  );
  assert.throws(
    () => buildAgentContext('scaffolding', undefined, root),
    /valid roles: investigation, implementation, review/,
  );
});

test('144327 CR7: investigation works before a change and optionally includes one', () => {
  const root = repo();
  const without = buildAgentContext('investigation', undefined, root);
  assert.match(without, /role: investigation/);
  assert.doesNotMatch(without, /# Selected change/);

  const id = '20260705-120005';
  addChange(root, 'draft', id);
  const withChange = buildAgentContext('investigation', id, root);
  assert.match(withChange, new RegExp(`# Selected change[\\s\\S]*id: "${id}"`));
});

test('144327 CR8: delegated capsules expose no orchestrator mutation surface and fit budget', () => {
  const root = repo();
  const fixtures = {
    investigation: undefined,
    implementation: '20260705-120006',
    review: '20260705-120007',
  };
  addChange(root, 'approved', fixtures.implementation);
  addChange(root, 'in-review', fixtures.review);

  for (const [role, id] of Object.entries(fixtures)) {
    const out = buildAgentContext(role, id, root);
    const base = out.split('\n# Selected change')[0];
    assertWithinBudget(`${role} capsule`, base, agentBudget);
    assert.doesNotMatch(
      base,
      /changeledger (status|task|log|review|graduate|archive|unarchive)/,
      `${role} exposes orchestrator mutation commands`,
    );
    assert.doesNotMatch(base, /# Economical Delegation|Do not over-shard/);
  }

  assert.match(buildAgentContext('investigation', undefined, root), /read-only/i);
  assert.match(buildAgentContext('review', fixtures.review, root), /read-only/i);
  assert.match(
    buildAgentContext('implementation', fixtures.implementation, root),
    /only the files assigned in the delegation prompt/i,
  );
});

test('201703 CR1: audit context is allowed only for in-validation and is framed, read-only', () => {
  const root = repo();
  const id = '20260705-120008';
  const selected = addChange(root, 'in-validation', id);
  const out = buildAgentContext('audit', id, root);
  assert.equal(
    out.split('\n')[0],
    `===== CHANGELEDGER AGENT CONTEXT BEGIN — role: audit — change: #${id} — v${VERSION} =====`,
  );
  assert.equal(
    out.trimEnd().split('\n').at(-1),
    '===== CHANGELEDGER AGENT CONTEXT END — if this line is missing, the output was truncated: stop and re-run =====',
  );
  assert.match(out, /self-contained delegated context/i);
  assert.match(out, /do not run `changeledger context`/i);
  assert.match(out, /read-only/i);
  assert.match(out, /do not modify files, do not change Git state, do not mutate the\s+ledger/i);
  assert.match(out, /do not\s+change status/i);
  assert.match(out, /do not add\s+Log entries/i);
  assert.match(out, /# Selected change[\s\S]*Do the delegated work/);
  assert.ok(out.includes(selected.trim()));
});

test('201703 CR2: audit never asks for a verdict or a lifecycle command', () => {
  const root = repo();
  const id = '20260705-120009';
  addChange(root, 'in-validation', id);
  const out = buildAgentContext('audit', id, root);
  const base = out.split('\n# Selected change')[0];
  assert.match(base, /findings and evidence/i);
  assert.doesNotMatch(base, /recommended (outcome|verdict)/i);
  assert.doesNotMatch(base, /pass, fail-retry|fail-block/i);
  assert.doesNotMatch(
    base,
    /changeledger (status|task|log|review|graduate|archive|unarchive|validation)/,
  );
});

test('201703 CR1/CR2: audit requires in-validation and requires a change id; review keeps its own guard', () => {
  const root = repo();
  const approved = '20260705-120010';
  const inReview = '20260705-120011';
  const inValidation = '20260705-120012';
  addChange(root, 'approved', approved);
  addChange(root, 'in-review', inReview);
  addChange(root, 'in-validation', inValidation);

  assert.doesNotThrow(() => buildAgentContext('audit', inValidation, root));
  assert.throws(
    () => buildAgentContext('audit', inReview, root),
    /role audit requires change status in-validation; got in-review/,
  );
  assert.throws(
    () => buildAgentContext('audit', approved, root),
    /role audit requires change status in-validation; got approved/,
  );
  assert.throws(
    () => buildAgentContext('audit', undefined, root),
    /role audit requires a change id/,
  );
  // review keeps its current in-review-only guard and verdict recipe untouched.
  assert.doesNotThrow(() => buildAgentContext('review', inReview, root));
  assert.throws(
    () => buildAgentContext('review', inValidation, root),
    /role review requires change status in-review; got in-validation/,
  );
  const reviewOut = buildAgentContext('review', inReview, root);
  assert.match(reviewOut, /pass, fail-retry|fail-block/i);
});

test('201703 CR3: audit capsule fits the shared agent budget and lists in the CLI role set', () => {
  const root = repo();
  const id = '20260705-120013';
  addChange(root, 'in-validation', id);
  const out = buildAgentContext('audit', id, root);
  const base = out.split('\n# Selected change')[0];
  assertWithinBudget('audit capsule', base, agentBudget);
  assert.throws(
    () => buildAgentContext('scaffolding', undefined, root),
    /valid roles: investigation, implementation, review, audit/,
  );
});

test('144327 CR7: agent-context is wired through the CLI', async () => {
  const root = repo();
  const { stdout } = await execFileAsync(
    process.execPath,
    [bin, 'agent-context', 'investigation'],
    { cwd: root },
  );
  assert.match(stdout, /^===== CHANGELEDGER AGENT CONTEXT BEGIN — role: investigation/);
  assert.match(stdout, /CHANGELEDGER AGENT CONTEXT END/);
});
