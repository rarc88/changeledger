import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertRegularBlobEntry, batchBlobReader, treeEntries } from '../src/git-batch.mjs';

const OID_A = 'a'.repeat(40);
const OID_B = 'b'.repeat(40);

function blobEntry(oid, path) {
  return { mode: '100644', type: 'blob', oid, path };
}

test('170613: treeEntries rejects output not NUL-terminated as malformed path framing', () => {
  const run = () => 'not-nul-terminated';
  assert.throws(() => treeEntries('/repo', 'HEAD', run), /malformed path framing/);
});

test('170613: treeEntries rejects a record that does not match the tree-entry grammar', () => {
  const run = () => 'not a valid ls-tree record\0';
  assert.throws(() => treeEntries('/repo', 'HEAD', run), /malformed tree entry/);
});

test('170613: treeEntries returns [] for an empty tree without throwing', () => {
  const run = () => '';
  assert.deepEqual(treeEntries('/repo', 'HEAD', run), []);
});

test('170613: treeEntries parses a well-formed record', () => {
  const run = () => `100644 blob ${OID_A}\tspecs/a.md\0`;
  assert.deepEqual(treeEntries('/repo', 'HEAD', run), [
    { mode: '100644', type: 'blob', oid: OID_A, path: 'specs/a.md' },
  ]);
});

test('170613: batchBlobReader throws when git reports the object missing', () => {
  const run = () => Buffer.from(`${OID_A} missing\n`);
  assert.throws(
    () => batchBlobReader('/repo', [blobEntry(OID_A, 'specs/a.md')], run),
    /is missing/,
  );
});

test('170613: batchBlobReader rejects output with no header terminator as malformed', () => {
  const run = () => Buffer.from('no newline anywhere in this buffer');
  assert.throws(
    () => batchBlobReader('/repo', [blobEntry(OID_A, 'specs/a.md')], run),
    /malformed output/,
  );
});

test('170613: batchBlobReader rejects a header naming an unexpected object type', () => {
  const run = () => Buffer.concat([Buffer.from(`${OID_A} tree 4\n`), Buffer.from('1234\n')]);
  assert.throws(
    () => batchBlobReader('/repo', [blobEntry(OID_A, 'specs/a.md')], run),
    /unexpected object/,
  );
});

test('170613: batchBlobReader rejects a batch that returns fewer objects than requested', () => {
  const content = Buffer.from('hi');
  const header = Buffer.from(`${OID_A} blob ${content.length}\n`);
  // Two distinct oids requested, but the stubbed batch output only answers one.
  const run = () => Buffer.concat([header, content, Buffer.from('\n')]);
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

test('170613: batchBlobReader rejects reading an oid that was never requested', () => {
  const content = Buffer.from('hello');
  const run = () =>
    Buffer.concat([Buffer.from(`${OID_A} blob ${content.length}\n`), content, Buffer.from('\n')]);
  const read = batchBlobReader('/repo', [blobEntry(OID_A, 'specs/a.md')], run);
  assert.equal(read(OID_A), 'hello');
  assert.throws(() => read(OID_B), /was not requested/);
});

test('170613: assertRegularBlobEntry rejects symlink, gitlink and tree entries', () => {
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

test('170613: assertRegularBlobEntry accepts regular blob modes 100644 and 100755', () => {
  assert.doesNotThrow(() => assertRegularBlobEntry('100644', 'specs/a.md', 'blob'));
  assert.doesNotThrow(() => assertRegularBlobEntry('100755', 'scripts/run.sh', 'blob'));
});

test('170613: assertRegularBlobEntry derives type from mode when the caller has none', () => {
  assert.throws(
    () => assertRegularBlobEntry('040000', 'specs'),
    /unsupported Git entry 040000 tree at specs/,
  );
});
