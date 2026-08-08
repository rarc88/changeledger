import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
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
import { commit } from '../src/commands/commit.mjs';
import { init } from '../src/commands/init.mjs';
import { idFromTimestamp, newChange } from '../src/commands/new.mjs';
import { registerRepo } from '../src/commands/register.mjs';
import { findChangeledgerDir, loadConfig } from '../src/config.mjs';
import { checkContract } from '../src/contract.mjs';
import { contractTemplatesDir, templatesDir } from '../src/paths.mjs';
import { readSnapshot, STATE_REF, writeActivation } from '../src/state-store.mjs';
import { contractFragmentNames } from './contract-support.mjs';
import { buildTree, commitTree, updateRef } from './helpers/state-repo.mjs';

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

// Activates an already-`init()`ed repo: a real git repo whose state ref holds
// the worktree's own config.yml (no changes yet) plus an activation record —
// the minimal fixture for CR4 (`new` on an activated repo). Mirrors
// `agent.test.mjs`'s `activatedRepoWithChange()`, without the pre-existing
// change document `new` itself is responsible for creating.
function activate(root) {
  const configText = fs.readFileSync(path.join(root, '.changeledger', 'config.yml'), 'utf8');
  execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  const tree = buildTree(root, {
    '.changeledger-state/manifest.yml': 'format_version: 1\nproject_id: demo\n',
    '.changeledger-state/config.yml': configText,
  });
  const revision = commitTree(root, tree, { message: 'chore: state' });
  updateRef(root, STATE_REF, revision);
  writeActivation(root, { stateRef: STATE_REF });
  return revision;
}

test('161652 CR3: new rejects a future schema before creating files or locks', () => {
  const root = tmp();
  init(root);
  const configFile = path.join(root, '.changeledger', 'config.yml');
  fs.writeFileSync(
    configFile,
    fs.readFileSync(configFile, 'utf8').replace(/^schema_version: \d+$/m, 'schema_version: 6'),
  );
  const changesDir = path.join(root, '.changeledger', 'changes');
  const before = fs.readdirSync(changesDir);

  assert.throws(
    () =>
      newChange(
        { type: 'feature', slug: 'future', title: 'Future', now: '2026-07-31T16:00:00Z' },
        root,
      ),
    /^Error: config schema 6 is newer than supported schema 5; update ChangeLedger before writing$/,
  );
  assert.deepEqual(fs.readdirSync(changesDir), before);
});

// The whole installed contract, at every depth. The sweeps below assert that a
// retired rule appears NOWHERE in it, and the `agent-contexts/` and
// `agent-prompts/` fragments are installed and shipped exactly like the top-level
// ones, so concatenating only the top level gave those sweeps eight seats they
// never read. The enumeration is the shared one, so no ninth guard is born blind.
// Each fragment's own whitespace is collapsed to a single space before the join,
// matching the equivalent sweeps in context.test.mjs: a `.*` pattern otherwise
// depends on a fragment's own line-wrap cut (`.` never matches `\n`), so a
// harmless reflow of prose that does not touch the obligation itself breaks the
// assert in silence. The join separator itself stays a real `\n`, added after
// normalizing each fragment rather than collapsed away with the rest of the
// whitespace: `.` still cannot cross it, so a pattern cannot match by pasting
// one fragment's tail against the next fragment's head.
function contractText() {
  return contractFragmentNames()
    .map((name) =>
      fs.readFileSync(path.join(contractTemplatesDir, name), 'utf8').replace(/\s+/g, ' '),
    )
    .join('\n');
}

// The fragments that carry a retired rule, by name. An exhaustive-negative sweep
// has to name the seat the rule came back in, and `doesNotMatch` over the
// concatenation cannot: it reprints a truncated dump of the whole contract, which
// locates nothing. Per fragment is also the exact claim — no fragment carries it —
// where a match across the join of two fragments would be an artefact. Each
// fragment's own text is whitespace-normalized before testing, for the same
// reflow-independence reason as `contractText()`.
function fragmentsCarrying(pattern) {
  return contractFragmentNames().filter((name) =>
    pattern.test(
      fs.readFileSync(path.join(contractTemplatesDir, name), 'utf8').replace(/\s+/g, ' '),
    ),
  );
}

// --- 20260728-151336 CR4 fixtures: commit()'s --no-change declaration ---
//
// This suite may itself run inside this repo's own pre-commit hook, which
// exports GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE for the outer repo. Left
// inherited, every git call below would silently operate on the outer repo
// instead of the scratch fixture — strip them so tests are hook-safe.
const COMMIT_GIT_ENV = { ...process.env };
for (const key of [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CEILING_DIRECTORIES',
]) {
  delete COMMIT_GIT_ENV[key];
}
function gitFor(root, args) {
  return execFileSync('git', args, { cwd: root, env: COMMIT_GIT_ENV, encoding: 'utf8' });
}

// A scratch repo that is both a real git repo and a minimal ChangeLedger repo
// (commit.mjs resolves the active change via loadRepo).
function commitFixtureRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-cli-commit-'));
  gitFor(root, ['init', '-q']);
  gitFor(root, ['config', 'user.email', 'test@example.com']);
  gitFor(root, ['config', 'user.name', 'Test']);
  gitFor(root, ['config', 'commit.gpgsign', 'false']);
  fs.mkdirSync(path.join(root, '.changeledger', 'changes'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.changeledger', 'config.yml'),
    'changes_dir: .changeledger/changes\n',
  );
  return root;
}

function commitFixtureWriteChange(root, id, status) {
  fs.writeFileSync(
    path.join(root, '.changeledger', 'changes', `${id}-x.md`),
    `---\nid: "${id}"\ntitle: X\ntype: feature\nstatus: ${status}\ncreated: 2026-07-11T00:00:00Z\ndepends_on: []\n---\n\n## Request\n`,
  );
}

function commitFixtureStageFile(root, name, content) {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  gitFor(root, ['add', name]);
}

function commitFixtureCommitCount(root) {
  try {
    return Number(gitFor(root, ['rev-list', '--count', 'HEAD']).trim());
  } catch {
    return 0;
  }
}

function commitFixtureLastSubject(root) {
  return gitFor(root, ['log', '-1', '--pretty=%s']).trim();
}

function commitFixtureLastBody(root) {
  return gitFor(root, ['log', '-1', '--pretty=%b']).trim();
}

const commitNoop = () => {};

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

- [ ] Update \`lib/parser.rb\`
  - **Target:** \`lib/parser.rb\`
  - **Verify:** \`bundle exec rspec spec/parser_spec.rb\`
  - **Criteria:** CR1

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
    .replace('  verification_patterns: ["test/**"]', '  verification_patterns: ["spec/**"]');
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
  // 20260730-002730 retired the portability sentence pin; the naming sweep stays.
  assert.deepEqual(
    fragmentsCarrying(/Spec\s+Ledger/i),
    [],
    'a contract fragment carries the retired product name',
  );
});

// 20260730-002730 retired the sentence pin of `020229 CR4`. The two configuration
// keys the criterion is actually about are identifiers, not prose, so they stay.
test('020229 CR4: installed contract documents configurable readiness patterns', () => {
  const contract = contractText();
  assert.match(contract, /readiness\.target_patterns/);
  assert.match(contract, /readiness\.verification_patterns/);
});

// 20260730-002730 retired the sentence pin of `122611 CR3`. The configured value and
// the copyable example child stay: both are structure a reader copies, not prose.
test('122611 CR3: installed contract recommends structural verify clauses', () => {
  const contract = contractText();
  assert.match(contract, /verification_patterns: \["verify:"\]/);
  assert.match(contract, /- \*\*Verify:\*\* verify: manual Android device check/);
});

test('221849: installed CLI reference names actors and dedicated terminal actions', () => {
  const contract = contractText();
  // 20260730-002730 retired the sentence pin over the refusal. The behaviour it
  // described is independently covered by `125139` in `cli-bin.test.mjs`, which runs
  // `status <id> approved` and asserts exit 1 — a behavioural test, not a wording.
  assert.match(contract, /`changeledger discard <id> "<reason>"`/);
});

// 20260730-002730 retired `214902 CR1-CR4/CR7/CR8`: all 20 of its asserts pinned a
// sentence of `core.md`, `implement.md` or `handoff.md` through the installed contract.
// The creation gate, the authorization rule and the intent routing are curated entries
// 1 and 2, guarded against the composed core rather than against this concatenation.
// `test/contract.test.mjs` still pins the published bootstrap block, which is a
// consumer-facing interface and out of this change's scope.

// 20260730-002730: the twelve presence pins are retired — the commit unit, the baseline
// and the correction isolation are curated entries 6 and 9. The two retired-phrase
// sweeps stay: the installed contract must not regrow the fixed per-change count or the
// inseparable-Plan-tasks excuse, and that is the class the decision preserves.
test('214902 CR5/CR6: the installed contract regrows no retired commit rule', () => {
  for (const retired of [
    /\*\*Implementation\*\*: exactly one/,
    /several Plan tasks are inseparable/,
  ]) {
    assert.deepEqual(
      fragmentsCarrying(retired),
      [],
      `a contract fragment regrew the retired ${retired}`,
    );
  }
});

test('171002 CR1-CR5: installed contract gives done one human-accepted meaning', () => {
  const contract = contractText();
  // Anchored to the row's own cells, not just its label: an unanchored `.*`
  // reaches past this row's own mechanism into the next row's `changeledger
  // status` cell post-normalization, so the pin can pass while this row's own
  // mechanism is wrong.
  assert.match(contract, /in-progress → in-review \| agent \| `changeledger status`/);
  assert.match(contract, /in-review → in-validation.*`changeledger review <id> pass`/);
  assert.match(contract, /in-progress → in-validation \(no review\).*`changeledger status`/);
  // Widened reach after normalization (intra-fragment newlines no longer block
  // `.*`) let this pin drift onto the next row's unrelated "human"/"viewer": tied
  // to the accept command so only this row's own content can satisfy it.
  assert.match(
    contract,
    /in-validation → done.*human.*viewer.*`changeledger validation <id> pass`/,
  );
  assert.match(contract, /human accepted the complete result/);
  // 20260730-002730 retired the two sentence pins that stood here. The transition rows
  // above are table cells, and the lifecycle value's own terminality is asserted by the
  // enum literal rather than by the sentence explaining it.
  assert.match(contract, /`discarded` never reopens/);
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

test('152809 CR5: check exits 1 and names an invalid change document', async () => {
  const root = tmp();
  init(root);
  const name = '20260804-120001-invalid.md';
  fs.writeFileSync(
    path.join(root, '.changeledger', 'changes', name),
    `---
id: "20260804-120001"
title: "Texto" fuera
type: bug
status: draft
created: 2026-08-04T12:00:01Z
depends_on: []
related_to: []
---
`,
  );
  const bin = path.resolve('bin/changeledger.mjs');

  await assert.rejects(
    execFileAsync(process.execPath, [bin, 'check'], {
      cwd: root,
      env: { ...process.env, CHANGELEDGER_HOME: process.env.CHANGELEDGER_HOME },
    }),
    (error) => {
      assert.equal(error.code, 1);
      const output = `${error.stdout}${error.stderr}`;
      assert.match(output, new RegExp(name));
      assert.doesNotMatch(output, /change\(s\) valid/);
      return true;
    },
  );
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

test('CR4: new on an activated repo writes the document to the state ref, not the worktree', () => {
  const root = tmp();
  init(root);
  const revision = activate(root);
  const changesDirWorktree = path.join(root, '.changeledger', 'changes');
  const worktreeBefore = fs.existsSync(changesDirWorktree)
    ? fs.readdirSync(changesDirWorktree)
    : [];

  const relPath = newChange(
    { type: 'chore', slug: 'active-new', title: 'Active new', now: '2026-08-08T15:00:00Z' },
    root,
    { ownerHandle: () => '' },
  );

  assert.equal(relPath, 'changes/20260808-150000-active-new.md');
  const tip = execFileSync('git', ['rev-parse', STATE_REF], { cwd: root, encoding: 'utf8' }).trim();
  assert.notEqual(tip, revision, 'the state ref advanced a commit');
  const snapshot = readSnapshot(root, { revision: tip });
  assert.match(snapshot.documents[relPath], /id: "20260808-150000"/);
  assert.match(snapshot.documents[relPath], /## Plan/);
  // The working tree never sees the new document.
  assert.equal(fs.existsSync(path.join(root, '.changeledger', relPath)), false);
  assert.deepEqual(
    fs.existsSync(changesDirWorktree) ? fs.readdirSync(changesDirWorktree) : [],
    worktreeBefore,
    'the worktree changes/ directory is untouched',
  );
});

// Smoke test only, not CR4 proof: two real child processes racing through a
// ready/go barrier tend to serialize on this machine (the second child's
// `loadRepo` already observes the first child's committed file before ever
// attempting a write), so the retry branch is not reliably exercised here —
// both outcomes (a real CAS conflict-then-retry, or a clean id bump before
// any write) land on the same two ids, which is why this assertion holds
// either way. The deterministic proof of the stale-revision retry itself is
// the test below.
test('new on an activated repo tolerates two concurrent processes, no crash, distinct ids', async () => {
  const root = tmp();
  init(root);
  activate(root);
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
    const relPath = newChange(
      { type: 'chore', slug: process.argv[1], title: process.argv[1], now: '2026-08-08T15:00:00Z' },
      process.argv[2],
      { ownerHandle: () => '' },
    );
    console.log(relPath);
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

  const relPaths = (await Promise.all([one, two])).map((r) => r.stdout.trim());
  const ids = relPaths.map((p) => p.match(/^changes\/(\d{8}-\d{6})-/)[1]);
  assert.equal(new Set(ids).size, 2, 'both `new` calls succeeded with distinct ids');
  assert.deepEqual(ids.sort(), ['20260808-150000', '20260808-150001']);

  const tip = execFileSync('git', ['rev-parse', STATE_REF], { cwd: root, encoding: 'utf8' }).trim();
  const snapshot = readSnapshot(root, { revision: tip });
  for (const relPath of relPaths) {
    assert.ok(snapshot.documents[relPath], `${relPath} present in the final snapshot`);
  }
});

// Deterministic CR4 proof for the stale-revision retry: no subprocess, no
// timing. `ownerHandle` is called by `newChangeActive` strictly after
// `loadRepo` has already captured `repo.state.revision` and strictly before
// this call's own write — exactly like `agent.test.mjs`'s CR2 test uses the
// same hook to fire a real, unrelated write in that window. Here the
// "unrelated write" is itself a `newChange` (through the same seam), so the
// ref genuinely advances out from under the primary call's captured
// revision, forcing a real `LedgerConflictError` on its first write attempt.
// `onceRacer` fires exactly once so the retry's own reload (which also
// re-invokes `ownerHandle`) cannot cascade into a second conflict.
function onceRacer(action) {
  let fired = false;
  return () => {
    if (!fired) {
      fired = true;
      action();
    }
    return '';
  };
}

test('CR4: new on an activated repo retries once with a fresh id after a genuine stale-revision conflict', () => {
  const root = tmp();
  init(root);
  activate(root);

  const racer = onceRacer(() => {
    newChange({ type: 'chore', slug: 'racer', title: 'Racer', now: '2026-08-08T15:00:00Z' }, root, {
      ownerHandle: () => '',
    });
  });

  const relPath = newChange(
    { type: 'chore', slug: 'primary', title: 'Primary', now: '2026-08-08T15:00:00Z' },
    root,
    { ownerHandle: racer },
  );

  // The racer took 20260808-150000; the primary call's first write attempt
  // was rejected as stale against it and retried once with a bumped id.
  assert.equal(relPath, 'changes/20260808-150001-primary.md');

  const tip = execFileSync('git', ['rev-parse', STATE_REF], { cwd: root, encoding: 'utf8' }).trim();
  const snapshot = readSnapshot(root, { revision: tip });
  assert.ok(snapshot.documents['changes/20260808-150000-racer.md'], 'the racer document landed');
  assert.ok(snapshot.documents[relPath], 'the retried primary document landed');
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
  // The Plan is left empty on purpose: since 20260729-203257 CR2 a prose line
  // inside `## Plan` is an `unrecognized Plan line` error, so filler cannot go here.
  return `---\n${fm}\n---\n\n## Request\n\nX\n\n## Plan\n`;
}

// A `bug` body without `## Specification`, a stage the shipped config activates
// for that type: the defect today's rules report on frozen history.
function bugMissingSpecification(id, over = {}) {
  const fm = frontmatterBlock({ id: `"${id}"`, type: 'bug', status: 'done', ...over });
  return `---\n${fm}\n---\n\n## Request\n\nX\n\n## Investigation\n\nX\n\n## Plan\n\n## Log\n`;
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

// 20260722-124656 CR3 — the readiness refusal must be observable where the
// orchestrator actually stands: a non-zero exit and every defect on stderr.
test('124656 CR3: `status <id> in-review` exits non-zero and names every readiness defect', async () => {
  const root = tmp();
  init(root);
  const configFile = path.join(root, '.changeledger', 'config.yml');
  fs.writeFileSync(
    configFile,
    fs
      .readFileSync(configFile, 'utf8')
      .replace(/^ {2}change_branch_format:.*$/m, '  change_branch_format: null'),
  );
  const file = newChange(
    { type: 'feature', slug: 'unready', title: 'Unready', now: '2026-06-13T12:00:00Z' },
    root,
    { ownerHandle: () => 'nobody' },
  );
  // Ready while it walks to in-progress: since 20260729-185200 `approve` refuses a
  // defective candidate, and what this criterion observes is the in-review refusal.
  fs.writeFileSync(
    file,
    fs
      .readFileSync(file, 'utf8')
      .replace(
        '## Specification\n',
        '## Specification\n\n### CR1 — Something\n- **Given** a thing\n- **When** it runs\n- **Then** it holds\n',
      )
      .replace(
        '## Plan\n',
        '## Plan\n\n- [ ] do it in `src/x.mjs`\n  - **Target:** `src/x.mjs`\n  - **Verify:** `test/x.test.mjs`\n  - **Criteria:** CR1\n',
      ),
  );
  const id = parseChange(fs.readFileSync(file, 'utf8')).frontmatter.id;
  const bin = path.resolve('bin/changeledger.mjs');
  const run = (...args) =>
    execFileAsync(process.execPath, [bin, ...args], { cwd: root }).then(
      (ok) => ({ code: 0, ...ok }),
      (error) => error,
    );

  assert.equal((await run('approve', id)).code, 0);
  assert.equal((await run('status', id, 'in-progress')).code, 0);
  // Now introduce the two readiness defects the in-review gate must name.
  fs.writeFileSync(
    file,
    fs
      .readFileSync(file, 'utf8')
      .replace(
        '### CR1 — Something\n- **Given** a thing\n- **When** it runs\n- **Then** it holds\n',
        '### CR1 — Something\n- **Given** a thing\n',
      )
      .replace(
        '- [ ] do it in `src/x.mjs`\n  - **Target:** `src/x.mjs`\n  - **Verify:** `test/x.test.mjs`\n  - **Criteria:** CR1',
        '- [ ] do the thing\n  - **Criteria:** CR1',
      ),
  );
  const before = fs.readFileSync(file, 'utf8');

  const failure = await run('status', id, 'in-review');
  assert.equal(failure.code, 1);
  assert.match(failure.stderr, /CR1 is not test-grade: missing Given\/When\/Then/);
  assert.match(failure.stderr, /Plan task for CR1 must name target and verification/);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'the refusal must not touch the document');
  assert.equal(parseChange(before).frontmatter.status, 'in-progress');
});

// 20260728-151336 CR4 — the CLI composes the `ChangeLedger: none — <reason>`
// operational-commit declaration and refuses to combine it with --id.
test('151336 CR4: --no-change and --id are mutually exclusive and create no commit', () => {
  const root = commitFixtureRepo();
  commitFixtureStageFile(root, 'a.txt', 'x');

  assert.throws(
    () =>
      commit(
        { message: 'docs(x): y', ids: ['20260711-000001'], noChange: 'reason' },
        root,
        undefined,
        commitNoop,
      ),
    (e) => /--no-change/.test(e.message) && /--id/.test(e.message),
  );
  assert.equal(commitFixtureCommitCount(root), 0);
});

test('151336 CR4: an empty --no-change reason is refused and creates no commit', () => {
  const root = commitFixtureRepo();
  commitFixtureStageFile(root, 'a.txt', 'x');

  assert.throws(
    () => commit({ message: 'docs(x): y', noChange: '   ' }, root, undefined, commitNoop),
    (e) => e.message === '--no-change requires a non-empty reason',
  );
  assert.equal(commitFixtureCommitCount(root), 0);
});

test('151336 CR4: --no-change composes a marker-less subject and an exact none body, valid under check --commits', () => {
  const root = commitFixtureRepo();
  commitFixtureStageFile(root, 'seed.txt', 'seed\n');
  gitFor(root, ['commit', '-m', 'chore(seed): base']);
  gitFor(root, ['branch', 'base']);
  commitFixtureStageFile(root, 'docs/workflow-hardening.md', 'notes\n');

  const subject = commit(
    {
      message: 'docs(workflow): record the sieve',
      noChange: 'acta de análisis, ningún change la cubre',
    },
    root,
    undefined,
    commitNoop,
  );

  assert.equal(subject, 'docs(workflow): record the sieve');
  assert.equal(commitFixtureLastSubject(root), 'docs(workflow): record the sieve');
  assert.equal(
    commitFixtureLastBody(root),
    'ChangeLedger: none — acta de análisis, ningún change la cubre',
  );

  const messages = [];
  const output = { log: (m) => messages.push(m), error: (m) => messages.push(m) };
  assert.equal(check(['--commits', 'base'], root, output), 0);
});

test('151336 CR4: --no-change ignores an in-progress change instead of attaching its marker', () => {
  const root = commitFixtureRepo();
  commitFixtureWriteChange(root, '20260711-000001', 'in-progress');
  commitFixtureStageFile(root, 'docs/note.md', 'x');

  const subject = commit(
    { message: 'docs(x): y', noChange: 'operational edit, no change covers it' },
    root,
    undefined,
    commitNoop,
  );

  assert.equal(subject, 'docs(x): y');
  assert.equal(commitFixtureLastSubject(root), 'docs(x): y');
  assert.equal(
    commitFixtureLastBody(root),
    'ChangeLedger: none — operational edit, no change covers it',
  );
});

// A scenario where in-progress auto-resolution would itself throw (ambiguous:
// two candidates) — the sharpest proof that --no-change skips resolution
// altogether rather than merely discarding a resolved id afterwards. If
// resolution ran, this would throw "Ambiguous: 2 changes are in-progress
// ..." instead of succeeding.
test('151336 CR4: --no-change succeeds even when in-progress resolution would itself be ambiguous', () => {
  const root = commitFixtureRepo();
  commitFixtureWriteChange(root, '20260711-000001', 'in-progress');
  commitFixtureWriteChange(root, '20260711-000002', 'in-progress');
  commitFixtureStageFile(root, 'docs/note.md', 'x');

  const subject = commit(
    { message: 'docs(x): y', noChange: 'operational edit, no change covers it' },
    root,
    undefined,
    commitNoop,
  );

  assert.equal(subject, 'docs(x): y');
  assert.equal(
    commitFixtureLastBody(root),
    'ChangeLedger: none — operational edit, no change covers it',
  );
});

test('151336 CR4: a --no-change reason containing a newline is refused and creates no commit', () => {
  const root = commitFixtureRepo();
  commitFixtureStageFile(root, 'a.txt', 'x');

  assert.throws(
    () =>
      commit(
        { message: 'docs(x): y', noChange: 'first line\nsecond line' },
        root,
        undefined,
        commitNoop,
      ),
    (e) => e.message === '--no-change reason must not contain a newline',
  );
  assert.equal(commitFixtureCommitCount(root), 0);
});

// 20260729-203257 correction — a raw NUL byte made git classify src/task.mjs
// as binary: no textual diff for review, and line-level grep stopped printing
// its matching lines, while lint, this suite and `changeledger check` all
// stayed green. The sweep forbids every raw control byte except tab/LF/CR, not
// only NUL: none of them belongs in this repo's source, whatever git's binary
// heuristic makes of each.
test('203257 correction: no raw control bytes in source files', () => {
  const repoRoot = path.join(templatesDir, '..');
  const offenders = [];
  const sweep = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        sweep(full);
        continue;
      }
      const buf = fs.readFileSync(full);
      for (let i = 0; i < buf.length; i++) {
        const b = buf[i];
        if ((b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) || b === 0x7f) {
          offenders.push(`${path.relative(repoRoot, full)} offset ${i} byte 0x${b.toString(16)}`);
          break;
        }
      }
    }
  };
  for (const dir of ['src', 'bin', 'test', 'templates', 'hooks']) sweep(path.join(repoRoot, dir));
  assert.deepEqual(offenders, [], `raw control bytes found: ${offenders.join(', ')}`);
});
