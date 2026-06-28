import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from './atomic-write.mjs';

const CONTRACT_FILES = ['AGENTS.md', 'CLAUDE.md'];
const MARKER = '<!-- changeledger -->';
const LEGACY_ENTRY = '.changeledger/AGENTS.md';
const LEGACY_HEADING = '# AGENTS.md — ChangeLedger Contract';

export const REFERENCE = `${MARKER}
> [!IMPORTANT]
> This repo uses **ChangeLedger**. Before creating or modifying files, run
> \`changeledger context\` (or \`changeledger context <change-id>\`) and follow its output.
> If the command is unavailable, stop and restore/install ChangeLedger; do not proceed from memory.
`;

export const contractLink = (changeledgerDir) => path.join(changeledgerDir, 'AGENTS.md');
export const rootContract = (repoRoot) => path.join(repoRoot, 'AGENTS.md');

function isPlainFile(file) {
  try {
    return fs.lstatSync(file).isFile();
  } catch {
    return false;
  }
}

function replaceReference(text) {
  const start = text.indexOf(MARKER);
  if (start === -1) return `${text}${text.endsWith('\n') ? '' : '\n'}\n${REFERENCE}`;
  const tail = text.slice(start).split('\n');
  let consumed = 1;
  while (consumed < tail.length && tail[consumed].startsWith('>')) consumed += 1;
  const before = text.slice(0, start);
  const after = tail.slice(consumed).join('\n').replace(/^\n+/, '');
  return `${before}${REFERENCE}${after ? `\n${after}` : ''}`;
}

// Add or replace the managed bootstrap block in project-owned agent files.
export function ensureReference(repoRoot) {
  const touched = [];
  for (const name of CONTRACT_FILES) {
    const file = path.join(repoRoot, name);
    if (!isPlainFile(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const updated = replaceReference(text);
    if (updated === text) continue;
    writeFileAtomic(file, updated);
    touched.push(name);
  }
  return touched;
}

// Remove only artifacts known to be managed by legacy ChangeLedger versions.
// Unknown regular files fail closed instead of being deleted.
export function removeLegacyContract(changeledgerDir) {
  const file = contractLink(changeledgerDir);
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  if (stat.isSymbolicLink()) {
    fs.unlinkSync(file);
    return true;
  }
  if (stat.isFile() && fs.readFileSync(file, 'utf8').startsWith(LEGACY_HEADING)) {
    fs.unlinkSync(file);
    return true;
  }
  throw new Error(
    '`.changeledger/AGENTS.md` is not a recognized legacy ChangeLedger contract; move or remove it manually, then run `changeledger register` again',
  );
}

export function removeLegacyGitignore(repoRoot) {
  const file = path.join(repoRoot, '.gitignore');
  if (!fs.existsSync(file)) return false;
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const kept = lines.filter((line) => line.trim() !== LEGACY_ENTRY);
  if (kept.length === lines.length) return false;
  writeFileAtomic(file, kept.join('\n'));
  return true;
}

export function checkContract(repoRoot) {
  const errors = [];
  const root = rootContract(repoRoot);
  if (!fs.existsSync(root)) {
    errors.push('missing AGENTS.md at the repo root (ChangeLedger contract reference lives here)');
  }
  for (const name of CONTRACT_FILES) {
    const file = path.join(repoRoot, name);
    if (!isPlainFile(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (!text.includes(MARKER)) {
      errors.push(`${name} has no ChangeLedger reference — run \`changeledger register\``);
    } else if (!text.includes(REFERENCE.trim())) {
      errors.push(`${name} has an outdated ChangeLedger reference — run \`changeledger register\``);
    }
  }
  return errors;
}
