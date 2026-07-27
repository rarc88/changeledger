import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { status, validation } from '../src/commands/agent.mjs';

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

function doneRepo() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = { ...process.env, CHANGELEDGER_HOME: home };
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

test('125139 CR1/CR3/CR5/CR6: CLI transmits explicit human decisions and preserves agent rejection', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-agent-cli-'));
  const env = { ...process.env, CHANGELEDGER_HOME: home };
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  assert.equal(runIn(root, env, 'init').code, 0);
  assert.equal(runIn(root, env, 'new', 'chore', 'x', 'X').code, 0);
  const id = JSON.parse(runIn(root, env, 'list', '--json').out)[0].id;
  assert.equal(runIn(root, env, 'status', id, 'approved').code, 1);
  assert.equal(runIn(root, env, 'approve', id).code, 0);
  for (const next of ['in-progress', 'in-validation'])
    assert.equal(runIn(root, env, 'status', id, next).code, 0);
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
  const env = { ...process.env, CHANGELEDGER_HOME: home };
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  assert.equal(runIn(root, env, 'init').code, 0);
  assert.equal(runIn(root, env, 'new', 'chore', 'x', 'X').code, 0);
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

// CR6: every public command and subcommand's help exits 0, shows Usage, matrix.
test('225212 CR6: help matrix — every command and subcommand documents Usage on exit 0', () => {
  const commands = [
    ['init'],
    ['register'],
    ['new'],
    ['view'],
    ['check'],
    ['context'],
    ['agent-prompt'],
    ['agent-context'],
    ['status'],
    ['approve'],
    ['discard'],
    ['review'],
    ['owner'],
    ['archive'],
    ['log'],
    ['task'],
    ['list'],
    ['show'],
    ['graduate'],
    ['config'],
    ['config', 'migrate'],
    ['release'],
    ['release', 'init'],
    ['release', 'plan'],
    ['release', 'record'],
  ];
  for (const cmd of commands) {
    const { code, out } = run(...cmd, '-h');
    assert.equal(code, 0, `${cmd.join(' ')} -h should exit 0`);
    assert.match(out, /Usage: changeledger/, `${cmd.join(' ')} -h should show Usage`);
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
  const env = { ...process.env, CHANGELEDGER_HOME: home };
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

// 124833 CR1: `--have` was retired with the revision segment it served. It is
// rejected as an unknown option and no longer appears in the help text, so a
// caller carrying a stale habit fails loudly instead of being silently ignored.
test('124833 CR1: context rejects --have as an unknown option', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = { ...process.env, CHANGELEDGER_HOME: home };
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
  const env = { ...process.env, CHANGELEDGER_HOME: home };

  assert.equal(runIn(root, env, 'init').code, 0);
  assert.equal(runIn(root, env, 'release', 'init', '0.1.0').code, 0);
  assert.equal(runIn(root, env, 'new', 'feature', 'x', 'X').code, 0);
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
  const env = { ...process.env, CHANGELEDGER_HOME: home };

  assert.equal(runIn(root, env, 'init').code, 0);
  assert.equal(runIn(root, env, 'new', 'feature', 'x', 'X').code, 0);
  const id = JSON.parse(runIn(root, env, 'list', '--json').out)[0].id;

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

// 20260628-113219: config migrate CLI integration
test('113219 CLI CR3: config migrate --dry-run shows candidate and exits 0 without writing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = { ...process.env, CHANGELEDGER_HOME: home };
  assert.equal(runIn(root, env, 'init').code, 0);

  // Downgrade to schema 0 by removing schema_version
  const configFile = path.join(root, '.changeledger', 'config.yml');
  const original = fs.readFileSync(configFile, 'utf8').replace(/^schema_version: \d+\n/m, '');
  fs.writeFileSync(configFile, original);
  const before = fs.readFileSync(configFile, 'utf8');

  const { code, out } = runIn(root, env, 'config', 'migrate', '--dry-run');
  assert.equal(code, 0);
  assert.match(out, /Config migration 0 → 4 \(dry run\)/);
  assert.match(out, /schema_version: 4/);
  assert.equal(fs.readFileSync(configFile, 'utf8'), before, 'dry-run must not modify file');
});

test('113219 CLI CR7: config migrate is idempotent', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = { ...process.env, CHANGELEDGER_HOME: home };
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
  const env = { ...process.env, CHANGELEDGER_HOME: home };
  assert.equal(runIn(root, env, 'init').code, 0);

  const configFile = path.join(root, '.changeledger', 'config.yml');
  fs.writeFileSync(configFile, 'statuses: [\n  broken yaml');

  const { code, err } = runIn(root, env, 'config', 'migrate');
  assert.equal(code, 1);
  assert.match(err, /Error:/);
});

// End-to-end: `changeledger graduate <id> <slug> --into` links an existing spec (flag in
// any position) without touching its body, exit 0.
test('CR6: graduate --into wires through and links an existing spec', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = { ...process.env, CHANGELEDGER_HOME: home };

  assert.equal(runIn(root, env, 'init').code, 0);
  assert.equal(runIn(root, env, 'new', 'chore', 'x', 'X').code, 0);
  const id = JSON.parse(runIn(root, env, 'list', '--json').out)[0].id;
  // chore: no review gate, but human validation is still required.
  status(id, 'approved', root);
  for (const s of ['in-progress', 'in-validation']) {
    assert.equal(runIn(root, env, 'status', id, s).code, 0);
  }
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
