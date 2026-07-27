import fs from 'node:fs';
import path from 'node:path';
import { parseChange } from '../change.mjs';
import { findChangeledgerDir, integrationBranch, loadConfig } from '../config.mjs';
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

// A capture publishes how much of its ceiling it occupies. A change-id capture
// is unbounded by design — it embeds a document of any size — so it has no entry
// in `budgets.yml` and publishes its exact count without inventing a ceiling.
function beginDelimiter(mode, changeId, occupancy) {
  const change = changeId ? ` — change: #${changeId}` : '';
  const budget = occupancy.budget;
  const size = budget
    ? `lines:${occupancy.lines}/${budget.lines} — bytes:${occupancy.bytes}/${budget.bytes}`
    : `lines:${occupancy.lines}`;
  return beginSentinel('CONTEXT', `mode: ${mode}${change} — v${VERSION} — ${size}`);
}

// The published byte count is part of the text whose size it reports, so widening
// a digit changes the total. Iterate to the fixed point instead of approximating:
// it settles because the figure's width only grows when it crosses a power of
// ten. Failing loudly beats publishing a number that is not the real size.
const MAX_FRAMING_PASSES = 4;

export function frameSections(mode, changeId, body, budget, maxPasses = MAX_FRAMING_PASSES) {
  const occupancy = { lines: 0, bytes: 0, budget };
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const sections = [beginDelimiter(mode, changeId, occupancy), ...body, END_DELIMITER];
    const rendered = render(sections);
    const lines = emittedLines(rendered);
    const bytes = Buffer.byteLength(rendered, 'utf8');
    if (lines === occupancy.lines && bytes === occupancy.bytes) return rendered;
    occupancy.lines = lines;
    occupancy.bytes = bytes;
  }
  throw new Error(
    `Context framing for "${mode}" did not converge in ${maxPasses} passes: published size keeps changing`,
  );
}

function render(sections) {
  return `${sections.join('\n\n')}\n`;
}

// Total lines of the emitted output. The rendered text ends with exactly one
// trailing newline, so its newline count is what `wc -l` reports for the CLI
// stdout and what a consumer must pass to `head -<N>`.
function emittedLines(text) {
  return text.split('\n').length - 1;
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
export function transversalPolicy(config) {
  const base = `Effective policy: language=${effectiveLanguage(config)} — tdd=${effectiveTdd(config)}`;
  const branch = integrationBranch(config);
  return branch ? `${base} — integration_branch=${branch}` : base;
}

// Type-specific policy for change-id contexts: adds review requirement and the
// active stages the type actually uses, so the agent does not infer them.
function changePolicyBlock(config, type) {
  const typeConfig = config?.types?.[type] ?? {};
  const reviewRequired = typeConfig.review_required === true ? 'yes' : 'no';
  const stages = Array.isArray(typeConfig.stages) ? typeConfig.stages.join(', ') : '';
  const lines = [
    `${transversalPolicy(config)} — review_required(${type})=${reviewRequired}`,
    `Active stages(${type})=${stages}`,
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
  const stages = config?.types?.[type]?.stages;
  if (Array.isArray(stages) && stages.includes('specification')) return fragments;
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
  // The BEGIN line publishes the exact size so any consumer can build a
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
    policy: changePolicyBlock(config, type),
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
