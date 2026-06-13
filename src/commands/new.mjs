import fs from 'node:fs';
import path from 'node:path';
import { findSpecDir, loadConfig } from '../config.mjs';

// Scaffolds a new change file with the active stages for its type.
// `slug` is the English filename slug (structure); `title` is the content title
// (repo language). See AGENTS.md §7-§8.
export function newChange({ type, slug, title, now }, cwd = process.cwd()) {
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

  const id = idFromTimestamp(now);
  const file = path.join(changesDir, `${id}-${slugify(slug)}.md`);
  fs.writeFileSync(file, render({ id, title, type, stages: typeDef.stages, now }));
  return file;
}

// Derives the canonical id from an ISO 8601 UTC timestamp: YYYYMMDD-HHMMSS.
export function idFromTimestamp(iso) {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) throw new Error(`Invalid ISO timestamp: ${iso}`);
  const [, y, mo, d, h, mi, s] = m;
  return `${y}${mo}${d}-${h}${mi}${s}`;
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
