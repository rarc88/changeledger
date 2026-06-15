import fs from 'node:fs';
import path from 'node:path';
import { findSpecDir, loadConfig } from '../config.mjs';
import { serializeScalar } from '../yaml.mjs';

// Scaffolds a new change file with the active stages for its type.
// `slug` is the English filename slug (structure); `title` is the content title
// (repo language). See AGENTS.md §7-§8.
export function newChange({ type, slug, title, owner, now }, cwd = process.cwd()) {
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

  // Guarantee a unique id even for changes created within the same second
  // (an agent creating several in a loop). Bump by 1s until free; keep created
  // coherent with the id.
  let created = now;
  let id = idFromTimestamp(created);
  while (idTaken(changesDir, id)) {
    created = bumpSecond(created);
    id = idFromTimestamp(created);
  }

  const file = path.join(changesDir, `${id}-${slugify(slug)}.md`);
  fs.writeFileSync(file, render({ id, title, type, owner, stages: typeDef.stages, now: created }));
  return file;
}

function idTaken(changesDir, id) {
  return fs.readdirSync(changesDir).some((name) => name.startsWith(`${id}-`));
}

function bumpSecond(iso) {
  const t = new Date(iso).getTime() + 1000;
  return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
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

function render({ id, title, type, owner, stages, now }) {
  const fm = [
    '---',
    `id: "${id}"`,
    `title: ${serializeScalar(title)}`,
    `type: ${type}`,
    'status: draft',
    `created: ${now}`,
    'depends_on: []',
    ...(owner ? [`owner: ${serializeScalar(owner)}`] : []),
    '---',
    '',
  ].join('\n');
  const body = stages.map((s) => `## ${heading(s)}\n`).join('\n');
  return `${fm}\n${body}`;
}
