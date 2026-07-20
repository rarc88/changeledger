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
const ROLES = ['investigation', 'implementation', 'review', 'audit'];

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
    /valid roles: investigation, implementation, review, audit/,
  );
  await assert.rejects(
    execFileAsync(process.execPath, [bin, 'agent-prompt', 'scaffolding']),
    (err) => {
      assert.notEqual(err.code, 0);
      assert.match(err.stderr, /investigation, implementation, review, audit/);
      return true;
    },
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
    // No re-delegation, and a stated return to the orchestrator.
    assert.match(
      body,
      /Do not delegate any part of this to another agent/,
      `${role} allows re-delegation`,
    );
    assert.match(body, /Return to the orchestrator/, `${role} missing return contract`);
  }

  // Investigation, review and audit forbid any write, by effect — no tool names.
  for (const role of ['investigation', 'review', 'audit']) {
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
  const impl = prose('implementation');
  assert.match(impl, /modify only the files under your ownership/i);
  assert.match(impl, /do not revert or overwrite anyone else's work/i);
  assert.match(impl, /report it instead of resolving it silently/i);
  assert.match(impl, /Do not mutate the ledger/i);
  // 20260711-160446: a baseline that fails to resolve is a stop, not a
  // recovery-from-memory or another-base fallback.
  assert.match(impl, /does not resolve the change.*stop and report instead of proceeding/i);
  assert.match(impl, /never reconstruct.*from memory.*never continue from another base/i);
});

test('CR4: each role loads available context without inventing a change', () => {
  for (const role of ROLES) {
    assert.match(
      prose(role),
      /For this delegated task, do not run the bootstrap's default `changeledger context`/i,
      `${role} must explicitly replace the bootstrap default`,
    );
    assert.match(
      prose(role),
      new RegExp(`changeledger agent-context ${role}`),
      `${role} must load its delegated capsule`,
    );
  }
  for (const role of ['implementation', 'review', 'audit']) {
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
  assert.match(inv, /There may be no change yet: work without a change id/i);
  assert.match(inv, /If the optional id below is empty, omit it/i);
  // Audit never issues a verdict — the review gate already ran.
  const audit = prose('audit');
  assert.match(audit, /never issues a verdict|do not issue a verdict/i);
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
