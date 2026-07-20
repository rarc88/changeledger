import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { registerRepo } from '../src/commands/register.mjs';
import { BOOTSTRAP_VERSION, REFERENCE } from '../src/contract.mjs';

process.env.CHANGELEDGER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'register-home-'));

function initializedRepo(agentsBody = '# Project rules\n') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'register-repo-'));
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), agentsBody);
  fs.mkdirSync(path.join(dir, '.changeledger', 'changes'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.changeledger', 'config.yml'),
    'schema_version: 1\nproject_id: "abc1234567"\nproject_name: test\n',
  );
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

const noopOutput = { warn: () => {}, log: () => {} };

test('CR1: register inserts the bootstrap wrapped in versioned BEGIN/END delimiters', () => {
  const dir = initializedRepo('# Project rules\n\nSome existing content.\n');
  registerRepo(dir, noopOutput);
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');

  assert.match(agents, new RegExp(`<!-- CHANGELEDGER BOOTSTRAP BEGIN v${BOOTSTRAP_VERSION} -->`));
  assert.match(agents, /<!-- CHANGELEDGER BOOTSTRAP END -->/);
  assert.ok(agents.includes(REFERENCE.trim()));
  assert.ok(agents.startsWith('# Project rules\n\nSome existing content.\n'));
});

test('CR2: register is idempotent and preserves surrounding content byte-for-byte', () => {
  const content = '# Standards\n\nline one.\nline two.\n\n## Notes\n\nmore project prose.\n';
  const dir = initializedRepo(content);
  registerRepo(dir, noopOutput);
  const firstRun = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');

  registerRepo(dir, noopOutput);
  const secondRun = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');

  assert.equal(secondRun, firstRun);
  assert.ok(firstRun.startsWith(content));
  assert.equal(firstRun.match(/CHANGELEDGER BOOTSTRAP BEGIN/g).length, 1);
  assert.equal(firstRun.match(/CHANGELEDGER BOOTSTRAP END/g).length, 1);
});

test('CR3: register migrates the legacy marker and its blockquote without duplicating it', () => {
  const before = '# Project\n\nprose before.\n';
  const legacyBlock =
    '<!-- changeledger -->\n> Read `.changeledger/AGENTS.md`.\n> More legacy prose.\n';
  const after = '\nprose after.\n';
  const dir = initializedRepo(`${before}${legacyBlock}${after}`);

  registerRepo(dir, noopOutput);
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');

  assert.doesNotMatch(agents, /<!-- changeledger -->/);
  assert.equal(agents.match(/CHANGELEDGER BOOTSTRAP BEGIN/g).length, 1);
  assert.equal(agents.match(/CHANGELEDGER BOOTSTRAP END/g).length, 1);
  assert.ok(agents.startsWith(before));
  assert.ok(agents.trimEnd().endsWith('prose after.'));
});

test('CR4: register updates an outdated bootstrap version and reports it', () => {
  const before = '# Project\n\nprose.\n';
  const staleBlock = `<!-- CHANGELEDGER BOOTSTRAP BEGIN v0 -->\n${REFERENCE}<!-- CHANGELEDGER BOOTSTRAP END -->\n`;
  const dir = initializedRepo(`${before}\n${staleBlock}`);

  const warnings = [];
  registerRepo(dir, { warn: (msg) => warnings.push(msg), log: () => {} });
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');

  assert.match(agents, new RegExp(`<!-- CHANGELEDGER BOOTSTRAP BEGIN v${BOOTSTRAP_VERSION} -->`));
  assert.ok(agents.includes(REFERENCE.trim()));
  assert.doesNotMatch(agents, /CHANGELEDGER BOOTSTRAP BEGIN v0/);
  assert.ok(warnings.some((msg) => /outdated/i.test(msg)));
});

test('212659 CR8: register migrates v2 optional-bootstrap predecessor and preserves outside text', () => {
  const before = '# Project\n\nprose before.\n\n';
  const after = '\nprose after.\n';
  const previousReference = `> [!IMPORTANT]
> This repo uses **ChangeLedger**. Immediately after reading this file — before
> planning, investigating, or acting — a normal agent must run \`changeledger context\` directly.
> Only a delegated leaf whose prompt was emitted by \`changeledger agent-prompt <role>\`
> runs \`changeledger agent-context <role> [change-id]\` instead; the role in the
> prompt and command must match. No other agent may skip the core context.
> On the first invocation, retain complete stdout through the \`CHANGELEDGER CONTEXT END\` line,
> or the \`CHANGELEDGER AGENT CONTEXT END\` line for that delegated path:
> no pipes, filters, summaries, previews or voluntary output limits. If the tool
> exposes an output budget, reserve enough for the whole response. A missing END
> after that is exceptional recovery: stop and re-run with a larger capture. If
> the command is unavailable, stop and restore/install ChangeLedger; do not
> proceed from memory.
>
> Do not create or modify files without an authorized change; the core context
> defines the workflow, the task contexts, and the narrow operational exception.
> After a compaction, verify a retained capture with \`changeledger context
> [mode] --have <rev>\` (the BEGIN line's \`rev:\`) instead of recapturing in
> full; a mismatch still returns the complete output.
`;
  const stale = `<!-- CHANGELEDGER BOOTSTRAP BEGIN v2 -->\n${previousReference}<!-- CHANGELEDGER BOOTSTRAP END -->\n`;
  const dir = initializedRepo(`${before}${stale}${after}`);

  const warnings = [];
  registerRepo(dir, { warn: (msg) => warnings.push(msg), log: () => {} });
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');

  assert.ok(agents.startsWith(before));
  assert.ok(agents.endsWith(after));
  assert.match(agents, new RegExp(`CHANGELEDGER BOOTSTRAP BEGIN v${BOOTSTRAP_VERSION}`));
  assert.ok(agents.includes(REFERENCE.trim()));
  assert.doesNotMatch(agents, /CHANGELEDGER BOOTSTRAP BEGIN v2/);
  assert.ok(warnings.some((msg) => /outdated/i.test(msg)));
});

test('150300 CR2: register preserves equivalent reflow in every contract file', () => {
  const dir = initializedRepo();
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Claude rules\n');
  registerRepo(dir, noopOutput);

  const files = ['AGENTS.md', 'CLAUDE.md'];
  const reformatted = new Map();
  for (const name of files) {
    const file = path.join(dir, name);
    const canonical = fs.readFileSync(file, 'utf8');
    const next = reflowBootstrap(canonical);
    assert.notEqual(next, canonical);
    fs.writeFileSync(file, next);
    reformatted.set(name, next);
  }

  const warnings = [];
  const result = registerRepo(dir, { warn: (msg) => warnings.push(msg), log: () => {} });

  assert.equal(result.path, dir);
  assert.equal(result.id, 'abc1234567');
  assert.equal(
    warnings.some((msg) => /bootstrap was outdated/i.test(msg)),
    false,
  );
  for (const name of files) {
    assert.equal(fs.readFileSync(path.join(dir, name), 'utf8'), reformatted.get(name));
  }
});

test('153633 CR2: register preserves the Prettier fixture in every contract file', () => {
  const dir = initializedRepo();
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Claude rules\n');
  registerRepo(dir, noopOutput);

  const files = ['AGENTS.md', 'CLAUDE.md'];
  const reformatted = new Map();
  for (const name of files) {
    const file = path.join(dir, name);
    const next = prettierBootstrap(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, next);
    reformatted.set(name, next);
  }

  const warnings = [];
  const result = registerRepo(dir, { warn: (msg) => warnings.push(msg), log: () => {} });

  assert.equal(result.path, dir);
  assert.equal(
    warnings.some((msg) => /bootstrap was outdated/i.test(msg)),
    false,
  );
  for (const name of files) {
    assert.equal(fs.readFileSync(path.join(dir, name), 'utf8'), reformatted.get(name));
  }
});

test('150300 CR3: register repairs semantic changes and preserves surrounding bytes', () => {
  const before = '# Project\n\nprose before.\n';
  const after = '\nprose after.\n';
  const dir = initializedRepo(before);
  registerRepo(dir, noopOutput);
  const file = path.join(dir, 'AGENTS.md');
  const canonical = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(
    file,
    `${canonical.replace('run `changeledger context` directly', 'run `changeledger check` directly').trimEnd()}${after}`,
  );

  registerRepo(dir, noopOutput);

  const repaired = fs.readFileSync(file, 'utf8');
  assert.ok(repaired.startsWith(before));
  assert.ok(repaired.endsWith(after));
  assert.ok(repaired.includes(REFERENCE.trim()));
  assert.doesNotMatch(repaired, /run `changeledger check` directly/);
});
