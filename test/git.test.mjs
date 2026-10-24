import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertCommitObject,
  changedPathsInRange,
  checkoutBranch,
  currentBranch,
  defaultGhRun,
  defaultRun,
  githubLogin,
  gitPrefix,
  gitRefs,
  isAncestor,
  isValidBranchName,
  mergeRecord,
  mutatingRun,
  ownerHandle,
} from '../src/git.mjs';
import { initGitFixture, sanitizedEnv } from './helpers/git-env.mjs';

const SEP = String.fromCharCode(31);
const RECORD_SEP = String.fromCharCode(30);
const ID = '20260613-222918';

test('161655 CR3: branch names are validated by git check-ref-format', () => {
  const calls = [];
  const run = (args, cwd) => {
    calls.push({ args, cwd });
    if (args.at(-1).includes('..')) throw new Error('invalid ref');
    return '';
  };

  assert.equal(isValidBranchName('changes/feature/id', run, '/repo'), true);
  assert.equal(isValidBranchName('bad..id', run, '/repo'), false);
  assert.deepEqual(calls, [
    { args: ['check-ref-format', '--branch', 'changes/feature/id'], cwd: '/repo' },
    { args: ['check-ref-format', '--branch', 'bad..id'], cwd: '/repo' },
  ]);
});

test('161655 CR3: the native git validator rejects an invalid rendered ref', () => {
  assert.equal(isValidBranchName('bad..20260731-161655'), false);
});

test('161655 CR5: current branch and ancestry use explicit native git queries', () => {
  const calls = [];
  const run = (args, cwd) => {
    calls.push({ args, cwd });
    if (args[0] === 'branch') return 'work/20260731-161655\n';
    return '';
  };

  assert.equal(currentBranch('/repo', run), 'work/20260731-161655');
  assert.equal(isAncestor('/repo', 'dev', 'HEAD', run), true);
  assert.deepEqual(calls, [
    { args: ['branch', '--show-current'], cwd: '/repo' },
    { args: ['merge-base', '--is-ancestor', 'dev', 'HEAD'], cwd: '/repo' },
  ]);
});

test('161655 CR5: failed merge-base means the branch does not descend from baseline', () => {
  const run = () => {
    throw new Error('not an ancestor');
  };
  assert.equal(isAncestor('/repo', 'dev', 'HEAD', run), false);
});

test('220545 CR2: gitPrefix removes only Git record terminator', () => {
  const calls = [];
  const run = (args, cwd) => {
    calls.push({ args, cwd });
    if (args[1] === '--absolute-git-dir') return '/repo/.git\n';
    return 'dir with space/line\nbreak/\r\n';
  };

  assert.equal(gitPrefix('/repo/subdir', '/repo', run), 'dir with space/line\nbreak/');
  assert.deepEqual(calls, [
    { args: ['rev-parse', '--absolute-git-dir'], cwd: '/repo' },
    {
      args: ['--git-dir=/repo/.git', '--work-tree=/repo', 'rev-parse', '--show-prefix'],
      cwd: '/repo/subdir',
    },
  ]);
});

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
  const dir = fileURLToPath(new URL('.', import.meta.url));
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
        // `new --from` lands a composed document and never resolves an
        // identity: `newChangeFrom` takes the owner from the document, so it
        // reaches no resolver and `--owner` beside it is refused outright
        // (20261020-172221 D2). Exempt for the same reason as `--help`.
        if (call.text.includes("'--from'")) continue;
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
        `abc123${SEP}feat: do it [#${ID}]${SEP}2026-06-14T10:00:00Z${SEP}${RECORD_SEP}`,
        `def456${SEP}fix: tweak [#${ID}]${SEP}2026-06-14T11:00:00Z${SEP}${RECORD_SEP}`,
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
  const workspace = fs.readFileSync(path.resolve('pnpm-workspace.yaml'), 'utf8');
  assert.match(pkg.scripts.test, /CHANGELEDGER_NO_GH=1/);
  assert.match(pkg.scripts.verify, /CHANGELEDGER_NO_GH=1/);
  assert.doesNotMatch(pkg.scripts.verify, /\bexport\b/);
  assert.match(workspace, /^shellEmulator:\s*true$/m);
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

test('20260805-052741 CR1: checkoutBranch returns the trimmed branch name', () => {
  const git = () => 'feature/x\n';
  assert.equal(checkoutBranch('/x', git), 'feature/x');
});

test('20260805-052741 CR3: checkoutBranch is empty on detached HEAD', () => {
  const git = () => 'HEAD\n';
  assert.equal(checkoutBranch('/x', git), '');
});

test('20260805-052741 CR3: checkoutBranch is empty when the subprocess fails', () => {
  const boom = () => {
    throw new Error('not a git repository');
  };
  assert.equal(checkoutBranch('/x', boom), '');
});

// --- mutatingRun (git run variant that surfaces stderr on failure) ---

// Hook-safety: strip the repo-location vars git exports inside hooks so the
// scratch repo below is the real target (same rationale as commit.test.mjs).
function scratchGitRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-git-'));
  execFileSync('git', ['init', '-q'], { cwd: root, env: sanitizedEnv(), encoding: 'utf8' });
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

// --- attribution is scoped to the declaration (20260730-002341 CR1-CR2) ---

// Commits `[subject, ...bodyParagraphs]` into a fresh scratch repo and returns
// its root, so an attribution test states only the messages it is about.
function scratchRepoWithCommits(messages) {
  const root = scratchGitRepo();
  mutatingRun(['config', 'user.email', 'test@example.com'], root);
  mutatingRun(['config', 'user.name', 'Test'], root);
  mutatingRun(['config', 'commit.gpgsign', 'false'], root);
  messages.forEach((parts, index) => {
    const file = `f${index}.txt`;
    fs.writeFileSync(path.join(root, file), `${file}\n`);
    mutatingRun(['add', file], root);
    mutatingRun(['commit', ...parts.flatMap((part) => ['-m', part])], root);
  });
  return root;
}

test('002341 CR1: a ChangeLedger: none commit is not attributed to an id its reason cites', () => {
  const root = scratchRepoWithCommits([
    ['feat: initial [#X]'],
    ['chore: cleanup', 'ChangeLedger: none — supersedes [#X], no longer needed'],
  ]);

  const refs = gitRefs(root, 'X');
  assert.deepEqual(
    refs.commits.map((c) => c.subject),
    ['feat: initial [#X]'],
  );
});

test('002341 CR2: a prose id in the body does not attribute; subject and declaration do', () => {
  const root = scratchRepoWithCommits([
    ['feat: third [#Y]', 'Related to work also tracked under [#Z] in a prose note.'],
    ['docs(context): checkpoint', 'ChangeLedger: [#Y] [#Z]'],
  ]);

  assert.deepEqual(
    gitRefs(root, 'Y')
      .commits.map((c) => c.subject)
      .sort(),
    ['docs(context): checkpoint', 'feat: third [#Y]'],
  );
  assert.deepEqual(
    gitRefs(root, 'Z').commits.map((c) => c.subject),
    ['docs(context): checkpoint'],
  );
});

// The relaxed body grammar (CR3) makes the lines under the declaration legal
// free text; attribution must read the declaration line only, or that tail
// becomes a second way to join a change's refs without declaring it.
test('002341 CR2: a marker cited in the free tail below a declaration does not attribute', () => {
  const root = scratchRepoWithCommits([
    ['docs(context): checkpoint', 'ChangeLedger: [#Y] [#Z]', 'Supersedes [#W], now dropped.'],
  ]);

  assert.deepEqual(gitRefs(root, 'W').commits, []);
  assert.deepEqual(
    gitRefs(root, 'Y').commits.map((c) => c.subject),
    ['docs(context): checkpoint'],
  );
});

// Pins the subject seat as "the marker CLOSES the subject" (MARKER_RE), not
// "the subject mentions the marker": a mid-subject marker is a mention. The
// second commit is the positive control, so an empty result cannot pass this
// test by way of a broken fixture or a grep that matched nothing.
test('002341 CR2: a marker that does not close the subject does not attribute', () => {
  const root = scratchRepoWithCommits([
    ['feat: touch [#Q] while doing something else'],
    ['feat: proper close [#Q]'],
  ]);

  assert.deepEqual(
    gitRefs(root, 'Q').commits.map((c) => c.subject),
    ['feat: proper close [#Q]'],
  );
});

// --- assertCommitObject (CR5: never accept a non-commit via a silent peel) --

test('151640 CR5: assertCommitObject accepts a ref that resolves directly to a commit', () => {
  const root = scratchGitRepo();
  execFileSync('git', ['commit', '--allow-empty', '-qm', 'root'], {
    cwd: root,
    env: sanitizedEnv(),
  });
  assert.doesNotThrow(() => assertCommitObject(root, 'HEAD'));
});

test('151640 CR5: assertCommitObject rejects a ref resolving to an annotated tag, naming the real type', () => {
  const root = scratchGitRepo();
  execFileSync('git', ['commit', '--allow-empty', '-qm', 'root'], {
    cwd: root,
    env: sanitizedEnv(),
  });
  execFileSync('git', ['tag', '-a', '-m', 'tag', 'v1'], { cwd: root, env: sanitizedEnv() });

  assert.throws(() => assertCommitObject(root, 'refs/tags/v1'), /resolves to a tag, not a commit/);
});

test('151640 CR5: assertCommitObject rejects a ref resolving to a blob, naming the real type', () => {
  const root = scratchGitRepo();
  const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], {
    cwd: root,
    env: sanitizedEnv(),
    input: 'not a commit',
    encoding: 'utf8',
  }).trim();
  execFileSync('git', ['update-ref', 'refs/changeledger/blob-ref', blob], {
    cwd: root,
    env: sanitizedEnv(),
  });

  assert.throws(
    () => assertCommitObject(root, 'refs/changeledger/blob-ref'),
    /resolves to a blob, not a commit/,
  );
});

test('151640 CR5: assertCommitObject never peels through ^{commit} (rejects a tree directly)', () => {
  const root = scratchGitRepo();
  const tree = execFileSync('git', ['write-tree'], {
    cwd: root,
    env: sanitizedEnv(),
    encoding: 'utf8',
  }).trim();

  assert.throws(() => assertCommitObject(root, tree), /resolves to a tree, not a commit/);
});

// --- mergeRecord (20261018-131621 CR10/CR11/CR12: acceptance derived from a
// local merge, never from a remote and never from the current checkout) ---

function initFixture(root) {
  initGitFixture(root);
  execFileSync('git', ['checkout', '-q', '-b', 'dev'], { cwd: root, env: sanitizedEnv() });
  execFileSync('git', ['commit', '--allow-empty', '-qm', 'root'], {
    cwd: root,
    env: sanitizedEnv(),
  });
  return root;
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, env: sanitizedEnv(), encoding: 'utf8' });
}

function workBranch(root, name) {
  git(root, ['checkout', '-q', '-b', name]);
  git(root, ['commit', '--allow-empty', '-qm', `work on ${name}`]);
  git(root, ['checkout', '-q', 'dev']);
}

test('20261018-131621 CR10: a branch merged into the integration branch yields the merge commit sha and instant', () => {
  const root = initFixture(fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-merge-')));
  workBranch(root, 'feature/x');
  git(root, ['merge', '--no-ff', '-q', '-m', 'merge feature/x', 'feature/x']);

  const record = mergeRecord(root, 'feature/x', 'dev');
  const head = git(root, ['rev-parse', 'HEAD']).trim();
  const when = git(root, ['log', '-1', '--format=%ct', 'HEAD']).trim();

  assert.equal(record.sha, head.slice(0, 7));
  assert.equal(record.at, new Date(Number(when) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'));
  assert.match(record.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

test('20261018-131621 CR11: a branch that is not merged into the integration branch yields no record', () => {
  const root = initFixture(fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-merge-')));
  workBranch(root, 'feature/x');

  assert.equal(mergeRecord(root, 'feature/x', 'dev'), null);
});

test('20261018-131621 CR12: a branch absent from the local repo is no merge, not an error', () => {
  const root = initFixture(fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-merge-')));

  assert.equal(mergeRecord(root, 'feature/gone', 'dev'), null);
  assert.equal(mergeRecord(root, '', 'dev'), null);

  // A change with no recorded branch must not be interpolated into a ref name:
  // `refs/heads/${undefined}` is a legal branch name, and a repo that happens
  // to hold it would hand that change someone else's merge.
  workBranch(root, 'undefined');
  git(root, ['merge', '--no-ff', '-q', '-m', 'merge undefined', 'undefined']);
  assert.equal(mergeRecord(root, undefined, 'dev'), null);
  assert.equal(mergeRecord(root, 'feature/gone', undefined), null);
});

test('20261018-131621 CR12: a deleted branch is not resurrected through a same-named tag', () => {
  const root = initFixture(fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-merge-')));
  workBranch(root, 'feature/x');
  git(root, ['merge', '--no-ff', '-q', '-m', 'merge feature/x', 'feature/x']);
  git(root, ['branch', '-q', '-D', 'feature/x']);
  // gitrevisions(7) resolves the full ref of an absent branch through
  // `refs/tags/<name>` (20261012-175147), so a tag a fetch or `git tag` can
  // create would otherwise hand the deleted branch a merge it no longer has.
  git(root, ['tag', 'refs/heads/feature/x', 'HEAD^2']);

  assert.equal(mergeRecord(root, 'feature/x', 'dev'), null);
});

test('20261018-131621 CR11: an absent integration branch is not resolved through a same-named tag', () => {
  const root = initFixture(fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-merge-')));
  workBranch(root, 'feature/x');
  git(root, ['merge', '--no-ff', '-q', '-m', 'merge feature/x', 'feature/x']);
  git(root, ['tag', 'refs/heads/integration', 'HEAD']);

  assert.equal(mergeRecord(root, 'feature/x', 'integration'), null);
});

test('20261018-131621 CR10: an integration branch absent locally yields no record instead of reaching for a remote', () => {
  const root = initFixture(fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-merge-')));
  workBranch(root, 'feature/x');
  git(root, ['merge', '--no-ff', '-q', '-m', 'merge feature/x', 'feature/x']);
  // The merge really happened on `dev`; `integration` names a branch this clone
  // does not have, which must read as "nothing detected", not as a fetch.
  assert.equal(mergeRecord(root, 'feature/x', 'integration'), null);

  const calls = [];
  const spy = (args, cwd) => {
    calls.push(args);
    return defaultRun(args, cwd);
  };
  mergeRecord(root, 'feature/x', 'integration', spy);
  assert.ok(
    calls.every((args) => !args.some((a) => /origin|fetch|ls-remote/.test(String(a)))),
    'merge detection must never consult a remote',
  );
});

test('20261018-131621 CR10: a fast-forwarded branch is accepted at its own tip', () => {
  const root = initFixture(fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-merge-')));
  workBranch(root, 'feature/x');
  git(root, ['merge', '--ff-only', '-q', 'feature/x']);

  const tip = git(root, ['rev-parse', 'refs/heads/feature/x']).trim();
  const record = mergeRecord(root, 'feature/x', 'dev');

  assert.equal(record.sha, tip.slice(0, 7));
  assert.match(record.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

test('20261018-131621 CR10: the merge that landed the branch wins over later merges', () => {
  const root = initFixture(fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-merge-')));
  workBranch(root, 'feature/x');
  git(root, ['merge', '--no-ff', '-q', '-m', 'merge feature/x', 'feature/x']);
  const landing = git(root, ['rev-parse', 'HEAD']).trim();

  workBranch(root, 'feature/y');
  git(root, ['merge', '--no-ff', '-q', '-m', 'merge feature/y', 'feature/y']);

  assert.equal(mergeRecord(root, 'feature/x', 'dev').sha, landing.slice(0, 7));
});

// --- changedPathsInRange (20261024-121022 CR5/CR6: the paths a change's branch
// touched, read the way `stagedFiles` reads the index, so a direct `done` can be
// decided from git and every doubt fails closed) ---

function commitFile(root, file, content = 'x\n') {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
  git(root, ['add', '--', file]);
  git(root, ['commit', '-qm', `touch ${file}`]);
}

function branchTouching(root, name, files) {
  git(root, ['checkout', '-q', '-b', name]);
  for (const file of files) commitFile(root, file);
  git(root, ['checkout', '-q', 'dev']);
}

test('20261024-121022 CR5: changedPathsInRange lists what the branch changed since it forked', () => {
  const root = initFixture(fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-range-')));
  branchTouching(root, 'change/x', ['src/x.mjs', '.changeledger/changes/x.md']);
  // Work that lands on the integration branch after the fork is not the change's.
  commitFile(root, 'later-on-dev.txt');

  assert.deepEqual(changedPathsInRange(root, 'dev', 'change/x').sort(), [
    '.changeledger/changes/x.md',
    'src/x.mjs',
  ]);
});

test('20261024-121022 CR5: changedPathsInRange pins the stagedFiles axes on <base>...<head>', () => {
  const calls = [];
  const run = (args) => {
    calls.push(args);
    return args[0] === 'show-ref' ? '' : 'a\0b c\0';
  };
  assert.deepEqual(changedPathsInRange('/repo', 'dev', 'change/x', run), ['a', 'b c']);
  assert.deepEqual(calls.at(-1), [
    '-c',
    'core.quotePath=false',
    'diff',
    '-z',
    '--no-renames',
    '--no-relative',
    '--ignore-submodules=none',
    '--name-only',
    'refs/heads/dev...refs/heads/change/x',
    '--',
  ]);
});

test('20261024-121022 CR5: changedPathsInRange keeps raw paths, splits renames and ignores diff.relative', () => {
  const root = initFixture(fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-range-')));
  commitFile(root, 'docs/old.md', 'same body\n'.repeat(20));
  git(root, ['checkout', '-q', '-b', 'change/x']);
  git(root, ['mv', 'docs/old.md', 'docs/new.md']);
  git(root, ['commit', '-qm', 'rename']);
  commitFile(root, 'docs/ñandú .md');
  git(root, ['checkout', '-q', 'dev']);
  git(root, ['config', 'diff.relative', 'true']);
  git(root, ['config', 'core.quotePath', 'true']);

  assert.deepEqual(changedPathsInRange(path.join(root, 'docs'), 'dev', 'change/x').sort(), [
    'docs/new.md',
    'docs/old.md',
    'docs/ñandú .md',
  ]);
});

test('20261024-121022 CR6: changedPathsInRange names a branch that does not exist locally', () => {
  const root = initFixture(fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-range-')));
  // A same-named tag must not stand in for the absent branch.
  git(root, ['tag', 'refs/heads/change/gone']);
  assert.throws(
    () => changedPathsInRange(root, 'dev', 'change/gone'),
    /^Error: branch "change\/gone" does not exist locally$/,
  );
  assert.throws(
    () => changedPathsInRange(root, 'main', 'dev'),
    /^Error: branch "main" does not exist locally$/,
  );
});

test('20261024-121022 CR6: changedPathsInRange fails closed naming git missing, old git or the git error', () => {
  const missing = () => {
    const error = new Error('spawnSync git ENOENT');
    error.code = 'ENOENT';
    throw error;
  };
  assert.throws(
    () => changedPathsInRange('/repo', 'dev', 'change/x', missing),
    /^Error: git is not installed or not on PATH$/,
  );

  const failingDiff = (stderr) => (args) => {
    if (args[0] === 'show-ref') return '';
    throw new Error(`Command failed: git ${args.join(' ')}\n${stderr}`);
  };
  assert.throws(
    () =>
      changedPathsInRange(
        '/repo',
        'dev',
        'change/x',
        failingDiff("error: unknown option `no-relative'"),
      ),
    /^Error: git >= 2\.28 is required for --no-relative: error: unknown option `no-relative'$/,
  );
  assert.throws(
    () =>
      changedPathsInRange('/repo', 'dev', 'change/x', failingDiff('fatal: bad object deadbeef')),
    /^Error: git diff dev\.\.\.change\/x failed: fatal: bad object deadbeef$/,
  );
});
