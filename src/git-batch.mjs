// Shared batch materialization for a Git tree: one `ls-tree` enumeration plus
// byte-bounded `cat-file --batch` reads of the referenced blobs, instead of a
// subprocess per file. Callers supply their own `run(args, cwd, options)`
// (their own timeout/env policy); this module only needs `options.encoding`
// (pass `null` for a raw Buffer), `options.input` (stdin) and `options.maxBuffer`
// (the per-call byte ceiling this reader sizes to each chunk) — the shape
// `capturedRun` in src/git.mjs already provides.

import { isUtf8 } from 'node:buffer';

const TREE_ENTRY = /^([0-7]{6}) ([^ ]+) ([0-9a-f]{40,64})\t([\s\S]+)$/;

const REGULAR_BLOB_MODES = Object.freeze(['100644', '100755']);

// Per-object budget, judged on CONTENT bytes, and the target ceiling for a
// chunk's framed `cat-file --batch` response. A tree's total blob content can
// far exceed any one object, so requesting every oid at once buffers the whole
// tree into one subprocess response and fails with ENOBUFS once it passes the
// run's maxBuffer. Instead oids are grouped so each chunk's framed response
// stays at or below this budget, keeping per-call memory bounded no matter how
// large the whole tree is. A single object whose CONTENT exceeds the budget
// cannot be read within it (one blob is one indivisible `cat-file --batch`
// response), so it is rejected fail-closed with a clear, bounded error naming
// the true content size, instead of an opaque ENOBUFS on a multi-MiB partial
// buffer. An object of exactly the budget in content is accepted: the read
// itself (readChunk) requests each chunk's exact framed byte count as
// maxBuffer, not this constant directly, so git's own per-object framing
// overhead (a short header line plus a trailing newline) never falls outside
// the requested buffer.
export const GIT_MAX_BUFFER = 32 * 1024 * 1024;
const CHUNK_BYTES = GIT_MAX_BUFFER;

// `cat-file --batch-check` returns one short header line per oid. Chunk the
// sizing pass by oid count so even a tree of hundreds of thousands of tiny
// blobs keeps each check response bounded, never re-introducing an aggregate
// ceiling on this path.
const CHECK_CHUNK_OIDS = 65536;

// Framing `cat-file --batch` wraps around each blob: `<oid> blob <size>\n`
// header plus a trailing `\n`. Counted so a chunk's requested maxBuffer covers
// content and framing exactly, not content alone.
function framedBytes(oid, size) {
  return `${oid} blob ${size}\n`.length + size + 1;
}

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
// gitlink (160000) or tree entry must be rejected so no read path -- the tree
// load -- dereferences or misreads it.
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

// Sizes every requested oid with `cat-file --batch-check`, count-chunked so the
// sizing response stays bounded regardless of tree size. Missing objects and
// non-blob types are rejected here (fail fast, before any content is read),
// with the same diagnostics the content read used to raise.
function sizeBlobs(repoRoot, oids, run) {
  const sizes = new Map();
  for (let start = 0; start < oids.length; start += CHECK_CHUNK_OIDS) {
    const chunk = oids.slice(start, start + CHECK_CHUNK_OIDS);
    const output = run(['cat-file', '--batch-check'], repoRoot, {
      input: `${chunk.join('\n')}\n`,
    });
    const lines = output.split('\n').filter((line) => line !== '');
    if (lines.length !== chunk.length) {
      throw new Error('git cat-file --batch-check returned an unexpected number of objects');
    }
    for (const line of lines) {
      const fields = line.split(' ');
      if (fields.length === 2 && fields[1] === 'missing') {
        throw new Error(`git object ${fields[0]} is missing`);
      }
      const [oid, type, sizeText] = fields;
      const size = Number(sizeText);
      if (type !== 'blob' || !Number.isInteger(size) || size < 0) {
        throw new Error(`git cat-file --batch-check returned unexpected object: ${line}`);
      }
      sizes.set(oid, size);
    }
  }
  return sizes;
}

// Groups oids into chunks whose framed `cat-file --batch` response stays at or
// below CHUNK_BYTES, packing greedily. The budget itself is judged on CONTENT
// bytes, not framed bytes: `cat-file --batch`'s own framing (a `<oid> blob
// <size>\n` header plus a trailing `\n` per object) adds a few dozen bytes on
// top of content that the budget was never meant to charge against -- an
// object of exactly CHUNK_BYTES content is a legitimate boundary case, not an
// over-budget one. A single blob whose CONTENT already exceeds the budget is
// rejected here (fail-closed, bounded diagnostic naming the true content size)
// since one indivisible object cannot be split across chunks; a solo object
// within budget is placed in its own chunk even though its framed size spills
// a little past CHUNK_BYTES (readChunk requests exactly that chunk's framed
// bytes as maxBuffer, not a fixed CHUNK_BYTES ceiling, so the framing margin
// is covered without inflating every other chunk's headroom).
function chunkBySize(oids, sizes) {
  const chunks = [];
  let current = [];
  let currentBytes = 0;
  for (const oid of oids) {
    const size = sizes.get(oid);
    if (size > CHUNK_BYTES) {
      throw new Error(
        `git object ${oid} is ${size} bytes, over the ${CHUNK_BYTES}-byte read budget`,
      );
    }
    const bytes = framedBytes(oid, size);
    if (current.length && currentBytes + bytes > CHUNK_BYTES) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(oid);
    currentBytes += bytes;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

// Reads one size-bounded chunk of oids with a single `cat-file --batch` call and
// stores each blob's raw content into `blobs`. The requested maxBuffer covers
// this chunk's framed bytes exactly (always <= CHUNK_BYTES, since chunkBySize
// rejects any single over-budget object), so per-call memory is bounded by the
// chunk budget. Framing, object type and per-chunk count are validated exactly
// as the whole-tree read used to.
function readChunk(repoRoot, chunk, sizes, blobs, run) {
  const expected = chunk.reduce((total, oid) => total + framedBytes(oid, sizes.get(oid)), 0);
  const buffer = run(['cat-file', '--batch'], repoRoot, {
    encoding: null,
    input: `${chunk.join('\n')}\n`,
    maxBuffer: expected,
  });
  let offset = 0;
  let seen = 0;
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
    seen += 1;
  }
  if (seen !== chunk.length) {
    throw new Error('git cat-file --batch returned an unexpected number of objects');
  }
}

// Reads every blob referenced by `entries` in byte-bounded `cat-file --batch`
// chunks and returns a `(oid) => text` reader. Each blob is validated as strict
// UTF-8 before the lossy decode: a blob that fails this check throws instead of
// corrupting text (transcoding to U+FFFD would also change its OID were it
// re-hashed).
export function batchBlobReader(repoRoot, entries, run) {
  const oids = [...new Set(entries.filter((entry) => entry.type === 'blob').map((e) => e.oid))];
  const blobs = new Map();
  if (oids.length) {
    const sizes = sizeBlobs(repoRoot, oids, run);
    for (const chunk of chunkBySize(oids, sizes)) {
      readChunk(repoRoot, chunk, sizes, blobs, run);
    }
  }
  return (oid) => {
    const content = blobs.get(oid);
    if (!content) throw new Error(`blob ${oid} was not requested`);
    if (!isUtf8(content)) throw new Error(`blob ${oid} is not valid UTF-8`);
    return content.toString('utf8');
  };
}
