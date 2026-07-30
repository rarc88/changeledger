import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { buildAgentPrompt } from '../src/commands/agent-prompt.mjs';
import { VERSION } from '../src/framing.mjs';
import { contractTemplatesDir } from '../src/paths.mjs';

const execFileAsync = promisify(execFile);
const bin = path.resolve('bin/changeledger.mjs');
const ROLES = ['investigation', 'implementation', 'review', 'post-review'];

// npm ships as the `npm.cmd` shim on Windows; execFile does not resolve
// shims through PATH the way a shell would, so the command must be
// selected per platform to avoid `spawn npm ENOENT` in CI.
function npmCommand(platform) {
  return platform === 'win32' ? 'npm.cmd' : 'npm';
}

function skeleton(role) {
  return fs.readFileSync(path.join(contractTemplatesDir, 'agent-prompts', `${role}.md`), 'utf8');
}

// Prose in the skeletons wraps, so collapse whitespace before matching phrases.
function prose(role) {
  return skeleton(role).replace(/\s+/g, ' ');
}

test('CR1: agent-prompt prints a role skeleton framed by its own delimiters', () => {
  for (const role of ROLES) {
    const out = buildAgentPrompt(role);
    const lines = out.split('\n');
    assert.equal(
      lines[0],
      `===== CHANGELEDGER AGENT PROMPT BEGIN — role: ${role} — v${VERSION} =====`,
    );
    assert.equal(
      out.trimEnd().split('\n').at(-1),
      '===== CHANGELEDGER AGENT PROMPT END — if this line is missing, the output was truncated: stop and re-run =====',
    );
    assert.ok(out.includes(skeleton(role).trim()), `${role} body must be the file content`);
  }
});

test('CR1: agent-prompt works outside an initialized repo (static package asset)', async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-prompt-outside-'));
  const { stdout } = await execFileAsync(process.execPath, [bin, 'agent-prompt', 'review'], {
    cwd: outside,
  });
  assert.match(stdout, /^===== CHANGELEDGER AGENT PROMPT BEGIN — role: review — v/);
  assert.match(stdout, /role: review/);
});

test('CR2: an unknown role fails with a non-zero exit listing the valid roles', async () => {
  assert.throws(
    () => buildAgentPrompt('scaffolding'),
    /valid roles: investigation, implementation, review, post-review/,
  );
  await assert.rejects(
    execFileAsync(process.execPath, [bin, 'agent-prompt', 'scaffolding']),
    (err) => {
      assert.notEqual(err.code, 0);
      assert.match(err.stderr, /investigation, implementation, review, post-review/);
      return true;
    },
  );
});

test('20260726-141123 CR2: the retired role name audit never resolves, no alias', () => {
  assert.throws(
    () => buildAgentPrompt('audit'),
    /^Error: Unknown role "audit" — valid roles: investigation, implementation, review, post-review$/,
  );
});

test('CR3: every skeleton materializes the full delegation contract', () => {
  for (const role of ROLES) {
    const body = prose(role);
    // Delegation-prompt contract fields, all present as literal placeholders.
    assert.match(body, /\{\{reason\}\}/, `${role} missing reason`);
    assert.match(body, /\{\{expected_output\}\}/, `${role} missing expected output`);
    assert.match(body, /\{\{difficulty_or_risk\}\}/, `${role} missing difficulty/risk`);
    assert.match(body, /\{\{integration\}\}/, `${role} missing integration`);
    // Ownership or question, per role (files, question, or the change under review).
    assert.match(body, /\{\{(files|question|change_id)\}\}/, `${role} missing ownership/question`);
    // No re-delegation, and a stated return to the orchestrator. Tolerant since
    // 20260730-002730: the obligation, not the skeleton's sentence.
    assert.match(
      body,
      /\bdo not delegate\b[^.]{0,45}\b(another|other)\b[^.]{0,15}\b(agent|subagent|delegate)\b/i,
      `${role} allows re-delegation`,
    );
    assert.match(body, /Return to the orchestrator/, `${role} missing return contract`);
  }

  // Investigation, review and post-review forbid any write, by effect — no tool names.
  for (const role of ['investigation', 'review', 'post-review']) {
    const body = prose(role);
    assert.match(body, /do not modify any file/i, `${role} must forbid file writes`);
    assert.match(body, /do not change Git state/i, `${role} must forbid git writes`);
    assert.match(
      body,
      /do not mutate the ledger|never record the verdict/i,
      `${role} must forbid ledger writes`,
    );
    assert.doesNotMatch(
      body,
      /\b(Edit|Write|Bash|Read)\b tool/,
      `${role} must not name harness tools`,
    );
  }

  // Implementation bounds writes and reserves the ledger to the orchestrator.
  // Tolerant concept matches since 20260730-002730: each obligation, never its sentence.
  const impl = prose('implementation');
  assert.match(
    impl,
    /\b(modify|edit|touch)\b[^.]{0,20}\bonly\b[^.]{0,30}\b(ownership|owned|assigned)\b/i,
  );
  assert.match(impl, /do not\b[^.]{0,20}\b(revert|overwrite)\b[^.]{0,35}\b(anyone|others?)\b/i);
  assert.match(impl, /\breport\b[^.]{0,30}\binstead of\b[^.]{0,30}\b(resolving|fixing)\b/i);
  assert.match(impl, /Do not mutate the ledger/i);
  // 20260711-160446: a baseline that fails to resolve is a stop, not a
  // recovery-from-memory or another-base fallback.
  assert.match(impl, /\bdoes not\b[^.]{0,15}\bresolve\b[^.]{0,90}\bstop and report\b/i);
  assert.match(impl, /never reconstruct.*from memory.*never continue from another base/i);
});

// 20260730-165310 CR1: the review skeleton must say WHAT is reviewed. Without a
// mandate field every review is a full audit by construction, so the placeholder
// and its three legal forms are structural composition of the capsule and are
// pinned literally — the register the CR3 loop above uses for placeholders.
test('165310 CR1: the review skeleton carries the mandate field and its three forms', () => {
  const body = prose('review');
  assert.match(body, /\{\{mandate\}\}/, 'the review skeleton lost the mandate placeholder');
  for (const form of [
    /spot check of the named diff/i,
    /the surface the change governs/i,
    /full audit/i,
  ]) {
    assert.match(body, form, `the review skeleton no longer offers the mandate form ${form}`);
  }
});

// The mandate is worthless if the capsule states the bound and nothing keeps it
// there: `review.md` guards its own version of this obligation, so an unguarded
// capsule is the drift seam between the two seats — the reviewer deleted this
// sentence and the whole suite stayed green.
//
// The two halves below are a deliberate local copy of the CR2 entry of
// `DELEGATION_OBLIGATIONS` in `test/context.test.mjs`, not an import: that file is
// a `node:test` suite, so importing it would run its 112 tests inside this one.
// Both copies must move together. Only this side carries the cross-reference: the
// correction that added it owned this file alone, so the twin does not name it back.
//
// A separate test from the placeholder pin above, not another assert inside it: a
// failure must say which of the two obligations the capsule lost, and the first
// failing assert aborts the rest of its test.
test('165310 CR1: the review skeleton bounds the inspection to the declared mandate', () => {
  const body = prose('review');
  for (const half of [
    /\bwithin\b[^.;]{0,45}\bmandate\b|\bmandate\b[^.;]{0,45}\bbounds?\b/i,
    /\boutside\b[^.;]{0,60}\bwithout\b[^.;]{0,45}\bexpand|\bwithout\b[^.;]{0,45}\bexpand\w*[^.;]{0,60}\boutside\b/i,
  ]) {
    assert.match(body, half, `the review skeleton no longer bounds the inspection: ${half}`);
  }
});

test('CR4: each role loads available context without inventing a change', () => {
  for (const role of ROLES) {
    assert.match(
      prose(role),
      /\bdo not run\b[^.]{0,30}\bbootstrap\b[^.]{0,25}`changeledger context`/i,
      `${role} must explicitly replace the bootstrap default`,
    );
    assert.match(
      prose(role),
      new RegExp(`changeledger agent-context ${role}`),
      `${role} must load its delegated capsule`,
    );
  }
  for (const role of ['implementation', 'review', 'post-review']) {
    assert.match(
      prose(role),
      new RegExp(`changeledger agent-context ${role} \\{\\{change_id\\}\\}`),
      `${role} must load its id capsule`,
    );
  }
  // Review references the checklist from its capsule instead of duplicating it.
  assert.match(prose('review'), /checklist that agent-context gives you/i);
  // Investigation admits there may be no change id yet.
  const inv = prose('investigation');
  assert.match(inv, /\bno change\b[^.]{0,25}\bwork\b[^.]{0,30}\bwithout a change id\b/i);
  assert.match(inv, /\boptional id\b[^.]{0,25}\bempty\b[^.]{0,15}\bomit\b/i);
  // Post-review never issues a verdict — the review gate already ran.
  const postReview = prose('post-review');
  assert.match(postReview, /never issues a verdict|do not issue a verdict/i);
});

test('CR1: npm command selection picks the Windows shim only on win32', () => {
  assert.equal(npmCommand('win32'), 'npm.cmd');
  assert.equal(npmCommand('linux'), 'npm');
  assert.equal(npmCommand('darwin'), 'npm');
});

test('CR6: the skeletons ship in the publishable package', async () => {
  const { stdout } = await execFileAsync(
    npmCommand(process.platform),
    ['pack', '--dry-run', '--json'],
    {
      cwd: path.resolve('.'),
      shell: process.platform === 'win32',
    },
  );
  const entries = JSON.parse(stdout)[0].files.map((f) => f.path);
  for (const role of ROLES) {
    assert.ok(
      entries.includes(`templates/contract/agent-prompts/${role}.md`),
      `package missing ${role} skeleton`,
    );
    assert.ok(
      entries.includes(`templates/contract/agent-contexts/${role}.md`),
      `package missing ${role} capsule`,
    );
  }
});
