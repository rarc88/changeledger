import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { agentsTemplate, templatesDir } from '../paths.mjs';
import { register } from '../registry.mjs';

// Sets up `.sl/` in the repo, gives it a stable identity, materializes the
// AGENTS.md contract, and registers the repo in the global registry.
export function init(cwd = process.cwd()) {
  const repoRoot = path.resolve(cwd);
  const specDir = path.join(repoRoot, '.sl');
  if (fs.existsSync(specDir)) {
    throw new Error('.sl/ already exists. Use `sl register` to (re)link this repo.');
  }

  fs.mkdirSync(path.join(specDir, 'changes'), { recursive: true });
  const configFile = path.join(specDir, 'config.yml');
  fs.copyFileSync(path.join(templatesDir, 'config.yml'), configFile);

  const id = crypto.randomBytes(5).toString('hex');
  const name = path.basename(repoRoot);
  fs.appendFileSync(
    configFile,
    `\n# Project identity (stable; the global registry maps it to a path)\nproject_id: "${id}"\nproject_name: ${name}\n`,
  );

  const agentsDest = path.join(repoRoot, 'AGENTS.md');
  if (!fs.existsSync(agentsDest)) fs.copyFileSync(agentsTemplate, agentsDest);

  register({ id, name, path: repoRoot });
  return specDir;
}
