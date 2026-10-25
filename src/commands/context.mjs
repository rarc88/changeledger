import fs from 'node:fs';
import path from 'node:path';
import { repoIsActivated } from '../change-store.mjs';
import { effectiveTdd, typeError } from '../check.mjs';
import {
  changeIntegrationBranch,
  findChangeledgerDir,
  integrationBranch,
  loadEffectiveConfig,
  releaseBranch,
  renderChangeBranch,
} from '../config.mjs';
import { beginSentinel, endSentinel, VERSION } from '../framing.mjs';
import { contractTemplatesDir } from '../paths.mjs';
import { loadRepo, resolveChangeInRepo } from '../repo.mjs';

const END_DELIMITER = endSentinel('CONTEXT');
const MODES = ['implement', 'review', 'spec', 'release'];
const MODE_CONTEXT = {
  implement: ['implement', 'delegation'],
  review: ['review'],
  spec: ['spec', 'delegation'],
  release: ['release'],
};
const STATUS_CONTEXT = {
  draft: { mode: 'spec', fragments: MODE_CONTEXT.spec },
  approved: { mode: 'implement', fragments: MODE_CONTEXT.implement },
  'in-progress': { mode: 'implement', fragments: MODE_CONTEXT.implement },
  'in-review': { mode: 'review', fragments: MODE_CONTEXT.review },
  done: { mode: 'close', fragments: ['close'] },
  // A tombstone loads no overlay: core already says it is terminal.
  discarded: { mode: 'discarded', fragments: [] },
};
const INCREMENTAL_NOTICE = `This incremental context extends the complete core context already read.
Read it complete in one pass, to its END line; a partial view is invalid.`;

function fragment(name) {
  return fs.readFileSync(path.join(contractTemplatesDir, `${name}.md`), 'utf8').trim();
}

// Budget thresholds live in the contract, so the published ceiling is the same
// number the quality gate enforces and cannot drift from it.
let budgetCache;

function packBudget(mode, { globalState = false } = {}) {
  budgetCache ??= JSON.parse(
    fs.readFileSync(path.join(contractTemplatesDir, 'budgets.yml'), 'utf8'),
  );
  const base = budgetCache.base[mode];
  if (!globalState) return base;
  const overlay = budgetCache.overlays['global-state'];
  return { tokens: base.tokens + overlay.tokens, lines: base.lines + overlay.lines };
}

// A capture publishes how many lines it occupies of its ceiling, and nothing
// else: lines are what the bootstrap's `head` consumes. The token ceiling is
// applied by this repository's tests, so no consuming repo has to install a
// tokenizer to read a capture. A change-id capture is unbounded by design — it
// embeds a document of any size — so it has no entry in `budgets.yml` and
// publishes its exact count without inventing a ceiling.
function beginDelimiter(mode, changeId, lines, budget) {
  const change = changeId ? ` — change: #${changeId}` : '';
  const size = budget ? `lines:${lines}/${budget.lines}` : `lines:${lines}`;
  return beginSentinel('CONTEXT', `mode: ${mode}${change} — v${VERSION} — ${size}`);
}

// The published figure is part of the text whose size it reports, so it is
// measured on a first framing and published by a second. Two passes are exact and
// no iteration is needed: widening the figure by a digit cannot add a line, since
// it stays on the same BEGIN line. Framing the body twice with the same delimiter
// shape is what makes the second count equal to the first.
export function frameSections(mode, changeId, body, budget) {
  const frame = (lines) =>
    render([beginDelimiter(mode, changeId, lines, budget), ...body, END_DELIMITER]);
  return frame(emittedLines(frame(0)));
}

function render(sections) {
  return `${sections.join('\n\n')}\n`;
}

// Emitted lines: what `wc -l` reports for the CLI stdout and what `head -<N>`
// must be given. The rendered text ends with exactly one trailing newline, so
// its last split segment is empty and does not count; a text without that
// newline still ends in a real line. This is the single canonical home of
// this count — `test/budget-support.mjs` imports and re-exports it rather
// than keeping its own copy.
export function emittedLines(text) {
  const segments = text.split('\n');
  return segments[segments.length - 1] === '' ? segments.length - 1 : segments.length;
}

// Resolved defaults so an agent never reads `.changeledger/config.yml` raw to
// discover the repo's effective policy. Keep these aligned with the shipped
// template config; the tdd default lives with its single resolver,
// `effectiveTdd` in `check.mjs`.
const DEFAULT_LANGUAGE = 'en';

function effectiveLanguage(config) {
  return config?.language ?? DEFAULT_LANGUAGE;
}

// The transversal policy line every composition anchors on: effective language
// and tdd with defaults already resolved. The integration branch appears only
// when declared — absence means the repo keeps branch auto-detection.
// `frontmatter` is the selected change's: its own `tdd` overrides the global
// value, and its `integrates_into: release` publishes `git.release_branch` as
// its integration branch (an undeclared one fails rather than publishing the
// repo's); without it the global values are published. An epic publishes no
// `tdd=`: it is never implemented, so there is no test to write first.
// A change integrating into a branch other than a declared
// `git.integration_branch` also publishes that branch as `back_merge_branch`,
// where its integrated result must be brought too (20261002-181428).
// Every composition also publishes `release_branch` while it is declared: the
// only state in which a change integrating into it can be loaded. A malformed
// value publishes nothing and is `check`'s to report, so it never breaks the
// bootstrap capture every session loads first.
export function transversalPolicy(config, frontmatter = {}) {
  const tdd =
    frontmatter.type === 'epic' ? '' : ` — tdd=${effectiveTdd(config, frontmatter) ? 'on' : 'off'}`;
  const release = publishableReleaseBranch(config);
  const releasePart = release === undefined ? '' : ` — release_branch=${release}`;
  const base = `Effective policy: language=${effectiveLanguage(config)}${tdd}${releasePart}`;
  const branch = changeIntegrationBranch(config, frontmatter);
  if (!branch) return base;
  const repoBranch = integrationBranch(config);
  const backMerge = repoBranch && repoBranch !== branch ? ` — back_merge_branch=${repoBranch}` : '';
  return `${base} — integration_branch=${branch}${backMerge}`;
}

function publishableReleaseBranch(config) {
  try {
    return releaseBranch(config);
  } catch {
    return undefined;
  }
}

// A change's `type` selects which obligations its capture publishes. A type
// other than `change` or `epic`, or none at all, is exactly the class of
// defect this repo aborts on rather than silently degrading (CR1).
function assertKnownType(type) {
  if (type === undefined) throw new Error('missing frontmatter "type"');
  const defect = typeError(type);
  if (defect) throw new Error(defect);
}

// Policy for change-id contexts: the transversal line resolved for this
// change, its branch, and its type, so the agent does not infer them.
function changePolicyBlock(config, frontmatter) {
  assertKnownType(frontmatter.type);
  const changeBranch = renderChangeBranch(config, frontmatter);
  const branch = changeBranch ? ` — change_branch=${changeBranch}` : '';
  return `${transversalPolicy(config, frontmatter)}${branch} — type=${frontmatter.type}`;
}

// One line per local dependency (id, title, status); external `project:id`
// references stay references, never pretending local resolution. Resolves
// against the already-loaded `repo` (`resolveChangeInRepo`) rather than a
// fresh disk read, so an activated repo's snapshot is what answers this, not
// the worktree (20260808-151641 CR7).
function dependencyBlock(dependsOn, repo) {
  if (!Array.isArray(dependsOn) || dependsOn.length === 0) return undefined;
  const lines = dependsOn.map((raw) => {
    const dep = String(raw);
    if (dep.includes(':')) return `- #${dep} — external reference (not resolved locally)`;
    try {
      const { frontmatter } = resolveChangeInRepo(repo, dep);
      return `- #${dep} — ${frontmatter.title} — ${frontmatter.status}`;
    } catch {
      return `- #${dep} — unresolved local dependency`;
    }
  });
  return `## Dependencies\n\n${lines.join('\n')}`;
}

function relatedChangeLine(direction, raw, repo) {
  const reference = String(raw);
  if (reference.includes(':')) {
    return `- ${direction} — #${reference} — external reference (not resolved locally)`;
  }
  try {
    const { frontmatter } = resolveChangeInRepo(repo, reference);
    return `- ${direction} — #${reference} — ${frontmatter.title} — ${frontmatter.status}`;
  } catch {
    return `- ${direction} — #${reference} — unresolved local relation`;
  }
}

function relatedBlock(id, relatedTo, repo) {
  const outgoing = Array.isArray(relatedTo) ? relatedTo : [];
  const incoming = repo.changes
    .filter(
      (change) =>
        String(change.frontmatter?.id) !== String(id) &&
        Array.isArray(change.frontmatter?.related_to) &&
        change.frontmatter.related_to.some((target) => String(target) === String(id)),
    )
    .map((change) => String(change.frontmatter.id));
  if (!outgoing.length && !incoming.length) return undefined;
  const lines = [
    ...outgoing.map((target) => relatedChangeLine('outgoing', target, repo)),
    ...incoming.map((source) => relatedChangeLine('incoming', source, repo)),
  ];
  return `## Related changes\n\n${lines.join('\n')}`;
}

// Composes the body (everything between the BEGIN and END lines) and returns
// the full rendered text, framed by its BEGIN and END delimiters.
function composeResult(mode, fragments, options = {}) {
  const {
    changeText,
    incremental = true,
    changeId = undefined,
    policy = undefined,
    dependencies = undefined,
    relations = undefined,
    budget = packBudget(mode),
  } = options;
  const body = [];
  if (incremental) body.push(INCREMENTAL_NOTICE);
  if (policy) body.push(policy);
  body.push(...fragments.map(fragment));
  if (dependencies) body.push(dependencies);
  if (relations) body.push(relations);
  if (changeText) body.push('---\n\n# Selected change\n', changeText.trim());
  // The BEGIN line publishes the exact line count so any consumer can build a
  // deterministic `head -<N>` and see the occupancy of its ceiling.
  // A change-id capture embeds a document of any size, so no ceiling applies to
  // it even though it reuses a mode's fragments: it publishes its count alone.
  return frameSections(mode, changeId, body, changeId ? undefined : budget);
}

function requireRepo(cwd) {
  const dir = findChangeledgerDir(cwd);
  if (!dir) throw new Error('Not a ChangeLedger repo. Run `changeledger init` first.');
  return dir;
}

// The id a filename encodes: the fixed `<8 digits>-<6 digits>` timestamp
// shape every change id uses, taken up to the first `-` that starts the slug
// or the `.md` extension for a bare `<id>.md`. Extracting this and comparing
// it exactly — rather than `name.startsWith(\`${id}-\`)` — matters because a
// dash-prefix substring match treats any strict prefix of a real id (e.g.
// "20990101" against "20990101-000000") as if it named that file too, wrongly
// inheriting a sibling's parse diagnosis for an id that does not exist
// (20260809-194236 post-review defect 2).
const FILENAME_ID = /^(\d{8}-\d{6})(?:-|\.md$)/;

function idFromFilename(name) {
  return name.match(FILENAME_ID)?.[1];
}

// `loadRepoWithConfig` (via `loadRepo`) already isolates a per-document parse
// failure into `repo.changeErrors`, with the exact diagnostic (e.g. "Change
// is missing its frontmatter block"). When the id a caller asked to resolve
// IS the malformed document — not an unrelated sibling (CR5 of 171107
// already covers that case) — that diagnosis must win over a generic
// "unknown id": matched by the filename's own encoded id, since a document
// with no parseable frontmatter has no `frontmatter.id` to match by
// (20260809-194236 CR1). Returns `undefined` when no change error names this
// id, so the caller falls back to its own unknown-id message unchanged (CR2).
export function changeParseFailureMessage(id, changeErrors) {
  const entry = (changeErrors ?? []).find((e) => idFromFilename(e.name) === id);
  if (!entry) return undefined;
  // The on-disk loader's `error.message` already carries the file path
  // (`readChangeFile` prefixes it); the activated-repo loader's does not
  // (`file` is `null` there) — naming the file ourselves in that case avoids
  // losing it, without double-prefixing the other.
  return entry.file ? entry.message : `${entry.name}: ${entry.message}`;
}

// A changeless capture (no input, or a mode keyword) never needs a change
// document — only effective `config`. Loading the full `loadRepo(cwd)`
// here regressed that: its sync loader throws on the first unparseable change
// document anywhere in the repo, which used to have no bearing on a capture
// that never looks at changes at all — denying the mandatory AGENTS.md
// bootstrap on a repo with one bad file. Only the change-id branch below
// needs `repo.changes` (and, on an activated repo, its snapshot routing), so
// only that branch pays for a full `loadRepo`.
function composeInput(input, cwd, changeledgerDir) {
  if (!input || MODES.includes(input)) {
    const config = loadEffectiveConfig(path.dirname(changeledgerDir), changeledgerDir);
    if (!input) {
      // The global-state semantics apply to the repo, not to a mode: only an
      // activated repo loads them, after core and under the two summed ceilings.
      const globalState = repoIsActivated(path.dirname(changeledgerDir));
      return composeResult('core', globalState ? ['core', 'global-state'] : ['core'], {
        incremental: false,
        policy: transversalPolicy(config),
        budget: packBudget('core', { globalState }),
      });
    }
    return composeResult(input, MODE_CONTEXT[input], { policy: transversalPolicy(config) });
  }

  const repo = loadRepo(cwd, { isolateChangeErrors: true });
  let resolved;
  try {
    resolved = resolveChangeInRepo(repo, input);
  } catch {
    const parseFailure = changeParseFailureMessage(input, repo.changeErrors);
    if (parseFailure) throw new Error(`Change "${input}" failed to parse: ${parseFailure}`);
    throw new Error(
      `Unknown context "${input}" — valid modes: ${MODES.join(', ')} (or pass a change id)`,
    );
  }

  const { text, frontmatter } = resolved;
  const { id, status, depends_on: dependsOn, related_to: relatedTo } = frontmatter;
  const selected = STATUS_CONTEXT[status];
  if (!selected) throw new Error(`No context mapping for change status "${status}"`);
  return composeResult(selected.mode, selected.fragments, {
    changeText: text,
    changeId: id,
    policy: changePolicyBlock(repo.config, frontmatter),
    dependencies: dependencyBlock(dependsOn, repo),
    relations: relatedBlock(id, relatedTo, repo),
  });
}

export function buildContext(input, cwd = process.cwd()) {
  const changeledgerDir = requireRepo(cwd);
  return composeInput(input, cwd, changeledgerDir);
}

export function context(input, cwd = process.cwd(), output = console.log) {
  output(buildContext(input, cwd).trimEnd());
}
