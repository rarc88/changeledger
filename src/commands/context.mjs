import fs from 'node:fs';
import path from 'node:path';
import { parseChange } from '../change.mjs';
import {
  findChangeledgerDir,
  integrationBranch,
  loadConfig,
  renderChangeBranch,
} from '../config.mjs';
import { beginSentinel, endSentinel, VERSION } from '../framing.mjs';
import { contractTemplatesDir } from '../paths.mjs';
import { loadRepo, resolveChange } from '../repo.mjs';

const END_DELIMITER = endSentinel('CONTEXT');
const MODES = ['implement', 'review', 'spec', 'release'];
const MODE_CONTEXT = {
  implement: ['implement', 'delegation', 'handoff'],
  review: ['review', 'handoff'],
  spec: ['spec', 'delegation', 'readiness'],
  release: ['release'],
};
const STATUS_CONTEXT = {
  draft: { mode: 'spec', fragments: MODE_CONTEXT.spec },
  approved: { mode: 'implement', fragments: MODE_CONTEXT.implement },
  'in-progress': { mode: 'implement', fragments: MODE_CONTEXT.implement },
  'in-review': { mode: 'review', fragments: MODE_CONTEXT.review },
  blocked: { mode: 'blocked', fragments: ['blocked', 'handoff'] },
  'in-validation': { mode: 'validation', fragments: ['validation'] },
  done: { mode: 'close', fragments: ['close'] },
  discarded: { mode: 'discarded', fragments: ['discarded'] },
};
const INCREMENTAL_NOTICE = `This incremental context extends the complete core context already read.
Its one-pass full-capture rule applies here; a partial view is invalid.`;

function fragment(name) {
  return fs.readFileSync(path.join(contractTemplatesDir, `${name}.md`), 'utf8').trim();
}

// Budget thresholds live in the contract, so the published ceiling is the same
// number the quality gate enforces and cannot drift from it.
let budgetCache;

function packBudget(mode) {
  budgetCache ??= JSON.parse(
    fs.readFileSync(path.join(contractTemplatesDir, 'budgets.yml'), 'utf8'),
  );
  return budgetCache.base[mode];
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
// template config and the Definition of Ready contract.
const DEFAULT_LANGUAGE = 'en';
const DEFAULT_TDD = true;

function effectiveLanguage(config) {
  return config?.language ?? DEFAULT_LANGUAGE;
}

function effectiveTdd(config) {
  const value = config?.tdd ?? DEFAULT_TDD;
  return value ? 'on' : 'off';
}

// The transversal policy line every composition anchors on: effective language
// and tdd with defaults already resolved. The integration branch appears only
// when declared — absence means the repo keeps branch auto-detection.
// Called with `includeTdd: false` for a change-id capture whose type never
// serves `readiness.md` (the only fragment that defines the `tdd` obligation)
// — publishing the line unconditionally would hand such a type an obligation
// with no definition anywhere in the same capture (CR5).
export function transversalPolicy(config, { includeTdd = true } = {}) {
  const tdd = includeTdd ? ` — tdd=${effectiveTdd(config)}` : '';
  const base = `Effective policy: language=${effectiveLanguage(config)}${tdd}`;
  const branch = integrationBranch(config);
  return branch ? `${base} — integration_branch=${branch}` : base;
}

// A change's `type` selects which stages the capture composes and which
// obligations (tdd, review) apply. An undecidable type — not declared in
// `config.types`, absent from the change's own frontmatter, or declaring
// `stages` as something other than a list — is exactly the class of defect
// this repo aborts on rather than silently degrading: `context` must never
// publish an empty `Active stages(...)=` line or omit `readiness` without
// saying why (CR1). Single seat consumed by both callers below.
function assertKnownType(config, type) {
  if (type === undefined) throw new Error('missing frontmatter "type"');
  const typeConfig = config?.types?.[type];
  if (!typeConfig) throw new Error(`unknown type "${type}"`);
  if (!Array.isArray(typeConfig.stages)) {
    throw new Error(`config type "${type}": stages must be a list`);
  }
  return typeConfig;
}

// Type-specific policy for change-id contexts: adds review requirement and the
// active stages the type actually uses, so the agent does not infer them.
function changePolicyBlock(config, change) {
  const { type } = change;
  const typeConfig = assertKnownType(config, type);
  const reviewRequired = typeConfig.review_required === true ? 'yes' : 'no';
  const servesReadiness = typeConfig.stages.includes('specification');
  const changeBranch = renderChangeBranch(config, change);
  const branch = changeBranch ? ` — change_branch=${changeBranch}` : '';
  const lines = [
    `${transversalPolicy(config, { includeTdd: servesReadiness })}${branch} — review_required(${type})=${reviewRequired}`,
    `Active stages(${type})=${typeConfig.stages.join(', ')}`,
  ];
  return lines.join('\n');
}

// `readiness` (`# Definition of Ready`) presupposes the change carries a
// `specification` stage: it requires every behavioral requirement to be a `CRn`
// and every Plan task to cite one. A type that never activates that stage
// cannot satisfy it — `check` rejects the stage outright — so composing the
// fragment would contradict the `Active stages(<type>)=` line of the same
// capture. Derived from the configured stages, never from a list of type names.
function fragmentsForType(fragments, config, type) {
  const { stages } = assertKnownType(config, type);
  if (stages.includes('specification')) return fragments;
  return fragments.filter((name) => name !== 'readiness');
}

// One line per local dependency (id, title, status); external `project:id`
// references stay references, never pretending local resolution.
function dependencyBlock(dependsOn, cwd) {
  if (!Array.isArray(dependsOn) || dependsOn.length === 0) return undefined;
  const lines = dependsOn.map((raw) => {
    const dep = String(raw);
    if (dep.includes(':')) return `- #${dep} — external reference (not resolved locally)`;
    try {
      const resolved = resolveChange(cwd, dep);
      const { frontmatter } = parseChange(fs.readFileSync(resolved.file, 'utf8'));
      return `- #${dep} — ${frontmatter.title} — ${frontmatter.status}`;
    } catch {
      return `- #${dep} — unresolved local dependency`;
    }
  });
  return `## Dependencies\n\n${lines.join('\n')}`;
}

function relatedChangeLine(direction, raw, cwd) {
  const reference = String(raw);
  if (reference.includes(':')) {
    return `- ${direction} — #${reference} — external reference (not resolved locally)`;
  }
  try {
    const resolved = resolveChange(cwd, reference);
    const { frontmatter } = parseChange(fs.readFileSync(resolved.file, 'utf8'));
    return `- ${direction} — #${reference} — ${frontmatter.title} — ${frontmatter.status}`;
  } catch {
    return `- ${direction} — #${reference} — unresolved local relation`;
  }
}

function relatedBlock(id, relatedTo, cwd) {
  const outgoing = Array.isArray(relatedTo) ? relatedTo : [];
  const incoming = loadRepo(cwd)
    .changes.filter(
      (change) =>
        String(change.frontmatter?.id) !== String(id) &&
        Array.isArray(change.frontmatter?.related_to) &&
        change.frontmatter.related_to.some((target) => String(target) === String(id)),
    )
    .map((change) => String(change.frontmatter.id));
  if (!outgoing.length && !incoming.length) return undefined;
  const lines = [
    ...outgoing.map((target) => relatedChangeLine('outgoing', target, cwd)),
    ...incoming.map((source) => relatedChangeLine('incoming', source, cwd)),
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
  return frameSections(mode, changeId, body, changeId ? undefined : packBudget(mode));
}

function requireRepo(cwd) {
  const dir = findChangeledgerDir(cwd);
  if (!dir) throw new Error('Not a ChangeLedger repo. Run `changeledger init` first.');
  return dir;
}

function composeInput(input, cwd, config) {
  if (!input) {
    return composeResult('core', ['core'], {
      incremental: false,
      policy: transversalPolicy(config),
    });
  }
  if (MODES.includes(input)) {
    return composeResult(input, MODE_CONTEXT[input], { policy: transversalPolicy(config) });
  }

  let resolved;
  try {
    resolved = resolveChange(cwd, input);
  } catch {
    throw new Error(
      `Unknown context "${input}" — valid modes: ${MODES.join(', ')} (or pass a change id)`,
    );
  }

  const text = fs.readFileSync(resolved.file, 'utf8');
  const {
    id,
    status,
    type,
    depends_on: dependsOn,
    related_to: relatedTo,
  } = parseChange(text).frontmatter;
  const selected = STATUS_CONTEXT[status];
  if (!selected) throw new Error(`No context mapping for change status "${status}"`);
  return composeResult(selected.mode, fragmentsForType(selected.fragments, config, type), {
    changeText: text,
    changeId: id,
    policy: changePolicyBlock(config, { id, type }),
    dependencies: dependencyBlock(dependsOn, cwd),
    relations: relatedBlock(id, relatedTo, cwd),
  });
}

export function buildContext(input, cwd = process.cwd()) {
  const changeledgerDir = requireRepo(cwd);
  const config = loadConfig(changeledgerDir);
  return composeInput(input, cwd, config);
}

export function context(input, cwd = process.cwd(), output = console.log) {
  output(buildContext(input, cwd).trimEnd());
}
