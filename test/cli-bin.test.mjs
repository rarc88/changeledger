import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { status, task, validation } from '../src/commands/agent.mjs';
import { buildMigration } from '../src/config-migration.mjs';
import { LOG_EVENT_DEFINITIONS } from '../src/lifecycle.mjs';
import { STATE_REF, writeActivation } from '../src/state-store.mjs';
import { initGitFixture, sanitizedEnv } from './helpers/git-env.mjs';
import { buildTree, commitTree, updateRef } from './helpers/state-repo.mjs';

const bin = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'bin',
  'changeledger.mjs',
);

test('ChangeLedger migration exposes only the unscoped changeledger binary (CR1, CR2)', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(path.dirname(bin), '..', 'package.json'), 'utf8'),
  );
  assert.equal(packageJson.name, 'changeledger');
  assert.deepEqual(packageJson.bin, { changeledger: 'bin/changeledger.mjs' });
  assert.equal(Object.hasOwn(packageJson.bin, 'sl'), false);
});

// Run the CLI; returns { code, out, err }.
function run(...args) {
  try {
    const out = execFileSync('node', [bin, ...args], { encoding: 'utf8' });
    return { code: 0, out, err: '' };
  } catch (e) {
    return { code: e.status ?? 1, out: e.stdout ?? '', err: e.stderr ?? '' };
  }
}

const HELP_COMMAND_EXCLUSIONS = new Set(['help']);

function registeredChildCommands(help) {
  const lines = help.split('\n');
  const start = lines.indexOf('Commands:');
  if (start === -1) return [];

  const commands = [];
  for (const line of lines.slice(start + 1)) {
    if (line === '') break;
    const match = line.match(/^ {2}(\S+)/);
    if (match && !HELP_COMMAND_EXCLUSIONS.has(match[1])) commands.push(match[1]);
  }
  return commands;
}

function registeredCommandHelp(runCommand = run) {
  const rootHelp = runCommand('--help');
  assert.equal(rootHelp.code, 0, 'root --help should exit 0');
  const queue = [{ command: [], out: rootHelp.out }];
  const results = [];

  for (const parent of queue) {
    for (const child of registeredChildCommands(parent.out)) {
      const command = [...parent.command, child];
      const help = runCommand(...command, '-h');
      results.push({ command, ...help });
      queue.push({ command, out: help.out });
    }
  }
  return results;
}

function runDirect(...args) {
  try {
    const out = execFileSync(bin, args, { encoding: 'utf8' });
    return { code: 0, out, err: '' };
  } catch (e) {
    return { code: e.status ?? 1, out: e.stdout ?? '', err: e.stderr ?? '' };
  }
}

// Run the CLI inside a repo, with an isolated registry home.
function runIn(cwd, env, ...args) {
  try {
    const out = execFileSync('node', [bin, ...args], { encoding: 'utf8', cwd, env });
    return { code: 0, out, err: '' };
  } catch (e) {
    return { code: e.status ?? 1, out: e.stdout ?? '', err: e.stderr ?? '' };
  }
}

function disableChangeBranchFormat(root) {
  const configFile = path.join(root, '.changeledger', 'config.yml');
  fs.writeFileSync(
    configFile,
    fs
      .readFileSync(configFile, 'utf8')
      .replace('  change_branch_format: "{type}/{id}"', '  change_branch_format:'),
  );
}

function doneRepo() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  assert.equal(runIn(root, env, 'init').code, 0);
  // Explicit owner: a spawned CLI takes no injected identity resolver, and since
  // 20260726-124836 `new` defaults to the host's git identity, which would make
  // the owner-filter assertions depend on who runs the suite.
  assert.equal(runIn(root, env, 'new', 'chore', 'x', 'X', '--owner', 'Roberto Ruiz').code, 0);
  const item = JSON.parse(runIn(root, env, 'list', '--json').out)[0];
  const changeFile = fs
    .readdirSync(path.join(root, '.changeledger', 'changes'))
    .map((name) => path.join(root, '.changeledger', 'changes', name))
    .find((candidate) => fs.readFileSync(candidate, 'utf8').includes(`id: "${item.id}"`));
  fs.writeFileSync(
    changeFile,
    fs.readFileSync(changeFile, 'utf8').replace('status: draft', 'status: done'),
  );
  return { root, env, id: item.id, changeFile };
}

// 20260808-151641 CR6 — the read-routing spec's "same resolver" claim only
// holds if the CLI's own subprocess entry point (not just the in-process
// `loadRepo` calls in repo.test.mjs) reaches the snapshot. Builds a repo via
// the real `changeledger init`, then turns it into a git repo with a
// worktree-only change (`only-worktree`) and an activated state ref carrying
// a different one (`only-ref`) — same shape as repo.test.mjs's CR2/view.test.mjs's CR5.
function activatedCliRepo() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  assert.equal(runIn(root, env, 'init').code, 0);

  initGitFixture(root);

  const changeDoc = (id, title) =>
    `---\nid: "${id}"\ntitle: ${title}\ntype: feature\nstatus: draft\ncreated: 2026-08-08T00:00:00Z\ndepends_on: []\n---\n\n## Request\n\nHi.\n`;

  fs.writeFileSync(
    path.join(root, '.changeledger', 'changes', 'only-worktree.md'),
    changeDoc('only-worktree', 'only-worktree'),
  );

  const tree = buildTree(root, {
    '.changeledger-state/manifest.yml': 'format_version: 1\nproject_id: demo\n',
    '.changeledger-state/config.yml': 'project_id: demo\nlanguage: en\n',
    '.changeledger-state/changes/only-ref.md': changeDoc('only-ref', 'only-ref'),
  });
  const revision = commitTree(root, tree, { message: 'chore: state' });
  updateRef(root, STATE_REF, revision);
  writeActivation(root, { stateRef: STATE_REF });

  return { root, env };
}

function activatedMigrationCliRepo({ marker = 'statuses: [\n', stateConfig } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  assert.equal(runIn(root, env, 'init').code, 0);
  const configFile = path.join(root, '.changeledger', 'config.yml');
  const initialized = fs.readFileSync(configFile, 'utf8');
  const authority =
    stateConfig ?? initialized.replace(/^schema_version: \d+$/m, 'schema_version: 1');
  fs.writeFileSync(configFile, marker);
  initGitFixture(root);
  const tree = buildTree(root, {
    '.changeledger-state/manifest.yml': 'format_version: 1\nproject_id: demo\n',
    '.changeledger-state/config.yml': authority,
    '.changeledger-state/specs/keep.md': '# Keep\n',
  });
  const revision = commitTree(root, tree, { message: 'chore: state fixture' });
  updateRef(root, STATE_REF, revision);
  writeActivation(root, { stateRef: STATE_REF });
  return { root, env, configFile, marker, authority, revision };
}

function cliStateConfig(root, revision = STATE_REF) {
  return execFileSync('git', ['cat-file', 'blob', `${revision}:.changeledger-state/config.yml`], {
    cwd: root,
    env: sanitizedEnv(),
    encoding: 'utf8',
  });
}

test('20260808-151641 CR6: `list` and `search` read the state-ref snapshot, not the worktree', () => {
  const { root, env } = activatedCliRepo();

  const listed = JSON.parse(runIn(root, env, 'list', '--json').out);
  assert.deepEqual(
    listed.map((c) => c.id),
    ['only-ref'],
  );

  const { out: searchOut } = runIn(root, env, 'search', 'only-ref');
  assert.match(searchOut, /only-ref/);
  assert.doesNotMatch(searchOut, /only-worktree/);
});

test('131649 CR8: graduate help contains only mutation modes and points to list', () => {
  const { code, out } = run('graduate', '--help');
  assert.equal(code, 0);
  assert.match(out, /--new/);
  assert.match(out, /--into/);
  assert.match(out, /--skip/);
  assert.doesNotMatch(out, /^\s+--pending\b/m);
  assert.match(out, /changeledger list --pending graduation/);
});

test('111457 CR5/CR6: fix help exposes the scoped graduation-links migration', () => {
  const { code, out } = run('fix', '--help');
  assert.equal(code, 0);
  assert.match(out, /--graduation-links/);
  assert.match(out, /--structured-sections/);
  assert.match(out, /--dry-run/);
});

test('20260824-134716 CR2: static CLI domains are complete in help and invalid-value errors', () => {
  for (const [command, values] of [
    ['agent-prompt', 'investigation | implementation | review | post-review'],
    ['agent-context', 'investigation | implementation | review | post-review'],
    ['validation', 'pass|fail'],
    ['review', 'pass|fail'],
    ['task', 'done|block'],
  ]) {
    assert.match(run(command, '--help').out, new RegExp(values.replace(/[|]/g, '\\|')));
  }
  const invalid = run('task', 'an-id', 'guess', '1');
  assert.notEqual(invalid.code, 0);
  assert.match(invalid.err, /Allowed choices are done, block/);
  const release = run('release', '--help').out;
  assert.match(release, /release impacts: none, patch, minor, major/);
  assert.match(release, /branch format placeholders: \{type\}, \{id\}/);
});

test('20260824-134716 CR2: repo-configured domains appear in help and invalid errors', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  assert.equal(runIn(root, env, 'init').code, 0);
  const configFile = path.join(root, '.changeledger', 'config.yml');
  fs.writeFileSync(
    configFile,
    fs
      .readFileSync(configFile, 'utf8')
      .replace('types:\n', 'types:\n  custom:\n    stages: [request, log]\n'),
  );
  const help = runIn(root, env, 'check', '--help').out;
  assert.match(help, /effective types: custom, feature, bug, audit, refactor, chore, quick/);
  assert.match(
    help,
    /effective statuses: draft, approved, in-progress, in-review, in-validation, blocked, done, discarded/,
  );
  assert.match(
    help,
    /effective stages: request, investigation, proposal, specification, plan, log/,
  );
  const invalid = runIn(root, env, 'new', 'guess', 'x', 'X', '--owner', 'Test');
  assert.notEqual(invalid.code, 0);
  assert.match(
    invalid.err,
    /Allowed choices are custom, feature, bug, audit, refactor, chore, quick/,
  );
});

test('20260824-134716 CR3: every pair of fix migration modes fails before action', () => {
  const modes = ['--graduation-links', '--structured-sections', '--plan-tags'];
  for (let left = 0; left < modes.length; left++) {
    for (let right = left + 1; right < modes.length; right++) {
      const result = run('fix', modes[left], modes[right]);
      assert.notEqual(result.code, 0);
      assert.match(
        result.err,
        new RegExp(`option '${modes[left]}' cannot be used with option '${modes[right]}'`),
      );
    }
  }
});

test('20260824-134716 CR4: review rejects --retry with --block before action', () => {
  const result = run('review', 'an-id', 'fail', '--retry', '--block', 'reason');
  assert.notEqual(result.code, 0);
  assert.match(result.err, /option '--retry' cannot be used with option '--block'/);
});

test('20260824-134716 CR5: fix help names exact default repairs and one-at-a-time migrations', () => {
  const out = run('fix', '--help').out;
  assert.match(
    out,
    /default repairs: checkbox markers \[ x \]\/\[X\], legacy hyphen separators, near-ISO UTC timestamps/,
  );
  assert.match(out, /--graduation-links.*graduation provenance/s);
  assert.match(
    out,
    /--structured-sections.*resolved\/blocked task metadata and recognized\s+legacy Log entries/s,
  );
  assert.match(out, /--plan-tags.*criteria, support and verify children/s);
  assert.match(out, /migration modes are mutually exclusive; run exactly one at a time/);
});

test('20260824-134716 CR7: log help derives the complete grammar without promising arbitrary events', () => {
  const { code, out } = run('log', '--help');
  assert.equal(code, 0);
  assert.match(out, /append a human-readable note to a change Log/);
  assert.match(out, /^\s*message\s+plain text stored as the `note` payload/m);
  assert.match(
    out,
    /\n\nRecord a note with `changeledger log <id> "Investigation complete"`\.\nExample Log line \(timestamp generated when you run it\):\n\s+- \*\*2026-08-24T17:42:40Z\*\* `\[note\]` Investigation complete/,
  );
  assert.doesNotMatch(out, /<current UTC timestamp>/);
  assert.match(out, /Use `changeledger log` only for human-readable notes\./);
  assert.match(out, /Do not type an event name in <message\.\.\.>\./);

  for (const [type, definition] of Object.entries(LOG_EVENT_DEFINITIONS)) {
    const [payload, ...alternatives] = definition.form.split(' | ');
    assert.match(out, new RegExp(`^  ${type}$`, 'm'));
    assert.ok(out.includes(`    Payload: ${payload}`), `log help should expose ${type} payload`);
    for (const alternative of alternatives) {
      assert.ok(
        out.includes(`    Or: ${alternative}`),
        `log help should expose ${type} alternative`,
      );
    }
  }

  for (const producer of [
    'changeledger approve',
    'changeledger status',
    'changeledger discard',
    'changeledger reopen',
    'changeledger review',
    'changeledger validation',
    'changeledger owner',
    'changeledger branch',
    'changeledger graduate',
    'changeledger archive',
    'changeledger log',
  ]) {
    assert.match(out, new RegExp(`^      ${producer}$`, 'm'));
  }

  assert.doesNotMatch(out, /approve\|status|status\|apply|\(op=/);
  assert.match(
    out,
    /Advanced batch writes:\n\s+`changeledger apply` can write status, owner, and note events/,
  );
});

test('125139 CR1/CR3/CR5/CR6: CLI transmits explicit human decisions and preserves agent rejection', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-agent-cli-'));
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  assert.equal(runIn(root, env, 'init').code, 0);
  disableChangeBranchFormat(root);
  // Explicit owner: a spawned CLI takes no injected identity resolver.
  assert.equal(runIn(root, env, 'new', 'chore', 'x', 'X', '--owner', 'Roberto Ruiz').code, 0);
  const id = JSON.parse(runIn(root, env, 'list', '--json').out)[0].id;
  // 20260810-213633: approve refuses a chore whose active stages (request, plan)
  // are blank — back-fill both minimally before the approval walk below.
  const chFile = path.join(
    root,
    '.changeledger',
    'changes',
    fs.readdirSync(path.join(root, '.changeledger', 'changes'))[0],
  );
  fs.writeFileSync(
    chFile,
    fs
      .readFileSync(chFile, 'utf8')
      .replace('## Request\n', '## Request\n\nR\n')
      .replace('## Plan\n', '## Plan\n\n- [ ] do it\n  - **Support:**\n'),
  );
  assert.equal(runIn(root, env, 'status', id, 'approved').code, 1);
  assert.equal(runIn(root, env, 'approve', id).code, 0);
  for (const next of ['in-progress', 'in-validation'])
    assert.equal(runIn(root, env, 'status', id, next).code, 0);
  assert.equal(runIn(root, env, 'task', id, 'done', '1').code, 0);
  assert.equal(runIn(root, env, 'validation', id, 'pass').code, 0);
  assert.match(
    fs.readFileSync(
      path.join(
        root,
        '.changeledger',
        'changes',
        fs.readdirSync(path.join(root, '.changeledger', 'changes'))[0],
      ),
      'utf8',
    ),
    /human accepted via conversation/,
  );
  assert.equal(runIn(root, env, 'reopen', id, 'needs original correction').code, 0);
  for (const status of ['in-validation'])
    assert.equal(runIn(root, env, 'status', id, status).code, 0);
  assert.equal(runIn(root, env, 'validation', id, 'fail', '--human', 'needs work').code, 0);
  assert.match(runIn(root, env, 'show', id, '--json').out, /human rejected via conversation/);
  assert.equal(runIn(root, env, 'status', id, 'in-validation').code, 0);
  assert.equal(runIn(root, env, 'validation', id, 'fail', 'agent reason').code, 0);
  assert.match(runIn(root, env, 'show', id, '--json').out, /agent rejected/);
});

test('125139 CR4/CR6/CR8: decision commands fail closed and explain human authority', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-decision-cli-'));
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  assert.equal(runIn(root, env, 'init').code, 0);
  // Explicit owner: a spawned CLI takes no injected identity resolver.
  assert.equal(runIn(root, env, 'new', 'chore', 'x', 'X', '--owner', 'Roberto Ruiz').code, 0);
  const id = JSON.parse(runIn(root, env, 'list', '--json').out)[0].id;
  const file = path.join(
    root,
    '.changeledger',
    'changes',
    fs.readdirSync(path.join(root, '.changeledger', 'changes'))[0],
  );

  const draft = fs.readFileSync(file, 'utf8');
  assert.equal(runIn(root, env, 'validation', id, 'pass').code, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), draft);
  assert.equal(runIn(root, env, 'validation', id, 'fail').code, 1);
  assert.equal(runIn(root, env, 'validation', id, 'fail', '--human').code, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), draft);

  for (const command of ['approve', 'validation']) {
    const help = run(command, '--help');
    assert.equal(help.code, 0);
    assert.match(help.out, /explicit human|human decision/i);
    assert.match(help.out, /conversation/i);
  }
});

test('191857 CR1: graduate without a mode rejects skip-like slugs without writing', () => {
  const { root, env, id, changeFile } = doneRepo();
  const before = fs.readFileSync(changeFile, 'utf8');

  for (const slug of ['skip', 'skip-map-driver-riders']) {
    const result = runIn(root, env, 'graduate', id, slug);
    assert.equal(result.code, 1);
    assert.match(result.err, /--new/);
    assert.match(result.err, /--into/);
    assert.match(result.err, /--skip/);
  }

  assert.equal(fs.readFileSync(changeFile, 'utf8'), before);
  assert.equal(fs.existsSync(path.join(root, '.changeledger', 'specs')), false);
});

test('191857 CR2/CR3: --new scaffolds pending truth and --into finalizes it', () => {
  const { root, env, id } = doneRepo();

  const created = runIn(root, env, 'graduate', id, 'auth', '--new');
  assert.equal(created.code, 0);
  assert.match(created.out, /Refine it, then run:/);
  assert.equal(
    JSON.parse(runIn(root, env, 'show', id, '--json').out).frontmatter.reviewed,
    undefined,
  );
  assert.match(runIn(root, env, 'list', '--pending', 'graduation').out, new RegExp(id));

  const specFile = path.join(root, '.changeledger', 'specs', 'auth.md');
  fs.writeFileSync(
    specFile,
    fs.readFileSync(specFile, 'utf8').replace('<!-- changeledger:spec-scaffold -->\n\n', ''),
  );
  const finalized = runIn(root, env, 'graduate', id, 'auth', '--into');
  assert.equal(finalized.code, 0);
  assert.equal(JSON.parse(runIn(root, env, 'show', id, '--json').out).frontmatter.reviewed, true);
});

test('191857 CR4: --skip records the reason without creating a spec', () => {
  const { root, env, id } = doneRepo();
  const result = runIn(root, env, 'graduate', id, '--skip', 'no durable truth');
  assert.equal(result.code, 0);
  const shown = JSON.parse(runIn(root, env, 'show', id, '--json').out);
  assert.equal(shown.frontmatter.reviewed, true);
  assert.match(shown.stages.find((stage) => stage.key === 'log').body, /no durable truth/);
  assert.equal(fs.existsSync(path.join(root, '.changeledger', 'specs')), false);
});

test('191857 CR5: incompatible graduate modes and arguments fail without writing', () => {
  const { root, env, id, changeFile } = doneRepo();
  const before = fs.readFileSync(changeFile, 'utf8');
  const cases = [
    ['graduate', id, 'auth', '--new', '--into'],
    ['graduate', id, 'auth', 'extra', '--into'],
  ];

  for (const args of cases) {
    const result = runIn(root, env, ...args);
    assert.equal(result.code, 1, args.join(' '));
    assert.match(result.err, /Usage: changeledger graduate/);
  }

  assert.equal(fs.readFileSync(changeFile, 'utf8'), before);
  assert.equal(fs.existsSync(path.join(root, '.changeledger', 'specs')), false);
});

test('CR2: changeledger task -h shows done|block, exit 0', () => {
  const { code, out } = run('task', '-h');
  assert.equal(code, 0);
  assert.match(out, /done\|block/);
});

// 225212 CR1/CR2: context -h enumerates the accepted domain and preserves the
// mandatory bootstrap order documented in AGENTS.md.
test('225212 CR1: changeledger context -h enumerates modes, no-arg and change-id behavior', () => {
  const { code, out } = run('context', '-h');
  assert.equal(code, 0);
  assert.match(out, /Usage: changeledger context/);
  for (const mode of ['spec', 'implement', 'review', 'release']) {
    assert.match(out, new RegExp(mode));
  }
  assert.match(out, /no argument/i);
  assert.match(out, /change id/i);
  assert.match(out, /blocked/);
  assert.match(out, /validation/);
  assert.match(out, /close|discarded/);
  assert.match(out, /inferred/i);
});

test('225212 CR2: context -h never tells the reader to run context <id> before the base context', () => {
  const { out } = run('context', '-h');
  assert.doesNotMatch(out, /run `?changeledger context <(id|change-id)>`? before/i);
  assert.match(out, /already read|incremental|extends/i);
});

test('225212 CR3: changeledger new -h documents type domain and slug language', () => {
  const { code, out } = run('new', '-h');
  assert.equal(code, 0);
  assert.match(out, /\.changeledger\/config\.yml/);
  assert.match(out, /English/i);
});

test('225212 CR3: changeledger status -h documents status domain and terminal moves', () => {
  const { code, out } = run('status', '-h');
  assert.equal(code, 0);
  assert.match(out, /\.changeledger\/config\.yml/);
  assert.match(out, /changeledger discard/);
  assert.match(out, /changeledger approve/);
  assert.match(out, /changeledger validation <id> pass/);
  assert.doesNotMatch(out, /e\.g\.[^\n]*approved/);
  assert.doesNotMatch(out, /Only human validation in the viewer/);
  assert.doesNotMatch(out, /status .*\bdone\|discarded\b/);
});

test('225212 CR3: changeledger task -h documents n as the Plan task index and reason for block', () => {
  const { code, out } = run('task', '-h');
  assert.equal(code, 0);
  assert.match(out, /index/i);
  assert.match(out, /reason/i);
});

test('225212 CR3: changeledger owner -h documents that "-" clears the owner', () => {
  const { code, out } = run('owner', '-h');
  assert.equal(code, 0);
  assert.match(out, /-.*clears?/i);
});

test('20260805-052741 CR4/CR5: changeledger branch -h documents that "-" clears the branch', () => {
  const { code, out } = run('branch', '-h');
  assert.equal(code, 0);
  assert.match(out, /-.*clears?/i);
});

test('20260805-052741 CR4: changeledger branch <id> <name> sets the branch explicitly', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  assert.equal(runIn(root, env, 'init').code, 0);
  assert.equal(runIn(root, env, 'new', 'chore', 'x', 'X', '--owner', 'Roberto Ruiz').code, 0);
  const item = JSON.parse(runIn(root, env, 'list', '--json').out)[0];
  const { code, out } = runIn(root, env, 'branch', item.id, 'hotfix/y');
  assert.equal(code, 0);
  assert.match(out, /hotfix\/y/);
  const changed = JSON.parse(runIn(root, env, 'list', '--json').out)[0];
  assert.equal(changed.branch, 'hotfix/y');
});

test('20260805-052741 CR5: changeledger branch <id> - clears the branch', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  assert.equal(runIn(root, env, 'init').code, 0);
  assert.equal(runIn(root, env, 'new', 'chore', 'x', 'X', '--owner', 'Roberto Ruiz').code, 0);
  const item = JSON.parse(runIn(root, env, 'list', '--json').out)[0];
  assert.equal(runIn(root, env, 'branch', item.id, 'hotfix/y').code, 0);
  assert.equal(runIn(root, env, 'branch', item.id, '-').code, 0);
  const changed = JSON.parse(runIn(root, env, 'list', '--json').out)[0];
  assert.equal(changed.branch, null);
});

test('131649 CR9: archive help keeps the action and points preview to list', () => {
  const { code, out } = run('archive', '-h');
  assert.equal(code, 0);
  assert.match(out, /--graduated/);
  assert.match(out, /--owner <name>/);
  assert.match(out, /--unowned/);
  assert.doesNotMatch(out, /^\s+--dry-run\b/m);
  assert.match(out, /changeledger list --pending archive --owner "Roberto Ruiz"/);
  assert.match(out, /changeledger archive --graduated --owner "Roberto Ruiz"/);
  assert.doesNotMatch(run('release', '-h').out, /--owner/);
});

test('105457 CR1/CR3: archive CLI transmits owner filters and rejects id combinations', () => {
  const { root, env, id, changeFile } = doneRepo();
  const candidate = `${fs
    .readFileSync(changeFile, 'utf8')
    .replace(
      'status: done',
      'status: done\nreviewed: true',
    )}\n## Log\n\n- **2026-07-18T12:00:00Z** \`[graduation]\` skipped: no durable truth\n`;
  assert.match(candidate, /\[graduation\]` skipped: no durable truth/);
  fs.writeFileSync(changeFile, candidate);

  assert.match(runIn(root, env, 'archive', '--graduated', '--owner', 'Ana').out, /Archived 0/);
  assert.equal(runIn(root, env, 'show', id, '--json').out.includes('"archived": true'), false);
  assert.match(
    runIn(root, env, 'archive', '--graduated', '--owner', 'Roberto Ruiz').out,
    /Archived 1/,
  );
  assert.match(runIn(root, env, 'show', id, '--json').out, /"archived": true/);

  const conflict = runIn(root, env, 'archive', '--graduated', '--owner', 'Ana', '--unowned');
  assert.equal(conflict.code, 1);
  assert.match(conflict.err, /--owner and --unowned are mutually exclusive/);
  const scopedId = runIn(root, env, 'archive', id, '--owner', 'Ana');
  assert.equal(scopedId.code, 1);
  assert.match(scopedId.err, /--owner and --unowned require --graduated/);
});

test('131649 CR3/CR4/CR6/CR10: list help documents its complete filter domain', () => {
  const { code, out } = run('list', '-h');
  assert.equal(code, 0);
  assert.match(out, /\.changeledger\/config\.yml/);
  assert.match(out, /--owner/);
  assert.match(out, /--unowned/);
  assert.match(out, /--pending.*graduation.*archive/is);
  assert.match(out, /--archived/);
  assert.match(out, /--all/);
});

test('131649 CR4/CR6/CR8-CR10: CLI rejects removed, conflicting and invalid query options', () => {
  const { root, env } = doneRepo();
  const cases = [
    ['graduate', '--pending'],
    ['archive', '--graduated', '--dry-run'],
    ['list', '--owner', 'Roberto Ruiz', '--unowned'],
    ['list', '--archived', '--all'],
    ['list', '--pending', 'release'],
  ];
  for (const args of cases) assert.equal(runIn(root, env, ...args).code, 1, args.join(' '));
  assert.match(runIn(root, env, 'list', '--pending', 'release').err, /graduation.*archive/);
});

test('225212 CR4: changeledger view -h shows explicit syntax for view, view . and a port', () => {
  const { code, out } = run('view', '-h');
  assert.equal(code, 0);
  assert.match(out, /changeledger view\b/);
  assert.match(out, /changeledger view \./);
  assert.match(out, /changeledger view (<port>|\d)/);
});

test('225212 CR4: changeledger view rejects unknown arguments instead of ignoring them', () => {
  const { code, err } = run('view', 'bogus');
  assert.notEqual(code, 0);
  assert.match(err, /bogus/);
});

test('225212 CR5: root --help offers a concise index without a divergent manual table', () => {
  const { code, out } = run('--help');
  assert.equal(code, 0);
  const lines = out.split('\n');
  assert.ok(lines.length <= 60, `root help should stay concise, got ${lines.length} lines`);
  // No second full manual listing of every subcommand's flags duplicated after Commander's own table.
  const occurrences = out.match(/changeledger graduate/g) ?? [];
  assert.ok(
    occurrences.length <= 1,
    'graduate should not appear in both a Commander table and a manual table',
  );
  assert.match(out, /context.*unless.*delegation prompt.*agent-context/is);
});

// CR6: every registered command and subcommand's help exits 0 and shows Usage.
test('225212 CR6: help matrix — every command and subcommand documents Usage on exit 0', () => {
  const commandHelp = registeredCommandHelp();
  const topLevelCommands = new Set(
    commandHelp.filter(({ command }) => command.length === 1).map(({ command }) => command[0]),
  );
  const formerlyOmitted = [
    'import',
    'cutover',
    'activate',
    'commit',
    'fix',
    'search',
    'validation',
  ];
  assert.deepEqual(
    formerlyOmitted.filter((name) => !topLevelCommands.has(name)),
    [],
  );
  for (const { command, code, out } of commandHelp) {
    assert.equal(code, 0, `${command.join(' ')} -h should exit 0`);
    assert.match(out, /Usage: changeledger/, `${command.join(' ')} -h should show Usage`);
  }
});

test('CR3: changeledger graduate with no args fails with its usage', () => {
  const { code, err } = run('graduate');
  assert.notEqual(code, 0);
  assert.match(err, /graduate/);
});

test('CR4: changeledger --help lists all commands', () => {
  const { code, out } = run('--help');
  assert.equal(code, 0);
  assert.match(out, /^\s+init\s/m);
  assert.match(out, /^\s+context\s/m);
  assert.match(out, /^\s+graduate\s/m);
  assert.match(out, /^\s+review\s/m);
  assert.match(out, /^\s+release\s/m);
});

test('205033 CR1/CR3/CR4: context is wired through the CLI', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  assert.equal(runIn(root, env, 'init').code, 0);

  const core = runIn(root, env, 'context');
  assert.equal(core.code, 0);
  assert.match(core.out, /mode: core/);

  const review = runIn(root, env, 'context', 'review');
  assert.equal(review.code, 0);
  assert.match(review.out, /mode: review/);

  const unknown = runIn(root, env, 'context', 'bogus');
  assert.equal(unknown.code, 1);
  assert.match(
    unknown.err,
    /Unknown context "bogus" — valid modes: implement, review, spec, release \(or pass a change id\)/,
  );
});

test('20260808-171107 CR5: unknown context ids outrank unrelated parse errors without emitting BEGIN', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  assert.equal(runIn(root, env, 'init').code, 0);
  fs.writeFileSync(
    path.join(root, '.changeledger', 'changes', 'broken.md'),
    'no frontmatter here\n',
  );

  const context = runIn(root, env, 'context', '20990101-000000');
  assert.equal(context.code, 1);
  assert.match(context.err, /Unknown context "20990101-000000"/);
  assert.doesNotMatch(context.out, /CHANGELEDGER CONTEXT BEGIN/);

  const agent = runIn(root, env, 'agent-context', 'implementation', '20990101-000000');
  assert.equal(agent.code, 1);
  assert.match(agent.err, /No change with id "20990101-000000"/);
  assert.doesNotMatch(agent.out, /CHANGELEDGER AGENT CONTEXT BEGIN/);

  const checked = runIn(root, env, 'check');
  assert.equal(checked.code, 1);
  assert.match(checked.err, /broken\.md/);
});

// Recursively collect every source file under `dir` (no fixed file list —
// a duplicate literal reintroduced anywhere under src/** or bin/** must be
// caught, not only in the three files this guard used to name explicitly).
function listSourceFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    return entry.isFile() && entry.name.endsWith('.mjs') ? [full] : [];
  });
}

test('20260808-171107 CR4: CLI and viewer conflict text use one shared literal base', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const files = [
    ...listSourceFiles(path.join(root, 'src')),
    ...listSourceFiles(path.join(root, 'bin')),
  ];
  // Quote-shaped ('...'/"...") AND backtick template literals: either form
  // can hold a reintroduced duplicate.
  const literals = files.flatMap((file) =>
    [
      ...fs.readFileSync(file, 'utf8').matchAll(/(['"`])(state changed since load[^'"`\n]*)\1/g),
    ].map((match) => match[2]),
  );

  assert.deepEqual(literals, ['state changed since load']);
});

// 20260729-162616 CR1: `context <id>` used to degrade silently on an
// undecidable type — an empty `Active stages(undefined)=` line, exit 0 — for
// three distinct causes. The contract requires it to abort naming the cause
// instead, exactly like `changeledger check` already does for the config-level
// version of the same defect.
function contextRepo() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  assert.equal(runIn(root, env, 'init').code, 0);
  assert.equal(runIn(root, env, 'new', 'chore', 'x', 'X', '--owner', 'Test').code, 0);
  const item = JSON.parse(runIn(root, env, 'list', '--json').out)[0];
  const changeFile = fs
    .readdirSync(path.join(root, '.changeledger', 'changes'))
    .map((name) => path.join(root, '.changeledger', 'changes', name))
    .find((candidate) => fs.readFileSync(candidate, 'utf8').includes(`id: "${item.id}"`));
  return { root, env, id: item.id, changeFile, original: fs.readFileSync(changeFile, 'utf8') };
}

test('162616 CR1: an unknown type aborts naming it instead of an empty stages line', () => {
  const { root, env, id, changeFile, original } = contextRepo();
  fs.writeFileSync(changeFile, original.replace('type: chore', 'type: bogus'));

  const { code, err, out } = runIn(root, env, 'context', id);
  assert.notEqual(code, 0);
  assert.match(err, /unknown type "bogus"/);
  assert.doesNotMatch(out, /Active stages\(bogus\)=\s*$/m);
});

test('162616 CR1: a missing frontmatter type aborts naming it', () => {
  const { root, env, id, changeFile, original } = contextRepo();
  fs.writeFileSync(changeFile, original.replace(/^type: chore\n/m, ''));

  const { code, err } = runIn(root, env, 'context', id);
  assert.notEqual(code, 0);
  assert.match(err, /missing frontmatter "type"/);
});

test('162616 CR1: a type whose config declares stages as a string aborts naming it', () => {
  const { root, env, id } = contextRepo();
  const configFile = path.join(root, '.changeledger', 'config.yml');
  fs.writeFileSync(
    configFile,
    fs
      .readFileSync(configFile, 'utf8')
      .replace('stages: [request, plan]', 'stages: "request, plan"'),
  );

  const { code, err } = runIn(root, env, 'context', id);
  assert.notEqual(code, 0);
  assert.match(err, /stages must be a list/);
});

test('162616 CR1: a valid type with valid stages produces the same capture as before', () => {
  const { root, env, id } = contextRepo();
  const { code, out } = runIn(root, env, 'context', id);
  assert.equal(code, 0);
  assert.match(out, /Active stages\(chore\)=request, plan/);
});

// 20260729-162616 CR5: `readiness.md` is the only fragment that defines the
// `tdd` obligation, and it is excluded for a type that never activates
// `specification` (chore has no such stage in the default template). The
// policy line must not publish `tdd=` when its definition was never served.
test('162616 CR5: the policy line omits tdd= for a type without specification', () => {
  const { root, env, id } = contextRepo();
  const { code, out } = runIn(root, env, 'context', id);
  assert.equal(code, 0);
  const policyLine = out.split('\n').find((line) => line.startsWith('Effective policy:'));
  assert.doesNotMatch(policyLine, /tdd=/);
});

test('162616 CR5: a type with specification keeps the tdd= line identical to today', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  assert.equal(runIn(root, env, 'init').code, 0);
  assert.equal(runIn(root, env, 'new', 'feature', 'x', 'X', '--owner', 'Test').code, 0);
  const item = JSON.parse(runIn(root, env, 'list', '--json').out)[0];
  const { code, out } = runIn(root, env, 'context', item.id);
  assert.equal(code, 0);
  const policyLine = out.split('\n').find((line) => line.startsWith('Effective policy:'));
  assert.match(policyLine, /tdd=on/);
});

// 124833 CR1: `--have` was retired with the revision segment it served. It is
// rejected as an unknown option and no longer appears in the help text, so a
// caller carrying a stale habit fails loudly instead of being silently ignored.
test('124833 CR1: context rejects --have as an unknown option', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  assert.equal(runIn(root, env, 'init').code, 0);

  const rejected = runIn(root, env, 'context', '--have', 'deadbeefcafe');
  assert.equal(rejected.code, 1);
  assert.match(rejected.err, /error: unknown option '--have'/);

  const help = runIn(root, env, 'context', '--help');
  assert.equal(help.code, 0);
  assert.doesNotMatch(help.out, /--have/);
  assert.doesNotMatch(help.out, /rev:/);
});

test('235628 CR1/CR5/CR7: release CLI initializes, plans JSON and records', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });

  assert.equal(runIn(root, env, 'init').code, 0);
  assert.equal(runIn(root, env, 'release', 'init', '0.1.0').code, 0);
  // Explicit owner: a spawned CLI takes no injected identity resolver.
  assert.equal(runIn(root, env, 'new', 'feature', 'x', 'X', '--owner', 'Roberto Ruiz').code, 0);
  const item = JSON.parse(runIn(root, env, 'list', '--json').out)[0];
  const file = fs
    .readdirSync(path.join(root, '.changeledger', 'changes'))
    .map((name) => path.join(root, '.changeledger', 'changes', name))
    .find((candidate) => fs.readFileSync(candidate, 'utf8').includes(`id: "${item.id}"`));
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('status: draft', 'status: done'));

  const planned = runIn(root, env, 'release', 'plan', '--json');
  assert.equal(planned.code, 0);
  const plan = JSON.parse(planned.out);
  assert.equal(plan.nextVersion, '0.2.0');
  assert.deepEqual(
    plan.changes.map((change) => change.id),
    [item.id],
  );
  assert.equal(runIn(root, env, 'release', 'record', '0.2.0').code, 0);
  assert.equal(fs.existsSync(path.join(root, '.changeledger', 'releases', '0.2.0.yml')), true);
});

test('151226: bin remains directly executable', { skip: process.platform === 'win32' }, () => {
  const { code, out } = runDirect('--help');
  assert.equal(code, 0);
  assert.match(out, /^\s+init\s/m);
});

test('151226: unknown options fail instead of being ignored', () => {
  const { code, err } = run('list', '--bogus');
  assert.notEqual(code, 0);
  assert.match(err, /unknown option '--bogus'/);
});

test('changeledger review --help shows pass and fail routing, exit 0', () => {
  const { code, out } = run('review', '--help');
  assert.equal(code, 0);
  assert.match(out, /pass/);
  assert.match(out, /--retry/);
  assert.match(out, /--block/);
});

// End-to-end: the bin parses `review <id> fail --block "<reason>"` (mode + reason
// extraction) and routes the change to blocked.
test('review wiring: fail --block parses the reason and blocks the change', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });

  assert.equal(runIn(root, env, 'init').code, 0);
  disableChangeBranchFormat(root);
  // Explicit owner: a spawned CLI takes no injected identity resolver.
  assert.equal(runIn(root, env, 'new', 'feature', 'x', 'X', '--owner', 'Roberto Ruiz').code, 0);
  const id = JSON.parse(runIn(root, env, 'list', '--json').out)[0].id;

  // 20260810-213633: approve refuses a feature whose active stages are blank;
  // in-review also needs a test-grade CR and a Plan task naming target and
  // verification (same shape as 124656 CR3's repaired fixture).
  const reviewFile = path.join(
    root,
    '.changeledger',
    'changes',
    fs.readdirSync(path.join(root, '.changeledger', 'changes'))[0],
  );
  fs.writeFileSync(
    reviewFile,
    fs
      .readFileSync(reviewFile, 'utf8')
      .replace('## Request\n', '## Request\n\nR\n')
      .replace('## Investigation\n', '## Investigation\n\nI\n')
      .replace('## Proposal\n', '## Proposal\n\nP\n')
      .replace(
        '## Specification\n',
        '## Specification\n\n### CR1 — Something\n- **Given** a thing\n- **When** it runs\n- **Then** it holds\n',
      )
      .replace(
        '## Plan\n',
        '## Plan\n\n- [ ] do it in `src/x.mjs`\n  - **Target:** `src/x.mjs`\n  - **Verify:** `test/x.test.mjs`\n  - **Criteria:** CR1\n',
      ),
  );

  status(id, 'approved', root);
  for (const s of ['in-progress', 'in-review']) {
    assert.equal(runIn(root, env, 'status', id, s).code, 0);
  }
  assert.equal(runIn(root, env, 'review', id, 'fail', '--block', 'spec is ambiguous').code, 0);

  const shown = JSON.parse(runIn(root, env, 'show', id, '--json').out);
  assert.equal(shown.frontmatter.status, 'blocked');
  assert.match(
    shown.stages.find((s) => s.key === 'log').body,
    /review → blocked: spec is ambiguous/,
  );
});

// 20260628-113218: --version / -V expose the installed package version
const pkgVersion = JSON.parse(
  fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'),
    'utf8',
  ),
).version;

test('113218 CR1: --version prints package version and exits 0', () => {
  const { code, out } = run('--version');
  assert.equal(code, 0);
  assert.equal(out, `${pkgVersion}\n`);
});

test('113218 CR2: -V produces identical output to --version', () => {
  const { code: code1, out: out1 } = run('--version');
  const { code: code2, out: out2 } = run('-V');
  assert.equal(code1, 0);
  assert.equal(code2, 0);
  assert.equal(out1, out2);
});

test('113218 CR2: -v produces identical output to --version', () => {
  const { code: code1, out: out1 } = run('--version');
  const { code: code2, out: out2 } = run('-v');
  assert.equal(code1, 0);
  assert.equal(code2, 0);
  assert.equal(out1, out2);
});

test('113218 CR3: version comes from package.json, not a hardcoded literal', () => {
  const { out } = run('--version');
  assert.equal(out, `${pkgVersion}\n`, 'version must match package.json at runtime');
});

test('113218 CR4: --help lists version flags', () => {
  const { code, out } = run('--help');
  assert.equal(code, 0);
  assert.match(out, /-v.*--version/);
  assert.match(out, /-V/);
});

// 20260924-184354 CR1 — the real bin process (not a unit-level injected
// version) declares its own installed package version as the repo's minimum.
test('184354 CLI CR1: init declares min_cli_version as the real installed version; check exits 0', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });

  assert.equal(runIn(root, env, 'init').code, 0);
  const configText = fs.readFileSync(path.join(root, '.changeledger', 'config.yml'), 'utf8');
  assert.match(configText, /^schema_version: 6$/m);
  assert.match(
    configText,
    new RegExp(`^min_cli_version: ${pkgVersion.replace(/\./g, '\\.')}$`, 'm'),
  );

  const checked = runIn(root, env, 'check');
  assert.equal(checked.code, 0, checked.err);
});

// 20260924-184354 CR2 — the real bin process declares its own installed
// package version when migrating an older repo, not a unit-injected one.
test('184354 CLI CR2: config migrate declares min_cli_version as the real installed version', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  assert.equal(runIn(root, env, 'init').code, 0);

  const configFile = path.join(root, '.changeledger', 'config.yml');
  const downgraded = fs
    .readFileSync(configFile, 'utf8')
    .replace(/^schema_version: 6$/m, 'schema_version: 5')
    .replace(/\n# Minimum ChangeLedger CLI version[\s\S]*?\nmin_cli_version: .*\n/, '\n');
  fs.writeFileSync(configFile, downgraded);

  const { code, out } = runIn(root, env, 'config', 'migrate');
  assert.equal(code, 0);
  assert.match(out, /^Config migration 5 → 6$/m);
  assert.match(out, new RegExp(`added min_cli_version: ${pkgVersion.replace(/\./g, '\\.')}$`, 'm'));
  const migrated = fs.readFileSync(configFile, 'utf8');
  assert.match(migrated, new RegExp(`^min_cli_version: ${pkgVersion.replace(/\./g, '\\.')}$`, 'm'));
});

const belowMinimum = (required) =>
  `ChangeLedger CLI ${pkgVersion} is below this repository's minimum ${required}; update the global installation.`;

function setMinCliVersion(configFile, value) {
  const text = fs.readFileSync(configFile, 'utf8');
  assert.match(text, /^min_cli_version: .*$/m);
  fs.writeFileSync(
    configFile,
    value === undefined
      ? text.replace(/^min_cli_version: .*\n/m, '')
      : text.replace(/^min_cli_version: .*$/m, `min_cli_version: ${value}`),
  );
}

function fixtureGit(root, args) {
  return execFileSync('git', args, { cwd: root, env: sanitizedEnv(), encoding: 'utf8' });
}

// A committed schema-6 git repo holding one `approved` change that
// `status <id> in-progress` can really start, so a guard failure is the only
// thing standing between the command and its writes.
function approvedGitRepo() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  assert.equal(runIn(root, env, 'init').code, 0);
  disableChangeBranchFormat(root);
  assert.equal(runIn(root, env, 'new', 'quick', 'x', 'X', '--owner', 'Roberto Ruiz').code, 0);
  const id = JSON.parse(runIn(root, env, 'list', '--json').out)[0].id;
  const changesDir = path.join(root, '.changeledger', 'changes');
  const changeFile = path.join(changesDir, fs.readdirSync(changesDir)[0]);
  fs.writeFileSync(
    changeFile,
    fs.readFileSync(changeFile, 'utf8').replace('status: draft', 'status: approved'),
  );
  initGitFixture(root);
  fixtureGit(root, ['config', 'commit.gpgsign', 'false']);
  fixtureGit(root, ['add', '-A']);
  fixtureGit(root, ['commit', '-q', '-m', 'chore: seed']);
  return { root, env, id, changeFile, configFile: path.join(root, '.changeledger', 'config.yml') };
}

// Every worktree byte, every ref (state and activation refs included) and every
// git lock file: what "no files, locks or refs change" is measured against.
function repoSnapshot(root) {
  const files = {};
  const locks = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full);
      if (entry.isDirectory()) walk(full);
      else if (rel.split(path.sep)[0] === '.git') {
        if (entry.name.endsWith('.lock')) locks.push(rel);
      } else files[rel] = fs.readFileSync(full, 'utf8');
    }
  };
  walk(root);
  const refs = fixtureGit(root, ['for-each-ref', '--format=%(objectname) %(refname)']);
  return { files, locks, refs };
}

test('184354 CR3: context and status stop below the minimum before any file, lock or ref changes', () => {
  const { root, env, id, configFile } = approvedGitRepo();
  setMinCliVersion(configFile, '99.0.0');
  for (const args of [['status', id, 'in-progress'], ['context']]) {
    const before = repoSnapshot(root);
    const result = runIn(root, env, ...args);
    assert.deepEqual(repoSnapshot(root), before, args.join(' '));
    assert.notEqual(result.code, 0, args.join(' '));
    assert.ok(result.err.includes(belowMinimum('99.0.0')), `${args.join(' ')}: ${result.err}`);
    assert.equal(result.out, '', args.join(' '));
  }
});

test('184354 CR5: status fails closed on an absent or invalid min_cli_version; version and help stay available', () => {
  for (const [value, named] of [
    ['latest', '"latest"'],
    [undefined, 'missing'],
  ]) {
    const { root, env, id, configFile } = approvedGitRepo();
    setMinCliVersion(configFile, value);
    const before = repoSnapshot(root);

    for (const args of [['status', id, 'in-progress'], ['check']]) {
      const result = runIn(root, env, ...args);
      assert.notEqual(result.code, 0, args.join(' '));
      assert.match(result.err, /min_cli_version/, args.join(' '));
      assert.ok(result.err.includes(named), `${args.join(' ')}: ${result.err}`);
    }
    assert.deepEqual(repoSnapshot(root), before);

    assert.deepEqual(runIn(root, env, '--version'), { code: 0, out: `${pkgVersion}\n`, err: '' });
    const help = runIn(root, env, 'help');
    assert.equal(help.code, 0, help.err);
    assert.match(help.out, /Usage: changeledger/);
  }
});

// Activated: the ledger and its config live in the state ref; the worktree
// keeps only the discovery marker, which here declares a satisfiable minimum.
function activatedApprovedRepo() {
  const { root, env, id, changeFile, configFile } = approvedGitRepo();
  const authority = fs
    .readFileSync(configFile, 'utf8')
    .replace(/^min_cli_version: .*$/m, 'min_cli_version: 99.0.0');
  const tree = buildTree(root, {
    '.changeledger-state/manifest.yml': 'format_version: 1\nproject_id: demo\n',
    '.changeledger-state/config.yml': authority,
    [`.changeledger-state/changes/${path.basename(changeFile)}`]: fs.readFileSync(
      changeFile,
      'utf8',
    ),
  });
  updateRef(root, STATE_REF, commitTree(root, tree, { message: 'chore: state' }));
  writeActivation(root, { stateRef: STATE_REF });
  fs.rmSync(changeFile);
  return { root, env, id, configFile };
}

test('184354 CR6: the activated state ref is the minimum authority; the worktree marker cannot bypass it', () => {
  const { root, env, id, configFile } = activatedApprovedRepo();
  const initialized = fs.readFileSync(configFile, 'utf8');
  for (const marker of [
    initialized.replace(/^min_cli_version: .*$/m, 'min_cli_version: 0.16.1'),
    initialized.replace(/^min_cli_version: .*$/m, 'min_cli_version: 0.1.0'),
    'schema_version: 5\n',
  ]) {
    fs.writeFileSync(configFile, marker);
    const before = repoSnapshot(root);
    for (const args of [['status', id, 'in-progress'], ['context']]) {
      const result = runIn(root, env, ...args);
      assert.notEqual(result.code, 0, args.join(' '));
      assert.ok(result.err.includes(belowMinimum('99.0.0')), `${args.join(' ')}: ${result.err}`);
    }
    assert.deepEqual(repoSnapshot(root), before);
  }
});

test('184354 CR8: a newer CLI works without editing the repo until the minimum rises', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  assert.equal(runIn(root, env, 'init').code, 0);
  const configFile = path.join(root, '.changeledger', 'config.yml');
  setMinCliVersion(configFile, '0.1.0');
  const declared = fs.readFileSync(configFile, 'utf8');

  const context = runIn(root, env, 'context');
  assert.equal(context.code, 0, context.err);
  assert.match(context.out, /^===== CHANGELEDGER CONTEXT BEGIN/);
  const checked = runIn(root, env, 'check');
  assert.equal(checked.code, 0, checked.err);
  assert.equal(fs.readFileSync(configFile, 'utf8'), declared);

  setMinCliVersion(configFile, '99.0.0');
  for (const args of [['context'], ['check']]) {
    const result = runIn(root, env, ...args);
    assert.notEqual(result.code, 0, args.join(' '));
    assert.ok(result.err.includes(belowMinimum('99.0.0')), `${args.join(' ')}: ${result.err}`);
  }
});

// Each help entry, joined across its wrapped continuation lines.
function helpEntries(help, heading) {
  const lines = help.split('\n');
  const start = lines.indexOf(`${heading}:`);
  if (start === -1) return [];
  const entries = [];
  for (const line of lines.slice(start + 1)) {
    if (line === '') break;
    if (/^ {2}\S/.test(line)) entries.push(line.trim());
    else entries[entries.length - 1] += ` ${line.trim()}`;
  }
  return entries;
}

// The arguments a command's own help declares obligatory: every `<required>`
// operand of its Usage line (its first declared choice when closed, otherwise a
// placeholder) and every option whose help says "(required)".
function requiredArgumentsFromHelp(command, help) {
  const usage = help.match(/^Usage: changeledger (.*)$/m)[1].slice(command.join(' ').length);
  const choices = new Map(
    helpEntries(help, 'Arguments').map((entry) => [
      entry.split(/\s/)[0],
      entry.match(/\(choices: "([^"]+)"/)?.[1],
    ]),
  );
  const operands = [...usage.matchAll(/<([^>.]+)(?:\.\.\.)?>/g)].map(
    ([, name]) => choices.get(name) ?? '1',
  );
  const options = helpEntries(help, 'Options')
    .filter((entry) => entry.includes('(required)'))
    .flatMap((entry) => [entry.match(/--[\w-]+/)[0], '1']);
  return [...operands, ...options];
}

// The guard's exemption list, closed: help and version never reach an action;
// `init` and `view` keep their own behavior; `config migrate` only as a preview.
const GUARD_EXEMPT_COMMANDS = new Set(['init', 'view']);

test('184354 CR9: only help, version, config migrate --dry-run, init and view bypass the guard', () => {
  const { root, env, configFile } = approvedGitRepo();
  setMinCliVersion(configFile, '99.0.0');
  const before = repoSnapshot(root);
  const inRepo = (...args) => runIn(root, env, ...args);

  for (const flag of ['--version', '-v', '-V']) {
    assert.deepEqual(inRepo(flag), { code: 0, out: `${pkgVersion}\n`, err: '' }, flag);
  }
  for (const args of [['help'], ['help', 'status'], ['config', 'help', 'migrate']]) {
    const result = inRepo(...args);
    assert.equal(result.code, 0, `${args.join(' ')}: ${result.err}`);
  }
  const dryRun = inRepo('config', 'migrate', '--dry-run');
  assert.equal(dryRun.code, 0, dryRun.err);

  const initAgain = inRepo('init');
  assert.notEqual(initAgain.code, 0);
  assert.ok(
    initAgain.err.includes(
      '.changeledger/ already exists. Use `changeledger register` to refresh this repo.',
    ),
    initAgain.err,
  );
  // `view` would serve; an unknown operand exercises its own action instead.
  const view = inRepo('view', 'bogus');
  assert.notEqual(view.code, 0);
  assert.match(view.err, /bogus/);
  assert.doesNotMatch(`${initAgain.err}${view.err}`, /is below this repository's minimum/);

  const commandHelp = registeredCommandHelp(inRepo);
  const guarded = [];
  for (const { command, code, out } of commandHelp) {
    assert.equal(code, 0, `${command.join(' ')} -h must bypass the guard`);
    if (registeredChildCommands(out).length > 0) continue;
    if (GUARD_EXEMPT_COMMANDS.has(command.join(' '))) continue;
    const args = [...command, ...requiredArgumentsFromHelp(command, out)];
    const result = inRepo(...args);
    assert.notEqual(result.code, 0, args.join(' '));
    assert.ok(result.err.includes(belowMinimum('99.0.0')), `${args.join(' ')}: ${result.err}`);
    guarded.push(command.join(' '));
  }
  for (const expected of [
    'context',
    'status',
    'check',
    'import',
    'config migrate',
    'release init',
  ]) {
    assert.ok(guarded.includes(expected), `${expected} must be among the guarded commands`);
  }
  assert.deepEqual(repoSnapshot(root), before);
});

// 20260628-113219: config migrate CLI integration
test('113219 CLI CR3: config migrate --dry-run shows candidate and exits 0 without writing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  assert.equal(runIn(root, env, 'init').code, 0);

  // Downgrade to schema 0 by removing schema_version
  const configFile = path.join(root, '.changeledger', 'config.yml');
  const original = fs.readFileSync(configFile, 'utf8').replace(/^schema_version: \d+\n/m, '');
  fs.writeFileSync(configFile, original);
  const before = fs.readFileSync(configFile, 'utf8');

  const { code, out } = runIn(root, env, 'config', 'migrate', '--dry-run');
  assert.equal(code, 0);
  assert.match(out, /Config migration 0 → 6 \(dry run\)/);
  assert.match(out, /schema_version: 6/);
  assert.match(out, /change_branch_format: "\{type\}\/\{id\}"/);
  assert.equal(fs.readFileSync(configFile, 'utf8'), before, 'dry-run must not modify file');
});

test('113219 CLI CR7: config migrate is idempotent', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  assert.equal(runIn(root, env, 'init').code, 0);

  // Already at the current schema — should be no-op
  const { code, out } = runIn(root, env, 'config', 'migrate');
  assert.equal(code, 0);
  assert.match(out, /already at schema/i);
});

test('113219 CLI CR8: config migrate on invalid YAML exits 1', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  assert.equal(runIn(root, env, 'init').code, 0);

  const configFile = path.join(root, '.changeledger', 'config.yml');
  fs.writeFileSync(configFile, 'statuses: [\n  broken yaml');

  const { code, err } = runIn(root, env, 'config', 'migrate');
  assert.equal(code, 1);
  assert.match(err, /Error:/);
});

test('234920 CR1: active CLI dry-run previews the ref and leaves ref, snapshot, and marker byte-identical', () => {
  const { root, env, configFile, marker, authority, revision } = activatedMigrationCliRepo();
  const expected = buildMigration(authority);

  const { code, out, err } = runIn(root, env, 'config', 'migrate', '--dry-run');

  assert.equal(code, 0, err);
  assert.match(out, /^Config migration 1 → 6 \(dry run\)$/m);
  assert.ok(out.includes(expected.yaml));
  assert.equal(
    execFileSync('git', ['rev-parse', STATE_REF], {
      cwd: root,
      env: sanitizedEnv(),
      encoding: 'utf8',
    }).trim(),
    revision,
  );
  assert.equal(cliStateConfig(root), authority);
  assert.equal(fs.readFileSync(configFile, 'utf8'), marker);
});

test('234920 CR2: active CLI apply publishes one config migration commit and preserves other state and marker bytes', () => {
  const marker = 'schema_version: 6\nproject_name: divergent marker\n';
  const { root, env, configFile, authority, revision } = activatedMigrationCliRepo({ marker });
  const expected = buildMigration(authority).yaml;

  const { code, out, err } = runIn(root, env, 'config', 'migrate');

  assert.equal(code, 0, err);
  assert.match(out, /^Config migration 1 → 6$/m);
  const tip = execFileSync('git', ['rev-parse', STATE_REF], {
    cwd: root,
    env: sanitizedEnv(),
    encoding: 'utf8',
  }).trim();
  assert.notEqual(tip, revision);
  assert.equal(
    execFileSync('git', ['rev-parse', `${tip}^`], {
      cwd: root,
      env: sanitizedEnv(),
      encoding: 'utf8',
    }).trim(),
    revision,
  );
  assert.equal(
    execFileSync('git', ['log', '-1', '--format=%s', tip], {
      cwd: root,
      env: sanitizedEnv(),
      encoding: 'utf8',
    }).trim(),
    'config: migrate',
  );
  assert.equal(cliStateConfig(root, tip), expected);
  assert.equal(
    execFileSync('git', ['cat-file', 'blob', `${tip}:.changeledger-state/specs/keep.md`], {
      cwd: root,
      env: sanitizedEnv(),
      encoding: 'utf8',
    }),
    '# Keep\n',
  );
  assert.equal(fs.readFileSync(configFile, 'utf8'), marker);
});

test('234920 CR3: active CLI fails closed on an absent ref and an invalid state layout', () => {
  const current = 'schema_version: 6\n';

  const absent = activatedMigrationCliRepo({ marker: current });
  execFileSync('git', ['update-ref', '-d', STATE_REF], { cwd: absent.root, env: sanitizedEnv() });
  const absentResult = runIn(absent.root, absent.env, 'config', 'migrate', '--dry-run');
  assert.equal(absentResult.code, 1);
  assert.match(absentResult.err, /state is not initialized/);
  assert.equal(fs.readFileSync(absent.configFile, 'utf8'), current);

  const invalid = activatedMigrationCliRepo({ marker: current });
  const badTree = buildTree(invalid.root, {
    '.changeledger-state/manifest.yml': 'format_version: 1\nproject_id: demo\n',
    '.changeledger-state/config.yml': invalid.authority,
    '.changeledger-state/foreign.txt': 'forbidden\n',
  });
  const badRevision = commitTree(invalid.root, badTree, {
    parents: [invalid.revision],
    message: 'chore: invalid layout',
  });
  updateRef(invalid.root, STATE_REF, badRevision, invalid.revision);
  const invalidResult = runIn(invalid.root, invalid.env, 'config', 'migrate');
  assert.equal(invalidResult.code, 1);
  assert.match(invalidResult.err, /invalid state path: \.changeledger-state\/foreign\.txt/);
  assert.equal(
    execFileSync('git', ['rev-parse', STATE_REF], {
      cwd: invalid.root,
      env: sanitizedEnv(),
      encoding: 'utf8',
    }).trim(),
    badRevision,
  );
  assert.equal(fs.readFileSync(invalid.configFile, 'utf8'), current);
});

// End-to-end: `changeledger graduate <id> <slug> --into` links an existing spec (flag in
// any position) without touching its body, exit 0.
test('CR6: graduate --into wires through and links an existing spec', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });

  assert.equal(runIn(root, env, 'init').code, 0);
  disableChangeBranchFormat(root);
  // Explicit owner: a spawned CLI takes no injected identity resolver.
  assert.equal(runIn(root, env, 'new', 'chore', 'x', 'X', '--owner', 'Roberto Ruiz').code, 0);
  const id = JSON.parse(runIn(root, env, 'list', '--json').out)[0].id;
  // 20260810-213633: approve refuses a chore whose active stages (request,
  // plan) are blank — back-fill both minimally.
  const graduateFile = path.join(
    root,
    '.changeledger',
    'changes',
    fs.readdirSync(path.join(root, '.changeledger', 'changes'))[0],
  );
  fs.writeFileSync(
    graduateFile,
    fs
      .readFileSync(graduateFile, 'utf8')
      .replace('## Request\n', '## Request\n\nR\n')
      .replace('## Plan\n', '## Plan\n\n- [ ] do it\n  - **Support:**\n'),
  );
  // chore: no review gate, but human validation is still required.
  status(id, 'approved', root);
  for (const s of ['in-progress', 'in-validation']) {
    assert.equal(runIn(root, env, 'status', id, s).code, 0);
  }
  task(id, 'done', 1, '', root);
  validation(id, 'pass', {}, root);

  const specFile = path.join(root, '.changeledger', 'specs', 'architecture.md');
  fs.mkdirSync(path.dirname(specFile), { recursive: true });
  fs.writeFileSync(
    specFile,
    '---\ntitle: Arch\nupdated: 2020-01-01T00:00:00Z\ntags: [architecture]\n---\n\n# Arch\n\nBody kept.\n',
  );

  const res = runIn(root, env, 'graduate', id, 'architecture', '--into');
  assert.equal(res.code, 0);
  const after = fs.readFileSync(specFile, 'utf8');
  assert.match(after, /Body kept\./);
  assert.doesNotMatch(after, /2020-01-01T00:00:00Z/);
});

// --- 20260728-151336 CR4: `changeledger commit --no-change <reason>` ---
//
// A real git repo is required here (unlike the rest of this file, which only
// exercises the ChangeLedger ledger): the CLI must actually create a git
// commit and `check --commits` must lint it. Strip the outer repo's
// GIT_DIR/GIT_WORK_TREE/etc so a run inside this repo's own pre-commit hook
// cannot redirect these git calls onto the outer repo.
const NO_CHANGE_GIT_ENV = sanitizedEnv();
function noChangeGit(root, args) {
  return execFileSync('git', args, { cwd: root, env: NO_CHANGE_GIT_ENV, encoding: 'utf8' });
}

// A git + ChangeLedger repo with one seed commit, branched as `base` so
// `check --commits base` has something to diff against.
function noChangeRepo() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  initGitFixture(root);
  noChangeGit(root, ['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  assert.equal(runIn(root, env, 'init').code, 0);
  noChangeGit(root, ['add', '-A']);
  noChangeGit(root, ['commit', '-m', 'chore(init): seed']);
  noChangeGit(root, ['branch', 'base']);
  return { root, env };
}

// A plain commit through the bin, with neither --no-change nor --id: proves
// commander's `--no-` negate default (`options.change === true` when the flag
// is absent) is correctly treated as "not passed", not as a truthy reason.
test('151336 CR4: a plain commit with no --no-change and no --id still succeeds', () => {
  const { root, env } = noChangeRepo();
  fs.writeFileSync(path.join(root, 'plain.txt'), 'x\n');
  noChangeGit(root, ['add', 'plain.txt']);

  const committed = runIn(root, env, 'commit', '-m', 'chore(x): plain', '--id', '20260711-000001');
  assert.equal(committed.code, 0, committed.err);
  assert.equal(
    noChangeGit(root, ['log', '-1', '--pretty=%s']).trim(),
    'chore(x): plain [#20260711-000001]',
  );
});

test('151336 CR4: commit -h documents --no-change', () => {
  const { code, out } = run('commit', '-h');
  assert.equal(code, 0);
  assert.match(out, /--no-change <reason>/);
});

test('151336 CR4: --no-change composes a marker-less commit that check --commits accepts', () => {
  const { root, env } = noChangeRepo();
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'workflow-hardening.md'), 'notes\n');
  noChangeGit(root, ['add', 'docs/workflow-hardening.md']);

  const committed = runIn(
    root,
    env,
    'commit',
    '-m',
    'docs(workflow): record the sieve',
    '--no-change',
    'acta de análisis, ningún change la cubre',
  );
  assert.equal(committed.code, 0);
  assert.equal(
    noChangeGit(root, ['log', '-1', '--pretty=%s']).trim(),
    'docs(workflow): record the sieve',
  );
  assert.equal(
    noChangeGit(root, ['log', '-1', '--pretty=%b']).trim(),
    'ChangeLedger: none — acta de análisis, ningún change la cubre',
  );

  const checked = runIn(root, env, 'check', '--commits', 'base');
  assert.equal(checked.code, 0);
});

test('151336 CR4: --no-change and --id are mutually exclusive and create no commit', () => {
  const { root, env } = noChangeRepo();
  fs.writeFileSync(path.join(root, 'docs-note.md'), 'x\n');
  noChangeGit(root, ['add', 'docs-note.md']);
  const before = noChangeGit(root, ['rev-list', '--count', 'HEAD']).trim();

  const conflict = runIn(
    root,
    env,
    'commit',
    '-m',
    'docs(x): y',
    '--no-change',
    'reason',
    '--id',
    '20260711-000001',
  );
  assert.equal(conflict.code, 1);
  assert.match(conflict.err, /--no-change/);
  assert.match(conflict.err, /--id/);
  assert.equal(noChangeGit(root, ['rev-list', '--count', 'HEAD']).trim(), before);
});

test('20260808-141944 CR6: status warns on stderr when the checkout differs from the registered branch', () => {
  const { root, env } = noChangeRepo();
  disableChangeBranchFormat(root);
  assert.equal(runIn(root, env, 'new', 'feature', 'x', 'X', '--owner', 'Roberto Ruiz').code, 0);
  const id = JSON.parse(runIn(root, env, 'list', '--json').out)[0].id;
  const changeFile = fs
    .readdirSync(path.join(root, '.changeledger', 'changes'))
    .map((name) => path.join(root, '.changeledger', 'changes', name))
    .find((candidate) => fs.readFileSync(candidate, 'utf8').includes(`id: "${id}"`));
  // A minimal ready candidate (same shape as 124656 CR3's repaired fixture):
  // the in-review readiness gate requires a testable CR and a Plan task that
  // names both target and verification.
  const ready = fs
    .readFileSync(changeFile, 'utf8')
    .replace('## Request\n', '## Request\n\nR\n')
    .replace('## Investigation\n', '## Investigation\n\nI\n')
    .replace('## Proposal\n', '## Proposal\n\nP\n')
    .replace(
      '## Specification\n',
      '## Specification\n\n### CR1 — Something\n- **Given** a thing\n- **When** it runs\n- **Then** it holds\n',
    )
    .replace(
      '## Plan\n',
      '## Plan\n\n- [ ] do it in `src/x.mjs`\n  - **Target:** `src/x.mjs`\n  - **Verify:** `test/x.test.mjs`\n  - **Criteria:** CR1\n',
    );
  fs.writeFileSync(changeFile, ready);
  noChangeGit(root, ['add', '-A']);
  noChangeGit(root, ['commit', '-m', 'chore(x): ready candidate']);
  assert.equal(runIn(root, env, 'approve', id).code, 0);
  assert.equal(runIn(root, env, 'status', id, 'in-progress').code, 0);
  assert.equal(runIn(root, env, 'branch', id, 'feature/x').code, 0);
  noChangeGit(root, ['checkout', '-q', '-b', 'other-branch']);

  // execFileSync discards stderr on a successful (exit 0) run, and this
  // transition succeeds — spawnSync captures both streams regardless of exit
  // code, which is what CR6 needs to assert.
  const result = spawnSync('node', [bin, 'status', id, 'in-review'], {
    cwd: root,
    env,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, new RegExp(`#${id} → in-review`));
  assert.match(result.stderr, /feature\/x/);
  assert.match(result.stderr, /changeledger branch/);
});

// 20260808-151643 CR2 — the bin presents a CAS conflict as an actionable,
// non-zero-exit error, never the store's own "state ref moved" wording.
// Two real subprocesses mutate the same activated snapshot at once: which one
// wins the race is not deterministic, but that exactly one wins and the other
// gets this exact message and no partial write is guaranteed by the CAS
// itself, not by timing — spawning both together (no artificial delay) gives
// them every chance to overlap in practice.
test('CR2: two concurrent CLI writes — exactly one succeeds, the loser gets the actionable message', async () => {
  const { root, env } = activatedCliRepo();
  const spawnAsync = (args) =>
    new Promise((resolve) => {
      const child = spawn('node', [bin, ...args], { cwd: root, env });
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('close', (code) => resolve({ code, stderr }));
    });

  const [a, b] = await Promise.all([
    spawnAsync(['log', 'only-ref', 'note A']),
    spawnAsync(['log', 'only-ref', 'note B']),
  ]);

  const outcomes = [a, b];
  const succeeded = outcomes.filter((o) => o.code === 0);
  const failed = outcomes.filter((o) => o.code !== 0);
  assert.equal(succeeded.length, 1, JSON.stringify(outcomes));
  assert.equal(failed.length, 1, JSON.stringify(outcomes));
  assert.equal(failed[0].code, 1);
  assert.match(failed[0].stderr, /state changed since load — re-run the command/);
  assert.doesNotMatch(failed[0].stderr, /state ref moved/);

  // No partial write: the surviving snapshot has exactly one of the two
  // notes, never both, never neither.
  const listed = runIn(root, env, 'show', 'only-ref', '--json').out;
  const noteACount = (listed.match(/note A/g) ?? []).length;
  const noteBCount = (listed.match(/note B/g) ?? []).length;
  assert.equal(noteACount + noteBCount, 1);
});
