import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { status, task } from '../src/commands/agent.mjs';
import { buildMigration } from '../src/config-migration.mjs';
import { LOG_EVENT_DEFINITIONS } from '../src/lifecycle.mjs';
import { STATE_REF, writeActivation } from '../src/state-store.mjs';
import { assertWithinBudget, contextBudgets } from './budget-support.mjs';
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
  assert.equal(runIn(root, env, 'new', 'change', 'x', 'X', '--owner', 'Roberto Ruiz').code, 0);
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
    `---\nid: "${id}"\ntitle: ${title}\ntype: change\nstatus: draft\ncreated: 2026-08-08T00:00:00Z\ndepends_on: []\n---\n\n## Request\n\nHi.\n`;

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
    stateConfig ?? initialized.replace(/^schema_version: \d+$/m, 'schema_version: 6');
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

test('20260824-134716 CR2: static CLI domains are complete in help and invalid-value errors', () => {
  for (const [command, values] of [
    ['agent-prompt', 'review'],
    ['agent-context', 'review'],
    ['review', 'pass|fail'],
    ['task', 'done|block'],
  ]) {
    // Commander wraps a long argument description, so the help is read flattened.
    const help = run(command, '--help').out.replace(/\s+/g, ' ');
    assert.match(help, new RegExp(values.replace(/[|]/g, '\\|')));
  }
  const invalid = run('task', 'an-id', 'guess', '1');
  assert.notEqual(invalid.code, 0);
  assert.match(invalid.err, /Allowed choices are done, block/);
  const release = run('release', '--help').out;
  assert.match(release, /release impacts: none, patch, minor, major/);
  assert.match(release, /branch format placeholders: \{type\}, \{id\}/);
});

test('20261018-131621 CR18: init hands out the six statuses and check never names a retired one', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  assert.equal(runIn(root, env, 'init').code, 0);
  const config = parseYaml(fs.readFileSync(path.join(root, '.changeledger', 'config.yml'), 'utf8'));
  assert.deepEqual(config.statuses, [
    'draft',
    'approved',
    'in-progress',
    'in-review',
    'done',
    'discarded',
  ]);
  const check = runIn(root, env, 'check');
  assert.doesNotMatch(check.out + check.err, /in-validation|blocked/);
});

test('20260824-134716 CR5: fix help names exact default repairs and no migration mode', () => {
  const out = run('fix', '--help').out;
  assert.match(
    out,
    /default repairs: checkbox markers \[ x \]\/\[X\], legacy hyphen separators, near-ISO UTC timestamps/,
  );
  assert.doesNotMatch(out, /--graduation-links|--structured-sections|--plan-tags|migration modes/);
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
    'changeledger review',
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

test('20261019-184719 CR4: log help names every live writer of the validation acceptance arm', () => {
  const { out } = run('log', '--help');
  const block = out.match(/^ {2}validation\n((?: {4}.*\n)+)/m);
  assert.ok(block, 'log help should list the validation type');
  const writers = block[1].split('Written by:')[1];
  // Derived from the source, not listed here: the help was falsified once by a
  // change that added a second seat for the acceptance arm without touching
  // this list, so the test asks the code who writes it.
  const dir = new URL('../src/commands/', import.meta.url);
  const seats = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.mjs'))
    .filter((name) => /outcome:\s*'accepted'/.test(fs.readFileSync(new URL(name, dir), 'utf8')))
    .map((name) => name.replace(/\.mjs$/, ''));
  assert.ok(seats.length > 0, 'the acceptance arm must have at least one command seat');
  for (const seat of seats) {
    assert.match(writers, new RegExp(`changeledger ${seat}\\b`), `unnamed writer: ${seat}`);
  }
  // A "no command" claim is only true of the retired in-validation arm.
  for (const line of writers.split('\n').filter((l) => /no command/i.test(l))) {
    assert.match(line, /in-validation/);
  }
});

test('125139 CR1/CR6: approve is the human decision the CLI transmits', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-agent-cli-'));
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  assert.equal(runIn(root, env, 'init').code, 0);
  disableChangeBranchFormat(root);
  // Explicit owner: a spawned CLI takes no injected identity resolver.
  // An epic: its short cycle reaches `done` without a review or a branch.
  assert.equal(runIn(root, env, 'new', 'epic', 'x', 'X', '--owner', 'Roberto Ruiz').code, 0);
  const id = JSON.parse(runIn(root, env, 'list', '--json').out)[0].id;
  // approve requires an objective and a frontier (20261023-181753).
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
      .replace('### Objective\n', '### Objective\n\nO\n')
      .replace('### Frontier\n', '### Frontier\n\nF\n'),
  );
  assert.equal(runIn(root, env, 'status', id, 'approved').code, 1);
  assert.equal(runIn(root, env, 'approve', id).code, 0);
  assert.match(runIn(root, env, 'show', id, '--json').out, /human via conversation/);
  assert.equal(runIn(root, env, 'status', id, 'in-progress').code, 0);
  assert.equal(runIn(root, env, 'status', id, 'done').code, 0);
  assert.equal(JSON.parse(runIn(root, env, 'show', id, '--json').out).frontmatter.status, 'done');
});

test('125139 CR4/CR6/CR8: decision commands fail closed and explain human authority', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-decision-cli-'));
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  assert.equal(runIn(root, env, 'init').code, 0);
  // Explicit owner: a spawned CLI takes no injected identity resolver.
  assert.equal(runIn(root, env, 'new', 'change', 'x', 'X', '--owner', 'Roberto Ruiz').code, 0);
  const id = JSON.parse(runIn(root, env, 'list', '--json').out)[0].id;
  const file = path.join(
    root,
    '.changeledger',
    'changes',
    fs.readdirSync(path.join(root, '.changeledger', 'changes'))[0],
  );

  const draft = fs.readFileSync(file, 'utf8');
  assert.equal(runIn(root, env, 'status', id, 'approved').code, 1);
  assert.equal(runIn(root, env, 'status', id, 'done').code, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), draft);

  const help = run('approve', '--help');
  assert.equal(help.code, 0);
  assert.match(help.out, /explicit human|human decision/i);
  assert.match(help.out, /conversation/i);
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
  assert.match(out, /change or epic/);
  assert.match(out, /English/i);
});

test('225212 CR3: changeledger status -h documents status domain and terminal moves', () => {
  const { code, out } = run('status', '-h');
  assert.equal(code, 0);
  assert.match(out, /\.changeledger\/config\.yml/);
  assert.match(out, /changeledger discard/);
  assert.match(out, /changeledger approve/);
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
  assert.equal(runIn(root, env, 'new', 'change', 'x', 'X', '--owner', 'Roberto Ruiz').code, 0);
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
  assert.equal(runIn(root, env, 'new', 'change', 'x', 'X', '--owner', 'Roberto Ruiz').code, 0);
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
  // `new` now scaffolds a Log for a chore too (the version stamp lives there),
  // so the graduation event joins that last section instead of opening a second.
  const candidate = `${fs
    .readFileSync(changeFile, 'utf8')
    .replace('status: done', 'status: done\nreviewed: true')
    .trimEnd()}\n- **2026-07-18T12:00:00Z** \`[graduation]\` skipped: no durable truth\n`;
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

// `--from` owns every field of the document it carries, so a flag that would
// contradict it is refused, never dropped. `--parent` used to vanish — and
// since `--from` is the ONLY way to create a change in an activated repo,
// that silent drop was the main path (20261020-172221 D2 of round 5).
test('20261020-172221 CR7: --parent is refused with --from, like --owner, never dropped', () => {
  const { root, env } = doneRepo();
  const draft = path.join(root, 'draft.md');
  fs.writeFileSync(
    draft,
    runIn(root, env, 'new', 'change', 'hijo', 'Hijo', '--print', '--owner', 'Roberto Ruiz').out,
  );

  const refused = runIn(
    root,
    env,
    'new',
    'change',
    'hijo',
    'Hijo',
    '--from',
    draft,
    '--parent',
    '20260613-110000',
  );
  assert.equal(refused.code, 1);
  assert.match(refused.err, /declares its own parent; drop --parent/);
  assert.ok(
    !fs.readdirSync(path.join(root, '.changeledger', 'changes')).some((n) => n.includes('hijo')),
    'a refused creation writes nothing',
  );

  // The flag is only refused next to `--from`; it still works on its own seat.
  assert.equal(runIn(root, env, 'new', 'change', 'hijo', 'Hijo', '--from', draft).code, 0);
});

// The bulk seat deletes no branches, so `--keep-branch` there is a promise it
// never made. `--owner`/`--unowned` were already refused out of scope; this one
// was silently ignored, and the help attached to the whole command read as if
// both seats pruned (20261020-172221 D3).
test('20261020-172221 CR8: --keep-branch is refused with --graduated, and the help scopes pruning', () => {
  const { root, env } = doneRepo();
  const refused = runIn(root, env, 'archive', '--graduated', '--keep-branch');
  assert.equal(refused.code, 1);
  assert.match(refused.err, /--keep-branch takes an id/);

  const { code, out } = run('archive', '-h');
  assert.equal(code, 0);
  assert.match(out, /Archiving one change by id deletes the local branch/);
  assert.match(out, /--graduated archives in bulk and deletes no branches/);
});

test('131649 CR3/CR4/CR6/CR10: list help documents its complete filter domain', () => {
  const { code, out } = run('list', '-h');
  assert.equal(code, 0);
  assert.match(out, /\.changeledger\/config\.yml/);
  assert.match(out, /--owner/);
  assert.match(out, /--unowned/);
  assert.match(out, /--pending.*graduation.*archive.*findings/is);
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
  assert.match(
    runIn(root, env, 'list', '--pending', 'release').err,
    /graduation, archive, findings/,
  );
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
  const formerlyOmitted = ['import', 'cutover', 'activate', 'commit', 'fix', 'search'];
  assert.deepEqual(
    formerlyOmitted.filter((name) => !topLevelCommands.has(name)),
    [],
  );
  for (const { command, code, out } of commandHelp) {
    assert.equal(code, 0, `${command.join(' ')} -h should exit 0`);
    assert.match(out, /Usage: changeledger/, `${command.join(' ')} -h should show Usage`);
  }
});

// A help example that carries a real change id sends the
// reader to a change that may not exist in their repo, so examples use `<id>`.
test('no command help carries a literal change id', () => {
  const commandHelp = registeredCommandHelp();
  assert.ok(commandHelp.length > 20, 'the help matrix looks truncated');
  for (const { command, out } of [{ command: [], out: run('--help').out }, ...commandHelp]) {
    assert.doesNotMatch(
      out,
      /\d{8}-\d{6}/,
      `\`changeledger ${command.join(' ')} -h\` carries a literal change id`,
    );
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

  const agent = runIn(root, env, 'agent-context', 'review', `${'20990101'}-000000`);
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
// undecidable type. It aborts naming the cause instead — an unknown or a
// missing type — exactly like `changeledger check` reports the same defect.
function contextRepo() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  assert.equal(runIn(root, env, 'init').code, 0);
  assert.equal(runIn(root, env, 'new', 'change', 'x', 'X', '--owner', 'Test').code, 0);
  const item = JSON.parse(runIn(root, env, 'list', '--json').out)[0];
  const changeFile = fs
    .readdirSync(path.join(root, '.changeledger', 'changes'))
    .map((name) => path.join(root, '.changeledger', 'changes', name))
    .find((candidate) => fs.readFileSync(candidate, 'utf8').includes(`id: "${item.id}"`));
  return { root, env, id: item.id, changeFile, original: fs.readFileSync(changeFile, 'utf8') };
}

test('162616 CR1: an unknown type aborts naming it instead of an empty stages line', () => {
  const { root, env, id, changeFile, original } = contextRepo();
  fs.writeFileSync(changeFile, original.replace('type: change', 'type: bogus'));

  const { code, err, out } = runIn(root, env, 'context', id);
  assert.notEqual(code, 0);
  assert.match(err, /unknown type "bogus"; valid types: change, epic/);
  assert.equal(out, '');
});

test('162616 CR1: a missing frontmatter type aborts naming it', () => {
  const { root, env, id, changeFile, original } = contextRepo();
  fs.writeFileSync(changeFile, original.replace(/^type: change\n/m, ''));

  const { code, err } = runIn(root, env, 'context', id);
  assert.notEqual(code, 0);
  assert.match(err, /missing frontmatter "type"/);
});

test('162616 CR1: a valid type publishes it instead of a stages line', () => {
  const { root, env, id } = contextRepo();
  const { code, out } = runIn(root, env, 'context', id);
  assert.equal(code, 0);
  assert.match(out, /— type=change$/m);
  assert.doesNotMatch(out, /Active stages/);
});

// 20260729-162616 CR5: `tdd` obliges writing the failing test from each
// criterion, and an epic is never implemented (20261024-121022), so it
// declares no criterion to write it from. The policy line must not publish
// `tdd=` for it.
test('162616 CR5: the policy line omits tdd= for an epic', () => {
  const { root, env, id, changeFile, original } = contextRepo();
  fs.writeFileSync(
    changeFile,
    original
      .replace('type: change', 'type: epic')
      .replace('## Specification\n\n', '')
      .replace('## Plan\n\n', ''),
  );
  const { code, out } = runIn(root, env, 'context', id);
  assert.equal(code, 0);
  const policyLine = out.split('\n').find((line) => line.startsWith('Effective policy:'));
  assert.doesNotMatch(policyLine, /tdd=/);
});

test('162616 CR5: a change keeps the tdd= line identical to today', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  assert.equal(runIn(root, env, 'init').code, 0);
  assert.equal(runIn(root, env, 'new', 'change', 'x', 'X', '--owner', 'Test').code, 0);
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
  assert.equal(runIn(root, env, 'new', 'change', 'x', 'X', '--owner', 'Roberto Ruiz').code, 0);
  const item = JSON.parse(runIn(root, env, 'list', '--json').out)[0];
  const file = fs
    .readdirSync(path.join(root, '.changeledger', 'changes'))
    .map((name) => path.join(root, '.changeledger', 'changes', name))
    .find((candidate) => fs.readFileSync(candidate, 'utf8').includes(`id: "${item.id}"`));
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('status: draft', 'status: done'));

  const planned = runIn(root, env, 'release', 'plan', '--json');
  assert.equal(planned.code, 0);
  const plan = JSON.parse(planned.out);
  // No `release_impact`: the template's `release.default_impact: patch`.
  assert.equal(plan.nextVersion, '0.1.1');
  assert.deepEqual(
    plan.changes.map((change) => change.id),
    [item.id],
  );
  assert.equal(runIn(root, env, 'release', 'record', '0.1.1').code, 0);
  assert.equal(fs.existsSync(path.join(root, '.changeledger', 'releases', '0.1.1.yml')), true);
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
  assert.match(out, /delivers the change to `done`/);
  assert.match(out, /returns it to `in-progress`/);
});

// End-to-end: the bin parses `review <id> fail "<reason>"` (reason extraction)
// and routes the change back to in-progress.
test('review wiring: fail parses the reason and returns the change to in-progress', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });

  assert.equal(runIn(root, env, 'init').code, 0);
  disableChangeBranchFormat(root);
  // Explicit owner: a spawned CLI takes no injected identity resolver.
  assert.equal(runIn(root, env, 'new', 'change', 'x', 'X', '--owner', 'Roberto Ruiz').code, 0);
  const id = JSON.parse(runIn(root, env, 'list', '--json').out)[0].id;

  // approve requires an objective and a frontier; in-review a Specification
  // with a criterion and a Plan with a body (20261023-181753).
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
      .replace('### Objective\n', '### Objective\n\nO\n')
      .replace('### Frontier\n', '### Frontier\n\nF\n')
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
  assert.equal(runIn(root, env, 'review', id, 'fail', 'spec is ambiguous').code, 0);

  const shown = JSON.parse(runIn(root, env, 'show', id, '--json').out);
  assert.equal(shown.frontmatter.status, 'in-progress');
  assert.match(
    shown.stages.find((s) => s.key === 'log').body,
    /review → in-progress: spec is ambiguous/,
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
  assert.match(configText, /^schema_version: 7$/m);
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
    .replace(/^schema_version: 7$/m, 'schema_version: 6')
    .replace(/^min_cli_version: .*$/m, 'min_cli_version: 0.1.0');
  fs.writeFileSync(configFile, downgraded);

  const { code, out, err } = runIn(root, env, 'config', 'migrate');
  assert.equal(code, 0, err);
  assert.match(out, /^Config migration 6 → 7$/m);
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
  assert.equal(runIn(root, env, 'new', 'change', 'x', 'X', '--owner', 'Roberto Ruiz').code, 0);
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

  // Downgrade to schema 6, the only one a migration starts from
  const configFile = path.join(root, '.changeledger', 'config.yml');
  const original = fs
    .readFileSync(configFile, 'utf8')
    .replace(/^schema_version: 7$/m, 'schema_version: 6');
  fs.writeFileSync(configFile, original);
  const before = fs.readFileSync(configFile, 'utf8');

  const { code, out } = runIn(root, env, 'config', 'migrate', '--dry-run');
  assert.equal(code, 0);
  assert.match(out, /Config migration 6 → 7 \(dry run\)/);
  assert.match(out, /schema_version: 7/);
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
  assert.match(out, /^Config migration 6 → 7 \(dry run\)$/m);
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
  const marker = 'schema_version: 7\nproject_name: divergent marker\n';
  const { root, env, configFile, authority, revision } = activatedMigrationCliRepo({ marker });
  const expected = buildMigration(authority).yaml;

  const { code, out, err } = runIn(root, env, 'config', 'migrate');

  assert.equal(code, 0, err);
  assert.match(out, /^Config migration 6 → 7$/m);
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
  const current = 'schema_version: 7\n';

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
  assert.equal(runIn(root, env, 'new', 'change', 'x', 'X', '--owner', 'Roberto Ruiz').code, 0);
  const id = JSON.parse(runIn(root, env, 'list', '--json').out)[0].id;
  // approve requires an objective and a frontier; in-review a Specification
  // with a criterion and a Plan (20261023-181753). Without git, `done` is
  // reached through the review verdict (20261024-121022).
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
      .replace('### Objective\n', '### Objective\n\nO\n')
      .replace('### Frontier\n', '### Frontier\n\nF\n')
      .replace('## Specification\n', '## Specification\n\n### CR1 — x\n- **Then** it holds\n')
      .replace('## Plan\n', '## Plan\n\n- [ ] do it\n  - **Criteria:** CR1\n'),
  );
  status(id, 'approved', root);
  assert.equal(runIn(root, env, 'status', id, 'in-progress').code, 0);
  task(id, 'done', 1, '', root);
  assert.equal(runIn(root, env, 'status', id, 'in-review').code, 0);
  assert.equal(runIn(root, env, 'review', id, 'pass').code, 0);

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
  assert.equal(runIn(root, env, 'new', 'change', 'x', 'X', '--owner', 'Roberto Ruiz').code, 0);
  const id = JSON.parse(runIn(root, env, 'list', '--json').out)[0].id;
  const changeFile = fs
    .readdirSync(path.join(root, '.changeledger', 'changes'))
    .map((name) => path.join(root, '.changeledger', 'changes', name))
    .find((candidate) => fs.readFileSync(candidate, 'utf8').includes(`id: "${id}"`));
  // A minimal reviewable candidate: approve requires an objective and a
  // frontier, and the exit to in-review a Specification with a criterion and a
  // Plan with a body (20261023-181753).
  const ready = fs
    .readFileSync(changeFile, 'utf8')
    .replace('### Objective\n', '### Objective\n\nO\n')
    .replace('### Frontier\n', '### Frontier\n\nF\n')
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

// 20261002-181346 CR7 — `init` declares an empty `git.release_branch` next to
// `git.integration_branch`, and the generated config stays valid.
test('181346 CR7: init declares an empty git.release_branch beside integration_branch', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  assert.equal(runIn(root, env, 'init').code, 0);
  const config = parseYaml(fs.readFileSync(path.join(root, '.changeledger', 'config.yml'), 'utf8'));
  assert.ok(Object.hasOwn(config.git, 'release_branch'), 'git.release_branch is not declared');
  assert.equal(config.git.release_branch, null);
  const keys = Object.keys(config.git);
  assert.equal(keys.indexOf('release_branch'), keys.indexOf('integration_branch') + 1);
  const checked = runIn(root, env, 'check');
  assert.equal(checked.code, 0, checked.err);
});

// 20261012-174310 CR1/CR5-CR7 — the first real use of the shipped `hotfix` type
// in a fresh repo: `new` refuses while `git.release_branch` is empty, and once
// the branch is declared the change is created, checks clean and loads.
const releaseRequirement = (id) =>
  `change ${id} integrates into git.release_branch, which is not declared — set git.release_branch in .changeledger/config.yml, for example "main"`;

// A composed change that integrates into the release branch (20261024-121022:
// the role is the change's own `integrates_into`, never its type).
function releaseDraft(root, env) {
  const printed = runIn(root, env, 'new', 'change', 'x', 'X', '--print', '--owner', 'Roberto Ruiz');
  assert.equal(printed.code, 0, printed.err);
  const text = printed.out.replace(
    '\nstatus: draft\n',
    '\nintegrates_into: release\nstatus: draft\n',
  );
  const draft = path.join(root, 'draft.md');
  fs.writeFileSync(draft, text);
  return { draft, id: text.match(/^id: "([^"]+)"$/m)[1] };
}

test('174310 CR7: a fresh repo refuses a release change until release_branch is declared, then it loads end to end', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  assert.equal(runIn(root, env, 'init').code, 0);
  const changesDir = path.join(root, '.changeledger', 'changes');

  const fresh = runIn(root, env, 'check');
  assert.equal(fresh.code, 0, fresh.err);
  assert.equal(fresh.out.trim(), '✓ 0 change(s) valid');

  const { draft, id } = releaseDraft(root, env);
  const refused = spawnIn(root, env, 'new', 'change', 'x', 'X', '--from', draft);
  assert.equal(refused.code, 1);
  assert.ok(refused.err.includes(releaseRequirement(id)), refused.err);
  assert.deepEqual(fs.readdirSync(changesDir), []);

  const configFile = path.join(root, '.changeledger', 'config.yml');
  fs.writeFileSync(
    configFile,
    fs
      .readFileSync(configFile, 'utf8')
      .replace(/^ {2}release_branch:.*$/m, '  release_branch: main'),
  );
  const created = runIn(root, env, 'new', 'change', 'x', 'X', '--from', draft);
  assert.equal(created.code, 0, created.err);

  const checked = runIn(root, env, 'check');
  assert.equal(checked.code, 0, checked.err);
  assert.equal(checked.out.trim(), '✓ 1 change(s) valid');
  const policy = (out) => out.split('\n').find((line) => line.startsWith('Effective policy:'));
  const loaded = runIn(root, env, 'context', id);
  assert.equal(loaded.code, 0, loaded.err);
  assert.equal(
    policy(loaded.out),
    `Effective policy: language=en — tdd=on — release_branch=main — integration_branch=main — change_branch=change/${id} — type=change`,
  );
  const core = runIn(root, env, 'context');
  assert.equal(core.code, 0, core.err);
  assert.equal(policy(core.out), 'Effective policy: language=en — tdd=on — release_branch=main');
});

test('174310 CR2: check reports a release change that reached a repo without release_branch', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  assert.equal(runIn(root, env, 'init').code, 0);
  const configFile = path.join(root, '.changeledger', 'config.yml');
  const original = fs.readFileSync(configFile, 'utf8');
  fs.writeFileSync(
    configFile,
    original.replace(/^ {2}release_branch:.*$/m, '  release_branch: main'),
  );
  const { draft, id } = releaseDraft(root, env);
  assert.equal(runIn(root, env, 'new', 'change', 'x', 'X', '--from', draft).code, 0);
  const [name] = fs.readdirSync(path.join(root, '.changeledger', 'changes'));

  // The branch is retired after the change exists.
  fs.writeFileSync(configFile, original);
  const checked = spawnIn(root, env, 'check');
  assert.equal(checked.code, 1);
  assert.ok(
    checked.err.includes(`  error  ${name}: ${releaseRequirement(id)}`),
    checked.err + checked.out,
  );
  assert.ok(checked.out.includes('1 error(s), 0 warning(s) — 1 change(s)'), checked.out);

  fs.writeFileSync(
    configFile,
    original.replace(/^ {2}release_branch:.*$/m, '  release_branch: main'),
  );
  const clean = runIn(root, env, 'check');
  assert.equal(clean.code, 0, clean.err);
  assert.equal(clean.out.trim(), '✓ 1 change(s) valid');
});

// --- 20261002-161641: a state ref holding collections this CLI does not know --

// Like `runIn`, but stderr is captured on success too: the warning under test
// is written by commands that exit 0.
function spawnIn(cwd, env, ...args) {
  const result = spawnSync('node', [bin, ...args], { cwd, env, encoding: 'utf8' });
  return { code: result.status ?? 1, out: result.stdout ?? '', err: result.stderr ?? '' };
}

const unknownWarning = (collections) =>
  `warning: the state ref holds collections ChangeLedger ${pkgVersion} does not know (${collections}); update the installation to use them`;

function occurrences(text, needle) {
  return text.split(needle).length - 1;
}

// `approvedGitRepo`'s ledger published to an activated state ref, with `extra`
// state paths (full paths) added to the same tree.
function activatedFutureRepo(extra = { '.changeledger-state/future/a.json': '{"later":true}\n' }) {
  const { root, env, id, changeFile, configFile } = approvedGitRepo();
  const tree = buildTree(root, {
    '.changeledger-state/manifest.yml': 'format_version: 1\nproject_id: demo\n',
    '.changeledger-state/config.yml': fs.readFileSync(configFile, 'utf8'),
    [`.changeledger-state/changes/${path.basename(changeFile)}`]: fs.readFileSync(
      changeFile,
      'utf8',
    ),
    ...extra,
  });
  const revision = commitTree(root, tree, { message: 'chore: state' });
  updateRef(root, STATE_REF, revision);
  writeActivation(root, { stateRef: STATE_REF });
  return { root, env, id, revision };
}

test('20261002-161641 CR1: list, context and status work over an unknown collection and warn once each', () => {
  const { root, env, id } = activatedFutureRepo();
  for (const args of [['list'], ['context'], ['status', id, 'in-progress']]) {
    const result = spawnIn(root, env, ...args);
    const label = args.join(' ');
    assert.equal(result.code, 0, `${label}: ${result.err}`);
    assert.equal(occurrences(result.err, unknownWarning('future')), 1, `${label}: ${result.err}`);
    assert.equal(occurrences(result.err, 'does not know'), 1, `${label}: ${result.err}`);
  }
  const listed = JSON.parse(spawnIn(root, env, 'list', '--json').out);
  assert.deepEqual(
    listed.map((change) => [change.id, change.status]),
    [[id, 'in-progress']],
  );
  const context = spawnIn(root, env, 'context');
  assert.match(context.out, /^===== CHANGELEDGER CONTEXT BEGIN/);
  assert.match(context.out, /CHANGELEDGER CONTEXT END/);
});

test('20261002-161641 CR1: the warning names every unknown collection in one line', () => {
  const { root, env } = activatedFutureRepo({
    '.changeledger-state/future/a.json': '{}\n',
    '.changeledger-state/later/b.yml': 'x: 1\n',
  });
  const result = spawnIn(root, env, 'list');
  assert.equal(result.code, 0, result.err);
  assert.equal(occurrences(result.err, unknownWarning('future, later')), 1, result.err);
});

test('20261002-161641 CR1: a state ref without unknown collections prints no warning', () => {
  const { root, env } = activatedFutureRepo({});
  const result = spawnIn(root, env, 'list');
  assert.equal(result.code, 0, result.err);
  assert.equal(result.err, '');
});

test('20261002-161641 CR2: the transition commit keeps the unknown entry with the same blob', () => {
  const { root, env, id, revision } = activatedFutureRepo();
  const result = spawnIn(root, env, 'status', id, 'in-progress');
  assert.equal(result.code, 0, result.err);
  const tip = fixtureGit(root, ['rev-parse', STATE_REF]).trim();
  assert.notEqual(tip, revision);
  const blob = (rev) =>
    fixtureGit(root, ['rev-parse', `${rev}:.changeledger-state/future/a.json`]).trim();
  assert.equal(blob(tip), blob(revision));
});

test('20261002-161641 CR4: list refuses each malformed state path, naming it', () => {
  for (const malformed of [
    '.changeledger-state/future/sub/a.json',
    '.changeledger-state/Future/a.json',
    '.changeledger-state/loose.yml',
    'other/a.json',
  ]) {
    const { root, env } = activatedFutureRepo({ [malformed]: 'x\n' });
    const result = spawnIn(root, env, 'list');
    assert.notEqual(result.code, 0, malformed);
    assert.ok(
      result.err.includes(`invalid state path: ${malformed}`),
      `${malformed}: ${result.err}`,
    );
  }
});

test('20261002-161641 CR5: check passes over an unknown collection and shows the warning', () => {
  const { root, env, id } = activatedFutureRepo();
  const result = spawnIn(root, env, 'check');
  assert.equal(result.code, 0, `${result.out}${result.err}`);
  assert.equal(occurrences(result.err, unknownWarning('future')), 1, result.err);
  assert.ok(
    result.err.includes(`  warn   .changeledger-state: ${unknownWarning('future').slice(9)}`),
    result.err,
  );
  assert.match(result.out, /0 error\(s\), 1 warning\(s\)/);

  // `check <id>` keeps the bin's stderr line and leaves it out of the report.
  const single = spawnIn(root, env, 'check', id);
  assert.equal(single.code, 0, `${single.out}${single.err}`);
  assert.equal(occurrences(single.err, 'does not know'), 1, single.err);
  assert.equal(single.out, `✓ change ${id} valid\n`);
});

// --- 20261012-174407: `check --commits` without a base follows the change on the branch ---

test('174407 CR10: check --help says where the default base comes from', () => {
  const help = run('check', '--help').out.replace(/\s+/g, ' ');
  assert.match(help, /--commits \[base\]/);
  assert.match(
    help,
    /base defaults to the integration branch of the change on the current branch, else git\.integration_branch, else auto-detected/,
  );
});

test('174407 CR1: a release change branch lints against the release branch the context publishes', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  initGitFixture(root, { args: ['-b', 'main'] });
  noChangeGit(root, ['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  assert.equal(runIn(root, env, 'init').code, 0);
  const configFile = path.join(root, '.changeledger', 'config.yml');
  fs.writeFileSync(
    configFile,
    fs
      .readFileSync(configFile, 'utf8')
      .replace('  integration_branch:\n', '  integration_branch: dev\n')
      .replace('  release_branch:\n', '  release_branch: main\n'),
  );
  assert.equal(runIn(root, env, 'new', 'change', 'urgent', 'Urgent', '--owner', 'Test').code, 0);
  const id = JSON.parse(runIn(root, env, 'list', '--json').out)[0].id;
  const changeFile = path.join(
    root,
    '.changeledger',
    'changes',
    fs.readdirSync(path.join(root, '.changeledger', 'changes')).find((n) => n.includes(id)),
  );
  const branch = `change/${id}`;
  fs.writeFileSync(
    changeFile,
    fs
      .readFileSync(changeFile, 'utf8')
      .replace('status: draft', 'integrates_into: release\nstatus: in-progress')
      .replace('\nrelated_to:', `\nbranch: ${branch}\nrelated_to:`),
  );
  noChangeGit(root, ['add', '-A']);
  noChangeGit(root, ['commit', '-m', `chore(init): seed [#${id}]`]);
  noChangeGit(root, ['branch', 'dev']);
  fs.writeFileSync(path.join(root, 'only-main.txt'), 'x\n');
  noChangeGit(root, ['add', 'only-main.txt']);
  noChangeGit(root, ['commit', '-m', 'fix(y): shipped on main, no marker']);
  noChangeGit(root, ['checkout', '-q', '-b', branch]);
  fs.writeFileSync(path.join(root, 'work.txt'), 'x\n');
  noChangeGit(root, ['add', 'work.txt']);
  noChangeGit(root, ['commit', '-m', `fix(x): hotfix work [#${id}]`]);

  const context = runIn(root, env, 'context', id);
  assert.equal(context.code, 0, context.err);
  assert.match(context.out, /integration_branch=main — back_merge_branch=dev/);

  const checked = runIn(root, env, 'check', '--commits');
  assert.equal(checked.code, 0, checked.err);
  assert.match(checked.out, /✓ commits main\.\.HEAD valid/);
  assert.equal(runIn(root, env, 'check', '--commits', 'dev').code, 1);
});

// 20261018-131621 — the retired statuses take their commands and flags with
// them: `review fail` is classless, and `validation`/`reopen` are gone.

// An approvable draft: every stage filled, so `approved` is both a legal
// transition and a valid candidate. `inReviewRepo` walks it on to `in-review`.
function readyDraftRepo() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-review-cli-'));
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  assert.equal(runIn(root, env, 'init').code, 0);
  disableChangeBranchFormat(root);
  assert.equal(runIn(root, env, 'new', 'change', 'x', 'X', '--owner', 'Roberto Ruiz').code, 0);
  const id = JSON.parse(runIn(root, env, 'list', '--json').out)[0].id;
  const file = path.join(
    root,
    '.changeledger',
    'changes',
    fs.readdirSync(path.join(root, '.changeledger', 'changes'))[0],
  );
  fs.writeFileSync(
    file,
    fs
      .readFileSync(file, 'utf8')
      .replace('### Objective\n', '### Objective\n\nO\n')
      .replace('### Frontier\n', '### Frontier\n\nF\n')
      .replace(
        '## Specification\n',
        '## Specification\n\n### CR1 — C\n- **Given** a\n- **When** b\n- **Then** c\n',
      )
      .replace(
        '## Plan\n',
        '## Plan\n\n- [ ] do it\n  - **Target:** `src/a.mjs`\n  - **Verify:** `node --test test/a.test.mjs`\n  - **Criteria:** CR1\n',
      ),
  );
  return { root, env, id, file };
}

function inReviewRepo() {
  const { root, env, id, file } = readyDraftRepo();
  assert.equal(runIn(root, env, 'approve', id).code, 0);
  for (const next of ['in-progress', 'in-review'])
    assert.equal(runIn(root, env, 'status', id, next).code, 0);
  return { root, env, id, file };
}

test('20261018-131621 CR6: review fail rejects --block and --retry without writing', () => {
  const { root, env, id, file } = inReviewRepo();
  const before = fs.readFileSync(file, 'utf8');
  for (const flag of ['--block', '--retry']) {
    const result = runIn(root, env, 'review', id, 'fail', flag, 'motivo');
    assert.notEqual(result.code, 0, flag);
    assert.match(result.err, new RegExp(`error: unknown option '${flag}'`), flag);
    assert.equal(fs.readFileSync(file, 'utf8'), before, flag);
  }
});

// The CLI is the agent's seat, so the return from `done` it writes is the
// agent's unless the human says otherwise — `--human` is the successor of the
// retired `validation fail --human`, and the attribution is what keeps
// `rejectionCount` a signal instead of a tally.
test('20261018-131621 CR24: `status in-progress` attributes the return to agent or human', () => {
  for (const [flags, expected] of [
    [[], 'agent'],
    [['--human'], 'human'],
  ]) {
    const { root, env, id, file } = inReviewRepo();
    assert.equal(runIn(root, env, 'task', id, 'done', '1').code, 0);
    assert.equal(runIn(root, env, 'review', id, 'pass').code, 0);
    const result = runIn(root, env, 'status', id, 'in-progress', 'motivo', ...flags);
    assert.equal(result.code, 0, result.err);
    assert.match(
      fs.readFileSync(file, 'utf8'),
      new RegExp(`\`\\[status\\]\` done → in-progress \\(${expected}\\): motivo$`, 'm'),
      flags.join(' ') || '(no flag)',
    );
  }
});

// `--human` only attributes this one edge. The draft here is approvable —
// `draft → approved` is legal and the candidate is valid — so nothing but the
// flag's own guard can refuse it. Without that guard the agent would hold the
// human approval seat `assertStatusDestinationAllowed` exists to deny it.
test('20261018-131621 CR25: `--human` is refused on any destination but in-progress', () => {
  const { root, env, id, file } = readyDraftRepo();
  const before = fs.readFileSync(file, 'utf8');
  const result = runIn(root, env, 'status', id, 'approved', '--human');
  assert.notEqual(result.code, 0);
  assert.match(result.err, /changeledger approve/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  // The same move without the flag is refused by the destination guard it
  // defers to, so the flag is the only thing this test's refusal can be.
  assert.equal(runIn(root, env, 'approve', id).code, 0);
});

test('20261018-131621 CR17: validation and reopen are no longer commands', () => {
  // Spawned from a scratch cwd on purpose: this suite runs inside the repo
  // ChangeLedger governs, and a resolvable id would aim a lifecycle verb at a
  // live document.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-retired-cli-'));
  const env = sanitizedEnv({
    CHANGELEDGER_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-')),
  });

  const validationRun = runIn(root, env, 'validation', '20261018-131621', 'pass');
  assert.notEqual(validationRun.code, 0);
  assert.match(validationRun.err, /error: unknown command 'validation'/);

  const reopenRun = runIn(root, env, 'reopen', '20261018-131621', 'motivo');
  assert.notEqual(reopenRun.code, 0);
  assert.match(reopenRun.err, /error: unknown command 'reopen'/);

  const help = run('help');
  assert.equal(help.code, 0);
  assert.doesNotMatch(help.out, /\bvalidation\b/);
  assert.doesNotMatch(help.out, /\breopen\b/);
});

// --- 20261024-121022: two types and the seeded Request ----------------------

function initializedRepo() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  assert.equal(runIn(root, env, 'init').code, 0);
  return { root, env };
}

const headings = (text) => text.split('\n').filter((line) => /^#{2,3} /.test(line));

test('20261024-121022 CR1: new refuses a retired type naming the two valid ones', () => {
  const { root, env } = initializedRepo();
  for (const type of ['feature', 'quick', 'spike']) {
    const result = runIn(root, env, 'new', type, 'x', 't', '--print', '--owner', 'Test');
    assert.notEqual(result.code, 0, type);
    assert.ok(
      result.err.includes(`Unknown type "${type}". Valid: change, epic`),
      `${type}: ${result.err}`,
    );
    assert.equal(result.out, '', type);
  }
});

test('20261024-121022 CR1: new, list and search name change and epic as the only types', () => {
  const { root, env } = initializedRepo();
  const help = runIn(root, env, 'new', '--help');
  assert.equal(help.code, 0);
  assert.match(help.out, /choices: "change",\s+"epic"\)/);
  for (const command of ['list', 'search']) {
    const commandHelp = runIn(root, env, command, '--help').out;
    assert.match(commandHelp, /--type <type>[\s\S]*choices: "change",\s+"epic"\)/, command);
    const args = command === 'search' ? ['search', 'x'] : ['list'];
    for (const type of ['change', 'epic']) {
      assert.equal(runIn(root, env, ...args, '--type', type).code, 0, `${command} ${type}`);
    }
    const refused = runIn(root, env, ...args, '--type', 'feature');
    assert.notEqual(refused.code, 0, command);
    assert.match(refused.err, /Allowed choices are change, epic\./, command);
  }
});

test('20261024-121022 CR1: check help names the fixed types and stages', () => {
  const { root, env } = initializedRepo();
  const help = runIn(root, env, 'check', '--help').out;
  assert.match(help, /^types: change, epic$/m);
  assert.match(help, /^stages: request, specification, plan, log$/m);
  assert.match(
    help,
    /^effective statuses: draft, approved, in-progress, in-review, done, discarded$/m,
  );
  assert.doesNotMatch(help, /effective types|effective stages/);
});

test('20261024-121022 CR4: new change --print seeds the objective and the frontier', () => {
  const { root, env } = initializedRepo();
  const result = runIn(root, env, 'new', 'change', 'x', 't', '--print', '--owner', 'Test');
  assert.equal(result.code, 0, result.err);
  assert.deepEqual(headings(result.out), [
    '## Request',
    '### Objective',
    '### Frontier',
    '## Specification',
    '## Plan',
    '## Log',
  ]);
});

test('20261024-121022 CR4: new epic --print seeds the Request and the Log only', () => {
  const { root, env } = initializedRepo();
  const result = runIn(root, env, 'new', 'epic', 'x', 't', '--print', '--owner', 'Test');
  assert.equal(result.code, 0, result.err);
  assert.deepEqual(headings(result.out), ['## Request', '### Objective', '### Frontier', '## Log']);
});

test('20261024-121022 CR4: the written scaffold is the printed one, and approve names the empty sections', () => {
  const { root, env } = initializedRepo();
  const printed = runIn(root, env, 'new', 'change', 'x', 't', '--print', '--owner', 'Test');
  assert.equal(printed.code, 0, printed.err);
  const written = runIn(root, env, 'new', 'change', 'x', 't', '--owner', 'Test');
  assert.equal(written.code, 0, written.err);
  const file = written.out
    .trim()
    .split('\n')
    .at(-1)
    .replace(/^Created\s+/, '');
  const text = fs.readFileSync(path.isAbsolute(file) ? file : path.join(root, file), 'utf8');
  const body = (doc) => doc.slice(doc.indexOf('\n## Request'));
  assert.equal(body(text).replace(/\n## Log\n[\s\S]*$/, '\n## Log\n'), body(printed.out));
  const id = text.match(/^id: "([^"]+)"$/m)[1];
  const approve = runIn(root, env, 'approve', id);
  assert.notEqual(approve.code, 0);
  assert.match(approve.err, /cannot approve: "### Objective", "### Frontier" are empty/);
});

test('20261024-202659 CR2: log --help prints finding with its only writer', () => {
  const { code, out } = run('log', '--help');
  assert.equal(code, 0);
  assert.ok(
    out.includes(
      [
        '  finding',
        '    Payload: <text>',
        '    Or: <n> promoted #<id>',
        '    Or: <n> dropped: <reason>',
        '    Written by:',
        '      changeledger finding',
      ].join('\n'),
    ),
    out,
  );
});

function findingCliRepo() {
  const { root, env, id, changeFile } = doneRepo();
  assert.equal(runIn(root, env, 'new', 'change', 'y', 'Y', '--owner', 'Ana').code, 0);
  const other = JSON.parse(runIn(root, env, 'list', '--json').out).find((c) => c.id !== id).id;
  return { root, env, x: id, y: other, changeFile };
}

const lastLogLine = (file) => fs.readFileSync(file, 'utf8').trimEnd().split('\n').at(-1);

test('20261024-202659 CR4-CR7: the finding command records, promotes and drops through the CLI', () => {
  const { root, env, x, y, changeFile } = findingCliRepo();
  const first = runIn(root, env, 'finding', x, 'el ejemplo de ayuda cita un id');
  assert.equal(first.code, 0, first.err);
  assert.equal(first.out, `finding F1 recorded on #${x}\n`);
  assert.match(lastLogLine(changeFile), /`\[finding\]` el ejemplo de ayuda cita un id$/);
  assert.equal(runIn(root, env, 'finding', x, 'segundo').out, `finding F2 recorded on #${x}\n`);

  const promoted = runIn(root, env, 'finding', x, '2', 'promote', y);
  assert.equal(promoted.code, 0, promoted.err);
  assert.equal(promoted.out, `finding F2 on #${x} → promoted to #${y}\n`);
  assert.match(lastLogLine(changeFile), new RegExp(`\`\\[finding\\]\` 2 promoted #${y}$`));

  const dropped = runIn(root, env, 'finding', x, '1', 'drop', 'ya', 'no', 'aplica');
  assert.equal(dropped.code, 0, dropped.err);
  assert.equal(dropped.out, `finding F1 on #${x} → dropped\n`);
  assert.match(lastLogLine(changeFile), /`\[finding\]` 1 dropped: ya no aplica$/);

  const before = fs.readFileSync(changeFile, 'utf8');
  for (const [args, message] of [
    [[x, ''], 'finding text must not be empty'],
    [
      [x, '2 promoted #20260101-000000'],
      'finding text "2 promoted #20260101-000000" reads as a resolution; resolve a finding with changeledger finding <id> <n> promote|drop',
    ],
    [[x, 'abc', 'promote', y], 'finding ordinal must be a positive integer (got "abc")'],
    [[x, '3', 'promote', y], `change #${x} has no finding F3`],
    [[x, '1', 'drop', ''], 'drop requires a reason'],
  ]) {
    const result = runIn(root, env, 'finding', ...args);
    assert.equal(result.code, 1, args.join(' '));
    assert.equal(result.err, `Error: ${message}\n`, args.join(' '));
  }
  assert.equal(fs.readFileSync(changeFile, 'utf8'), before);
});

test('20261024-202659 CR4: finding --help names both forms and what a finding is', () => {
  const { code, out } = run('finding', '--help');
  assert.equal(code, 0);
  assert.match(out, /outside the active change's frontier/);
  assert.match(out, /changeledger finding <id> "<text>"/);
  assert.match(out, /changeledger finding <id> <n> promote <change-id>/);
  assert.match(out, /changeledger finding <id> <n> drop "<reason>"/);
});

test('20261024-202659 CR8: list --pending findings prints the open findings of the whole ledger', () => {
  const { root, env, x, y, changeFile } = findingCliRepo();
  assert.equal(runIn(root, env, 'finding', x, 'falta la vista').code, 0);
  assert.equal(runIn(root, env, 'finding', x, 'sobra un test').code, 0);
  assert.equal(runIn(root, env, 'finding', x, '2', 'drop', 'no', 'aplica').code, 0);
  fs.writeFileSync(
    changeFile,
    fs.readFileSync(changeFile, 'utf8').replace('status: done', 'status: done\narchived: true'),
  );
  assert.equal(runIn(root, env, 'finding', y, 'otro hallazgo').code, 0);

  const text = runIn(root, env, 'list', '--pending', 'findings');
  assert.equal(text.code, 0, text.err);
  assert.equal(text.out, `#${x} F1  falta la vista\n#${y} F1  otro hallazgo\n`);
  const rows = JSON.parse(runIn(root, env, 'list', '--pending', 'findings', '--json').out);
  assert.deepEqual(
    rows.map(({ id, n, text: t }) => ({ id, n, text: t })),
    [
      { id: x, n: 1, text: 'falta la vista' },
      { id: y, n: 1, text: 'otro hallazgo' },
    ],
  );
  for (const row of rows) assert.match(row.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.equal(
    runIn(root, env, 'list', '--pending', 'findings', '--archived').out,
    `#${x} F1  falta la vista\n`,
  );
  assert.equal(
    runIn(root, env, 'list', '--pending', 'findings', '--owner', 'Roberto Ruiz').out,
    `#${x} F1  falta la vista\n`,
  );
  assert.equal(runIn(root, env, 'list', '--pending', 'findings', '--all').out, text.out);
});

test('20261024-202659 CR9: an invalid --pending names the three kinds, and the help documents findings', () => {
  const { root, env } = doneRepo();
  const invalid = runIn(root, env, 'list', '--pending', 'release');
  assert.equal(invalid.code, 1);
  assert.equal(
    invalid.err,
    'Error: Invalid --pending "release". Valid: graduation, archive, findings\n',
  );
  const help = run('list', '--help').out;
  assert.match(help, /filter pending work \(graduation\|archive\|findings\)/);
  assert.match(help, /changeledger list --pending findings/);
});

test('20261024-202659 CR14: the day after, a finding is recorded, listed and promoted', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  assert.equal(runIn(root, env, 'init').code, 0);
  assert.equal(runIn(root, env, 'new', 'change', 'x', 'X', '--owner', 'Ana').code, 0);
  const x = JSON.parse(runIn(root, env, 'list', '--json').out)[0].id;
  assert.equal(runIn(root, env, 'new', 'change', 'y', 'Y', '--owner', 'Ana').code, 0);
  const y = JSON.parse(runIn(root, env, 'list', '--json').out).find((c) => c.id !== x).id;

  assert.equal(runIn(root, env, 'finding', x, 'falta la vista').code, 0);
  assert.equal(runIn(root, env, 'list', '--pending', 'findings').out, `#${x} F1  falta la vista\n`);
  const promoted = runIn(root, env, 'finding', x, '1', 'promote', y);
  assert.equal(promoted.code, 0, promoted.err);
  assert.equal(runIn(root, env, 'list', '--pending', 'findings').out, '');
  assert.equal(JSON.parse(runIn(root, env, 'list', '--all', '--json').out).length, 2);

  const shown = JSON.parse(runIn(root, env, 'show', x, '--json').out);
  const logBody = shown.stages.find((s) => s.key === 'log').body;
  assert.deepEqual(
    logBody
      .split('\n')
      .filter((line) => line.includes('`[finding]`'))
      .map((line) => line.replace(/^- \*\*\S+\*\* /, '')),
    ['`[finding]` falta la vista', `\`[finding]\` 1 promoted #${y}`],
  );
  const check = runIn(root, env, 'check');
  assert.equal(check.code, 0, check.out + check.err);
});

// The day after the contract cut, walked end to end through the real binary: a
// fresh repo reads core and implement inside their ceilings and free of every
// retired rule, delegates a review through the one skeleton and capsule left,
// has a criterion id in code rejected at commit time, and loads the global-state
// overlay only once it is activated.
test('the day after the contract cut: from a fresh repo to review delegation and activation', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = sanitizedEnv({ CHANGELEDGER_HOME: home });
  initGitFixture(root, { args: ['-b', 'main'] });
  assert.equal(runIn(root, env, 'init').code, 0);

  const retired = [
    /quantif/i,
    /copy its checklist|\bDo not copy\b/i,
    /figures, line numbers/i,
    /Mutate one thing|restore it by editing/i,
    /once; do not reload|never reload one already held/i,
    /Correction isolation|uncommitted correction|kept uncommitted|left uncommitted|confirmation review|confirms it/i,
    /graduation-review/,
  ];
  for (const [args, budget] of [
    [[], contextBudgets.base.core],
    [['implement'], contextBudgets.base.implement],
  ]) {
    const { code, out, err } = runIn(root, env, 'context', ...args);
    assert.equal(code, 0, err);
    assertWithinBudget(`context ${args.join(' ')}`.trim(), out, budget);
    const flat = out.replace(/\s+/g, ' ');
    for (const pattern of retired) assert.doesNotMatch(flat, pattern);
    assert.ok(!out.includes('# Global State'), 'an inactive repo loaded the global-state overlay');
  }

  const prompt = runIn(root, env, 'agent-prompt', 'review');
  assert.equal(prompt.code, 0, prompt.err);
  assert.match(prompt.out, /^===== CHANGELEDGER AGENT PROMPT BEGIN — role: review/);
  assert.match(prompt.out, /\{\{mandate\}\}/);

  const created = runIn(root, env, 'new', 'change', 'day-after', 'Day after', '--owner', 'Test');
  assert.equal(created.code, 0, created.err);
  const { id } = JSON.parse(runIn(root, env, 'list', '--json').out)[0];
  const changes = path.join(root, '.changeledger', 'changes');
  const file = path.join(
    changes,
    fs.readdirSync(changes).find((name) => name.startsWith(id)),
  );
  fs.writeFileSync(
    file,
    fs.readFileSync(file, 'utf8').replace('status: draft', 'status: in-review'),
  );
  const capsule = runIn(root, env, 'agent-context', 'review', id);
  assert.equal(capsule.code, 0, capsule.err);
  assert.match(capsule.out, new RegExp(`role: review — change: #${id}`));
  assert.doesNotMatch(capsule.out, /every `CRn`/);

  const git = (...args) =>
    execFileSync('git', args, { cwd: root, env: sanitizedEnv(), encoding: 'utf8' });
  git('add', '-A');
  git('commit', '-q', '-m', 'chore: seed the ledger');
  const hook = fileURLToPath(new URL('../hooks/no-ledger-refs.sh', import.meta.url));
  const stageAndCheck = (name, text) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
    git('add', name);
    return spawnSync('sh', [hook, '--cached'], { cwd: root, env, encoding: 'utf8' });
  };
  const clean = stageAndCheck('src/clean.mjs', '// the parser keeps blank lines\n');
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  git('commit', '-q', '-m', 'feat: clean line');
  const criterion = `CR${2}`;
  const dirty = stageAndCheck('src/dirty.mjs', `// see ${criterion}\n`);
  assert.equal(dirty.status, 1, dirty.stdout + dirty.stderr);
  assert.match(
    dirty.stdout,
    new RegExp(`^src/dirty\\.mjs:1: ledger reference outside \\.changeledger/: ${criterion}$`, 'm'),
  );
  git('rm', '-q', '--cached', 'src/dirty.mjs');
  fs.rmSync(path.join(root, 'src', 'dirty.mjs'));

  const cutover = runIn(root, env, 'cutover');
  assert.equal(cutover.code, 0, cutover.err);
  const activated = runIn(root, env, 'context');
  assert.equal(activated.code, 0, activated.err);
  assert.match(activated.out, /\n# Global State\n/);
  const summed = {
    tokens: contextBudgets.base.core.tokens + contextBudgets.overlays['global-state'].tokens,
    lines: contextBudgets.base.core.lines + contextBudgets.overlays['global-state'].lines,
  };
  assert.match(activated.out.split('\n')[0], new RegExp(`lines:\\d+/${summed.lines} =====$`));
  assertWithinBudget('activated context', activated.out, summed);
});
