import fs from 'node:fs';
import path from 'node:path';
import { parseChange } from '../change.mjs';
import { findChangeledgerDir } from '../config.mjs';
import { contractTemplatesDir } from '../paths.mjs';
import { resolveChange } from '../repo.mjs';

const MODES = ['implement', 'review', 'spec', 'release'];
const MODE_CONTEXT = {
  implement: ['implement', 'readiness'],
  review: ['review'],
  spec: ['spec', 'readiness'],
  release: ['release'],
};
const STATUS_CONTEXT = {
  draft: { mode: 'spec', fragments: MODE_CONTEXT.spec },
  approved: { mode: 'implement', fragments: MODE_CONTEXT.implement },
  'in-progress': { mode: 'implement', fragments: MODE_CONTEXT.implement },
  'in-review': { mode: 'review', fragments: MODE_CONTEXT.review },
  blocked: { mode: 'blocked', fragments: ['blocked'] },
  'in-validation': { mode: 'validation', fragments: ['validation'] },
  done: { mode: 'close', fragments: ['close'] },
  discarded: { mode: 'discarded', fragments: ['discarded'] },
};
const INCREMENTAL_NOTICE = `This incremental context extends the complete core context already read.
If the complete base output has not been read, stop and run \`changeledger context\` directly before proceeding.`;

function fragment(name) {
  return fs.readFileSync(path.join(contractTemplatesDir, `${name}.md`), 'utf8').trim();
}

function compose(mode, fragments, changeText, incremental = true) {
  const sections = [`Mode: ${mode}`];
  if (incremental) sections.push(INCREMENTAL_NOTICE);
  sections.push(...fragments.map(fragment));
  if (changeText) sections.push('---\n\n# Selected change\n', changeText.trim());
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
  const status = parseChange(text).frontmatter.status;
  const selected = STATUS_CONTEXT[status];
  if (!selected) throw new Error(`No context mapping for change status "${status}"`);
  return compose(selected.mode, selected.fragments, text);
}

export function context(input, cwd = process.cwd(), output = console.log) {
  output(buildContext(input, cwd).trimEnd());
}
