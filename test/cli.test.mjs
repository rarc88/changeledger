import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parseChange } from '../src/change.mjs';
import { check } from '../src/commands/check.mjs';
import { init } from '../src/commands/init.mjs';
import { idFromTimestamp, newChange } from '../src/commands/new.mjs';
import { registerRepo } from '../src/commands/register.mjs';
import { findSpecDir, loadConfig } from '../src/config.mjs';
import { checkContract } from '../src/contract.mjs';
import { agentsTemplate } from '../src/paths.mjs';

// Isolate the global registry so init() doesn't touch the real home.
process.env.SPEC_LEDGER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-home-'));

// A bare temp dir (no root AGENTS.md) — for the negative discovery case.
function bare() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sl-cli-'));
}

// A temp repo with the project's own root AGENTS.md already present, which init
// now requires.
function tmp() {
  const root = bare();
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Project rules\nOwn project contract.\n');
  return root;
}

test('init creates .sl/ with config and links the contract', () => {
  const root = tmp();
  init(root);
  assert.ok(fs.existsSync(path.join(root, '.sl', 'config.yml')));
  assert.ok(fs.existsSync(path.join(root, '.sl', 'changes')));
  // .sl/AGENTS.md is a symlink to the installed contract, not a copy (CR1).
  const link = path.join(root, '.sl', 'AGENTS.md');
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
  assert.equal(fs.readlinkSync(link), agentsTemplate);
});

test('init preserves the root AGENTS.md and appends a reference (CR1)', () => {
  const root = tmp();
  init(root);
  const text = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(text, /Own project contract\./);
  assert.match(text, /\.sl\/AGENTS\.md/);
});

test('init refuses without a root AGENTS.md and leaves no .sl/ (CR2)', () => {
  const root = bare();
  assert.throws(() => init(root), /Create AGENTS\.md/);
  assert.equal(fs.existsSync(path.join(root, '.sl')), false);
});

test('init gitignores the per-machine contract link (CR4)', () => {
  const root = tmp();
  init(root);
  const gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.ok(gi.split('\n').some((l) => l.trim() === '.sl/AGENTS.md'));
});

test('init seeds tdd:true in the config (implementation-readiness CR1)', () => {
  const root = tmp();
  init(root);
  const cfg = fs.readFileSync(path.join(root, '.sl', 'config.yml'), 'utf8');
  assert.match(cfg, /^tdd: true$/m);
});

test('CR1: init seeds in-review and review_required per type (review-gate)', () => {
  const root = tmp();
  init(root);
  const cfg = loadConfig(findSpecDir(root));
  assert.deepEqual(cfg.statuses, [
    'draft',
    'approved',
    'in-progress',
    'in-review',
    'blocked',
    'done',
    'discarded',
  ]);
  assert.equal(cfg.types.feature.review_required, true);
  assert.equal(cfg.types.bug.review_required, true);
  assert.equal(cfg.types.refactor.review_required, true);
  assert.equal('review_required' in cfg.types.chore, false);
  assert.equal('review_required' in cfg.types.audit, false);
});

test('reference and gitignore entries are idempotent (CR3)', () => {
  const root = tmp();
  init(root);
  registerRepo(root);
  registerRepo(root);
  const text = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.equal(text.match(/<!-- spec-ledger -->/g).length, 1);
  const gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.equal(gi.split('\n').filter((l) => l.trim() === '.sl/AGENTS.md').length, 1);
});

test('reference covers CLAUDE.md when present, as a GitHub alert (CR1)', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# Claude rules\n');
  init(root);
  const claude = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
  assert.match(claude, /# Claude rules/);
  assert.match(claude, /<!-- spec-ledger -->/);
  assert.match(claude, /> \[!IMPORTANT\]/);
});

test('reference skips a symlinked contract file', () => {
  const root = tmp();
  // CLAUDE.md symlinked to AGENTS.md must not be written into.
  fs.symlinkSync(path.join(root, 'AGENTS.md'), path.join(root, 'CLAUDE.md'));
  init(root);
  assert.equal(fs.lstatSync(path.join(root, 'CLAUDE.md')).isSymbolicLink(), true);
  // Only one reference total (in the AGENTS.md target), not doubled via the link.
  assert.equal(
    fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8').match(/<!-- spec-ledger -->/g).length,
    1,
  );
});

test('register regenerates a missing contract link (CR5)', () => {
  const root = tmp();
  init(root);
  const link = path.join(root, '.sl', 'AGENTS.md');
  fs.unlinkSync(link);
  assert.equal(fs.existsSync(link), false);
  registerRepo(root);
  assert.equal(fs.readlinkSync(link), agentsTemplate);
});

test('checkContract flags missing reference and dangling link (CR6)', () => {
  const root = tmp();
  init(root);
  const specDir = path.join(root, '.sl');
  // Healthy repo: no discovery errors.
  assert.deepEqual(checkContract(root, specDir), []);

  // Strip the reference and break the link.
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# only project rules\n');
  fs.unlinkSync(path.join(specDir, 'AGENTS.md'));
  const errors = checkContract(root, specDir);
  assert.equal(errors.length, 2);
  assert.ok(errors.some((e) => /no Spec Ledger reference/.test(e)));
  assert.ok(errors.some((e) => /missing or dangling/.test(e)));
});

test('checkContract flags a CLAUDE.md without the reference (CR6)', () => {
  const root = tmp();
  init(root);
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# Claude rules, no reference\n');
  const errors = checkContract(root, path.join(root, '.sl'));
  assert.ok(errors.some((e) => /^CLAUDE\.md has no Spec Ledger reference/.test(e)));
});

test('check surfaces discovery errors repo-wide (CR6)', () => {
  const root = tmp();
  init(root);
  fs.unlinkSync(path.join(root, '.sl', 'AGENTS.md'));
  // check() prints findings (console.error) and a summary (console.log);
  // silence both so this deliberate failure doesn't look like a real error in
  // the test/verify output.
  const origErr = console.error;
  const origLog = console.log;
  console.error = () => {};
  console.log = () => {};
  try {
    assert.equal(check([], root), 1);
  } finally {
    console.error = origErr;
    console.log = origLog;
  }
});

test('init refuses to overwrite an existing .sl/', () => {
  const root = tmp();
  init(root);
  assert.throws(() => init(root), /already exists/);
});

test('idFromTimestamp derives YYYYMMDD-HHMMSS from an ISO UTC instant', () => {
  assert.equal(idFromTimestamp('2026-06-13T15:04:02Z'), '20260613-150402');
});

test('new uses the English slug for the file and keeps the title as content', () => {
  const root = tmp();
  init(root);
  const file = newChange(
    { type: 'bug', slug: 'token-expiry', title: 'Token expira mal', now: '2026-06-13T15:00:00Z' },
    root,
  );
  assert.equal(path.basename(file), '20260613-150000-token-expiry.md');

  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.id, '20260613-150000');
  assert.equal(c.frontmatter.title, 'Token expira mal');
  assert.equal(c.frontmatter.type, 'bug');
  assert.equal(c.frontmatter.status, 'draft');
  assert.equal(c.frontmatter.created, '2026-06-13T15:00:00Z');
  assert.deepEqual(
    c.stages.map((s) => s.key),
    ['request', 'investigation', 'specification', 'plan', 'log'],
  );
});

test('new normalizes the slug to kebab ascii', () => {
  const root = tmp();
  init(root);
  const file = newChange(
    { type: 'chore', slug: 'Fix CI Pipeline', title: 'x', now: '2026-06-13T15:00:00Z' },
    root,
  );
  assert.equal(path.basename(file), '20260613-150000-fix-ci-pipeline.md');
});

test('new bumps the id to stay unique within the same second', () => {
  const root = tmp();
  init(root);
  const now = '2026-06-13T15:00:00Z';
  const a = newChange({ type: 'chore', slug: 'one', title: 'one', now }, root);
  const b = newChange({ type: 'chore', slug: 'two', title: 'two', now }, root);
  assert.equal(path.basename(a), '20260613-150000-one.md');
  assert.equal(path.basename(b), '20260613-150001-two.md');

  const c = parseChange(fs.readFileSync(b, 'utf8'));
  assert.equal(c.frontmatter.id, '20260613-150001');
  assert.equal(c.frontmatter.created, '2026-06-13T15:00:01Z');
});

test('new rejects an unknown type', () => {
  const root = tmp();
  init(root);
  assert.throws(() => newChange({ type: 'nope', title: 't', now: 'x' }, root), /Unknown type/);
});
