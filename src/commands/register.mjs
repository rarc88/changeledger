import fs from 'node:fs';
import path from 'node:path';
import { findChangeledgerDir, loadConfig } from '../config.mjs';
import { ensureGitignore, ensureReference, linkContract, rootContract } from '../contract.mjs';
import { register } from '../registry.mjs';

// (Re)links the current repo's path to its config project_id in the global
// registry, and regenerates the per-machine `.changeledger/AGENTS.md` contract link. Use
// after moving the repo or cloning it on another machine.
export function registerRepo(cwd = process.cwd()) {
  const changeledgerDir = findChangeledgerDir(cwd);
  if (!changeledgerDir) throw new Error('Not a ChangeLedger repo. Run `changeledger init` first.');

  const config = loadConfig(changeledgerDir);
  if (!config.project_id) {
    throw new Error('config.yml has no project_id. Run `changeledger init` to create one.');
  }

  const repoRoot = path.dirname(changeledgerDir);
  const name = config.project_name || path.basename(repoRoot);

  linkContract(changeledgerDir);
  ensureGitignore(repoRoot);
  if (fs.existsSync(rootContract(repoRoot))) ensureReference(repoRoot);

  register({ id: config.project_id, name, path: repoRoot });
  return { id: config.project_id, name, path: repoRoot };
}
