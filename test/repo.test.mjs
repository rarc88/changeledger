import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { resolveRepoPath } from '../src/config.mjs';
import { loadRepo } from '../src/repo.mjs';

function fixture(changesDir = '.changeledger/changes') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-'));
  const changes = path.join(root, '.changeledger', 'changes');
  fs.mkdirSync(changes, { recursive: true });
  fs.writeFileSync(
    path.join(root, '.changeledger', 'config.yml'),
    `language: en\nchanges_dir: ${changesDir}\ntypes:\n  feature:\n    stages: [request, plan]\n`,
  );
  fs.writeFileSync(
    path.join(changes, '0001-x.md'),
    '---\nid: "0001"\ntitle: X\ntype: feature\nstatus: draft\ncreated: 2026-06-13T00:00:00Z\ndepends_on: []\n---\n\n## Request\n\nHi.\n',
  );
  return root;
}

test('loadRepo finds .changeledger, reads config and changes', () => {
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

test('loadRepo throws outside a ChangeLedger repo', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-empty-'));
  assert.throws(() => loadRepo(empty), /Run `changeledger init`/);
});

test('ChangeLedger migration does not discover the retired project directory (CR3, CR9)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-retired-'));
  fs.mkdirSync(path.join(root, '.sl'), { recursive: true });
  fs.writeFileSync(path.join(root, '.sl', 'config.yml'), 'language: en\n');
  assert.throws(() => loadRepo(root), /no \.changeledger\/ found/);
});

test('CR1: a traversal changes_dir is rejected and reads nothing outside', () => {
  const root = fixture('../outside');
  assert.throws(() => loadRepo(root), /changes_dir.*escapes the repo root/);
});

test('CR2: an absolute changes_dir is rejected before any IO', () => {
  const root = fixture(path.join(os.tmpdir(), 'changeledger-abs-target'));
  assert.throws(() => loadRepo(root), /changes_dir.*must be relative/);
});

test('CR3: a configured dir symlinked outside the repo is rejected', () => {
  const root = fixture('.changeledger/changes');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-ext-'));
  const link = path.join(root, 'escape');
  fs.symlinkSync(outside, link);
  assert.throws(() => resolveRepoPath(root, 'escape', 'specs_dir'), /specs_dir.*symlink/);
});

test('CR4: default and normalized internal paths keep working', () => {
  assert.equal(loadRepo(fixture()).changes.length, 1);
  assert.equal(loadRepo(fixture('./.changeledger/changes')).changes.length, 1);
});

// 20260615-175731 — an intermediate ancestor is a symlink and the final target
// does not exist yet. The shape check passes and existsSync(resolved) is false,
// so the realpath guard must inspect the nearest existing ancestor.
test('175731 CR1: an external intermediate symlink with a non-existent target is rejected', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-'));
  fs.mkdirSync(path.join(root, '.changeledger'), { recursive: true });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-ext-'));
  fs.symlinkSync(outside, path.join(root, '.changeledger', 'escape'));
  assert.throws(
    () => resolveRepoPath(root, '.changeledger/escape/newdir', 'changes_dir'),
    /changes_dir.*symlink/,
  );
  assert.ok(!fs.existsSync(path.join(outside, 'newdir')), 'must not create in the external target');
});

test('175731 CR2: an internal intermediate symlink is accepted for a non-existent target', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-'));
  const real = path.join(root, '.changeledger', 'real');
  fs.mkdirSync(real, { recursive: true });
  fs.symlinkSync(real, path.join(root, '.changeledger', 'link'));
  const resolved = resolveRepoPath(root, '.changeledger/link/newdir', 'changes_dir');
  assert.equal(resolved, path.join(root, '.changeledger', 'link', 'newdir'));
});
