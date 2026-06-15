import fs from 'node:fs';
import path from 'node:path';
import { parseChange } from './change.mjs';
import { findSpecDir, loadConfig, resolveRepoPath, resolveSpecsDir } from './config.mjs';
import { parseSpec } from './spec.mjs';

// Loads a Spec Ledger repo: locates .sl/, reads config and every change file.
// Shared by `sl view` and `sl check`.
export function loadRepo(start = process.cwd()) {
  const specDir = findSpecDir(start);
  if (!specDir) {
    throw new Error('Not a Spec Ledger repo (no .sl/ found). Run `sl init` first.');
  }
  const repoRoot = path.dirname(specDir);
  const config = loadConfig(specDir);
  const changesDir = resolveRepoPath(repoRoot, config.changes_dir, 'changes_dir');

  const changes = [];
  if (fs.existsSync(changesDir)) {
    for (const name of fs.readdirSync(changesDir).sort()) {
      if (!name.endsWith('.md')) continue;
      const file = path.join(changesDir, name);
      const text = fs.readFileSync(file, 'utf8');
      changes.push({ file, name, text, ...parseChange(text) });
    }
  }
  changes.sort((a, b) => String(a.frontmatter.id).localeCompare(String(b.frontmatter.id)));

  const specs = [];
  const specsDir = resolveSpecsDir(repoRoot, config);
  if (fs.existsSync(specsDir)) {
    for (const name of fs.readdirSync(specsDir).sort()) {
      if (!name.endsWith('.md')) continue;
      const file = path.join(specsDir, name);
      specs.push({ file, name, ...parseSpec(fs.readFileSync(file, 'utf8')) });
    }
  }

  return { specDir, repoRoot, config, changes, specs };
}
