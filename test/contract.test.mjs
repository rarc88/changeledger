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

function reflowBootstrap(text) {
  return text.replace(
    '> This repo uses **ChangeLedger**. Immediately after reading this file — before\n> planning, investigating, or acting — a normal agent must run `changeledger context` directly.',
    '>This repo uses **ChangeLedger**. Immediately after reading this file —\n> before planning, investigating, or acting — a normal agent must run\n>`changeledger context` directly.',
  );
}

function prettierBootstrap(text) {
  return text
    .replace(/(<!-- CHANGELEDGER BOOTSTRAP BEGIN v\d+ -->)\n/, '$1\n\n')
    .replace(
      "> [mode] --have <rev>` (the BEGIN line's `rev:`) instead of recapturing in",
      "[mode] --have <rev>` (the BEGIN line's `rev:`) instead of recapturing in",
    )
    .replace('\n<!-- CHANGELEDGER BOOTSTRAP END -->', '\n\n<!-- CHANGELEDGER BOOTSTRAP END -->');
}

test('CR10: init installs a fail-closed bootstrap without link or gitignore entry', () => {
  const dir = root();
  init(dir);
  assert.equal(fs.existsSync(path.join(dir, '.changeledger', 'AGENTS.md')), false);
  assert.equal(fs.existsSync(path.join(dir, '.gitignore')), false);
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.match(agents, /changeledger context/);
  assert.match(agents, /run `changeledger context` directly/);
  assert.match(agents, /restore\/install ChangeLedger; do not\s+>?\s*proceed from memory/);
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
  assert.match(agents, /first invocation[\s\S]*retain complete stdout/i);
  assert.match(agents, /no pipes, filters, summaries, previews or voluntary output limits/i);
  assert.match(agents, /output budget[\s\S]*whole response/i);
  assert.match(agents, /exceptional recovery/i);
});

test('144327 CR9: bootstrap permits only the role-matched delegated capsule instead of core', () => {
  const dir = root();
  init(dir);
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.match(agents, /normal agent[\s\S]*run `changeledger context`/i);
  assert.match(
    agents,
    /prompt (?:was )?emitted by `changeledger agent-prompt <role>`[\s\S]*`changeledger agent-context <role> \[change-id\]`/i,
  );
  assert.match(agents, /role in the\s+>?\s*prompt and command must match/i);
  assert.match(agents, /CHANGELEDGER (?:AGENT )?CONTEXT END/);
  assert.doesNotMatch(agents, /any delegate may skip/i);
});

test('CR10/CR12: reference refresh is idempotent and stale references fail check', () => {
  const dir = root();
  init(dir);
  registerRepo(dir);
  registerRepo(dir);
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.equal(agents.match(/CHANGELEDGER BOOTSTRAP BEGIN v\d+/g).length, 1);
  assert.equal(agents.match(/CHANGELEDGER BOOTSTRAP END/g).length, 1);
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

test('150300 CR1: check accepts equivalent blockquote reflow', () => {
  const dir = root();
  init(dir);
  const file = path.join(dir, 'AGENTS.md');
  const canonical = fs.readFileSync(file, 'utf8');
  const reformatted = reflowBootstrap(canonical);
  assert.notEqual(reformatted, canonical);

  fs.writeFileSync(file, reformatted);

  assert.deepEqual(checkContract(dir), []);
});

test('153633 CR1/CR3: check accepts the real Prettier lazy-continuation fixture', () => {
  const dir = root();
  init(dir);
  const file = path.join(dir, 'AGENTS.md');
  const canonical = fs.readFileSync(file, 'utf8');
  const reformatted = prettierBootstrap(canonical);
  assert.notEqual(reformatted, canonical);
  assert.match(reformatted, /context\n\[mode\] --have/);

  fs.writeFileSync(file, reformatted);

  assert.deepEqual(checkContract(dir), []);
});

test('153633 CR3: check accepts different Markdown syntax with the same token tree', () => {
  const dir = root();
  init(dir);
  const file = path.join(dir, 'AGENTS.md');
  const canonical = fs.readFileSync(file, 'utf8');
  const equivalent = canonical.replace('**ChangeLedger**', '__ChangeLedger__');
  assert.notEqual(equivalent, canonical);

  fs.writeFileSync(file, equivalent);

  assert.deepEqual(checkContract(dir), []);
});

test('150300 CR3/CR4: check rejects semantic and structural bootstrap changes', () => {
  const mutations = [
    (text) =>
      text.replace('run `changeledger context` directly', 'run `changeledger check` directly'),
    (text) => text.replace('This repo uses **ChangeLedger**.', 'This  repo uses **ChangeLedger**.'),
    (text) => text.replace('> planning, investigating', '>\n> planning, investigating'),
    (text) =>
      text.replace(
        '> planning, investigating',
        '>\n\noutside the blockquote\n\n> planning, investigating',
      ),
  ];

  for (const mutate of mutations) {
    const dir = root();
    init(dir);
    const file = path.join(dir, 'AGENTS.md');
    const canonical = fs.readFileSync(file, 'utf8');
    const changed = mutate(canonical);
    assert.notEqual(changed, canonical);
    fs.writeFileSync(file, changed);

    assert.deepEqual(checkContract(dir), [
      'AGENTS.md has an outdated ChangeLedger reference — run `changeledger register`',
    ]);
  }

  const dir = root();
  init(dir);
  const file = path.join(dir, 'AGENTS.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').trimEnd());
  assert.throws(() => checkContract(dir), /END marker must occupy its own line/);

  const missingEndDir = root();
  init(missingEndDir);
  const missingEndFile = path.join(missingEndDir, 'AGENTS.md');
  fs.writeFileSync(
    missingEndFile,
    fs.readFileSync(missingEndFile, 'utf8').replace('<!-- CHANGELEDGER BOOTSTRAP END -->', ''),
  );
  assert.throws(() => checkContract(missingEndDir), /BEGIN marker without a matching END marker/);
});

test('153633 CR4/CR5: check rejects semantic token and delimiter changes', () => {
  const mutations = [
    (text) => text.replace('`changeledger context` directly', '`changeledger check` directly'),
    (text) => text.replace('**ChangeLedger**', '**[ChangeLedger](https://example.com)**'),
    (text) => `${text}<!-- CHANGELEDGER BOOTSTRAP END -->\n`,
    (text) =>
      text.replace('<!-- CHANGELEDGER BOOTSTRAP BEGIN', 'prefix <!-- CHANGELEDGER BOOTSTRAP BEGIN'),
  ];

  for (const mutate of mutations) {
    const dir = root();
    init(dir);
    const file = path.join(dir, 'AGENTS.md');
    const canonical = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, mutate(canonical));

    let errors;
    try {
      errors = checkContract(dir);
    } catch (error) {
      assert.match(error.message, /Malformed ChangeLedger bootstrap/);
      continue;
    }
    assert.deepEqual(errors, [
      'AGENTS.md has an outdated ChangeLedger reference — run `changeledger register`',
    ]);
  }
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
