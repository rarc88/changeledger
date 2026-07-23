// Shared batch materialization for a Git tree: one `ls-tree` enumeration plus
// one `cat-file --batch` read of every blob, instead of a subprocess per file.
// Callers supply their own `run(args, cwd, options)` (their own timeout/env
// policy); this module only needs `options.encoding` (pass `null` for a raw
// Buffer) and `options.input` (stdin), matching the shape already used by
// this codebase's `gitOutput`-style wrappers.

import { isUtf8 } from 'node:buffer';

const TREE_ENTRY = /^([0-7]{6}) ([^ ]+) ([0-9a-f]{40,64})\t([\s\S]+)$/;

const REGULAR_BLOB_MODES = Object.freeze(['100644', '100755']);

// Git modes carry a type the ls-tree/diff header may not spell out (the raw
// diff format only emits modes). Derive it so a mode-only caller gets the same
// `<mode> <type>` diagnostic as one that already parsed the type token.
function gitEntryType(mode) {
  if (mode === '040000') return 'tree';
  if (mode === '160000') return 'commit';
  return 'blob';
}

// The state tree is materialized as documents: only regular file blobs
// (100644/100755) may be read as text. A symlink (120000, still a "blob"),
// gitlink (160000) or tree entry must be rejected so no read path -- the
// incremental raw-diff parser or the full tree load -- dereferences or
// misreads it. Message style matches state-migration.mjs's regularBlob so the
// create and validate paths reject the same surface identically.
export function assertRegularBlobEntry(mode, entryPath, type = gitEntryType(mode)) {
  if (type !== 'blob' || !REGULAR_BLOB_MODES.includes(mode)) {
    throw new Error(`tree contains unsupported Git entry ${mode} ${type} at ${entryPath}`);
  }
}

function parseTreeEntries(output) {
  if (output === '') return [];
  if (!output.endsWith('\0')) throw new Error('git returned malformed path framing');
  return output
    .slice(0, -1)
    .split('\0')
    .map((record) => {
      const match = record.match(TREE_ENTRY);
      if (!match) throw new Error('git returned malformed tree entry');
      return { mode: match[1], type: match[2], oid: match[3], path: match[4] };
    });
}

// Enumerates every entry of `revision`'s tree in one `ls-tree` call. Kept
// separate from blob reading so callers can wrap enumeration failures (e.g. a
// missing/unreadable revision) with their own diagnostic distinct from a
// blob-read failure.
export function treeEntries(repoRoot, revision, run) {
  return parseTreeEntries(run(['ls-tree', '-r', '-z', '--full-tree', revision], repoRoot));
}

function parseBatchOutput(buffer, expectedCount) {
  const blobs = new Map();
  let offset = 0;
  while (offset < buffer.length) {
    const headerEnd = buffer.indexOf(0x0a, offset);
    if (headerEnd === -1) throw new Error('git cat-file --batch returned malformed output');
    const header = buffer.toString('utf8', offset, headerEnd);
    const fields = header.split(' ');
    if (fields.length === 2 && fields[1] === 'missing') {
      throw new Error(`git object ${fields[0]} is missing`);
    }
    const [oid, type, sizeText] = fields;
    const size = Number(sizeText);
    if (type !== 'blob' || !Number.isInteger(size) || size < 0) {
      throw new Error(`git cat-file --batch returned unexpected object: ${header}`);
    }
    const contentStart = headerEnd + 1;
    blobs.set(oid, buffer.subarray(contentStart, contentStart + size));
    offset = contentStart + size + 1;
  }
  if (blobs.size !== expectedCount) {
    throw new Error('git cat-file --batch returned an unexpected number of objects');
  }
  return blobs;
}

// Reads every blob referenced by `entries` in one `cat-file --batch` call and
// returns a `(oid) => text` reader. Each blob is validated as strict UTF-8
// before the lossy decode, matching this codebase's blob-reading contract
// elsewhere (a blob that fails this check throws instead of corrupting text).
export function batchBlobReader(repoRoot, entries, run) {
  const oids = [...new Set(entries.filter((entry) => entry.type === 'blob').map((e) => e.oid))];
  const blobs =
    oids.length === 0
      ? new Map()
      : parseBatchOutput(
          run(['cat-file', '--batch'], repoRoot, {
            encoding: null,
            input: `${oids.join('\n')}\n`,
          }),
          oids.length,
        );
  return (oid) => {
    const content = blobs.get(oid);
    if (!content) throw new Error(`blob ${oid} was not requested`);
    if (!isUtf8(content)) throw new Error(`blob ${oid} is not valid UTF-8`);
    return content.toString('utf8');
  };
}
