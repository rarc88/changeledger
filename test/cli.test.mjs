import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { parseChange } from '../src/change.mjs';
import { check } from '../src/commands/check.mjs';
import { init } from '../src/commands/init.mjs';
import { idFromTimestamp, newChange } from '../src/commands/new.mjs';
import { registerRepo } from '../src/commands/register.mjs';
import { findSpecDir, loadConfig } from '../src/config.mjs';
import { checkContract } from '../src/contract.mjs';
import { agentsTemplate } from '../src/paths.mjs';

const execFileAsync = promisify(execFile);

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

test('020229 CR4: installed contract documents configurable readiness patterns', () => {
  const contract = fs.readFileSync(agentsTemplate, 'utf8');
  assert.match(contract, /readiness\.target_patterns/);
  assert.match(contract, /readiness\.verification_patterns/);
  assert.match(contract, /target file\(s\)\/area\(s\)/);
});

test('212840 CR1/CR2/CR3/CR4: installed contract captures friction as future work', () => {
  const contract = fs.readFileSync(agentsTemplate, 'utf8');
  assert.match(contract, /Capture friction as future work/);
  assert.match(contract, /separate `draft` change/);
  assert.match(contract, /current change/);
  assert.match(contract, /`## Log`/);
  assert.match(contract, /not actionable enough for\s+backlog/);
  assert.match(contract, /must not mix concerns/);
});

test('161309 CR1-CR5: installed contract requires branch-safe atomic commits', () => {
  const contract = fs.readFileSync(agentsTemplate, 'utf8');
  assert.match(contract, /Never implement approved changes on\s+`main`, `master`, or `dev`/);
  assert.match(contract, /inspect the worktree/);
  assert.match(contract, /unrelated\s+changes exist/);
  assert.match(
    contract,
    /commit the approved change\s+documentation before touching implementation code/,
  );
  assert.match(contract, /Implement one change at a\s+time/);
  assert.match(contract, /commit\s+that change and its related truth before starting another/);
  assert.match(contract, /If shared files\s+make a combined commit unavoidable/);
});

test('212322 CR1/CR5: CLI dry-runs archive --graduated without writing files', async () => {
  const root = tmp();
  init(root);
  const file = path.join(root, '.sl', 'changes', '20260613-120001-done.md');
  fs.writeFileSync(
    file,
    `---
id: "20260613-120001"
title: Done
type: feature
status: done
created: 2026-06-13T12:00:00Z
reviewed: true
depends_on: []
---

## Request

R

## Investigation

I

## Proposal

P

## Specification

### CR1 — C
- **Given** x
- **When** y
- **Then** z

## Plan

- [x] do it (CR1) — 2026-06-13T12:00:00Z

## Log

- **2026-06-13T12:00:00Z** — graduado a spec \`arch.md\`
`,
  );
  const before = fs.readFileSync(file, 'utf8');
  const bin = path.resolve('bin/sl.mjs');
  const { stdout } = await execFileAsync(
    process.execPath,
    [bin, 'archive', '--graduated', '--dry-run'],
    {
      cwd: root,
    },
  );
  assert.match(stdout, /#20260613-120001 Done/);
  assert.match(stdout, /Would archive 1 change\(s\)/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
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
  assert.equal(check([], root, silentOutput()), 1);
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

test('new rejects a slug that normalizes to empty', () => {
  const root = tmp();
  init(root);
  assert.throws(
    () =>
      newChange({ type: 'bug', slug: '!!!', title: 'Título', now: '2026-06-13T15:00:00Z' }, root),
    /slug must contain at least one ASCII letter or number/,
  );
  assert.deepEqual(
    fs.readdirSync(path.join(root, '.sl', 'changes')).filter((n) => n.endsWith('.md')),
    [],
  );
});

test('new bumps the id to stay unique within the same second', () => {
  const root = tmp();
  init(root);
  const now = '2026-06-13T15:00:00Z';
  const a = newChange({ type: 'chore', slug: 'one', title: 'one', now }, root);
  const before = fs.readFileSync(a, 'utf8');
  const b = newChange({ type: 'chore', slug: 'two', title: 'two', now }, root);
  assert.equal(path.basename(a), '20260613-150000-one.md');
  assert.equal(path.basename(b), '20260613-150001-two.md');
  assert.equal(fs.readFileSync(a, 'utf8'), before, 'existing change file is not overwritten');

  const c = parseChange(fs.readFileSync(b, 'utf8'));
  assert.equal(c.frontmatter.id, '20260613-150001');
  assert.equal(c.frontmatter.created, '2026-06-13T15:00:01Z');
});

test('new recovers from an orphan id lock', () => {
  const root = tmp();
  init(root);
  const changesDir = path.join(root, '.sl', 'changes');
  const lock = path.join(changesDir, '.20260613-150000.lock');
  fs.writeFileSync(lock, 'not-json');
  const stale = new Date(Date.now() - 60_000);
  fs.utimesSync(lock, stale, stale);

  const file = newChange(
    { type: 'chore', slug: 'one', title: 'one', now: '2026-06-13T15:00:00Z' },
    root,
  );

  assert.equal(path.basename(file), '20260613-150000-one.md');
  assert.deepEqual(
    fs.readdirSync(changesDir).filter((n) => n.endsWith('.lock')),
    [],
    'normal creation leaves no lock artifacts',
  );
});

test('new tolerates a lock removed while checking whether it is stale', () => {
  const root = tmp();
  init(root);
  const changesDir = path.join(root, '.sl', 'changes');
  const lock = path.join(changesDir, '.20260613-150000.lock');
  fs.writeFileSync(lock, 'not-json');

  const originalStatSync = fs.statSync;
  fs.statSync = (target, ...args) => {
    if (target === lock) {
      const err = new Error('gone');
      err.code = 'ENOENT';
      throw err;
    }
    return originalStatSync.call(fs, target, ...args);
  };
  try {
    const file = newChange(
      { type: 'chore', slug: 'one', title: 'one', now: '2026-06-13T15:00:00Z' },
      root,
    );
    assert.equal(path.basename(file), '20260613-150000-one.md');
  } finally {
    fs.statSync = originalStatSync;
  }
});

test('new reserves ids atomically across concurrent processes', async () => {
  const root = tmp();
  init(root);
  const readyOne = path.join(root, 'ready-one');
  const readyTwo = path.join(root, 'ready-two');
  const go = path.join(root, 'go');
  const code = `
    import fs from 'node:fs';
    import { setTimeout as delay } from 'node:timers/promises';
    import { newChange } from ${JSON.stringify(path.resolve('src/commands/new.mjs'))};
    fs.writeFileSync(process.argv[3], 'ready');
    while (!fs.existsSync(process.argv[4])) {
      await delay(5);
    }
    const file = newChange(
      { type: 'chore', slug: process.argv[1], title: process.argv[1], now: '2026-06-13T15:00:00Z' },
      process.argv[2],
    );
    console.log(file);
  `;
  const child = (slug, readyPath) =>
    execFileAsync(process.execPath, ['--input-type=module', '-e', code, slug, root, readyPath, go]);

  const one = child('one', readyOne);
  const two = child('two', readyTwo);
  const deadline = Date.now() + 3000;
  while ((!fs.existsSync(readyOne) || !fs.existsSync(readyTwo)) && Date.now() < deadline) {
    await delay(5);
  }
  assert.ok(fs.existsSync(readyOne), 'first child reached the barrier');
  assert.ok(fs.existsSync(readyTwo), 'second child reached the barrier');
  fs.writeFileSync(go, 'go');

  const files = (await Promise.all([one, two])).map((r) => path.basename(r.stdout.trim()));
  assert.deepEqual(files.map((f) => f.replace(/^20260613-15000[01]-/, '')).sort(), [
    'one.md',
    'two.md',
  ]);

  const changes = fs
    .readdirSync(path.join(root, '.sl', 'changes'))
    .filter((n) => n.endsWith('.md'))
    .map((n) => parseChange(fs.readFileSync(path.join(root, '.sl', 'changes', n), 'utf8')));
  assert.deepEqual(changes.map((c) => c.frontmatter.id).sort(), [
    '20260613-150000',
    '20260613-150001',
  ]);
  assert.deepEqual(changes.map((c) => c.frontmatter.created).sort(), [
    '2026-06-13T15:00:00Z',
    '2026-06-13T15:00:01Z',
  ]);
  assert.deepEqual(
    changes.map((c) => idFromTimestamp(c.frontmatter.created)),
    changes.map((c) => c.frontmatter.id),
    'created and id remain the same instant for each change',
  );

  assert.equal(check([], root, silentOutput()), 0);
});

test('new rejects an unknown type', () => {
  const root = tmp();
  init(root);
  assert.throws(() => newChange({ type: 'nope', title: 't', now: 'x' }, root), /Unknown type/);
});

function silentOutput() {
  return { log() {}, error() {}, warn() {} };
}
