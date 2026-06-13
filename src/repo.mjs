import fs from 'node:fs';
import path from 'node:path';
import { findSpecDir, loadConfig } from './config.mjs';
import { parseChange } from './change.mjs';

// Loads a Spec Ledger repo: locates .sl/, reads config and every change file.
// Shared by `sl view` and `sl check`.
export function loadRepo(start = process.cwd()) {
  const specDir = findSpecDir(start);
  if (!specDir) {
    throw new Error('Not a Spec Ledger repo (no .sl/ found). Run `sl init` first.');
  }
  const repoRoot = path.dirname(specDir);
  const config = loadConfig(specDir);
  const changesDir = path.join(repoRoot, config.changes_dir);

  const changes = [];
  if (fs.existsSync(changesDir)) {
    for (const name of fs.readdirSync(changesDir).sort()) {
      if (!name.endsWith('.md')) continue;
      const file = path.join(changesDir, name);
      const parsed = parseChange(fs.readFileSync(file, 'utf8'));
      changes.push({ file, name, ...parsed });
    }
  }
  changes.sort((a, b) => String(a.frontmatter.id).localeCompare(String(b.frontmatter.id)));

  return { specDir, repoRoot, config, changes };
}
