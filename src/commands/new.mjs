import fs from 'node:fs';
import path from 'node:path';
import { findChangeledgerDir, loadConfig, resolveRepoPath } from '../config.mjs';
import { slugify } from '../slug.mjs';
import { serializeScalar } from '../yaml.mjs';

// Applied only when JSON parse fails — governs mtime-based staleness fallback.
// Not the primary timeout: the main strategy is PID liveness (process.kill 0),
// which is more robust for id-collision prevention than a wall-clock timeout.
const LOCK_MTIME_STALE_MS = 30_000;

// Scaffolds a new change file with the active stages for its type.
// `slug` is the English filename slug (structure); `title` is the content title
// (repo language). See AGENTS.md §7-§8.
export function newChange({ type, slug, title, owner, now }, cwd = process.cwd()) {
  const changeledgerDir = findChangeledgerDir(cwd);
  if (!changeledgerDir) throw new Error('Not a ChangeLedger repo. Run `changeledger init` first.');

  const config = loadConfig(changeledgerDir);
  const typeDef = config.types?.[type];
  if (!typeDef) {
    throw new Error(`Unknown type "${type}". Valid: ${Object.keys(config.types ?? {}).join(', ')}`);
  }

  const repoRoot = path.dirname(changeledgerDir);
  const changesDir = resolveRepoPath(repoRoot, config.changes_dir, 'changes_dir');
  fs.mkdirSync(changesDir, { recursive: true });
  const normalizedSlug = slugify(slug);

  // Guarantee a unique id even for changes created within the same second
  // (an agent creating several in a loop). Bump by 1s until free; keep created
  // coherent with the id. The final reservation is atomic (`wx`), so two
  // separate `changeledger new` processes racing in the same second cannot both win the
  // same id.
  let created = now;
  let id = idFromTimestamp(created);
  for (;;) {
    if (idTaken(changesDir, id)) {
      created = bumpSecond(created);
      id = idFromTimestamp(created);
      continue;
    }
    const lock = acquireIdLock(changesDir, id);
    if (!lock) {
      created = bumpSecond(created);
      id = idFromTimestamp(created);
      continue;
    }

    // Re-check after acquiring the lock: another process may have written a
    // file with this id between our idTaken() check and acquireIdLock().
    if (idTaken(changesDir, id)) {
      releaseIdLock(lock);
      created = bumpSecond(created);
      id = idFromTimestamp(created);
      continue;
    }

    const file = path.join(changesDir, `${id}-${normalizedSlug}.md`);
    try {
      fs.writeFileSync(
        file,
        render({ id, title, type, owner, stages: typeDef.stages, now: created }),
        {
          flag: 'wx',
        },
      );
      return file;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      created = bumpSecond(created);
      id = idFromTimestamp(created);
    } finally {
      releaseIdLock(lock);
    }
  }
}

function acquireIdLock(changesDir, id) {
  const lock = path.join(changesDir, `.${id}.lock`);
  let attempts = 0;
  for (;;) {
    try {
      const fd = fs.openSync(lock, 'wx');
      fs.writeFileSync(
        fd,
        JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
      );
      return { fd, path: lock };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (!isStaleLock(lock)) return null;
      if (++attempts > 5) return null;
      fs.rmSync(lock, { force: true });
    }
  }
}

function releaseIdLock(lock) {
  fs.closeSync(lock.fd);
  fs.rmSync(lock.path, { force: true });
}

function isStaleLock(lock) {
  try {
    const raw = fs.readFileSync(lock, 'utf8');
    const data = JSON.parse(raw);
    return !Number.isInteger(data.pid) || !processIsAlive(data.pid);
  } catch {
    try {
      return Date.now() - fs.statSync(lock).mtimeMs > LOCK_MTIME_STALE_MS;
    } catch (e) {
      if (e.code === 'ENOENT') return true;
      throw e;
    }
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
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
