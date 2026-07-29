import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { defaultGhRun, githubLogin, gitRefs, mutatingRun, ownerHandle } from '../src/git.mjs';

const SEP = String.fromCharCode(31);
const ID = '20260613-222918';

// Extracts the full text of every `<name>(` call in `source`, balancing
// parentheses so a call spread over several lines is read whole. Returns
// `{ line, text }` per call, so a violation can be reported where it lives.
function callsTo(source, name) {
  const calls = [];
  const opener = `${name}(`;
  for (let at = source.indexOf(opener); at !== -1; at = source.indexOf(opener, at + 1)) {
    let depth = 0;
    let end = at + opener.length - 1;
    for (; end < source.length; end += 1) {
      if (source[end] === '(') depth += 1;
      else if (source[end] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push({
      start: at,
      end,
      line: source.slice(0, at).split('\n').length,
      text: source.slice(at, end + 1),
    });
  }
  return calls;
}

// Counts arguments at the call's top level, ignoring commas nested in objects,
// arrays or inner calls. Empty segments do not count: a trailing comma is style,
// not an argument, and counting it would let a dropped injection pass unseen.
function topLevelArgs(callText) {
  const inner = callText.slice(callText.indexOf('(') + 1, -1);
  let depth = 0;
  let current = '';
  const args = [];
  for (const character of inner) {
    if ('([{'.includes(character)) depth += 1;
    else if (')]}'.includes(character)) depth -= 1;
    if (character === ',' && depth === 0) {
      args.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  args.push(current);
  return args.filter((argument) => argument.trim()).length;
}

// True when the call's options argument actually carries an identity resolver,
// inline or through a variable declared in the same file. Presence of a third
// argument is not enough: an empty `{}` would leave the default resolver running.
function injectsResolver(callText, source) {
  const inner = callText.slice(callText.indexOf('(') + 1, -1);
  let depth = 0;
  let current = '';
  const args = [];
  for (const character of inner) {
    if ('([{'.includes(character)) depth += 1;
    else if (')]}'.includes(character)) depth -= 1;
    if (character === ',' && depth === 0) {
      args.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  args.push(current);
  const options = args.map((argument) => argument.trim()).filter(Boolean)[2];
  if (!options) return false;
  if (options.includes('ownerHandle')) return true;
  const identifier = options.match(/^[A-Za-z_$][\w$]*$/);
  if (!identifier) return false;
  const declaration = source.match(new RegExp(`\\b(?:const|let|var)\\s+${options}\\s*=([^;]*);`));
  return Boolean(declaration?.[1].includes('ownerHandle'));
}

// 20260726-124836 CR7: creating a change resolves the local git identity, which
// runs `gh api user` — a network subprocess. A suite that creates changes
// without injecting an identity therefore reaches api.github.com on every one of
// them, and no assertion notices, because nothing depends on the value. This
// guard is the falsifiable form of that criterion: drop an injection anywhere and
// it names the file and line. A counter inside `src/git.mjs` could not do this —
// its only reader would be its own unit test, so a regressed site stayed green.
test('124836 CR7: no test creates a change without injecting an identity', () => {
  const dir = path.dirname(new URL(import.meta.url).pathname);
  // Recursive: a suite added under a subdirectory tomorrow must be scanned too.
  const suites = fs
    .readdirSync(dir, { recursive: true })
    .filter((name) => String(name).endsWith('.test.mjs'));
  const offenders = [];
  for (const suite of suites) {
    const source = fs.readFileSync(path.join(dir, suite), 'utf8');
    const throwSpans = callsTo(source, 'assert.throws').map((call) => [call.start, call.end]);
    // In-process creation: safe when the identity resolver is injected, or when
    // an explicit owner short-circuits the resolution entirely.
    for (const call of callsTo(source, 'newChange')) {
      // Injected when a third argument is present — the options object carrying
      // the resolver, whether written inline or held in a variable. Also safe
      // when the first argument names an owner, which short-circuits resolution
      // before any subprocess, and when the call is expected to throw.
      // `newChange()` with no arguments is prose naming the function, not a call.
      if (topLevelArgs(call.text) === 0) continue;
      // Injected only when the options argument really carries the resolver:
      // counting arguments would let an empty `{}` exempt while the default
      // resolver still runs. The options may be written inline or held in a
      // variable, so a bare identifier is resolved against its declaration.
      if (injectsResolver(call.text, source)) continue;
      // A literal owner short-circuits resolution before any subprocess.
      // `owner: undefined` or a variable does not, so only a non-empty literal
      // counts here.
      if (/\bowner: '[^']+'/.test(call.text)) continue;
      // A call the test expects to throw never reaches the resolver. Scope it to
      // the actual `assert.throws(...)` span, not to a fixed lookbehind that a
      // creation on the next line would slip through.
      if (throwSpans.some(([from, to]) => call.start > from && call.end < to)) continue;
      offenders.push(`${suite}:${call.line} newChange without an injected identity`);
    }
    // Spawned CLI: a child process takes no injection, so `--owner` is the only
    // way to keep it off the network. Every helper in the tree that launches the
    // binary is scanned, not just one of them — keying this to a single helper
    // name let a sibling spawn escape unseen.
    for (const helper of ['run', 'runIn', 'runDirect', 'execFileSync', 'execFileAsync']) {
      for (const call of callsTo(source, helper)) {
        if (!/(^|[[(,]\s*)'new'/.test(call.text)) continue;
        // `new --help` prints usage and creates nothing. Scoped to the token
        // right after `new`: a literal `--help` sitting in some other argument,
        // such as a fixture title, must not exempt a call that really creates.
        if (/'new',\s*'(-h|--help)'/.test(call.text)) continue;
        if (call.text.includes('--owner')) continue;
        offenders.push(`${suite}:${call.line} spawned \`new\` without --owner`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('CR1: parses commits that reference the id', () => {
  const run = (args) => {
    if (args[0] === 'log')
      return [
        `abc123${SEP}feat: do it [#${ID}]${SEP}2026-06-14T10:00:00Z`,
        `def456${SEP}fix: tweak [#${ID}]${SEP}2026-06-14T11:00:00Z`,
      ].join('\n');
    return '';
  };
  const refs = gitRefs(ID, ID, run);
  assert.equal(refs.commits.length, 2);
  assert.deepEqual(refs.commits[0], {
    sha: 'abc123',
    subject: `feat: do it [#${ID}]`,
    date: '2026-06-14T10:00:00Z',
  });
});

test('CR1: branches are filtered to those containing the id', () => {
  const run = (args) => {
    if (args[0] === 'branch') return `main\nfeat/${ID}-x\nother\n`;
    return '';
  };
  const refs = gitRefs(ID, ID, run);
  assert.deepEqual(refs.branches, [`feat/${ID}-x`]);
});

test('CR2: a git failure yields empty refs without throwing', () => {
  const run = () => {
    throw new Error('not a git repo');
  };
  assert.deepEqual(gitRefs(ID, ID, run), { commits: [], branches: [] });
});

test('CR2: a missing id yields empty refs', () => {
  assert.deepEqual(
    gitRefs('/x', '', () => 'whatever'),
    { commits: [], branches: [] },
  );
});

// --- owner handle (GitHub login, fallback git name) ---

test('CR1: githubLogin returns the trimmed gh login', () => {
  assert.equal(
    githubLogin(() => 'raruiz-hiberuscom\n'),
    'raruiz-hiberuscom',
  );
});

test('CR4: githubLogin is empty when gh fails', () => {
  assert.equal(
    githubLogin(() => {
      throw new Error('gh: command not found');
    }),
    '',
  );
});

// 20260729-144812 CR3/CR4: the kill-switch lives only in the default `gh`
// runner, so injected runners bypass it and the suite stays hermetic by
// construction rather than by per-test discipline.

test("144812 CR3: defaultGhRun returns '' under the kill-switch, without a subprocess", () => {
  const before = process.env.CHANGELEDGER_NO_GH;
  process.env.CHANGELEDGER_NO_GH = '1';
  try {
    assert.equal(defaultGhRun(['api', 'user', '--jq', '.login']), '');
  } finally {
    if (before === undefined) delete process.env.CHANGELEDGER_NO_GH;
    else process.env.CHANGELEDGER_NO_GH = before;
  }
});

test('144812 CR4: an injected runner bypasses the kill-switch', () => {
  const before = process.env.CHANGELEDGER_NO_GH;
  process.env.CHANGELEDGER_NO_GH = '1';
  try {
    assert.equal(
      githubLogin(() => 'spied-login\n'),
      'spied-login',
    );
  } finally {
    if (before === undefined) delete process.env.CHANGELEDGER_NO_GH;
    else process.env.CHANGELEDGER_NO_GH = before;
  }
});

test('144812 CR5: the test and verify scripts set CHANGELEDGER_NO_GH so the suite is hermetic by construction', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /CHANGELEDGER_NO_GH=1/);
  assert.match(pkg.scripts.verify, /CHANGELEDGER_NO_GH=1/);
});

test('CR1: ownerHandle prefers the GitHub login', () => {
  const gh = () => 'raruiz-hiberuscom';
  const git = () => 'config\nuser.name'; // should be ignored
  assert.equal(ownerHandle('/x', git, gh), 'raruiz-hiberuscom');
});

test('CR2: ownerHandle falls back to git user.name when gh is unavailable', () => {
  const gh = () => {
    throw new Error('no gh');
  };
  const git = (args) => (args[0] === 'config' ? 'Roberto Ruiz' : '');
  assert.equal(ownerHandle('/x', git, gh), 'Roberto Ruiz');
});

test('CR4: ownerHandle is empty when neither is available', () => {
  const boom = () => {
    throw new Error('nope');
  };
  assert.equal(ownerHandle('/x', boom, boom), '');
});

// --- mutatingRun (git run variant that surfaces stderr on failure) ---

// Hook-safety: strip the repo-location vars git exports inside hooks so the
// scratch repo below is the real target (same rationale as commit.test.mjs).
function scratchGitRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-git-'));
  const env = { ...process.env };
  for (const key of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_COMMON_DIR',
    'GIT_CEILING_DIRECTORIES',
  ]) {
    delete env[key];
  }
  execFileSync('git', ['init', '-q'], { cwd: root, env, encoding: 'utf8' });
  return root;
}

test('CR1: mutatingRun includes git stderr in the thrown error', () => {
  const root = scratchGitRepo();
  assert.throws(
    () => mutatingRun(['rev-parse', '--verify', 'refs/heads/definitely-missing'], root),
    (e) =>
      /fatal:.*definitely-missing/i.test(e.message) || /needed a single revision/i.test(e.message),
    'error must carry the git stderr diagnostic',
  );
});

test('CR2: mutatingRun returns stdout on success', () => {
  const root = scratchGitRepo();
  const out = mutatingRun(['rev-parse', '--is-inside-work-tree'], root);
  assert.equal(out.trim(), 'true');
});

test('131022: mutatingRun ignores inherited hook locations when writing config', () => {
  const host = scratchGitRepo();
  const fixture = scratchGitRepo();
  const inherited = {
    GIT_DIR: process.env.GIT_DIR,
    GIT_WORK_TREE: process.env.GIT_WORK_TREE,
    GIT_INDEX_FILE: process.env.GIT_INDEX_FILE,
  };
  process.env.GIT_DIR = path.join(host, '.git');
  process.env.GIT_WORK_TREE = host;
  process.env.GIT_INDEX_FILE = path.join(host, '.git', 'index');

  try {
    mutatingRun(['config', 'user.name', 'Fixture User'], fixture);
  } finally {
    for (const [key, value] of Object.entries(inherited)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  assert.equal(
    mutatingRun(['config', '--local', '--get', 'user.name'], fixture).trim(),
    'Fixture User',
  );
  assert.throws(() => mutatingRun(['config', '--local', '--get', 'user.name'], host));
});

test('225638 CR5: gitRefs finds a body marker and returns the clean subject', () => {
  const root = scratchGitRepo();
  mutatingRun(['config', 'user.email', 'test@example.com'], root);
  mutatingRun(['config', 'user.name', 'Test'], root);
  mutatingRun(['config', 'commit.gpgsign', 'false'], root);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  mutatingRun(['add', 'a.txt'], root);
  mutatingRun(
    ['commit', '-m', 'docs(context): checkpoint', '-m', `ChangeLedger: [#${ID}] [#B]`],
    root,
  );

  const refs = gitRefs(root, ID);
  assert.equal(refs.commits.length, 1);
  assert.equal(refs.commits[0].subject, 'docs(context): checkpoint');
});
