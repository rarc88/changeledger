import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { init } from '../src/commands/init.mjs';
import { registerRepo } from '../src/commands/register.mjs';
import { checkContract, REFERENCE, removeLegacyContract } from '../src/contract.mjs';

process.env.CHANGELEDGER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-home-'));

function root() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-repo-'));
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Project rules\n');
  return dir;
}

test('CR10: init installs a fail-closed bootstrap without link or gitignore entry', () => {
  const dir = root();
  init(dir);
  assert.equal(fs.existsSync(path.join(dir, '.changeledger', 'AGENTS.md')), false);
  assert.equal(fs.existsSync(path.join(dir, '.gitignore')), false);
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.match(agents, /changeledger context/);
  assert.match(agents, /run `changeledger context` directly/);
  assert.match(agents, /restore\/install ChangeLedger; do not proceed from memory/);
  assert.doesNotMatch(agents, /\.changeledger\/AGENTS\.md/);
  assert.deepEqual(checkContract(dir), []);
});

test('213931 CR1: bootstrap triggers the core load immediately, not only before edits', () => {
  const dir = root();
  init(dir);
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.match(agents, /Immediately after reading this file/);
  assert.match(agents, /before\s+>?\s*planning, investigating, or acting/);
  assert.doesNotMatch(agents, /Before creating or modifying files/);
});

test('213931 CR2: bootstrap carries the hard rule and defers detail to the core', () => {
  const dir = root();
  init(dir);
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.match(agents, /Do not create or modify files without an authorized change/);
  assert.match(
    agents,
    /the core context\s+>?\s*defines the workflow, the task contexts, and the narrow operational exception/,
  );
  // No mode enumeration (it invites skipping the base context) and no absolute
  // "Never" (the core's operational-exception valve is the single truth).
  assert.doesNotMatch(agents, /spec\|implement\|review\|release/);
  assert.doesNotMatch(agents, /Never create or modify/);
});

test('213931 CR3: bootstrap verifies completeness through the END sentinel', () => {
  const dir = root();
  init(dir);
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.match(agents, /through the `CHANGELEDGER CONTEXT END` line/);
  assert.match(agents, /If that\s+>?\s*line is missing, the output was truncated/);
  assert.match(agents, /re-run the command\s+>?\s*directly, without pipes or filters/);
});

test('CR10/CR12: reference refresh is idempotent and stale references fail check', () => {
  const dir = root();
  init(dir);
  registerRepo(dir);
  registerRepo(dir);
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.equal(agents.match(/<!-- changeledger -->/g).length, 1);
  assert.ok(agents.includes(REFERENCE.trim()));

  fs.writeFileSync(
    path.join(dir, 'AGENTS.md'),
    '# Project\n\n<!-- changeledger -->\n> Read `.changeledger/AGENTS.md`.\n',
  );
  assert.match(checkContract(dir).join('\n'), /outdated ChangeLedger reference/);
  registerRepo(dir);
  assert.deepEqual(checkContract(dir), []);
});

test('213931 CR7: the pre-sentinel managed block fails check until re-register', () => {
  const dir = root();
  init(dir);
  const previousReference = `<!-- changeledger -->
> [!IMPORTANT]
> This repo uses **ChangeLedger**. Before creating or modifying files, run
> \`changeledger context\` directly, read its complete output, and follow it.
> Do not pipe, filter, summarize, limit, or truncate the output before reading it.
> If the output is truncated/incomplete, stop and restore complete context before
> proceeding. If the command is unavailable, stop and restore/install
> ChangeLedger; do not proceed from memory.
`;
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), `# Project\n\n${previousReference}`);
  assert.match(checkContract(dir).join('\n'), /outdated ChangeLedger reference/);
  registerRepo(dir);
  assert.deepEqual(checkContract(dir), []);
});

test('CR11: register removes a legacy symlink and exact gitignore entry', () => {
  const dir = root();
  init(dir);
  const artifact = path.join(dir, '.changeledger', 'AGENTS.md');
  const target = path.join(dir, 'legacy-contract.md');
  fs.writeFileSync(target, '# legacy\n');
  fs.symlinkSync(target, artifact);
  fs.writeFileSync(path.join(dir, '.gitignore'), 'dist\n.changeledger/AGENTS.md\n.env\n');
  registerRepo(dir);
  assert.equal(fs.existsSync(artifact), false);
  assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), 'dist\n.env\n');
});

test('CR11: register removes a recognized Windows fallback copy', () => {
  const dir = root();
  init(dir);
  const artifact = path.join(dir, '.changeledger', 'AGENTS.md');
  const legacy = '# AGENTS.md — ChangeLedger Contract\nknown exact legacy payload\n';
  fs.writeFileSync(artifact, legacy);
  const digest = crypto.createHash('sha256').update(legacy).digest('hex');
  removeLegacyContract(path.join(dir, '.changeledger'), new Set([digest]));
  assert.equal(fs.existsSync(artifact), false);
});

test('CR11: register preserves and rejects an unknown regular file', () => {
  const dir = root();
  init(dir);
  const artifact = path.join(dir, '.changeledger', 'AGENTS.md');
  fs.writeFileSync(artifact, '# AGENTS.md — ChangeLedger Contract\nuser-owned additions\n');
  assert.throws(() => registerRepo(dir), /not a recognized legacy ChangeLedger contract/);
  assert.equal(
    fs.readFileSync(artifact, 'utf8'),
    '# AGENTS.md — ChangeLedger Contract\nuser-owned additions\n',
  );
});

test('CR11: register removes only the literal legacy gitignore line', () => {
  const dir = root();
  init(dir);
  fs.writeFileSync(
    path.join(dir, '.gitignore'),
    '.changeledger/AGENTS.md\n .changeledger/AGENTS.md\n.changeledger/AGENTS.md \n',
  );
  registerRepo(dir);
  assert.equal(
    fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'),
    ' .changeledger/AGENTS.md\n.changeledger/AGENTS.md \n',
  );
});
