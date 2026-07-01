import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { validation } from '../src/commands/agent.mjs';

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
  assert.equal(runIn(root, env, 'new', 'chore', 'x', 'X').code, 0);
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

test('CR1: changeledger graduate --help shows every explicit mode, exit 0', () => {
  const { code, out } = run('graduate', '--help');
  assert.equal(code, 0);
  assert.match(out, /--new/);
  assert.match(out, /--into/);
  assert.match(out, /--skip/);
  assert.match(out, /--pending/);
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
  assert.match(runIn(root, env, 'graduate', '--pending').out, new RegExp(id));

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
    ['graduate', id, '--skip', '--pending'],
    ['graduate', '--pending', id],
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

test('CR3: changeledger graduate with no args fails with its usage', () => {
  const { code, err } = run('graduate');
  assert.notEqual(code, 0);
  assert.match(err, /graduate/);
});

test('CR4: changeledger --help lists all commands', () => {
  const { code, out } = run('--help');
  assert.equal(code, 0);
  assert.match(out, /changeledger init/);
  assert.match(out, /changeledger context/);
  assert.match(out, /changeledger graduate/);
  assert.match(out, /changeledger review/);
  assert.match(out, /changeledger release/);
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
  assert.match(out, /changeledger init/);
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

  for (const s of ['approved', 'in-progress', 'in-review']) {
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
  const original = fs.readFileSync(configFile, 'utf8').replace(/^schema_version: 1\n/m, '');
  fs.writeFileSync(configFile, original);
  const before = fs.readFileSync(configFile, 'utf8');

  const { code, out } = runIn(root, env, 'config', 'migrate', '--dry-run');
  assert.equal(code, 0);
  assert.match(out, /Config migration 0 → 1 \(dry run\)/);
  assert.match(out, /schema_version: 1/);
  assert.equal(fs.readFileSync(configFile, 'utf8'), before, 'dry-run must not modify file');
});

test('113219 CLI CR7: config migrate is idempotent', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  const env = { ...process.env, CHANGELEDGER_HOME: home };
  assert.equal(runIn(root, env, 'init').code, 0);

  // Already at schema 1 — should be no-op
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
  for (const s of ['approved', 'in-progress', 'in-validation']) {
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
