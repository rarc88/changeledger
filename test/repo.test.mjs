import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { resolveRepoPath } from '../src/config.mjs';
import { loadRepo } from '../src/repo.mjs';

function fixture(changesDir = '.sl/changes') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-'));
  const changes = path.join(root, '.sl', 'changes');
  fs.mkdirSync(changes, { recursive: true });
  fs.writeFileSync(
    path.join(root, '.sl', 'config.yml'),
    `language: en\nchanges_dir: ${changesDir}\ntypes:\n  feature:\n    stages: [request, plan]\n`,
  );
  fs.writeFileSync(
    path.join(changes, '0001-x.md'),
    '---\nid: "0001"\ntitle: X\ntype: feature\nstatus: draft\ncreated: 2026-06-13T00:00:00Z\ndepends_on: []\n---\n\n## Request\n\nHi.\n',
  );
  return root;
}

test('loadRepo finds .sl, reads config and changes', () => {
  const root = fixture();
  const repo = loadRepo(root);
  assert.equal(repo.config.language, 'en');
  assert.equal(repo.changes.length, 1);
  assert.equal(repo.changes[0].frontmatter.id, '0001');
});

test('loadRepo walks up from a subdirectory', () => {
  const root = fixture();
  const sub = path.join(root, 'src', 'deep');
  fs.mkdirSync(sub, { recursive: true });
  const repo = loadRepo(sub);
  assert.equal(repo.changes.length, 1);
});

test('loadRepo throws outside a Spec Ledger repo', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-empty-'));
  assert.throws(() => loadRepo(empty), /Run `sl init`/);
});

test('CR1: a traversal changes_dir is rejected and reads nothing outside', () => {
  const root = fixture('../outside');
  assert.throws(() => loadRepo(root), /changes_dir.*escapes the repo root/);
});

test('CR2: an absolute changes_dir is rejected before any IO', () => {
  const root = fixture(path.join(os.tmpdir(), 'sl-abs-target'));
  assert.throws(() => loadRepo(root), /changes_dir.*must be relative/);
});

test('CR3: a configured dir symlinked outside the repo is rejected', () => {
  const root = fixture('.sl/changes');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-ext-'));
  const link = path.join(root, 'escape');
  fs.symlinkSync(outside, link);
  assert.throws(() => resolveRepoPath(root, 'escape', 'specs_dir'), /specs_dir.*symlink/);
});

test('CR4: default and normalized internal paths keep working', () => {
  assert.equal(loadRepo(fixture()).changes.length, 1);
  assert.equal(loadRepo(fixture('./.sl/changes')).changes.length, 1);
});
