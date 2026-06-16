import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { writeFileAtomic } from '../src/atomic-write.mjs';

test('162017: writeFileAtomic replaces a file with complete content', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-atomic-'));
  const file = path.join(dir, 'doc.md');
  fs.writeFileSync(file, 'old');

  writeFileAtomic(file, 'new');

  assert.equal(fs.readFileSync(file, 'utf8'), 'new');
  assert.deepEqual(
    fs.readdirSync(dir).filter((name) => name.includes('.tmp')),
    [],
  );
});

test('162017: writeFileAtomic removes the temp file if rename fails', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-atomic-'));
  const file = path.join(dir, 'doc.md');
  fs.writeFileSync(file, 'old');
  const fsImpl = {
    ...fs,
    renameSync() {
      throw new Error('rename failed');
    },
  };

  assert.throws(() => writeFileAtomic(file, 'new', { fsImpl }), /rename failed/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'old');
  assert.deepEqual(
    fs.readdirSync(dir).filter((name) => name.includes('.tmp')),
    [],
  );
});
