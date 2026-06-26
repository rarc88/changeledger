import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from './atomic-write.mjs';
import { agentsTemplate } from './paths.mjs';

// The tool's contract (templates/AGENTS.md) is a tool artifact, not a project
// artifact. Each repo links to the installed copy via `.changeledger/AGENTS.md` (a
// per-machine, gitignored symlink) and points its own contract files at that
// link. We never copy the contract (it would drift) nor commit the symlink (it
// would dangle on another machine). See change #20260614-151759.

// Project-owned contract files that should reference the linked contract. The
// root AGENTS.md is required by `init`; CLAUDE.md is referenced when present.
const CONTRACT_FILES = ['AGENTS.md', 'CLAUDE.md'];

const MARKER = '<!-- changeledger -->';
const REFERENCE = `${MARKER}
> [!IMPORTANT]
> This repo uses **ChangeLedger**. Read and follow \`.changeledger/AGENTS.md\` (the change
> contract). If it is missing, run \`changeledger register\`.
`;

export const contractLink = (changeledgerDir) => path.join(changeledgerDir, 'AGENTS.md');
export const rootContract = (repoRoot) => path.join(repoRoot, 'AGENTS.md');

// A real, non-symlink file we may safely append to.
function isPlainFile(file) {
  try {
    return fs.lstatSync(file).isFile();
  } catch {
    return false;
  }
}

// Create (or refresh) the `.changeledger/AGENTS.md` symlink to the installed contract.
// Idempotent and tolerant of a pre-existing/dangling link.
export function linkContract(changeledgerDir) {
  const link = contractLink(changeledgerDir);
  try {
    fs.lstatSync(link);
    fs.unlinkSync(link);
  } catch {
    // no existing link — nothing to remove
  }
  try {
    fs.symlinkSync(agentsTemplate, link);
  } catch {
    // Windows without Developer Mode/admin cannot create symlinks. Fall back to
    // a copy so the contract is still present; `changeledger register` refreshes it if the
    // installed contract changes.
    writeFileAtomic(link, fs.readFileSync(agentsTemplate, 'utf8'));
  }
  return link;
}

// Append the reference block to each present, non-symlink contract file unless
// already there. Symlinks are skipped (appending would write into their target).
export function ensureReference(repoRoot) {
  const touched = [];
  for (const name of CONTRACT_FILES) {
    const file = path.join(repoRoot, name);
    if (!isPlainFile(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (text.includes(MARKER)) continue;
    writeFileAtomic(file, `${text}${text.endsWith('\n') ? '' : '\n'}\n${REFERENCE}`);
    touched.push(name);
  }
  return touched;
}

// Ensure `.changeledger/AGENTS.md` is gitignored (it is a per-machine artifact).
export function ensureGitignore(repoRoot) {
  const file = path.join(repoRoot, '.gitignore');
  const entry = '.changeledger/AGENTS.md';
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (text.split('\n').some((l) => l.trim() === entry)) return false;
  writeFileAtomic(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${entry}\n`);
  return true;
}

// IO-level discovery validation (repo-wide). Returns a list of error messages.
export function checkContract(repoRoot, changeledgerDir) {
  const errors = [];
  const root = rootContract(repoRoot);
  if (!fs.existsSync(root)) {
    errors.push('missing AGENTS.md at the repo root (ChangeLedger contract reference lives here)');
  }
  // Every present, non-symlink contract file must carry the reference.
  for (const name of CONTRACT_FILES) {
    const file = path.join(repoRoot, name);
    if (!isPlainFile(file)) continue;
    if (!fs.readFileSync(file, 'utf8').includes(MARKER)) {
      errors.push(`${name} has no ChangeLedger reference — run \`changeledger register\``);
    }
  }
  if (!fs.existsSync(contractLink(changeledgerDir))) {
    errors.push('`.changeledger/AGENTS.md` is missing or dangling — run `changeledger register`');
  }
  return errors;
}
