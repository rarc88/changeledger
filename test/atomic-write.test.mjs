import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { mutateFileAtomic, writeFileAtomic } from '../src/atomic-write.mjs';

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

test('212314 CR3: mutateFileAtomic removes the lock when the mutation throws', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-atomic-'));
  const file = path.join(dir, 'doc.md');
  fs.writeFileSync(file, 'old');

  assert.throws(
    () =>
      mutateFileAtomic(file, () => {
        throw new Error('boom');
      }),
    /boom/,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), 'old');
  assert.deepEqual(
    fs.readdirSync(dir).filter((name) => name.endsWith('.lock')),
    [],
  );

  mutateFileAtomic(file, (text) => `${text}+new`);
  assert.equal(fs.readFileSync(file, 'utf8'), 'old+new');
});

test('212314 CR3: mutateFileAtomic removes its lock when metadata write fails', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-atomic-'));
  const file = path.join(dir, 'doc.md');
  fs.writeFileSync(file, 'old');
  const fsImpl = {
    ...fs,
    writeFileSync(target, ...args) {
      if (typeof target === 'number') throw new Error('metadata failed');
      return fs.writeFileSync(target, ...args);
    },
  };

  assert.throws(() => mutateFileAtomic(file, () => 'new', { fsImpl }), /metadata failed/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'old');
  assert.deepEqual(
    fs.readdirSync(dir).filter((name) => name.endsWith('.lock')),
    [],
  );
});

test('212314 CR1/CR3: mutateFileAtomic does not delete an existing old lock', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-atomic-'));
  const file = path.join(dir, 'doc.md');
  fs.writeFileSync(file, 'old');
  const lock = path.join(dir, '.doc.md.lock');
  fs.writeFileSync(lock, 'active');
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lock, old, old);

  assert.throws(
    () => mutateFileAtomic(file, () => 'new', { waitMs: 5, retryMs: 1 }),
    /timed out waiting for lock/,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), 'old');
  assert.equal(fs.existsSync(lock), true);
});

test('212314 CR4: mutateFileAtomic keeps the old file when atomic write fails', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-atomic-'));
  const file = path.join(dir, 'doc.md');
  fs.writeFileSync(file, 'old');
  const fsImpl = {
    ...fs,
    renameSync() {
      throw new Error('rename failed');
    },
  };

  assert.throws(() => mutateFileAtomic(file, () => 'new', { fsImpl }), /rename failed/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'old');
  assert.deepEqual(
    fs.readdirSync(dir).filter((name) => name.includes('.tmp') || name.endsWith('.lock')),
    [],
  );
});
