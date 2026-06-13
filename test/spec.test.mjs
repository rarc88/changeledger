import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadRepo } from '../src/repo.mjs';
import { parseSpec } from '../src/spec.mjs';

test('parseSpec reads frontmatter and body', () => {
  const text =
    '---\ntitle: Arch\nupdated: 2026-06-13T21:00:00Z\ntags: [a, b]\n---\n\n# Body\n\ntext\n';
  const s = parseSpec(text);
  assert.equal(s.frontmatter.title, 'Arch');
  assert.deepEqual(s.frontmatter.tags, ['a', 'b']);
  assert.match(s.body, /# Body/);
});

test('parseSpec throws without frontmatter', () => {
  assert.throws(() => parseSpec('# just a body'), /frontmatter/i);
});

test('loadRepo picks up specs from specs_dir', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-spec-'));
  fs.mkdirSync(path.join(root, '.sl', 'changes'), { recursive: true });
  fs.mkdirSync(path.join(root, '.sl', 'specs'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.sl', 'config.yml'),
    'changes_dir: .sl/changes\nspecs_dir: .sl/specs\ntypes:\n  feature:\n    stages: [request]\n',
  );
  fs.writeFileSync(
    path.join(root, '.sl', 'specs', 'arch.md'),
    '---\ntitle: Arch\nupdated: 2026-06-13T21:00:00Z\ntags: []\n---\n\nbody\n',
  );

  const repo = loadRepo(root);
  assert.equal(repo.specs.length, 1);
  assert.equal(repo.specs[0].frontmatter.title, 'Arch');
});
