import fs from 'node:fs';
import path from 'node:path';
import { findSpecDir, loadConfig } from '../config.mjs';
import { ensureGitignore, ensureReference, linkContract, rootContract } from '../contract.mjs';
import { register } from '../registry.mjs';

// (Re)links the current repo's path to its config project_id in the global
// registry, and regenerates the per-machine `.sl/AGENTS.md` contract link. Use
// after moving the repo or cloning it on another machine.
export function registerRepo(cwd = process.cwd()) {
  const specDir = findSpecDir(cwd);
  if (!specDir) throw new Error('Not a Spec Ledger repo. Run `sl init` first.');

  const config = loadConfig(specDir);
  if (!config.project_id) {
    throw new Error('config.yml has no project_id. Run `sl init` to create one.');
  }

  const repoRoot = path.dirname(specDir);
  const name = config.project_name || path.basename(repoRoot);

  linkContract(specDir);
  ensureGitignore(repoRoot);
  if (fs.existsSync(rootContract(repoRoot))) ensureReference(repoRoot);

  register({ id: config.project_id, name, path: repoRoot });
  return { id: config.project_id, name, path: repoRoot };
}
