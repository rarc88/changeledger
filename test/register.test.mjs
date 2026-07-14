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
    '> This repo uses **ChangeLedger**. Immediately after reading this file — before\n> planning, investigating, or acting — a normal agent must run `changeledger context` directly.',
    '>This repo uses **ChangeLedger**. Immediately after reading this file —\n> before planning, investigating, or acting — a normal agent must run\n>`changeledger context` directly.',
  );
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
