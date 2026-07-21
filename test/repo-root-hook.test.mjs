import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { registerRepo } from '../src/commands/register.mjs';
import { BOOTSTRAP_VERSION } from '../src/contract.mjs';
import { initializeStateStore, publishStateStore, readStateStore } from '../src/state-store.mjs';

// Regression coverage for change 20260721-000706: `changeledger check` (and the
// global state store) must resolve the invoking worktree under a git hook's
// inherited environment, never a sibling or unrelated repository. The trace
// found no independent defect — `checkContract` reads AGENTS.md purely from the
// cwd-anchored repoRoot, and every git call routes through `sanitizedEnv()`
// (src/git.mjs), which strips GIT_DIR/GIT_WORK_TREE/… These tests lock in that
// behavior so a future change that git-derives repoRoot, scans other worktrees,
// or drops the env sanitization cannot silently reintroduce the false positive.

const BIN = path.resolve(fileURLToPath(import.meta.url), '../../bin/changeledger.mjs');

const LOCATION_VARS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CEILING_DIRECTORIES',
];

// A parent process (e.g. this project's own pre-commit hook) may export the git
// location vars; inheriting them here would redirect the fixture's `git init`
// at a fresh tmpdir onto the real repo. Strip them for all setup git calls.
function cleanEnv(home) {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Hook Test',
    GIT_AUTHOR_EMAIL: 'hook@example.com',
    GIT_COMMITTER_NAME: 'Hook Test',
    GIT_COMMITTER_EMAIL: 'hook@example.com',
    CHANGELEDGER_HOME: home,
  };
  for (const key of LOCATION_VARS) delete env[key];
  return env;
}

function writeConfig(root, projectId, { stateBranch, stateBaseline } = {}) {
  fs.mkdirSync(path.join(root, '.changeledger', 'changes'), { recursive: true });
  const stateLines =
    stateBranch && stateBaseline
      ? `  state_branch: ${stateBranch}\n  state_baseline: ${stateBaseline}\n`
      : '';
  fs.writeFileSync(
    path.join(root, '.changeledger', 'config.yml'),
    `schema_version: 4
language: en
changes_dir: .changeledger/changes
specs_dir: .changeledger/specs
git:
  integration_branch: dev
  change_branch_format: "{type}/{id}"
${stateLines}statuses: [draft, approved, in-progress, in-review, in-validation, blocked, done, discarded]
stages: [request, plan, log]
types:
  bug:
    stages: [request, plan]
project_id: ${projectId}
project_name: ${path.basename(root)}
`,
  );
}

// A deliberately stale bootstrap block (one version behind the current one), so
// `check` would emit "outdated ChangeLedger reference" if it ever read it.
function staleAgents(root) {
  fs.writeFileSync(
    path.join(root, 'AGENTS.md'),
    `# ${path.basename(root)}\n\n<!-- CHANGELEDGER BOOTSTRAP BEGIN v${BOOTSTRAP_VERSION - 1} -->\n> outdated\n<!-- CHANGELEDGER BOOTSTRAP END -->\n`,
  );
}

test('20260721-000706 CR1: check under a hook in a linked worktree resolves the invoker, not a stale sibling', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-hook-cr1-'));
  const home = path.join(base, 'home');
  fs.mkdirSync(path.join(home, '.changeledger'), { recursive: true });
  fs.writeFileSync(path.join(home, '.changeledger', '.registry.json'), '{}');
  const env = cleanEnv(home);
  const git = (root, args) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8' });
  const cli = (root, args) =>
    execFileSync('node', [BIN, ...args], { cwd: root, env, encoding: 'utf8' });

  // Main worktree — deliberately STALE AGENTS.md.
  const main = path.join(base, 'main');
  fs.mkdirSync(main);
  git(main, ['init', '-q', '-b', 'dev']);
  writeConfig(main, 'proj-main');
  fs.writeFileSync(path.join(main, 'AGENTS.md'), '# main\n');
  registerRepo(main, { log() {}, warn() {} });
  staleAgents(main);
  git(main, ['add', '-A']);
  git(main, ['commit', '-qm', 'init main']);

  // Linked worktree (the invoker) — CURRENT AGENTS.md via register.
  const sib = path.join(base, 'sib');
  git(main, ['worktree', 'add', '-q', '-b', 'sib', sib]);
  fs.rmSync(path.join(sib, '.changeledger'), { recursive: true, force: true });
  fs.rmSync(path.join(sib, 'AGENTS.md'), { force: true });
  writeConfig(sib, 'proj-sib');
  fs.writeFileSync(path.join(sib, 'AGENTS.md'), '# sib\n');
  registerRepo(sib, { log() {}, warn() {} });
  git(sib, ['add', '-A']);
  git(sib, ['commit', '-qm', 'init sib']);

  // Interactive check in the invoker is clean.
  const interactive = cli(sib, ['check']);
  assert.match(interactive, /valid/);
  assert.doesNotMatch(interactive, /outdated/);

  // Install a real pre-commit hook that runs the CLI's `check`, then make a real
  // commit in the linked worktree. git fires the hook with GIT_DIR pointing at
  // .git/worktrees/sib; the commit must succeed (hook check clean), proving the
  // hook resolves the invoker's current AGENTS.md, not main's stale one.
  const hooks = path.join(main, '.githooks');
  fs.mkdirSync(hooks);
  const hookLog = path.join(base, 'hook-check.out');
  fs.writeFileSync(
    path.join(hooks, 'pre-commit'),
    `#!/bin/sh\nnode "${BIN}" check > "${hookLog}" 2>&1\nexit $?\n`,
    { mode: 0o755 },
  );
  git(main, ['config', 'core.hooksPath', hooks]);

  fs.appendFileSync(path.join(sib, 'AGENTS.md'), '\nedit\n');
  git(sib, ['add', '-A']);
  // A non-zero hook exit aborts the commit; a successful commit proves the hook
  // check resolved the invoker's current AGENTS.md, not main's stale one.
  assert.doesNotThrow(() => {
    git(sib, ['commit', '-m', 'trigger hook']);
  }, 'commit blocked: the hook check falsely resolved a sibling worktree');
  const hookOutput = fs.readFileSync(hookLog, 'utf8');
  assert.match(hookOutput, /valid/);
  assert.doesNotMatch(hookOutput, /outdated/);

  // The sibling's stale AGENTS.md never influenced the result and was untouched.
  assert.match(
    fs.readFileSync(path.join(main, 'AGENTS.md'), 'utf8'),
    new RegExp(`BOOTSTRAP BEGIN v${BOOTSTRAP_VERSION - 1}`),
  );
});

test('20260721-000706 CR2: state store operations stay anchored on repoRoot under inherited git env', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-hook-cr2-'));
  const home = path.join(base, 'home');
  fs.mkdirSync(path.join(home, '.changeledger'), { recursive: true });
  fs.writeFileSync(path.join(home, '.changeledger', '.registry.json'), '{}');
  const env = cleanEnv(home);
  const git = (root, args) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8' });

  // Repo with an active state store.
  const main = path.join(base, 'main');
  fs.mkdirSync(main);
  git(main, ['init', '-q', '-b', 'dev']);
  writeConfig(main, 'proj-main');
  fs.writeFileSync(path.join(main, 'README.md'), '# main\n');
  git(main, ['add', '-A']);
  git(main, ['commit', '-qm', 'init']);
  const text =
    '---\nid: "20260720-120000"\ntitle: G\ntype: bug\nstatus: draft\ncreated: 2026-07-20T12:00:00Z\ndepends_on: []\n---\n\n## Request\n\n## Plan\n';
  const initialized = initializeStateStore({
    repoRoot: main,
    branch: 'changeledger/state',
    projectId: 'proj-main',
    integrationBranch: 'dev',
    changes: [{ name: '20260720-120000-g.md', text }],
    gitEnv: env,
  });

  // A completely unrelated repo with NO state branch.
  const other = path.join(base, 'other');
  fs.mkdirSync(other);
  git(other, ['init', '-q', '-b', 'dev']);
  fs.writeFileSync(path.join(other, 'x'), 'x');
  git(other, ['add', '-A']);
  git(other, ['commit', '-qm', 'other']);

  // Simulate a git hook: export location vars pointing at the unrelated repo.
  const saved = {};
  for (const key of LOCATION_VARS) saved[key] = process.env[key];
  process.env.GIT_DIR = path.join(other, '.git');
  process.env.GIT_WORK_TREE = other;
  process.env.GIT_INDEX_FILE = path.join(other, '.git', 'index');
  try {
    // Without sanitizedEnv these would target `other` and fail; anchored on
    // repoRoot they read the correct state branch.
    const store = readStateStore(main, 'changeledger/state');
    assert.equal(store.head, initialized.head);
    assert.equal(store.changes.length, 1);
    const published = publishStateStore(main, 'changeledger/state');
    assert.equal(published.head, initialized.head);
    assert.equal(published.remote, 'unconfigured');
  } finally {
    for (const key of LOCATION_VARS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});
