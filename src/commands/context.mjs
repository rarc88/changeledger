import fs from 'node:fs';
import path from 'node:path';
import { parseChange } from '../change.mjs';
import { findChangeledgerDir, loadConfig } from '../config.mjs';
import { contractTemplatesDir, packageRoot } from '../paths.mjs';
import { resolveChange } from '../repo.mjs';

const VERSION = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).version;
const END_DELIMITER =
  '===== CHANGELEDGER CONTEXT END — if this line is missing, the output was truncated: stop and re-run =====';
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
If you have not read the core output through its \`CHANGELEDGER CONTEXT END\` line, stop and run \`changeledger context\` directly before proceeding.`;

function fragment(name) {
  return fs.readFileSync(path.join(contractTemplatesDir, `${name}.md`), 'utf8').trim();
}

function beginDelimiter(mode, changeId) {
  const change = changeId ? ` — change: #${changeId}` : '';
  return `===== CHANGELEDGER CONTEXT BEGIN — mode: ${mode}${change} — v${VERSION} =====`;
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
// and tdd with defaults already resolved.
function transversalPolicy(config) {
  return `Effective policy: language=${effectiveLanguage(config)} — tdd=${effectiveTdd(config)}`;
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
function dependencyBlock(config, repoRoot, dependsOn, cwd) {
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

function compose(mode, fragments, options = {}) {
  const {
    changeText,
    incremental = true,
    changeId = undefined,
    policy = undefined,
    dependencies = undefined,
  } = options;
  const sections = [beginDelimiter(mode, changeId)];
  if (incremental) sections.push(INCREMENTAL_NOTICE);
  if (policy) sections.push(policy);
  sections.push(...fragments.map(fragment));
  if (dependencies) sections.push(dependencies);
  if (changeText) sections.push('---\n\n# Selected change\n', changeText.trim());
  sections.push(END_DELIMITER);
  return `${sections.join('\n\n')}\n`;
}

function requireRepo(cwd) {
  const dir = findChangeledgerDir(cwd);
  if (!dir) throw new Error('Not a ChangeLedger repo. Run `changeledger init` first.');
  return dir;
}

export function buildContext(input, cwd = process.cwd()) {
  const changeledgerDir = requireRepo(cwd);
  const config = loadConfig(changeledgerDir);
  if (!input) {
    return compose('core', ['core'], { incremental: false, policy: transversalPolicy(config) });
  }
  if (MODES.includes(input)) {
    return compose(input, MODE_CONTEXT[input], { policy: transversalPolicy(config) });
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
  const { id, status, type, depends_on: dependsOn } = parseChange(text).frontmatter;
  const selected = STATUS_CONTEXT[status];
  if (!selected) throw new Error(`No context mapping for change status "${status}"`);
  return compose(selected.mode, selected.fragments, {
    changeText: text,
    changeId: id,
    policy: changePolicyBlock(config, type),
    dependencies: dependencyBlock(config, resolved.repoRoot, dependsOn, cwd),
  });
}

export function context(input, cwd = process.cwd(), output = console.log) {
  output(buildContext(input, cwd).trimEnd());
}
