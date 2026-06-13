import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadRepo } from '../src/repo.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-'));
  const changes = path.join(root, '.sl', 'changes');
  fs.mkdirSync(changes, { recursive: true });
  fs.writeFileSync(
    path.join(root, '.sl', 'config.yml'),
    'language: en\nchanges_dir: .sl/changes\ntypes:\n  feature:\n    stages: [request, plan]\n',
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
