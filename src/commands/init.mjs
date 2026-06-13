import fs from 'node:fs';
import path from 'node:path';
import { agentsTemplate, templatesDir } from '../paths.mjs';

// Sets up `.sl/` in the repo and materializes the AGENTS.md contract.
export function init(cwd = process.cwd()) {
  const specDir = path.join(cwd, '.sl');
  if (fs.existsSync(specDir)) throw new Error('.sl/ already exists in this repo');

  fs.mkdirSync(path.join(specDir, 'changes'), { recursive: true });
  fs.copyFileSync(path.join(templatesDir, 'config.yml'), path.join(specDir, 'config.yml'));

  const agentsDest = path.join(cwd, 'AGENTS.md');
  if (!fs.existsSync(agentsDest)) fs.copyFileSync(agentsTemplate, agentsDest);

  return specDir;
}
