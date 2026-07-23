import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  defaultRun,
  githubLogin,
  gitRefs,
  mutatingRun,
  ownerHandle,
  receiveGitEnv,
  sanitizedGitEnv,
} from '../src/git.mjs';

const SEP = String.fromCharCode(31);
const ID = '20260613-222918';

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

test('170613: defaultRun includes git stderr in the thrown error on its read path', () => {
  const root = scratchGitRepo();
  assert.throws(
    () => defaultRun(['rev-parse', '--verify', 'refs/heads/definitely-missing'], root),
    (e) =>
      /fatal:.*definitely-missing/i.test(e.message) || /needed a single revision/i.test(e.message),
    'error must carry the git stderr diagnostic',
  );
});

test('170613: defaultRun still returns stdout unchanged on success', () => {
  const root = scratchGitRepo();
  const out = defaultRun(['rev-parse', '--is-inside-work-tree'], root);
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

test('193104 CR6: client sanitization drops quarantine while receive hooks preserve it', () => {
  const before = {
    object: process.env.GIT_OBJECT_DIRECTORY,
    alternates: process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES,
  };
  process.env.GIT_OBJECT_DIRECTORY = '/quarantine/objects';
  process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES = '/main/objects';
  try {
    assert.equal(sanitizedGitEnv().GIT_OBJECT_DIRECTORY, undefined);
    assert.equal(sanitizedGitEnv().GIT_ALTERNATE_OBJECT_DIRECTORIES, undefined);
    assert.equal(receiveGitEnv().GIT_OBJECT_DIRECTORY, '/quarantine/objects');
    assert.equal(receiveGitEnv().GIT_ALTERNATE_OBJECT_DIRECTORIES, '/main/objects');
  } finally {
    if (before.object === undefined) delete process.env.GIT_OBJECT_DIRECTORY;
    else process.env.GIT_OBJECT_DIRECTORY = before.object;
    if (before.alternates === undefined) delete process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
    else process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES = before.alternates;
  }
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
