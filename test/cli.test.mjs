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
import { approve } from '../src/commands/agent.mjs';
import { check } from '../src/commands/check.mjs';
import { init } from '../src/commands/init.mjs';
import { idFromTimestamp, newChange } from '../src/commands/new.mjs';
import { registerRepo } from '../src/commands/register.mjs';
import { findChangeledgerDir, loadConfig } from '../src/config.mjs';
import { checkContract } from '../src/contract.mjs';
import { contractTemplatesDir, templatesDir } from '../src/paths.mjs';

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

test('141122 CR1: the template publishes readiness uncommented with an adapt-it comment', () => {
  const template = fs.readFileSync(path.join(templatesDir, 'config.yml'), 'utf8');
  assert.ok(
    template.includes(
      'readiness:\n  target_patterns: ["src/**"]\n  verification_patterns: ["test/**"]\n',
    ),
    `readiness must ship uncommented with the effective defaults, got:\n${template}`,
  );
  const comment = template
    .slice(0, template.indexOf('readiness:'))
    .split(/\n\s*\n/)
    .pop();
  assert.match(comment, /`approved`/);
  assert.match(comment, /Adapt them to this repo's own layout/);
  assert.match(comment, /lib\/\*\*/);
});

// A well-formed Ruby-flavoured bug: the Plan task names a `lib/` target and a
// `verify:` clause, neither of which matches the JavaScript-shaped defaults.
function rubyBug(id) {
  return `---
id: "${id}"
title: Parser drops trailing commas
type: bug
status: draft
created: 2026-07-26T14:11:22Z
depends_on: []
related_to: []
---

## Request

The parser drops trailing commas.

## Investigation

\`lib/parser.rb\` truncates the token stream.

## Specification

### CR1 — Trailing commas survive parsing
- **Given** the source \`[1, 2,]\`
- **When** the parser runs
- **Then** it yields \`[1, 2]\` without raising

## Plan

- [ ] Update \`lib/parser.rb\`; verify: \`bundle exec rspec spec/parser_spec.rb\` (CR1)

## Log

- **2026-07-26T14:11:22Z** \`[note]\` Draft.
`;
}

test('141122 CR2: a fresh non-JS repo approves once readiness matches its stack', () => {
  const root = tmp();
  init(root);
  const configFile = path.join(root, '.changeledger', 'config.yml');
  const seeded = fs.readFileSync(configFile, 'utf8');
  // The agent tunes the published keys to its own stack, as `readiness.md` requires.
  const tuned = seeded
    .replace('  target_patterns: ["src/**"]', '  target_patterns: ["lib/**"]')
    .replace('  verification_patterns: ["test/**"]', '  verification_patterns: ["verify:"]');
  assert.notEqual(tuned, seeded, 'the seeded config must expose readiness as a real key');
  fs.writeFileSync(configFile, tuned);

  const file = newChange(
    { type: 'bug', slug: 'parser', title: 'Parser', now: '2026-07-26T14:11:22Z' },
    root,
    { ownerHandle: () => '' },
  );
  const id = parseChange(fs.readFileSync(file, 'utf8')).frontmatter.id;
  fs.writeFileSync(file, rubyBug(id));

  assert.doesNotThrow(() => approve(id, root));

  const logged = [];
  const code = check([id, '--json'], root, { ...silentOutput(), log: (m) => logged.push(m) });
  const report = JSON.parse(logged.join('\n'));
  assert.deepEqual(report.errors, [], 'an approved non-JS change must report no errors');
  assert.equal(code, 0);
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
    /`changeledger status <id> <status>`[\s\S]*does not accept\s+`approved`, `done`, `discarded` or reopening/,
  );
  assert.match(contract, /`changeledger discard <id> "<reason>"`/);
  assert.match(contract, /For an existing spec, edit its body first, then run/);
});

test('214902 CR1-CR4/CR7/CR8: installed contract gates creation, scope growth and friction', () => {
  const contract = contractText();
  // 20260726-124835: the installed contract no longer carries core's first-capture
  // recipe — the bootstrap owns making and verifying that capture — so the
  // creation gate is asserted through the rewritten routing rules instead. Its
  // amendment restores the two pins this test had deleted rather than repointed:
  // the documentation precondition and what counts as authorization.
  assert.match(contract, /Classifying the human's intent is free and mandatory on every message/);
  assert.match(contract, /enough clarity to document faithfully/);
  assert.match(contract, /direct request such as “create the\s+change” is authorization/);
  assert.match(contract, /never invent missing requirements/);
  assert.match(contract, /never load one speculatively and never reload one\s+already held/);
  assert.match(contract, /Escalate to a mode before acting/);
  assert.match(contract, /No artifact without explicit human authorization/);
  assert.match(contract, /only once the human authorizes documenting it/);
  assert.match(contract, /ask the human: `quick` type or operational edit/);
  assert.match(contract, /The human decides and the agent\s+executes/);
  assert.match(contract, /If no approved or in-progress change applies/);
  assert.match(contract, /ask the human whether a purely operational,\s+reversible edit/);
  assert.match(contract, /If unsure, document\s+it in ChangeLedger/);
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
    /\*\*Baseline\*\*: exactly one, the approved change\s+document, before any code/,
  );
  assert.match(contract, /Implement one\s+change at a\s+time/);
  assert.match(contract, /\*\*Task\*\*: one per completed Plan task/);
  assert.match(
    contract,
    /After review `fail --retry`, keep the\s+candidate correction uncommitted/,
  );
  assert.match(
    contract,
    /After `pass`, commit the confirmed correction[\s\S]*before human validation/,
  );
  assert.match(contract, /keep the correction\s+uncommitted until the human confirms/);
  assert.match(contract, /do not start another task or change\s+while a correction waits/i);
  assert.match(
    contract,
    /several changes share the same files, or\s+several Plan tasks are inseparable/,
  );
  assert.match(contract, /four commit classes and no others/);
  assert.match(contract, /is never a commit of its own; it travels inside the next real class/);
  assert.match(contract, /never defer them and reconstruct mixed diffs at the end/);
  assert.match(contract, /\*\*Handoff\*\*: zero or one, only when work stops/);
  assert.match(contract, /one final closure commit[\s\S]*graduation/i);
});

test('171002 CR1-CR5: installed contract gives done one human-accepted meaning', () => {
  const contract = contractText();
  assert.match(contract, /in-progress → in-review.*`changeledger status`/);
  assert.match(contract, /in-review → in-validation.*`changeledger review <id> pass`/);
  assert.match(contract, /in-progress → in-validation \(no review\).*`changeledger status`/);
  assert.match(contract, /in-validation → done.*human.*viewer/);
  assert.match(contract, /human accepted the complete result/);
  // 20260726-124835: core stopped restating this; validation.md is the only owner
  // left, and it wraps the sentence across a line.
  assert.match(contract, /agent\s+never accepts on the human's behalf/i);
  assert.match(contract, /`discarded` never reopens/);
  assert.match(contract, /A `done`\s+change can reopen only to finish its original scope/);
});

test('131649 CR2/CR9: list previews archive --graduated without writing files', async () => {
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

- [x] do it (CR1)
  - **Resolved:** \`2026-06-13T12:00:00Z\`

## Log

- **2026-06-13T12:00:00Z** \`[graduation]\` spec: \`arch.md\`
`,
  );
  const before = fs.readFileSync(file, 'utf8');
  const bin = path.resolve('bin/changeledger.mjs');
  const { stdout } = await execFileAsync(process.execPath, [bin, 'list', '--pending', 'archive'], {
    cwd: root,
  });
  assert.match(stdout, /#20260613-120001\s+Done/);
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
  assert.equal(text.match(/CHANGELEDGER BOOTSTRAP BEGIN/g).length, 1);
  assert.equal(text.match(/CHANGELEDGER BOOTSTRAP END/g).length, 1);
  assert.equal(fs.existsSync(path.join(root, '.gitignore')), false);
});

test('reference covers CLAUDE.md when present, as a GitHub alert (CR1)', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# Claude rules\n');
  init(root);
  const claude = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
  assert.match(claude, /# Claude rules/);
  assert.match(claude, /CHANGELEDGER BOOTSTRAP BEGIN/);
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
    fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8').match(/CHANGELEDGER BOOTSTRAP BEGIN/g)
      .length,
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
    { ownerHandle: () => '' },
  );
  assert.equal(path.basename(file), '20260613-150000-token-expiry.md');

  const source = fs.readFileSync(file, 'utf8');
  const c = parseChange(source);
  assert.equal(c.frontmatter.id, '20260613-150000');
  assert.equal(c.frontmatter.title, 'Token expira mal');
  assert.equal(c.frontmatter.type, 'bug');
  assert.equal(c.frontmatter.status, 'draft');
  assert.equal(c.frontmatter.created, '2026-06-13T15:00:00Z');
  assert.deepEqual(c.frontmatter.related_to, []);
  assert.match(source, /depends_on: \[\]\nrelated_to: \[\]/);
  assert.deepEqual(
    c.stages.map((s) => s.key),
    ['request', 'investigation', 'specification', 'plan', 'log'],
  );
});

// 20260711-103756 CR1: the `quick` lane scaffolds only Request and Log, in
// that order, with the same frontmatter shape as any other type.
test('103756 CR1: new scaffolds a quick change with only request and log', () => {
  const root = tmp();
  init(root);
  const file = newChange(
    {
      type: 'quick',
      slug: 'fix-copy',
      title: 'Corregir texto del banner',
      now: '2026-06-13T15:00:00Z',
    },
    root,
    { ownerHandle: () => '' },
  );
  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.type, 'quick');
  assert.equal(c.frontmatter.status, 'draft');
  assert.deepEqual(
    c.stages.map((s) => s.key),
    ['request', 'log'],
  );
});

// 20260711-103756 CR4: the default (unpersonalized) matrix includes `quick`
// with request+log active and no review gate.
test('103756 CR4: the default config matrix includes quick with no review gate', () => {
  const root = tmp();
  init(root);
  const dir = findChangeledgerDir(root);
  const config = loadConfig(dir);
  assert.deepEqual(config.types.quick.stages, ['request', 'log']);
  assert.equal(Boolean(config.types.quick.review_required), false);
});

test('new normalizes the slug to kebab ascii', () => {
  const root = tmp();
  init(root);
  const file = newChange(
    { type: 'chore', slug: 'Fix CI Pipeline', title: 'x', now: '2026-06-13T15:00:00Z' },
    root,
    { ownerHandle: () => '' },
  );
  assert.equal(path.basename(file), '20260613-150000-fix-ci-pipeline.md');
});

test('20260726-124836 CR1: new resolves owner from the injected git identity when --owner is omitted', () => {
  const root = tmp();
  init(root);
  const file = newChange(
    { type: 'chore', slug: 'x', title: 'X', now: '2026-06-13T15:00:00Z' },
    root,
    { ownerHandle: () => 'ana' },
  );
  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal(c.frontmatter.owner, 'ana');
});

// Confirm-only (Plan task 1, CR2): an explicit --owner already prevailed before
// this change — newChange() passed `owner` straight through to render(), which
// only gates on truthiness. No production change was needed for this criterion.
test('20260726-124836 CR2: an explicit --owner still wins over the injected identity', () => {
  const root = tmp();
  init(root);
  const file = newChange(
    { type: 'chore', slug: 'x', title: 'X', owner: 'leo', now: '2026-06-13T15:00:00Z' },
    root,
    { ownerHandle: () => 'ana' },
  );
  const source = fs.readFileSync(file, 'utf8');
  assert.equal(parseChange(source).frontmatter.owner, 'leo');
  assert.doesNotMatch(source, /owner: ana/);
});

test('20260726-124836 CR3: an unresolvable identity emits no owner line and does not throw', () => {
  const root = tmp();
  init(root);
  let calls = 0;
  let file;
  assert.doesNotThrow(() => {
    file = newChange({ type: 'chore', slug: 'x', title: 'X', now: '2026-06-13T15:00:00Z' }, root, {
      ownerHandle: () => {
        calls += 1;
        return '';
      },
    });
  });
  assert.equal(
    calls,
    1,
    'the injected identity resolver must be consulted when --owner is omitted',
  );
  const c = parseChange(fs.readFileSync(file, 'utf8'));
  assert.equal('owner' in c.frontmatter, false);
});

test('20260726-124836 CR4: --owner help text announces the local git identity default', async () => {
  const bin = path.resolve('bin/changeledger.mjs');
  const { stdout } = await execFileAsync(process.execPath, [bin, 'new', '--help']);
  assert.doesNotMatch(stdout, /defaults to unassigned/);
  assert.match(stdout, /defaults to the local git identity/);
});

test('new rejects a slug that normalizes to empty', () => {
  const root = tmp();
  init(root);
  assert.throws(
    () =>
      newChange({ type: 'bug', slug: '!!!', title: 'Título', now: '2026-06-13T15:00:00Z' }, root, {
        ownerHandle: () => '',
      }),
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
  const noOwner = { ownerHandle: () => '' };
  const a = newChange({ type: 'chore', slug: 'one', title: 'one', now }, root, noOwner);
  const before = fs.readFileSync(a, 'utf8');
  const b = newChange({ type: 'chore', slug: 'two', title: 'two', now }, root, noOwner);
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
    { ownerHandle: () => '' },
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
      { ownerHandle: () => '' },
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
      { ownerHandle: () => '' },
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
      { ownerHandle: () => '' },
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
      { ownerHandle: () => '' },
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

// --- frozen history (20260726-194220): the summary names what it did not validate ---

function frozenLedger(docs) {
  const root = tmp();
  init(root);
  for (const [name, text] of Object.entries(docs)) {
    fs.writeFileSync(path.join(root, '.changeledger', 'changes', name), text);
  }
  return root;
}

function frontmatterBlock(over) {
  return Object.entries({
    title: 'X',
    created: '2026-01-01T00:00:00Z',
    depends_on: '[]',
    ...over,
  })
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}

// A well-formed document: the shipped config activates only `## Request` and
// `## Plan` for `chore`, so nothing here can error or warn.
function validChore(id, over = {}) {
  const fm = frontmatterBlock({ id: `"${id}"`, type: 'chore', status: 'approved', ...over });
  return `---\n${fm}\n---\n\n## Request\n\nX\n\n## Plan\n\nX\n`;
}

// A `bug` body without `## Specification`, a stage the shipped config activates
// for that type: the defect today's rules report on frozen history.
function bugMissingSpecification(id, over = {}) {
  const fm = frontmatterBlock({ id: `"${id}"`, type: 'bug', status: 'done', ...over });
  return `---\n${fm}\n---\n\n## Request\n\nX\n\n## Investigation\n\nX\n\n## Plan\n\nX\n\n## Log\n`;
}

function captureOutput() {
  const lines = [];
  const push = (m) => lines.push(m);
  return { lines, log: push, warn: push, error: push };
}

// The summary's error branch opens with a blank separator, so its emitted string
// carries a leading newline the printed last line does not.
function lastLine(out) {
  return out.lines.at(-1).split('\n').at(-1);
}

test('194220 CR8: the repo-wide summary names the documents it did not validate', () => {
  const root = frozenLedger({
    '20260101-000000-one.md': validChore('20260101-000000'),
    '20260102-000000-two.md': validChore('20260102-000000'),
    '20260103-000000-frozen.md': validChore('20260103-000000', {
      status: 'done',
      archived: 'true',
    }),
  });
  const out = captureOutput();
  const code = check([], root, out);
  assert.equal(out.lines.at(-1), '✓ 2 change(s) valid — 1 not validated (archived or discarded)');
  assert.equal(code, 0);
});

test('194220 CR9: with no frozen documents the summary is unchanged', () => {
  const root = frozenLedger({
    '20260101-000000-one.md': validChore('20260101-000000'),
    '20260102-000000-two.md': validChore('20260102-000000'),
  });
  const out = captureOutput();
  const code = check([], root, out);
  assert.equal(out.lines.at(-1), '✓ 2 change(s) valid');
  assert.equal(code, 0);
});

test('194220 CR10: check <id> on a frozen document says it was not validated', () => {
  const root = frozenLedger({
    '20260101-000000-archived.md': bugMissingSpecification('20260101-000000', {
      archived: 'true',
    }),
    '20260102-000000-discarded.md': bugMissingSpecification('20260102-000000', {
      status: 'discarded',
    }),
  });

  const archived = captureOutput();
  assert.equal(check(['20260101-000000'], root, archived), 0);
  assert.deepEqual(archived.lines, ['✓ change 20260101-000000 not validated (archived)']);

  const discarded = captureOutput();
  assert.equal(check(['20260102-000000'], root, discarded), 0);
  assert.deepEqual(discarded.lines, ['✓ change 20260102-000000 not validated (discarded)']);
});

test('194220 CR11: the summary names what it did not validate when it also reports errors', () => {
  // `mismatch.md` carries a well-formed document whose filename does not start
  // with its id: exactly one error, no warnings, and still a validated subject.
  const live = {
    '20260101-000000-one.md': validChore('20260101-000000'),
    'mismatch.md': validChore('20260102-000000'),
  };

  const withFrozen = captureOutput();
  const frozenRoot = frozenLedger({
    ...live,
    '20260103-000000-frozen.md': validChore('20260103-000000', {
      status: 'done',
      archived: 'true',
    }),
  });
  assert.equal(check([], frozenRoot, withFrozen), 1);
  assert.equal(
    lastLine(withFrozen),
    '1 error(s), 0 warning(s) — 2 change(s), 1 not validated (archived or discarded)',
  );

  const withoutFrozen = captureOutput();
  assert.equal(check([], frozenLedger(live), withoutFrozen), 1);
  assert.equal(lastLine(withoutFrozen), '1 error(s), 0 warning(s) — 2 change(s)');
});
