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
    '> Attempt to run **ChangeLedger** with `changeledger context` immediately after\n> reading this file — before planning, investigating, or acting.',
    '>Attempt to run **ChangeLedger** with `changeledger context` immediately\n> after reading this file — before planning, investigating, or acting.',
  );
}

function prettierBootstrap(text) {
  return text
    .replace(/(<!-- CHANGELEDGER BOOTSTRAP BEGIN v\d+ -->)\n/, '$1\n\n')
    .replace('> [mode] --have <rev>`', '[mode] --have <rev>`')
    .replace('\n<!-- CHANGELEDGER BOOTSTRAP END -->', '\n\n<!-- CHANGELEDGER BOOTSTRAP END -->');
}

test('212659 CR1/CR2: init installs an optional bootstrap without hiding real failures', () => {
  const dir = root();
  init(dir);
  assert.equal(fs.existsSync(path.join(dir, '.changeledger', 'AGENTS.md')), false);
  assert.equal(fs.existsSync(path.join(dir, '.gitignore')), false);
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.match(agents, /Attempt to run[\s\S]*`changeledger context`/);
  assert.match(agents, /command is unavailable[\s\S]*continue normally without ChangeLedger/i);
  assert.match(agents, /starts but fails[\s\S]*report the error[\s\S]*human/i);
  assert.match(agents, /human[\s\S]*decide how\s+>?\s*to continue/i);
  assert.doesNotMatch(agents, /restore\/install ChangeLedger|command -v|which changeledger/i);
  assert.doesNotMatch(agents, /\.changeledger\/AGENTS\.md/);
  assert.deepEqual(checkContract(dir), []);
});

test('212659 CR1: bootstrap attempts the core load immediately, not only before edits', () => {
  const dir = root();
  init(dir);
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.match(agents, /immediately after\s+>?\s*reading this file/i);
  assert.match(agents, /before\s+>?\s*planning, investigating, or acting/);
  assert.doesNotMatch(agents, /Before creating or modifying files/);
});

test('212659 CR7: bootstrap leaves lifecycle authority to loaded context', () => {
  const dir = root();
  init(dir);
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.match(
    agents,
    /If it succeeds,[\s\S]*follow (?:its|that)\s+>?\s*complete (?:output|context)/i,
  );
  assert.doesNotMatch(agents, /Do not create or modify files without an authorized change/);
  assert.doesNotMatch(agents, /workflow, the task contexts, and the narrow operational exception/);
  assert.doesNotMatch(agents, /spec\|implement\|review\|release/);
});

test('212659 CR3/CR4: bootstrap preserves complete capture and revision recovery', () => {
  const dir = root();
  init(dir);
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.match(agents, /through the `CHANGELEDGER CONTEXT END` line/);
  assert.match(
    agents.replace(/\s+/g, ' '),
    /`changeledger context`[^.]*\.[^.]*(?:If it succeeds|On success),\s*>?\s*retain complete stdout/i,
  );
  assert.match(agents, /no pipes, filters, summaries, previews or voluntary output limits/i);
  assert.match(agents, /output budget[\s\S]*whole response/i);
  assert.match(agents, /missing END[\s\S]*re-run with a larger capture/i);
  assert.match(
    agents,
    /After a compaction[\s\S]*`changeledger context\s+>?\s*\[mode\] --have <rev>`/i,
  );
  assert.match(agents, /context or its revision was lost[\s\S]*load it completely again/i);
});

test('212659 CR5: bootstrap contains no delegation mechanism', () => {
  const dir = root();
  init(dir);
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.doesNotMatch(
    agents,
    /delegat|subagent|agent-context|investigation|implementation|CHANGELEDGER AGENT CONTEXT END/i,
  );
});

test('212659 CR6: bootstrap leaves divergence policy to loaded context', () => {
  const dir = root();
  init(dir);
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.doesNotMatch(agents, /divergence|specs and code|reconcile/i);
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

test('124113 CR1: CLAUDE.md may import the canonical AGENTS.md bootstrap', () => {
  for (const claude of ['@AGENTS.md\n', '# Claude\n\nFollow @AGENTS.md for shared rules.\n']) {
    const dir = root();
    init(dir);
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), claude);

    assert.deepEqual(checkContract(dir), []);
  }
});

test('124113 CR2: register preserves an imported CLAUDE.md byte-for-byte', () => {
  const dir = root();
  init(dir);
  const file = path.join(dir, 'CLAUDE.md');
  const claude = '# Claude-specific rules\n\n@AGENTS.md\n\nKeep this text.\n';
  fs.writeFileSync(file, claude);

  registerRepo(dir);

  assert.equal(fs.readFileSync(file, 'utf8'), claude);
});

test('124113 CR3: an import does not hide an invalid canonical AGENTS.md', () => {
  const dir = root();
  init(dir);
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '@AGENTS.md\n');
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Project rules without bootstrap\n');

  assert.deepEqual(checkContract(dir), [
    'AGENTS.md has no ChangeLedger reference — run `changeledger register`',
  ]);
});

test('124113 CR4: other paths and partial tokens are not canonical imports', () => {
  const invalid = [
    'AGENTS.md\n',
    '@docs/AGENTS.md\n',
    '@../AGENTS.md\n',
    '@/repo/AGENTS.md\n',
    '@AGENTS.md.bak\n',
  ];
  for (const claude of invalid) {
    const dir = root();
    init(dir);
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), claude);

    assert.deepEqual(checkContract(dir), [
      'CLAUDE.md has no ChangeLedger reference — run `changeledger register`',
    ]);
  }
});

test('124113 CR5: a direct stale CLAUDE.md bootstrap still requires repair', () => {
  const dir = root();
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Claude rules\n');
  init(dir);
  const file = path.join(dir, 'CLAUDE.md');
  const stale = fs
    .readFileSync(file, 'utf8')
    .replace(
      '<!-- CHANGELEDGER BOOTSTRAP BEGIN v3 -->',
      '<!-- CHANGELEDGER BOOTSTRAP BEGIN v0 -->',
    );
  fs.writeFileSync(file, `@AGENTS.md\n\n${stale}`);

  assert.deepEqual(checkContract(dir), [
    'CLAUDE.md has an outdated ChangeLedger reference — run `changeledger register`',
  ]);
  registerRepo(dir);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /BOOTSTRAP BEGIN v0/);
});

test('150300 CR3/CR4: check rejects semantic and structural bootstrap changes', () => {
  const mutations = [
    (text) => text.replace('with `changeledger context`', 'with `changeledger check`'),
    (text) => text.replace('Attempt to run **ChangeLedger**', 'Attempt  to run **ChangeLedger**'),
    (text) => text.replace('> reading this file', '>\n> reading this file'),
    (text) =>
      text.replace('> reading this file', '>\n\noutside the blockquote\n\n> reading this file'),
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
    (text) => text.replace('`changeledger context`', '`changeledger check`'),
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

test('141119 CR5: refactor activates specification in every versioned artifact', () => {
  const repoRoot = new URL('../', import.meta.url);
  for (const file of ['.changeledger/config.yml', 'templates/config.yml']) {
    assert.match(
      fs.readFileSync(new URL(file, repoRoot), 'utf8'),
      / {2}refactor:\n {4}stages: \[request, proposal, specification, plan, log\]\n {4}review_required: true\n/,
      `${file} must activate specification for the refactor type`,
    );
  }
  assert.ok(
    fs
      .readFileSync(new URL('templates/contract/spec.md', repoRoot), 'utf8')
      .includes('| refactor | ✓ | — | ✓ | ✓ | ✓ | ✓ |'),
    'the default activation matrix must mark specification active for refactor',
  );
});
