import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from '../atomic-write.mjs';
import { ensureGitignore, ensureReference, linkContract, rootContract } from '../contract.mjs';
import { templatesDir } from '../paths.mjs';
import { register } from '../registry.mjs';
import { serializeScalar } from '../yaml.mjs';

// Sets up `.sl/` in the repo, gives it a stable identity, links the installed
// AGENTS.md contract into `.sl/`, references it from the project's root
// AGENTS.md, and registers the repo in the global registry.
export function init(cwd = process.cwd()) {
  const repoRoot = path.resolve(cwd);
  const specDir = path.join(repoRoot, '.sl');
  if (fs.existsSync(specDir)) {
    throw new Error('.sl/ already exists. Use `sl register` to (re)link this repo.');
  }
  // The root AGENTS.md is the project's own contract; we reference the tool's
  // contract from it but never create it ourselves. Fail before touching .sl/.
  if (!fs.existsSync(rootContract(repoRoot))) {
    throw new Error('Create AGENTS.md at the repo root first, then re-run `sl init`.');
  }

  fs.mkdirSync(path.join(specDir, 'changes'), { recursive: true });
  const configFile = path.join(specDir, 'config.yml');

  const id = crypto.randomBytes(5).toString('hex');
  const name = path.basename(repoRoot);
  writeFileAtomic(
    configFile,
    `${fs.readFileSync(path.join(templatesDir, 'config.yml'), 'utf8')}\n# Project identity (stable; the global registry maps it to a path)\nproject_id: "${id}"\nproject_name: ${serializeScalar(name)}\n`,
  );

  linkContract(specDir);
  ensureReference(repoRoot);
  ensureGitignore(repoRoot);

  register({ id, name, path: repoRoot });
  return specDir;
}
