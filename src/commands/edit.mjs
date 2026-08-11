// `changeledger edit <change-id|spec:slug> --from <file|->` — the supported way
// to write a ledger document's PROSE (20260810-182641). The lifecycle commands
// (`status`/`owner`/`branch`/`log`/`task`) mutate fields; `new` scaffolds; until
// this seam existed an activated repo had no write path for a document's body at
// all, so a published draft could never be filled in.
//
// The unit is the WHOLE document, deliberately. The state ref's journal is
// permanent — rewriting it would break the CAS for every clone — so each entry
// must be a meaningful event, not a keystroke. A full replace is the only unit
// that guarantees a document lands complete and that no half-written state ever
// enters the ref; section-scoped editing would buy the same result at the price
// of drip commits.
//
// Every guard runs BEFORE the write and throws, so a refusal leaves the ref at
// the oid it was read from and the worktree file byte-for-byte untouched
// (`mutateFileAtomic` only writes what `mutate` returns). Writing goes through
// `mutateLedgerFile`, the single seam that decides worktree vs CAS commit, so
// inactive and activated repos share this command's semantics instead of each
// having their own.

import fs from 'node:fs';
import path from 'node:path';
import { parseChange } from '../change.mjs';
import { mutateLedgerFile } from '../change-store.mjs';
import { checkRepo, checkSelectedChange } from '../check.mjs';
import { assertSupportedSchema } from '../config-migration.mjs';
import { loadRepo, resolveChangeInRepo } from '../repo.mjs';
import { parseSpec } from '../spec.mjs';
import { readSnapshot } from '../state-store.mjs';

const SPEC_PREFIX = 'spec:';

// Identity: rewriting either would make the document a different one, and the
// journal already carries the original under that identity.
const IMMUTABLE_CHANGE_FIELDS = ['id', 'created'];

// Fields whose truth is a lifecycle event, not prose. Each has a command that
// records the event as well as the field, so accepting them here would let
// `edit` fake a transition with no Log entry. `title`, `depends_on`,
// `related_to` and `release_impact` are content and stay editable.
const OWNED_CHANGE_FIELDS = {
  status: 'changeledger status',
  owner: 'changeledger owner',
  branch: 'changeledger branch',
  archived: 'changeledger archive',
  reviewed: 'changeledger review',
};

// A spec has no lifecycle, so nothing is immutable: `title`, `tags`, `updated`
// and the body are all content its author owns. `graduated_from` is the
// exception — it is the durable half of a graduation link that `graduate`
// writes together with the change's Log event, and `check` validates the two
// against each other.
const OWNED_SPEC_FIELDS = { graduated_from: 'changeledger graduate' };

export function readSource(from) {
  if (typeof from !== 'string' || from === '') {
    throw new Error(
      'edit needs the complete document: pass `--from <file>` (or `--from -` to read it from stdin)',
    );
  }
  return from === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(path.resolve(from), 'utf8');
}

export function edit(target, { from } = {}, cwd = process.cwd()) {
  const incoming = readSource(from);
  const repo = loadRepo(cwd);
  assertSupportedSchema(repo.config);
  const subject = String(target);
  return subject.startsWith(SPEC_PREFIX)
    ? editSpec(repo, subject.slice(SPEC_PREFIX.length), incoming)
    : editChange(repo, subject, incoming);
}

function editChange(repo, id, incoming) {
  return land(repo, prepareChangeEdit(repo, id, incoming));
}

// Every guard `edit` runs on a change, plus the address the write needs, and no
// write at all. Split out so `apply` can run the SAME guards against its
// accumulated candidate repo instead of growing a second copy of this policy;
// `editChange` above is now exactly this seat followed by the one write.
export function prepareChangeEdit(repo, id, incoming) {
  const current = resolveChangeInRepo(repo, id);
  const parsed = parseIncoming(id, incoming, parseChange);
  assertFields(id, current.frontmatter ?? {}, parsed.frontmatter ?? {}, {
    immutable: IMMUTABLE_CHANGE_FIELDS,
    owned: OWNED_CHANGE_FIELDS,
  });
  // Judged at the severity `check` applies to the status the document is at —
  // which the guard above has already pinned to the current one — and against
  // the rest of the repo, so a related-change or graduation link that only the
  // siblings can falsify is caught before the write, not after it.
  assertClean(id, checkSelectedChange(repo, id, incoming).errors);

  return {
    name: current.name,
    relPath: `changes/${current.name}`,
    file: current.file,
    currentText: current.text,
    incoming,
    message: `edit: ${id}`,
  };
}

function editSpec(repo, slug, incoming) {
  return land(repo, prepareSpecEdit(repo, slug, incoming));
}

// Spec-shaped sibling of `prepareChangeEdit`, same contract: all the guards,
// none of the write.
export function prepareSpecEdit(repo, slug, incoming) {
  const subject = `${SPEC_PREFIX}${slug}`;
  const name = slug.endsWith('.md') ? slug : `${slug}.md`;
  const index = repo.specs.findIndex((s) => s.name === name);
  if (index === -1) {
    throw new Error(
      `No spec "${name}" (create it with \`changeledger graduate <id> <slug> --new\`)`,
    );
  }
  const current = repo.specs[index];
  const parsed = parseIncoming(subject, incoming, parseSpec);
  assertFields(subject, current.frontmatter ?? {}, parsed.frontmatter ?? {}, {
    immutable: [],
    owned: OWNED_SPEC_FIELDS,
  });
  // Specs have no per-document scope in `checkRepo`, so the whole repo is
  // validated with the candidate in place and only the diagnostics attributed
  // to this spec gate the write — a pre-existing error elsewhere is not this
  // edit's to answer for.
  const specs = repo.specs.with(index, { ...current, ...parsed });
  const errors = checkRepo({ ...repo, specs }).errors.filter((e) => e.file === name);
  assertClean(subject, errors);

  return {
    name,
    parsed,
    relPath: `specs/${name}`,
    file: current.file,
    // `repo.specs` carries only the parsed frontmatter/body, so the raw text an
    // active-mode CAS write compares against is read from the very revision
    // `loadRepo` already resolved (the same gap `fix.mjs` and `graduate.mjs`
    // close this way) rather than from a second, possibly newer, state read.
    currentText: repo.state
      ? readSnapshot(repo.repoRoot, { revision: repo.state.revision }).documents[`specs/${name}`]
      : undefined,
    incoming,
    message: `edit: spec ${name}`,
  };
}

// The one write. Byte-identical input returns `undefined` from the mutator,
// which both modes already understand as "skip": no worktree write, no journal
// commit, exit 0.
function land(repo, { relPath, file, currentText, incoming, message }) {
  const target = repo.state ? { relPath, text: currentText } : { file };
  const written = mutateLedgerFile(
    repo,
    target,
    (text) => (text === incoming ? undefined : incoming),
    { message },
  );
  return { path: repo.state ? relPath : file, changed: written !== undefined };
}

function parseIncoming(subject, text, parse) {
  try {
    return parse(text);
  } catch (e) {
    throw new Error(refusal(subject, `the incoming document does not parse — ${e.message}`));
  }
}

function assertFields(subject, current, incoming, { immutable, owned }) {
  for (const field of immutable) {
    if (!same(current[field], incoming[field])) {
      throw new Error(
        refusal(subject, `"${field}" is immutable ${delta(current[field], incoming[field])}`),
      );
    }
  }
  for (const [field, command] of Object.entries(owned)) {
    if (!same(current[field], incoming[field])) {
      throw new Error(
        refusal(
          subject,
          `"${field}" is owned by \`${command}\` ${delta(current[field], incoming[field])} — edit writes content, never lifecycle`,
        ),
      );
    }
  }
}

function assertClean(subject, errors) {
  if (!errors.length) return;
  throw new Error(
    refusal(
      subject,
      `${errors.length} validation error(s):\n${errors.map((e) => `  ${e.file}: ${e.message}`).join('\n')}`,
    ),
  );
}

const refusal = (subject, detail) => `edit ${subject} refused, nothing was written — ${detail}`;

const render = (value) => (value === undefined ? '(absent)' : JSON.stringify(value));
const same = (a, b) => render(a) === render(b);
const delta = (current, incoming) => `(current ${render(current)}, incoming ${render(incoming)})`;
