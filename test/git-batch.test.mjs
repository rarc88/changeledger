import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { capturedRun } from '../src/git.mjs';
import {
  assertRegularBlobEntry,
  batchBlobReader,
  GIT_MAX_BUFFER,
  treeEntries,
} from '../src/git-batch.mjs';
import { sanitizedEnv } from './helpers/git-env.mjs';

const OID_A = 'a'.repeat(40);
const OID_B = 'b'.repeat(40);

function blobEntry(oid, path) {
  return { mode: '100644', type: 'blob', oid, path };
}

// Two-phase reader stub: `cat-file --batch-check` returns text size headers,
// `cat-file --batch` returns the raw content buffer. A stub omitting either
// phase leaves it undefined so a test can assert the reader fails before it.
function stubRun({ check, batch } = {}) {
  return (args) => {
    if (args[0] === 'cat-file' && args[1] === '--batch-check') return check;
    if (args[0] === 'cat-file' && args[1] === '--batch') return batch;
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  };
}

function batchBuffer(...blobs) {
  return Buffer.concat(
    blobs.flatMap(({ oid, content }) => [
      Buffer.from(`${oid} blob ${content.length}\n`),
      content,
      Buffer.from('\n'),
    ]),
  );
}

test('CR2/CR7 support: treeEntries rejects output not NUL-terminated as malformed path framing', () => {
  const run = () => 'not-nul-terminated';
  assert.throws(() => treeEntries('/repo', 'HEAD', run), /malformed path framing/);
});

test('CR2/CR7 support: treeEntries rejects a record that does not match the tree-entry grammar', () => {
  const run = () => 'not a valid ls-tree record\0';
  assert.throws(() => treeEntries('/repo', 'HEAD', run), /malformed tree entry/);
});

test('CR2/CR7 support: treeEntries returns [] for an empty tree without throwing', () => {
  const run = () => '';
  assert.deepEqual(treeEntries('/repo', 'HEAD', run), []);
});

test('CR2/CR7 support: treeEntries parses a well-formed record', () => {
  const run = () => `100644 blob ${OID_A}\tspecs/a.md\0`;
  assert.deepEqual(treeEntries('/repo', 'HEAD', run), [
    { mode: '100644', type: 'blob', oid: OID_A, path: 'specs/a.md' },
  ]);
});

test('CR2/CR7 support: batchBlobReader throws when the sizing pass reports the object missing', () => {
  const run = stubRun({ check: `${OID_A} missing\n` });
  assert.throws(
    () => batchBlobReader('/repo', [blobEntry(OID_A, 'specs/a.md')], run),
    /is missing/,
  );
});

test('CR2/CR7 support: batchBlobReader rejects a sizing pass naming an unexpected object type', () => {
  const run = stubRun({ check: `${OID_A} tree 4\n` });
  assert.throws(
    () => batchBlobReader('/repo', [blobEntry(OID_A, 'specs/a.md')], run),
    /unexpected object/,
  );
});

test('CR2/CR7 support: batchBlobReader rejects a sizing pass returning fewer objects than requested', () => {
  // Two oids requested, one size line answered.
  const run = stubRun({ check: `${OID_A} blob 2\n` });
  assert.throws(
    () =>
      batchBlobReader(
        '/repo',
        [blobEntry(OID_A, 'specs/a.md'), blobEntry(OID_B, 'specs/b.md')],
        run,
      ),
    /unexpected number of objects/,
  );
});

test('CR2/CR7 support: batchBlobReader rejects content with no header terminator as malformed', () => {
  const run = stubRun({
    check: `${OID_A} blob 2\n`,
    batch: Buffer.from('no newline anywhere in this buffer'),
  });
  assert.throws(
    () => batchBlobReader('/repo', [blobEntry(OID_A, 'specs/a.md')], run),
    /malformed output/,
  );
});

test('CR2/CR7 support: batchBlobReader rejects a content read yielding fewer objects than its chunk', () => {
  const content = Buffer.from('hi');
  const run = stubRun({
    check: `${OID_A} blob 2\n${OID_B} blob 2\n`,
    // Both oids sized, but the content read only frames the first one.
    batch: batchBuffer({ oid: OID_A, content }),
  });
  assert.throws(
    () =>
      batchBlobReader(
        '/repo',
        [blobEntry(OID_A, 'specs/a.md'), blobEntry(OID_B, 'specs/b.md')],
        run,
      ),
    /unexpected number of objects/,
  );
});

test('CR2/CR7 support: batchBlobReader rejects reading an oid that was never requested', () => {
  const content = Buffer.from('hello');
  const run = stubRun({
    check: `${OID_A} blob ${content.length}\n`,
    batch: batchBuffer({ oid: OID_A, content }),
  });
  const read = batchBlobReader('/repo', [blobEntry(OID_A, 'specs/a.md')], run);
  assert.equal(read(OID_A), 'hello');
  assert.throws(() => read(OID_B), /was not requested/);
});

test('CR7: batchBlobReader rejects a blob that is not valid UTF-8', () => {
  const content = Buffer.from([0xff, 0xfe]);
  const run = stubRun({
    check: `${OID_A} blob ${content.length}\n`,
    batch: batchBuffer({ oid: OID_A, content }),
  });
  const read = batchBlobReader('/repo', [blobEntry(OID_A, 'specs/a.md')], run);
  assert.throws(() => read(OID_A), /not valid UTF-8/);
});

test('CR8 support: assertRegularBlobEntry rejects symlink, gitlink and tree entries', () => {
  assert.throws(
    () => assertRegularBlobEntry('120000', 'specs/link.md', 'blob'),
    /unsupported Git entry 120000 blob at specs\/link\.md/,
  );
  assert.throws(
    () => assertRegularBlobEntry('160000', 'vendor/dep', 'commit'),
    /unsupported Git entry 160000 commit at vendor\/dep/,
  );
  assert.throws(
    () => assertRegularBlobEntry('040000', 'specs', 'tree'),
    /unsupported Git entry 040000 tree at specs/,
  );
});

test('CR8 support: assertRegularBlobEntry accepts regular blob modes 100644 and 100755', () => {
  assert.doesNotThrow(() => assertRegularBlobEntry('100644', 'specs/a.md', 'blob'));
  assert.doesNotThrow(() => assertRegularBlobEntry('100755', 'scripts/run.sh', 'blob'));
});

test('CR8 support: assertRegularBlobEntry derives type from mode when the caller has none', () => {
  assert.throws(
    () => assertRegularBlobEntry('040000', 'specs'),
    /unsupported Git entry 040000 tree at specs/,
  );
});

// --- byte-bounded chunking over real repositories ---------------------------
//
// The reader must materialize a tree whose TOTAL blob content far exceeds the
// per-call 32 MiB budget. A few large distinct blobs (not thousands of files)
// keep generation fast while still crossing several chunk boundaries.

const MiB = 1024 * 1024;

function initRepo(objectFormat) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-git-batch-'));
  execFileSync('git', ['init', '-q', `--object-format=${objectFormat}`], {
    cwd: dir,
    env: sanitizedEnv(),
  });
  execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: dir, env: sanitizedEnv() });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, env: sanitizedEnv() });
  return dir;
}

// `count` distinct blobs of `blobBytes` each (distinct leading byte => distinct
// oid), committed as regular files. Returns { dir, tree } for a batch read.
function seedLargeState(objectFormat, count, blobBytes) {
  const dir = initRepo(objectFormat);
  const expected = new Map();
  for (let i = 0; i < count; i++) {
    const lead = String.fromCharCode(65 + i);
    const content = lead.repeat(blobBytes);
    fs.writeFileSync(path.join(dir, `blob-${i}.txt`), content);
    expected.set(`blob-${i}.txt`, content);
  }
  execFileSync('git', ['add', '.'], { cwd: dir, env: sanitizedEnv() });
  execFileSync('git', ['commit', '-qm', 'large state'], { cwd: dir, env: sanitizedEnv() });
  return { dir, tree: treeEntries(dir, 'HEAD', capturedRun), expected };
}

function assertReadsBack(dir, tree, expected) {
  const read = batchBlobReader(dir, tree, capturedRun);
  const byPath = new Map(tree.map((entry) => [entry.path, entry]));
  for (const [file, content] of expected) {
    const text = read(byPath.get(file).oid);
    assert.equal(text.length, content.length, `${file} length`);
    assert.equal(text, content, `${file} content`);
  }
}

for (const totalMiB of [17, 32]) {
  test(`reads a ${totalMiB} MiB total state without ENOBUFS (sha1)`, () => {
    // Blobs well under the 32 MiB per-call budget so several chunk boundaries
    // are crossed; total exceeds the old aggregate ceiling.
    const blobBytes = 6 * MiB;
    const count = Math.ceil((totalMiB * MiB) / blobBytes);
    const { dir, tree, expected } = seedLargeState('sha1', count, blobBytes);
    try {
      assertReadsBack(dir, tree, expected);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('reads a 64 MiB total state without ENOBUFS (sha1)', () => {
  const { dir, tree, expected } = seedLargeState('sha1', 8, 8 * MiB);
  try {
    assertReadsBack(dir, tree, expected);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reads a multi-chunk >32 MiB total state without ENOBUFS (sha256)', () => {
  const { dir, tree, expected } = seedLargeState('sha256', 6, 6 * MiB);
  try {
    assertReadsBack(dir, tree, expected);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a single object larger than the chunk budget is rejected fail-closed', () => {
  // One indivisible blob cannot be read within a bounded `cat-file --batch`
  // call, so it is rejected with a clear, bounded diagnostic rather than an
  // opaque ENOBUFS on a multi-MiB partial buffer.
  const { dir, tree } = seedLargeState('sha1', 1, GIT_MAX_BUFFER + MiB);
  try {
    assert.throws(() => batchBlobReader(dir, tree, capturedRun), /over the \d+-byte read budget/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The per-object budget check compares framed `cat-file --batch` bytes
// (header + content + trailing newline) against the chunk budget, not the
// object's CONTENT bytes -- so a blob of exactly the budget in content was
// rejected purely because git's own framing overhead pushed the framed total a
// few bytes past it, with a diagnostic that named the framed size as if it
// were the content size. The boundary must be judged on content bytes, with
// the actual read given enough headroom to cover framing on top.
test('an object of exactly the chunk budget in content bytes is accepted', () => {
  const { dir, tree, expected } = seedLargeState('sha1', 1, GIT_MAX_BUFFER);
  try {
    assertReadsBack(dir, tree, expected);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an object one byte over the chunk budget is rejected naming content size truthfully', () => {
  const { dir, tree } = seedLargeState('sha1', 1, GIT_MAX_BUFFER + 1);
  try {
    assert.throws(
      () => batchBlobReader(dir, tree, capturedRun),
      new RegExp(`is ${GIT_MAX_BUFFER + 1} bytes, over the ${GIT_MAX_BUFFER}-byte read budget`),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CR7: rejects invalid UTF-8 content read from a real repository', () => {
  const dir = initRepo('sha1');
  try {
    fs.writeFileSync(path.join(dir, 'bad.bin'), Buffer.from([0x61, 0xff, 0xfe, 0x62]));
    execFileSync('git', ['add', '.'], { cwd: dir, env: sanitizedEnv() });
    execFileSync('git', ['commit', '-qm', 'bad'], { cwd: dir, env: sanitizedEnv() });
    const tree = treeEntries(dir, 'HEAD', capturedRun);
    const read = batchBlobReader(dir, tree, capturedRun);
    assert.throws(() => read(tree[0].oid), /not valid UTF-8/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects a missing object against a real repository', () => {
  const dir = initRepo('sha1');
  try {
    fs.writeFileSync(path.join(dir, 'a.md'), 'hi');
    execFileSync('git', ['add', '.'], { cwd: dir, env: sanitizedEnv() });
    execFileSync('git', ['commit', '-qm', 'a'], { cwd: dir, env: sanitizedEnv() });
    assert.throws(
      () => batchBlobReader(dir, [blobEntry(OID_A, 'a.md')], capturedRun),
      /is missing/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
