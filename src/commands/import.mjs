// `changeledger import --from <ref>` — the incremental, explicit and idempotent
// absorption of ONE worktree-layout ref into an already activated repo's state
// ref. It covers the two leftovers a one-shot `cutover` cannot: the branches
// that were in flight at the moment of the migration, and the documents that
// land late on a branch cut before it.
//
// It is a single pass with no intermediate state: resolve the ref (asserting it
// IS a commit, never peeling an annotated tag — MIG-04), read the ledger out of
// its tree with no checkout, validate ALL of it with the repo's own `checkRepo`
// rules BEFORE classifying anything, classify every document by CONTENT
// IDENTITY against the current snapshot, and then either report every conflict
// and write nothing, or apply adds and updates as one `mutateState`.
//
// Two deliberate asymmetries with `cutover`:
//
// - The source's `.changeledger/config.yml` is neither imported nor reported as
//   a conflict. Once a repo is activated the authority over config content is
//   the copy inside the state ref; a branch cut before the migration carries a
//   potentially stale copy, and absorbing it silently would install a second
//   truth. For the same reason the SNAPSHOT's config — never the source's — is
//   what drives both the ledger layout and the validation rules here.
// - Changes are ordered by their `## Log`, which only ever grows: one document's
//   Log entries being a proper prefix of the other's says which version is newer
//   without any semantic diff. Specs and releases have no Log, so their only
//   equality is byte-identity and everything else is a conflict for the human.
//
// Everything is all-or-nothing on purpose. Applying the clean documents and
// leaving the conflicts would make the result depend on the order of
// invocations, which is exactly the observable idempotency (MIG-05) this
// command exists to provide.

import path from 'node:path';
import { parseChange } from '../change.mjs';
import { checkRepo } from '../check.mjs';
import { findChangeledgerDir, resolveRepoPath, resolveSpecsDir } from '../config.mjs';
import { assertCommitObject, capturedRun, gitTopLevel } from '../git.mjs';
import { assertRegularBlobEntry, batchBlobReader, treeEntries } from '../git-batch.mjs';
import { resolveReleasesDir } from '../release.mjs';
import { parseSpec } from '../spec.mjs';
import { mutateState, readActivation, readSnapshot, STATE_REF } from '../state-store.mjs';
import { parseYaml } from '../yaml.mjs';

function toPosix(relPath) {
  return relPath.split(path.sep).join('/');
}

// Where each collection lives inside the SOURCE tree, as git paths. Identical in
// spirit to the cutover's layout — the configured directories go through
// `resolveRepoPath`'s containment guard, then are expressed relative to git's
// own top-level, which is not necessarily the ChangeLedger repo root — except
// that `config.yml` has no entry at all: it is not a document this command can
// see, so it cannot be imported or reported by accident.
function sourceLayout(repoRoot, config, run) {
  const topLevel = gitTopLevel(repoRoot, run);
  const rel = (absolute) => toPosix(path.relative(topLevel, absolute));
  return [
    {
      name: 'changes',
      extension: '.md',
      prefix: `${rel(resolveRepoPath(repoRoot, config.changes_dir, 'changes_dir'))}/`,
    },
    { name: 'specs', extension: '.md', prefix: `${rel(resolveSpecsDir(repoRoot, config))}/` },
    { name: 'releases', extension: '.yml', prefix: `${rel(resolveReleasesDir(repoRoot))}/` },
  ];
}

// The source ledger as committed at `revision`, read with no checkout and keyed
// by its future state path (`changes/x.md`). A nested path under a collection is
// refused rather than flattened: the state layout has exactly one level, and
// silently collapsing two documents onto one name would lose one of them.
function readLedgerAt(repoRoot, revision, layout, run) {
  const wanted = [];
  const entries = new Map();

  for (const entry of treeEntries(repoRoot, revision, run)) {
    const collection = layout.find((c) => entry.path.startsWith(c.prefix));
    if (!collection) continue;
    const name = entry.path.slice(collection.prefix.length);
    if (!name.endsWith(collection.extension)) continue;
    if (name.includes('/')) {
      throw new Error(
        `the source has a nested document the state layout cannot hold: ${entry.path}`,
      );
    }
    assertRegularBlobEntry(entry.mode, entry.path, entry.type);
    wanted.push(entry);
    entries.set(`${collection.name}/${name}`, entry);
  }

  const readBlob = batchBlobReader(repoRoot, wanted, run);
  const documents = new Map();
  for (const [name, entry] of entries) documents.set(name, readBlob(entry.oid));
  return documents;
}

// A document's identity, derived from its CONTENT and never from its filename: a
// change is its id, a spec its name, a release its version. This is what lets
// the same document be recognized across a rename, and what decides which
// snapshot document an imported one is compared against.
function identify(name, text, origin) {
  const base = name.slice(name.indexOf('/') + 1);
  try {
    if (name.startsWith('changes/')) {
      const parsed = parseChange(text);
      return { kind: 'change', key: String(parsed.frontmatter?.id), base, text, parsed };
    }
    if (name.startsWith('specs/')) {
      parseSpec(text);
      return { kind: 'spec', key: base.slice(0, -'.md'.length), base, text };
    }
    const parsed = parseYaml(text);
    return { kind: 'release', key: String(parsed?.version), base, text };
  } catch (e) {
    throw new Error(`${origin} — ${name}: ${e.message}`);
  }
}

// The source, parsed into the shape `checkRepo` consumes and validated whole
// before a single document is classified. Nothing has been written at this point
// and nothing may be: one error aborts the entire import.
function validateSource(documents, config) {
  const changes = [];
  const specs = [];
  const releases = [];
  const cannot = 'the source cannot be imported';

  for (const [name, text] of documents) {
    const base = name.slice(name.indexOf('/') + 1);
    try {
      if (name.startsWith('changes/')) changes.push({ name: base, text, ...parseChange(text) });
      else if (name.startsWith('specs/')) specs.push({ name: base, ...parseSpec(text) });
      else releases.push({ name: base, ...parseYaml(text) });
    } catch (e) {
      throw new Error(`${cannot} — ${name}: ${e.message}`);
    }
  }
  changes.sort((a, b) => String(a.frontmatter?.id).localeCompare(String(b.frontmatter?.id)));

  const { errors } = checkRepo({ config, changes, specs, releases });
  if (errors.length) {
    const detail = errors.map((e) => `  ${e.file}: ${e.message}`).join('\n');
    throw new Error(
      `${cannot} — ${errors.length} validation error(s), nothing was written:\n${detail}`,
    );
  }
}

// The entries of a change's `## Log`, in order. An entry starts at a `- ` line;
// any following non-blank line belongs to it, so a wrapped entry stays one
// entry instead of splitting into a phantom extra one that would fake a
// divergence.
function logEntries(parsed) {
  const stage = (parsed.stages ?? []).find((s) => s.key === 'log');
  if (!stage) return [];
  const entries = [];
  for (const raw of stage.body.split('\n')) {
    const line = raw.trimEnd();
    if (/^- /.test(line)) entries.push(line);
    else if (entries.length && line.trim() !== '') entries[entries.length - 1] += `\n${line}`;
  }
  return entries;
}

function isProperPrefix(shorter, longer) {
  return shorter.length < longer.length && shorter.every((entry, i) => entry === longer[i]);
}

// How far two Logs agree — the number the divergence report needs so a human can
// go straight to the entry where the two histories parted.
function sharedPrefixLength(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

// Every document of the snapshot indexed by the same content identity as the
// source's, so the comparison never depends on either side's filename. A
// snapshot document that cannot be parsed is a corruption of the published
// state, not an import problem: it is reported as such rather than being
// silently treated as absent, which would re-add it as a duplicate.
function indexSnapshot(snapshot) {
  const index = new Map();
  for (const [name, text] of Object.entries(snapshot.documents)) {
    const document = identify(name, text, `the published state at ${snapshot.revision} is corrupt`);
    index.set(`${document.kind}:${document.key}`, { ...document, path: name });
  }
  return index;
}

// The whole decision, one document at a time. Returns the plan (`adds`,
// `updates`, `conflicts`); it writes nothing and reads nothing, so the caller
// can report every conflict before touching a ref.
function classify(documents, published) {
  const adds = [];
  const updates = [];
  const conflicts = [];
  const seen = new Map();

  for (const [name, text] of documents) {
    const source = identify(name, text, 'the source cannot be imported');
    const id = `${source.kind}:${source.key}`;

    const duplicate = seen.get(id);
    if (duplicate) {
      throw new Error(
        `the source cannot be imported — ${name} and ${duplicate} are both ${source.kind} "${source.key}"`,
      );
    }
    seen.set(id, name);

    const current = published.get(id);
    if (!current) {
      adds.push({ id, kind: source.kind, key: source.key, path: name, text });
      continue;
    }
    if (current.text === text) continue;

    if (source.kind !== 'change') {
      conflicts.push({
        id,
        cause: `content differs and a ${source.kind} has no Log to order the two versions`,
      });
      continue;
    }

    const incoming = logEntries(source.parsed);
    const held = logEntries(current.parsed);
    // The snapshot already absorbed this version and kept moving: nothing to do.
    if (isProperPrefix(incoming, held)) continue;
    if (isProperPrefix(held, incoming)) {
      // Written back at the SNAPSHOT's path, not the source's: the identity is
      // the change id, so honoring a renamed source filename would leave the
      // same change published twice under two names.
      updates.push({ id, kind: source.kind, key: source.key, path: current.path, text });
      continue;
    }
    const shared = sharedPrefixLength(incoming, held);
    conflicts.push({
      id,
      cause:
        shared === incoming.length && shared === held.length
          ? 'content differs with no Log advance on either side'
          : `the Logs diverge after ${shared} shared entry(ies)`,
    });
  }

  return { adds, updates, conflicts };
}

export function importFromRef({ from } = {}, cwd = process.cwd(), output = console) {
  const run = capturedRun;
  const changeledgerDir = findChangeledgerDir(cwd);
  if (!changeledgerDir) {
    throw new Error(
      'Not a ChangeLedger repo (no .changeledger/ found). Run `changeledger init` first.',
    );
  }
  const repoRoot = path.dirname(changeledgerDir);

  // The import writes into the state ref, so a repo that never took the
  // activation decision has no destination at all. Said explicitly rather than
  // failing later on a missing ref, whose message would send the caller looking
  // in the wrong place.
  if (readActivation(repoRoot, run) === null) {
    throw new Error(
      'import requires an activated repo: this checkout has no activation — run `changeledger activate` (or `changeledger cutover` to publish the ledger first)',
    );
  }

  // Asserted to BE a commit via `cat-file -t`, never `^{commit}`: an annotated
  // tag names a different object and must be refused, not silently followed to
  // the commit it wraps (MIG-04).
  assertCommitObject(repoRoot, from, run);
  const revision = run(['rev-parse', from], repoRoot).trim();

  const snapshot = readSnapshot(repoRoot, {}, run);
  const documents = readLedgerAt(
    repoRoot,
    revision,
    sourceLayout(repoRoot, snapshot.config, run),
    run,
  );
  validateSource(documents, snapshot.config);

  const { adds, updates, conflicts } = classify(documents, indexSnapshot(snapshot));
  if (conflicts.length) {
    const detail = conflicts.map((c) => `  ${c.id.replace(':', ' ')}: ${c.cause}`).join('\n');
    throw new Error(
      `the source cannot be imported — ${conflicts.length} conflict(s) between ${from} (${revision}) and ${STATE_REF}, nothing was written:\n${detail}`,
    );
  }

  // "Nothing to import" and "nothing was FOUND to import" are different facts and
  // must not share a sentence. A ref with no ledger visible at all — no
  // `.changeledger/` on it, or documents that live somewhere this repo's
  // configured layout does not look — absorbed nothing, and reporting it as
  // "0 document(s) already absorbed" claims an absorption that never happened.
  // An operator who believes it deletes a branch whose ledger was never read.
  // The exit code is 0 either way; only the sentence separates them.
  if (documents.size === 0) {
    output.log(
      `No ChangeLedger documents found at ${from} (${revision}) — nothing was read, so nothing was imported`,
    );
    return 0;
  }

  const applied = [...adds, ...updates];
  if (applied.length === 0) {
    output.log(
      `Nothing to import from ${from} (${revision}) — ${documents.size} document(s) already absorbed`,
    );
    return 0;
  }

  for (const document of adds)
    output.log(`  + ${document.path} (${document.kind} ${document.key})`);
  for (const doc of updates) output.log(`  ~ ${doc.path} (${doc.kind} ${doc.key})`);

  const { revision: tip } = mutateState(
    repoRoot,
    { expectedRevision: snapshot.revision, message: `chore: import ${from} (${revision})` },
    (stage) => {
      for (const document of applied) stage.write(document.path, document.text);
    },
    run,
  );
  output.log(
    `Imported ${applied.length} document(s) from ${from} (${revision}) — ${STATE_REF} at ${tip}`,
  );
  return 0;
}
