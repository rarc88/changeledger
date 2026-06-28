import fs from 'node:fs';
import path from 'node:path';
import { parseChange } from '../change.mjs';
import { findChangeledgerDir } from '../config.mjs';
import { contractTemplatesDir } from '../paths.mjs';
import { resolveChange } from '../repo.mjs';

const MODES = ['implement', 'review', 'spec', 'release'];
const MODE_CONTEXT = {
  implement: ['core', 'implement', 'readiness'],
  review: ['core', 'review'],
  spec: ['core', 'spec', 'readiness'],
  release: ['core', 'release'],
};
const STATUS_CONTEXT = {
  draft: { mode: 'spec', fragments: MODE_CONTEXT.spec },
  approved: { mode: 'implement', fragments: MODE_CONTEXT.implement },
  'in-progress': { mode: 'implement', fragments: MODE_CONTEXT.implement },
  'in-review': { mode: 'review', fragments: ['core', 'review'] },
  blocked: { mode: 'blocked', fragments: ['core', 'blocked'] },
  'in-validation': { mode: 'validation', fragments: ['core', 'validation'] },
  done: { mode: 'close', fragments: ['core', 'close'] },
  discarded: { mode: 'discarded', fragments: ['core', 'discarded'] },
};

function fragment(name) {
  return fs.readFileSync(path.join(contractTemplatesDir, `${name}.md`), 'utf8').trim();
}

function compose(mode, fragments, changeText) {
  const sections = [`Mode: ${mode}`, ...fragments.map(fragment)];
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
  if (!input) return compose('core', ['core']);
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
