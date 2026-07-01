import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { parseChange } from '../src/change.mjs';
import { check } from '../src/commands/check.mjs';
import { init } from '../src/commands/init.mjs';
import { idFromTimestamp, newChange } from '../src/commands/new.mjs';
import { registerRepo } from '../src/commands/register.mjs';
import { findChangeledgerDir, loadConfig } from '../src/config.mjs';
import { checkContract } from '../src/contract.mjs';
import { contractTemplatesDir } from '../src/paths.mjs';

const execFileAsync = promisify(execFile);

// Isolate the global registry so init() doesn't touch the real home.
process.env.CHANGELEDGER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));

// A bare temp dir (no root AGENTS.md) — for the negative discovery case.
function bare() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-cli-'));
}

// A temp repo with the project's own root AGENTS.md already present, which init
// now requires.
function tmp() {
  const root = bare();
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Project rules\nOwn project contract.\n');
  return root;
}

function contractText() {
  return fs
    .readdirSync(contractTemplatesDir)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => fs.readFileSync(path.join(contractTemplatesDir, name), 'utf8'))
    .join('\n');
}

test('init creates .changeledger/ with config and no per-machine contract artifact', () => {
  const root = tmp();
  init(root);
  assert.ok(fs.existsSync(path.join(root, '.changeledger', 'config.yml')));
  assert.ok(fs.existsSync(path.join(root, '.changeledger', 'changes')));
  assert.equal(fs.existsSync(path.join(root, '.changeledger', 'AGENTS.md')), false);
});

test('init preserves the root AGENTS.md and appends a reference (CR1)', () => {
  const root = tmp();
  init(root);
  const text = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(text, /Own project contract\./);
  assert.match(text, /changeledger context/);
});

test('init refuses without a root AGENTS.md and leaves no .changeledger/ (CR2)', () => {
  const root = bare();
  assert.throws(() => init(root), /Create AGENTS\.md/);
  assert.equal(fs.existsSync(path.join(root, '.changeledger')), false);
});

test('init does not create a gitignore entry for a contract artifact', () => {
  const root = tmp();
  init(root);
  assert.equal(fs.existsSync(path.join(root, '.gitignore')), false);
});

test('init seeds tdd:true in the config (implementation-readiness CR1)', () => {
  const root = tmp();
  init(root);
  const cfg = fs.readFileSync(path.join(root, '.changeledger', 'config.yml'), 'utf8');
  assert.match(cfg, /^tdd: true$/m);
});

test('235628 CR3/CR8: init seeds portable release impacts and contract boundary', () => {
  const root = tmp();
  init(root);
  const cfg = fs.readFileSync(path.join(root, '.changeledger', 'config.yml'), 'utf8');
  const contract = contractText();
  assert.match(cfg, /^release:$/m);
  assert.match(cfg, /^ {4}feature: minor$/m);
  assert.match(cfg, /^ {4}bug: patch$/m);
  assert.match(contract, /changeledger release plan \[--json\]/);
  assert.match(contract, /Never infer that every ChangeLedger repository uses npm or GitHub/);
  assert.doesNotMatch(contract, /Spec\s+Ledger/i);
});

test('020229 CR4: installed contract documents configurable readiness patterns', () => {
  const contract = contractText();
  assert.match(contract, /readiness\.target_patterns/);
  assert.match(contract, /readiness\.verification_patterns/);
  assert.match(contract, /target file\(s\)\/area\(s\)/);
});

test('122611 CR3: installed contract recommends structural verify clauses', () => {
  const contract = contractText();
  assert.match(contract, /verification_patterns: \["verify:"\]/);
  assert.match(contract, /manual Android device check/);
  assert.match(contract, /instead of listing every possible manual phrase/);
});

test('221849: installed CLI reference names actors and dedicated terminal actions', () => {
  const contract = contractText();
  assert.match(
    contract,
    /`changeledger status <id> <status>`[\s\S]*does not accept `done` or `discarded`/,
  );
  assert.match(contract, /`changeledger discard <id> "<reason>"`/);
  assert.match(contract, /the agent edits its body first, then runs/);
});

test('214902 CR1-CR4/CR7/CR8: installed contract gates creation, scope growth and friction', () => {
  const contract = contractText();
  assert.match(contract, /Running `changeledger context` is discovery, not compliance/);
  assert.match(contract, /Read the complete output\s+through the `CHANGELEDGER CONTEXT END` line/);
  assert.match(contract, /follow the current mode/);
  assert.match(contract, /stop and re-run the\s+command directly, without pipes or filters/);
  assert.match(contract, /enough clarity\s+to document faithfully \*\*and\*\* the human/);
  assert.match(contract, /direct request such\s+as “create the change” is authorization/);
  assert.match(contract, /human authorizes scope, approves drafts and accepts the final result/);
  assert.match(contract, /If no approved or in-progress change applies/);
  assert.match(contract, /ask the human whether a purely operational,\s+reversible edit/);
  assert.match(contract, /If unsure, document it in ChangeLedger/);
  assert.match(
    contract,
    /materially expands observable scope, obtain explicit human\s+authorization/,
  );
  assert.match(contract, /Triage friction at handoff; retrospect after completion/);
  assert.match(contract, /necessary to fulfill the purpose of an active change/);
  assert.match(contract, /operational step such as verify, commit, graduate/);
  assert.match(contract, /propose its type, title, and reason to\s+the human/);
  assert.match(contract, /Create the draft only after explicit authorization/);
  assert.match(contract, /too vague for backlog/);
  assert.match(contract, /When a change reaches `done`, also share a brief retrospective/);
});

test('214902 CR5/CR6: installed contract preserves traceability without false-fix commits', () => {
  const contract = contractText();
  assert.match(contract, /Never implement approved changes on `main`, `master`, or `dev`/);
  assert.match(contract, /Inspect the\s+worktree/);
  assert.match(contract, /unrelated changes exist/);
  assert.match(
    contract,
    /Commit the approved change documentation before touching implementation code/,
  );
  assert.match(contract, /Implement one change at a time/);
  assert.match(contract, /Commit a completed unit before continuing/);
  assert.match(
    contract,
    /After review `fail --retry`, keep the\s+candidate correction uncommitted/,
  );
  assert.match(
    contract,
    /After `pass`, commit the confirmed correction[\s\S]*before asking for\s+human validation/,
  );
  assert.match(contract, /keep the correction\s+uncommitted until the human confirms/);
  assert.match(contract, /do not start another task or change\s+while a correction waits/i);
  assert.match(contract, /If shared files make a combined commit\s+unavoidable/);
});

test('171002 CR1-CR5: installed contract gives done one human-accepted meaning', () => {
  const contract = contractText();
  assert.match(contract, /in-progress → in-review → in-validation → done/);
  assert.match(contract, /in-progress → in-validation → done/);
  assert.match(contract, /human accepted the complete result/);
  assert.match(contract, /agent never accepts on the human's behalf/i);
  assert.match(contract, /`done` and `discarded`\s+never reopen/);
});

test('212322 CR1/CR5: CLI dry-runs archive --graduated without writing files', async () => {
  const root = tmp();
  init(root);
  const file = path.join(root, '.changeledger', 'changes', '20260613-120001-done.md');
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
  const bin = path.resolve('bin/changeledger.mjs');
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
  const cfg = loadConfig(findChangeledgerDir(root));
  assert.deepEqual(cfg.statuses, [
    'draft',
    'approved',
    'in-progress',
    'in-review',
    'in-validation',
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

test('reference refresh is idempotent and does not add a legacy gitignore entry', () => {
  const root = tmp();
  init(root);
  registerRepo(root);
  registerRepo(root);
  const text = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.equal(text.match(/<!-- changeledger -->/g).length, 1);
  assert.equal(fs.existsSync(path.join(root, '.gitignore')), false);
});

test('reference covers CLAUDE.md when present, as a GitHub alert (CR1)', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# Claude rules\n');
  init(root);
  const claude = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
  assert.match(claude, /# Claude rules/);
  assert.match(claude, /<!-- changeledger -->/);
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
    fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8').match(/<!-- changeledger -->/g).length,
    1,
  );
});

test('register does not regenerate the retired contract link', () => {
  const root = tmp();
  init(root);
  registerRepo(root);
  assert.equal(fs.existsSync(path.join(root, '.changeledger', 'AGENTS.md')), false);
});

test('checkContract flags a missing reference without requiring a link', () => {
  const root = tmp();
  init(root);
  const changeledgerDir = path.join(root, '.changeledger');
  // Healthy repo: no discovery errors.
  assert.deepEqual(checkContract(root, changeledgerDir), []);

  // Strip the reference; no per-machine link is part of discovery anymore.
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# only project rules\n');
  const errors = checkContract(root, changeledgerDir);
  assert.equal(errors.length, 1);
  assert.ok(errors.some((e) => /no ChangeLedger reference/.test(e)));
});

test('checkContract flags a CLAUDE.md without the reference (CR6)', () => {
  const root = tmp();
  init(root);
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# Claude rules, no reference\n');
  const errors = checkContract(root, path.join(root, '.changeledger'));
  assert.ok(errors.some((e) => /^CLAUDE\.md has no ChangeLedger reference/.test(e)));
});

test('check surfaces discovery errors repo-wide (CR6)', () => {
  const root = tmp();
  init(root);
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# missing bootstrap\n');
  assert.equal(check([], root, silentOutput()), 1);
});

test('init refuses to overwrite an existing .changeledger/', () => {
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
    fs.readdirSync(path.join(root, '.changeledger', 'changes')).filter((n) => n.endsWith('.md')),
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
  const changesDir = path.join(root, '.changeledger', 'changes');
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
  const changesDir = path.join(root, '.changeledger', 'changes');
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

test('190006 CR1: acquireIdLock returns null after max stale-lock retries', () => {
  const root = tmp();
  init(root);
  const changesDir = path.join(root, '.changeledger', 'changes');
  const lock = path.join(changesDir, '.20260613-150000.lock');
  fs.mkdirSync(changesDir, { recursive: true });
  fs.writeFileSync(lock, 'not-json');
  const stale = new Date(Date.now() - 60_000);
  fs.utimesSync(lock, stale, stale);

  // Prevent lock removal so the loop retries until the cap triggers
  const origRmSync = fs.rmSync;
  fs.rmSync = (target, ...args) => {
    if (String(target).endsWith('.lock')) return;
    return origRmSync.call(fs, target, ...args);
  };
  try {
    const file = newChange(
      { type: 'chore', slug: 'one', title: 'one', now: '2026-06-13T15:00:00Z' },
      root,
    );
    // After hitting the cap, acquireIdLock returned null → outer loop bumped the second
    assert.equal(path.basename(file), '20260613-150001-one.md', 'id bumped after spin cap');
  } finally {
    fs.rmSync = origRmSync;
    origRmSync.call(fs, lock, { force: true });
  }
});

test('190006 CR4: processIsAlive returns true on EPERM — lock treated as live', () => {
  const root = tmp();
  init(root);
  const changesDir = path.join(root, '.changeledger', 'changes');
  const lock = path.join(changesDir, '.20260613-150000.lock');
  fs.mkdirSync(changesDir, { recursive: true });
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));

  // Mock process.kill(pid, 0) to throw EPERM — simulates a live process we can't signal
  const origKill = process.kill.bind(process);
  process.kill = (pid, sig) => {
    if (sig === 0) {
      const e = new Error('EPERM');
      e.code = 'EPERM';
      throw e;
    }
    return origKill(pid, sig);
  };
  try {
    const file = newChange(
      { type: 'chore', slug: 'one', title: 'one', now: '2026-06-13T15:00:00Z' },
      root,
    );
    // isStaleLock returned false (EPERM → alive) → acquireIdLock returned null → second bumped
    assert.equal(path.basename(file), '20260613-150001-one.md', 'id bumped because lock was live');
  } finally {
    process.kill = origKill;
    fs.rmSync(lock, { force: true });
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
    import { newChange } from ${JSON.stringify(pathToFileURL(path.resolve('src/commands/new.mjs')).href)};
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
    .readdirSync(path.join(root, '.changeledger', 'changes'))
    .filter((n) => n.endsWith('.md'))
    .map((n) =>
      parseChange(fs.readFileSync(path.join(root, '.changeledger', 'changes', n), 'utf8')),
    );
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
