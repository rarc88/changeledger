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
    assert.ok(base.split('\n').length <= 60, `${role} exceeds 60 base lines`);
    assert.ok(Buffer.byteLength(base) <= 3000, `${role} exceeds 3000 base bytes`);
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
