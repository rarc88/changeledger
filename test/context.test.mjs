import assert from 'node:assert/strict';
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
