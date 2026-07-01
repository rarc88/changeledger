import fs from 'node:fs';
import path from 'node:path';
import { parseChange } from '../change.mjs';
import { findChangeledgerDir } from '../config.mjs';
import { contractTemplatesDir, packageRoot } from '../paths.mjs';
import { resolveChange } from '../repo.mjs';

const VERSION = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).version;
const END_DELIMITER =
  '===== CHANGELEDGER CONTEXT END — if this line is missing, the output was truncated: stop and re-run =====';
const MODES = ['implement', 'review', 'spec', 'release'];
const MODE_CONTEXT = {
  implement: ['implement', 'delegation', 'readiness', 'handoff'],
  review: ['review', 'delegation', 'handoff'],
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

function compose(mode, fragments, changeText, incremental = true, changeId = undefined) {
  const sections = [beginDelimiter(mode, changeId)];
  if (incremental) sections.push(INCREMENTAL_NOTICE);
  sections.push(...fragments.map(fragment));
  if (changeText) sections.push('---\n\n# Selected change\n', changeText.trim());
  sections.push(END_DELIMITER);
  return `${sections.join('\n\n')}\n`;
}

function requireRepo(cwd) {
  if (!findChangeledgerDir(cwd)) {
    throw new Error('Not a ChangeLedger repo. Run `changeledger init` first.');
  }
}

export function buildContext(input, cwd = process.cwd()) {
  requireRepo(cwd);
  if (!input) return compose('core', ['core'], undefined, false);
  if (MODES.includes(input)) return compose(input, MODE_CONTEXT[input]);

  let resolved;
  try {
    resolved = resolveChange(cwd, input);
  } catch {
    throw new Error(
      `Unknown context "${input}" — valid modes: ${MODES.join(', ')} (or pass a change id)`,
    );
  }

  const text = fs.readFileSync(resolved.file, 'utf8');
  const { id, status } = parseChange(text).frontmatter;
  const selected = STATUS_CONTEXT[status];
  if (!selected) throw new Error(`No context mapping for change status "${status}"`);
  return compose(selected.mode, selected.fragments, text, true, id);
}

export function context(input, cwd = process.cwd(), output = console.log) {
  output(buildContext(input, cwd).trimEnd());
}
