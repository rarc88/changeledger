import fs from 'node:fs';
import path from 'node:path';
import { parseYaml } from './yaml.mjs';

// Walk up from `start` looking for a `.sl/` directory. Returns its absolute path
// or null if none is found.
export function findSpecDir(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    const candidate = path.join(dir, '.sl');
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function loadConfig(specDir) {
  const file = path.join(specDir, 'config.yml');
  if (!fs.existsSync(file)) throw new Error(`Missing config: ${file}`);
  return parseYaml(fs.readFileSync(file, 'utf8'));
}
