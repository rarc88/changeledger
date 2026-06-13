import fs from 'node:fs';
import path from 'node:path';
import { findSpecDir, loadConfig } from '../config.mjs';

// Scaffolds a new change file with the active stages for its type.
export function newChange({ type, title, now }, cwd = process.cwd()) {
  const specDir = findSpecDir(cwd);
  if (!specDir) throw new Error('Not a Spec Ledger repo. Run `sl init` first.');

  const config = loadConfig(specDir);
  const typeDef = config.types?.[type];
  if (!typeDef) {
    throw new Error(`Unknown type "${type}". Valid: ${Object.keys(config.types ?? {}).join(', ')}`);
  }

  const repoRoot = path.dirname(specDir);
  const changesDir = path.join(repoRoot, config.changes_dir);
  fs.mkdirSync(changesDir, { recursive: true });

  const id = nextId(changesDir, config.id_digits ?? 4);
  const slug = slugify(title);
  const file = path.join(changesDir, `${id}-${slug}.md`);
  fs.writeFileSync(file, render({ id, title, type, stages: typeDef.stages, now }));
  return file;
}

function nextId(changesDir, digits) {
  let max = 0;
  if (fs.existsSync(changesDir)) {
    for (const name of fs.readdirSync(changesDir)) {
      const m = name.match(/^(\d+)-/);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return String(max + 1).padStart(digits, '0');
}

function slugify(title) {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function heading(stageKey) {
  return stageKey.charAt(0).toUpperCase() + stageKey.slice(1);
}

function render({ id, title, type, stages, now }) {
  const fm = [
    '---',
    `id: "${id}"`,
    `title: ${title}`,
    `type: ${type}`,
    'status: draft',
    `created: ${now}`,
    'depends_on: []',
    '---',
    '',
  ].join('\n');
  const body = stages.map((s) => `## ${heading(s)}\n`).join('\n');
  return fm + '\n' + body;
}
