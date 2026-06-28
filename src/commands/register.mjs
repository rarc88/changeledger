import fs from 'node:fs';
import path from 'node:path';
import { findChangeledgerDir, loadConfig } from '../config.mjs';
import {
  ensureReference,
  removeLegacyContract,
  removeLegacyGitignore,
  rootContract,
} from '../contract.mjs';
import { register } from '../registry.mjs';

// Refreshes the repo bootstrap and registry path. Also migrates the per-machine
// contract artifact left by legacy versions.
export function registerRepo(cwd = process.cwd()) {
  const changeledgerDir = findChangeledgerDir(cwd);
  if (!changeledgerDir) throw new Error('Not a ChangeLedger repo. Run `changeledger init` first.');

  const config = loadConfig(changeledgerDir);
  if (!config.project_id) {
    throw new Error('config.yml has no project_id. Run `changeledger init` to create one.');
  }

  const repoRoot = path.dirname(changeledgerDir);
  const name = config.project_name || path.basename(repoRoot);

  removeLegacyContract(changeledgerDir);
  removeLegacyGitignore(repoRoot);
  if (fs.existsSync(rootContract(repoRoot))) ensureReference(repoRoot);

  register({ id: config.project_id, name, path: repoRoot });
  return { id: config.project_id, name, path: repoRoot };
}
