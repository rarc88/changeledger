// `changeledger apply --from <file|-> [--dry-run]` — the batch landing seam
// (20260811-110629). The state ref's journal is permanent, so its unit must be
// a meaningful EVENT, not a keystroke: starting a change (status + owner + log)
// or drafting a batch of documents is one event that used to cost one commit
// per command. This command reads a JSON manifest, applies every entry IN ORDER
// against a single accumulated candidate, and lands the whole thing as exactly
// one CAS commit — or nothing at all.
//
// It owns no policy of its own. Document entries run the very seats `edit` and
// `new --from` run (`prepareChangeEdit`, `prepareSpecEdit`, `prepareNewChange`),
// and event entries run the very text transforms their individual commands run
// (`statusMutation`, `ownerMutation`, `logMutation`, `taskMutation`). What this
// file adds is the envelope, the ordering, the ownership refusal and the single
// write — never a second copy of a guard.
//
// Human-owned and terminal transitions are refused by name: a batch is executed
// by an agent, and `approve`, `validation`, `review` and `discard` exist as
// individual, separately auditable commands precisely so an agent cannot carry
// them along inside a larger unit.

import fs from 'node:fs';
import path from 'node:path';
import { parseChange } from '../change.mjs';
import { writeLedgerFiles } from '../change-store.mjs';
import { checkRepo } from '../check.mjs';
import { assertSupportedSchema } from '../config-migration.mjs';
import { loadRepo } from '../repo.mjs';
import { slugify } from '../slug.mjs';
import {
  assertStatusDestinationAllowed,
  logMutation,
  ownerMutation,
  statusMutation,
  taskMutation,
} from './agent.mjs';
import { prepareChangeEdit, prepareSpecEdit, readSource } from './edit.mjs';
import { prepareNewChange } from './new.mjs';

const CHANGE_PREFIX = 'change:';
const SPEC_PREFIX = 'spec:';

// The four the agent owns, and the ONLY four a manifest may carry.
const BATCH_OPS = new Set(['status', 'log', 'task', 'owner']);

// Every other lifecycle op, mapped to the individual command that owns it. A
// batch entry naming one of these is refused with that command's name so the
// caller learns where the move belongs instead of only that it was rejected.
const OPS_OWNED_ELSEWHERE = {
  approve: 'changeledger approve',
  validation: 'changeledger validation',
  review: 'changeledger review',
  discard: 'changeledger discard',
  reopen: 'changeledger reopen',
  archive: 'changeledger archive',
  branch: 'changeledger branch',
  graduate: 'changeledger graduate',
};

// Longest commit subject the summary is allowed to reach before it starts
// counting the rest instead of listing it.
const SUMMARY_BUDGET = 96;

export function apply({ from, dryRun = false } = {}, cwd = process.cwd()) {
  const entries = parseManifest(readSource(from));
  const repo = loadRepo(cwd);
  assertSupportedSchema(repo.config);

  // One candidate for the whole manifest: every entry validates against what
  // its predecessors already did, so an `edit` may follow the `new` that
  // created its target and an id taken earlier in the batch is taken.
  const candidate = { ...repo, changes: [...repo.changes], specs: [...repo.specs] };
  const pending = new Map();
  const descriptors = [];
  const statusWarnings = [];

  entries.forEach((entry, index) => {
    try {
      applyEntry(entry, { repo, candidate, pending, descriptors, statusWarnings });
    } catch (e) {
      throw new Error(
        `apply refused, nothing was written — entry ${index + 1} (${label(entry)}): ${e.message}`,
      );
    }
  });

  const { errors, warnings } = checkRepo(candidate);
  const writes = [...pending.values()].filter((w) => w.text !== w.baseline);
  const changed = writes.map((w) => w.relPath ?? w.file);
  const message = `apply: ${summarize(descriptors)}`;

  // The write gate: a candidate carrying `check` errors never lands, whether
  // by dry run (so `compose → correct → land once` can be SCRIPTED — its
  // verdict has to be programmatic, not printed) or for real (20260811-122031
  // closed the gap where only `--dry-run` refused and landing printed the
  // same errors and still exited 0). Warnings stay informative — `check`
  // reports them and still exits 0 in both modes.
  assertCandidateClean(errors, dryRun);

  if (dryRun) {
    return { changed, warnings, errors, message, dryRun, statusWarnings };
  }

  // Net-empty is a no-op by contract (CR5): a manifest whose entries all
  // reproduce what the ledger already holds spends no journal entry, exactly as
  // a byte-identical `edit` spends none.
  if (writes.length === 0) {
    return { changed, warnings, errors, message, dryRun, statusWarnings };
  }

  if (!repo.state) {
    for (const w of writes) fs.mkdirSync(path.dirname(w.file), { recursive: true });
  }
  writeLedgerFiles(
    repo,
    writes.map((w) => ({ relPath: w.relPath, file: w.file, text: w.text })),
    { message },
  );
  return { changed, warnings, errors, message, dryRun, statusWarnings };
}

// Shaped like `edit`'s own refusal: every error named with its file, and
// nothing written anywhere. Runs identically in both modes (20260811-122031)
// — only the wording names which mode refused, since a landing refusal never
// claims to be a dry run.
function assertCandidateClean(errors, dryRun) {
  if (!errors.length) return;
  const mode = dryRun ? 'apply dry run' : 'apply';
  throw new Error(
    `${mode} refused, nothing was written — the resulting candidate carries ${errors.length} validation error(s):\n${errors
      .map((e) => `  ${e.file}: ${e.message}`)
      .join('\n')}`,
  );
}

function applyEntry(entry, context) {
  if (!isObject(entry)) throw new Error('an entry must be a JSON object');
  if (entry.op !== undefined) return applyEvent(entry, context);
  if (entry.target !== undefined) return applyDocument(entry, context);
  throw new Error('an entry declares either "target" (a document) or "op" (an agent event)');
}

// ---------------------------------------------------------------- documents

function applyDocument(entry, { candidate, pending, descriptors }) {
  const target = String(entry.target);
  if (typeof entry.content !== 'string') {
    throw new Error('"content" must be the complete document text');
  }
  const content = entry.content;

  if (target === 'new') {
    // The document is the authority for its own frontmatter, so the only thing
    // the envelope still names is the filename slug — English structure, which
    // a repo-language title cannot always supply. Absent, it is derived from
    // the title, and a derivation that yields nothing fails loudly.
    const slug = entry.slug ?? parseChange(content).frontmatter?.title;
    const prepared = prepareNewChange(candidate, content, { slug: slugify(slug) });
    candidate.changes = [
      ...candidate.changes,
      { file: prepared.file, name: prepared.name, text: content, ...parseChange(content) },
    ];
    stage(pending, { ...prepared, text: content, baseline: undefined });
    descriptors.push(`new ${prepared.id}`);
    return;
  }

  if (target.startsWith(CHANGE_PREFIX)) {
    const id = target.slice(CHANGE_PREFIX.length);
    const prepared = prepareChangeEdit(candidate, id, content);
    replaceChange(candidate, id, prepared.name, prepared.file, content);
    stage(pending, { ...prepared, text: content, baseline: baselineOf(pending, prepared) });
    descriptors.push(`edit ${id}`);
    return;
  }

  if (target.startsWith(SPEC_PREFIX)) {
    const slug = target.slice(SPEC_PREFIX.length);
    const prepared = prepareSpecEdit(candidate, slug, content);
    const index = candidate.specs.findIndex((s) => s.name === prepared.name);
    candidate.specs = candidate.specs.with(index, {
      ...candidate.specs[index],
      ...prepared.parsed,
    });
    stage(pending, { ...prepared, text: content, baseline: baselineOf(pending, prepared) });
    descriptors.push(`edit spec ${prepared.name}`);
    return;
  }

  throw new Error(`unknown target "${target}" (use "new", "change:<id>" or "spec:<slug>")`);
}

// ------------------------------------------------------------------- events

function applyEvent(entry, { repo, candidate, pending, descriptors, statusWarnings }) {
  const op = String(entry.op);
  const ownedElsewhere = OPS_OWNED_ELSEWHERE[op];
  if (ownedElsewhere) {
    throw new Error(
      `op "${op}" never travels in a batch — it stays an individual, auditable command: \`${ownedElsewhere}\``,
    );
  }
  if (!BATCH_OPS.has(op)) {
    throw new Error(`unknown op "${op}" (a batch carries ${[...BATCH_OPS].join(', ')})`);
  }

  const id = String(entry.id ?? '');
  const index = candidate.changes.findIndex((c) => String(c.frontmatter.id) === id);
  if (index === -1) throw new Error(`no change with id "${id}" in this batch or ledger`);
  const current = candidate.changes[index];

  const { mutate, descriptor } = eventMutation(op, entry, {
    id,
    config: candidate.config,
    repoRoot: repo.repoRoot,
    name: current.name,
    statusWarnings,
  });

  const next = mutate(current.text);
  if (next === undefined) return;
  const file = current.file ?? preparedFileFor(repo, current.name);
  replaceChange(candidate, id, current.name, file, next);
  stage(pending, {
    relPath: `changes/${current.name}`,
    file,
    text: next,
    baseline: baselineOf(pending, {
      relPath: `changes/${current.name}`,
      currentText: current.text,
    }),
  });
  descriptors.push(descriptor);
}

function eventMutation(op, entry, { id, config, repoRoot, name, statusWarnings }) {
  if (op === 'status') {
    const to = String(entry.to ?? '');
    // A batch is executed by an agent, never by a human: this is the seat that
    // turns `approved`, `done` and `discarded` into a refusal naming their own
    // command (CR4), and it is `status`'s own guard, not a copy of it.
    assertStatusDestinationAllowed(config, to, 'agent');
    return {
      mutate: statusMutation(to, {
        config,
        repoRoot,
        gitCwd: repoRoot,
        name,
        warnings: statusWarnings,
        actor: 'agent',
        channel: 'batch',
      }),
      descriptor: `status ${id} → ${to}`,
    };
  }
  if (op === 'log') {
    if (typeof entry.message !== 'string' || entry.message === '') {
      throw new Error('"message" must be the note text');
    }
    return { mutate: logMutation(entry.message), descriptor: `log ${id}` };
  }
  if (op === 'owner') {
    if (typeof entry.name !== 'string' || entry.name === '') {
      throw new Error('"name" must be the owner handle ("-" clears it)');
    }
    const next = entry.name === '-' ? null : entry.name;
    return { mutate: ownerMutation(next), descriptor: `owner ${id} ${next ?? '-'}` };
  }
  const n = Number(entry.n);
  if (!Number.isInteger(n) || n < 1) throw new Error('"n" must be the 1-based task number');
  return {
    mutate: taskMutation(entry.action, n, entry.reason),
    descriptor: `task ${id} ${n} ${entry.action}`,
  };
}

// ------------------------------------------------------------------ candidate

function replaceChange(candidate, id, name, file, text) {
  const index = candidate.changes.findIndex((c) => String(c.frontmatter.id) === String(id));
  candidate.changes = candidate.changes.with(index, { file, name, text, ...parseChange(text) });
}

// The worktree path a change would occupy when the repo is inactive; `null`
// when it is activated, where the state tree's relPath is the only address.
function preparedFileFor(repo, name) {
  return repo.state ? null : path.join(repo.repoRoot, repo.config.changes_dir, name);
}

function stage(pending, { relPath, file, text, baseline }) {
  const existing = pending.get(relPath);
  pending.set(relPath, {
    relPath,
    file,
    text,
    // The FIRST baseline seen for a document is the one the whole batch is
    // judged against: two entries touching the same document must decide
    // "changed" against what the ledger holds, not against each other.
    baseline: existing ? existing.baseline : baseline,
  });
}

// What the ledger holds for this document right now: a value already staged in
// this batch keeps its original baseline, an active-mode prepare carries the
// snapshot text, and an inactive-mode one is read from the worktree.
function baselineOf(pending, prepared) {
  const existing = pending.get(prepared.relPath);
  if (existing) return existing.baseline;
  if (prepared.currentText !== undefined) return prepared.currentText;
  if (prepared.file && fs.existsSync(prepared.file)) {
    return fs.readFileSync(prepared.file, 'utf8');
  }
  return undefined;
}

// -------------------------------------------------------------------- envelope

function parseManifest(text) {
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (e) {
    throw new Error(`the manifest does not parse — ${e.message}`);
  }
  if (!Array.isArray(manifest)) {
    throw new Error('the manifest must be a JSON array of entries');
  }
  return manifest;
}

function label(entry) {
  if (!isObject(entry)) return 'malformed';
  if (entry.op !== undefined) return String(entry.op);
  if (entry.target !== undefined) return String(entry.target);
  return 'malformed';
}

// A commit subject that names what landed, bounded so a nine-document batch
// does not write a paragraph into the journal.
function summarize(descriptors) {
  if (!descriptors.length) return 'no-op';
  const kept = [];
  let width = 0;
  for (const descriptor of descriptors) {
    if (kept.length && width + descriptor.length + 2 > SUMMARY_BUDGET) break;
    kept.push(descriptor);
    width += descriptor.length + 2;
  }
  const rest = descriptors.length - kept.length;
  return rest ? `${kept.join(', ')}, +${rest} more` : kept.join(', ');
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
