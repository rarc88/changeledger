import assert from 'node:assert/strict';
import { test } from 'node:test';
import { githubLogin, gitRefs, ownerHandle } from '../src/git.mjs';

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
