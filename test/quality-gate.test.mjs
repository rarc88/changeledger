// The quality gate aborted before reading a line of code whenever a git
// worktree sat under `.claude/worktrees/`: that worktree is a checkout of this
// same repository, so it carries a copy of this repository's own `biome.json`,
// and Biome refused to run with a nested root configuration. The fix has two
// halves — git ignores the path, and Biome's scanner honours that ignore — and
// either half alone leaves the gate broken, which is what these pin.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(repo, name), 'utf8');

// Asserted key by key rather than as a whole object: a later, unrelated `vcs`
// setting must not cost this guard a retarget.
test('Biome honours the repository ignore file', () => {
  const { vcs } = JSON.parse(read('biome.json'));
  assert.equal(vcs?.enabled, true);
  assert.equal(vcs?.clientKind, 'git');
  assert.equal(vcs?.useIgnoreFile, true);
});

// Asked of git rather than matched against the file: what has to hold is that
// the path is ignored, not that one spelling of the pattern is present.
test('git ignores the worktrees the app creates', () => {
  const ignored = spawnSync('git', ['check-ignore', '-q', '.claude/worktrees/any-session'], {
    cwd: repo,
  });
  assert.equal(
    ignored.status,
    0,
    'the path is not ignored, so Biome rediscovers the nested configuration',
  );
});

test('the analysed paths are unchanged', () => {
  const { files } = JSON.parse(read('biome.json'));
  assert.deepEqual(files.includes, ['bin/**', 'src/**', 'test/**', '!src/viewer/public/vendor']);
});
