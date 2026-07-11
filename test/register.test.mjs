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
  const staleBlock = `<!-- CHANGELEDGER BOOTSTRAP BEGIN v0 -->\n> stale content\n<!-- CHANGELEDGER BOOTSTRAP END -->\n`;
  const dir = initializedRepo(`${before}\n${staleBlock}`);

  const warnings = [];
  registerRepo(dir, { warn: (msg) => warnings.push(msg), log: () => {} });
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');

  assert.match(agents, new RegExp(`<!-- CHANGELEDGER BOOTSTRAP BEGIN v${BOOTSTRAP_VERSION} -->`));
  assert.ok(agents.includes(REFERENCE.trim()));
  assert.doesNotMatch(agents, /stale content/);
  assert.ok(warnings.some((msg) => /outdated/i.test(msg)));
});
