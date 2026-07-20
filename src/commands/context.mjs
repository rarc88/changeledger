import fs from 'node:fs';
import path from 'node:path';
import { parseChange } from '../change.mjs';
import { findChangeledgerDir, integrationBranch } from '../config.mjs';
import { beginSentinel, contentRev, endSentinel, VERSION } from '../framing.mjs';
import { contractTemplatesDir } from '../paths.mjs';
import { loadRepo, resolveChange, resolveRepoAuthority } from '../repo.mjs';

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

function beginDelimiter(mode, changeId, rev, extra = '') {
  const change = changeId ? ` — change: #${changeId}` : '';
  const revPart = rev ? ` — rev:${rev}` : '';
  return beginSentinel('CONTEXT', `mode: ${mode}${change} — v${VERSION}${revPart}${extra}`);
}

// Short confirmation body returned by `--have` when the caller's retained
// revision still matches: no contract text, just the framed confirmation.
function unchangedBody(rev) {
  return `Context unchanged since rev:${rev}. Skip reload; continue with the retained capture.`;
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

// One line per local dependency (id, title, status); external `project:id`
// references stay references, never pretending local resolution.
function dependencyBlock(dependsOn, cwd) {
  if (!Array.isArray(dependsOn) || dependsOn.length === 0) return undefined;
  const lines = dependsOn.map((raw) => {
    const dep = String(raw);
    if (dep.includes(':')) return `- #${dep} — external reference (not resolved locally)`;
    try {
      const resolved = resolveChange(cwd, dep);
      const { frontmatter } = resolved.change;
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
    const { frontmatter } = resolved.change;
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

// Composes the body (everything between the BEGIN and END lines), derives its
// `rev` from that body alone — never from the framing lines that quote it —
// then returns both the rev and the full rendered text so callers can decide
// whether a `--have` match makes the full body unnecessary.
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
  const rev = contentRev(body.join('\n\n'));
  const sections = [beginDelimiter(mode, changeId, rev), ...body, END_DELIMITER];
  return { mode, changeId, rev, text: `${sections.join('\n\n')}\n` };
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

  const text = resolved.change.text;
  const {
    id,
    status,
    type,
    depends_on: dependsOn,
    related_to: relatedTo,
  } = parseChange(text).frontmatter;
  const selected = STATUS_CONTEXT[status];
  if (!selected) throw new Error(`No context mapping for change status "${status}"`);
  return composeResult(selected.mode, selected.fragments, {
    changeText: text,
    changeId: id,
    policy: changePolicyBlock(config, type),
    dependencies: dependencyBlock(dependsOn, cwd),
    relations: relatedBlock(id, relatedTo, cwd),
  });
}

// `options.have` names a previously captured `rev`. A match returns a short
// framed `unchanged` confirmation instead of the full contract body; any
// mismatch (stale or invented) falls back to the complete normal output.
export function buildContext(input, cwd = process.cwd(), options = {}) {
  requireRepo(cwd);
  const { config } = resolveRepoAuthority(cwd);
  const result = composeInput(input, cwd, config);
  if (options.have && options.have === result.rev) {
    const sections = [
      beginDelimiter(result.mode, result.changeId, result.rev, ' — unchanged'),
      unchangedBody(result.rev),
      END_DELIMITER,
    ];
    return `${sections.join('\n\n')}\n`;
  }
  return result.text;
}

export function context(input, options = {}, cwd = process.cwd(), output = console.log) {
  output(buildContext(input, cwd, options).trimEnd());
}
