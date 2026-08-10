import fs from 'node:fs';
import path from 'node:path';
import { parseChange } from '../change.mjs';
import { repoIsActivated, writeLedgerFiles } from '../change-store.mjs';
import { checkSelectedChange } from '../check.mjs';
import { findChangeledgerDir, loadConfig, resolveRepoPath } from '../config.mjs';
import { assertSupportedSchema } from '../config-migration.mjs';
import { ownerHandle as defaultOwnerHandle } from '../git.mjs';
import { loadRepo } from '../repo.mjs';
import { slugify } from '../slug.mjs';
import { serializeScalar } from '../yaml.mjs';
import { readSource } from './edit.mjs';

// Applied only when JSON parse fails — governs mtime-based staleness fallback.
// Not the primary timeout: the main strategy is PID liveness (process.kill 0),
// which is more robust for id-collision prevention than a wall-clock timeout.
const LOCK_MTIME_STALE_MS = 30_000;

// Scaffolds a new change file with the active stages for its type.
// `slug` is the English filename slug (structure); `title` is the content title
// (repo language). See `changeledger context spec`.
export function newChange(
  { type, slug, title, owner, now },
  cwd = process.cwd(),
  { ownerHandle = defaultOwnerHandle } = {},
) {
  const changeledgerDir = findChangeledgerDir(cwd);
  if (!changeledgerDir) throw new Error('Not a ChangeLedger repo. Run `changeledger init` first.');
  const repoRoot = path.dirname(changeledgerDir);

  // An activated repo publishes to a permanent journal, so a scaffold with
  // nothing in it would spend a commit on a document nobody can fill from here
  // — which is exactly what happened to `20260810-180434` before this gate
  // existed. Compose first, land once.
  if (repoIsActivated(repoRoot)) {
    throw new Error(
      'this repo is activated: `new` never publishes an empty scaffold to the state ref — compose the document first (`changeledger new <type> <slug> "<title>" --print > draft.md`), then land it whole with `--from draft.md`',
    );
  }

  const config = loadConfig(changeledgerDir);
  assertSupportedSchema(config);
  const typeDef = requireType(config, type);

  // Born with an owner: an explicit --owner always wins; otherwise resolve the
  // local git identity. Tolerant — an unresolvable identity (ownerHandle
  // returns '') falls through to render()'s existing falsy-owner gate, so no
  // `owner:` line is written and creation never fails on this account.
  const resolvedOwner = owner !== undefined ? owner : ownerHandle(repoRoot);
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
        render({ id, title, type, owner: resolvedOwner, stages: typeDef.stages, now: created }),
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

function requireType(config, type) {
  const typeDef = config.types?.[type];
  if (!typeDef) {
    throw new Error(`Unknown type "${type}". Valid: ${Object.keys(config.types ?? {}).join(', ')}`);
  }
  return typeDef;
}

// Renders the scaffold — id, frontmatter and the active stage headings — and
// writes nothing anywhere. This is what `--print` emits so an author can
// compose the whole document before it exists in either store, and what
// `--from` is expected to be built from. The id is allocated against the
// documents the repo currently holds (snapshot when activated, worktree when
// not); the write path re-checks it, so this reservation is advisory by
// design and never blocks.
export function scaffoldChange(
  { type, slug, title, owner, now },
  cwd = process.cwd(),
  { ownerHandle = defaultOwnerHandle } = {},
) {
  const repo = loadRepo(cwd);
  assertSupportedSchema(repo.config);
  const typeDef = requireType(repo.config, type);
  let created = now;
  let id = idFromTimestamp(created);
  while (idTakenInRepo(repo, id)) {
    created = bumpSecond(created);
    id = idFromTimestamp(created);
  }
  const resolvedOwner = owner !== undefined ? owner : ownerHandle(repo.repoRoot);
  return {
    id,
    name: `${id}-${slugify(slug)}.md`,
    text: render({ id, title, type, owner: resolvedOwner, stages: typeDef.stages, now: created }),
  };
}

// Creation from an already composed document: the whole thing lands in one
// write (one CAS commit when activated), never a scaffold followed by edits.
// The document is the authority for its own frontmatter — `id` and `created`
// included, so the text an author reviewed is the text that lands, byte for
// byte — and the command line must agree with it rather than silently losing
// to it. A CAS conflict propagates instead of retrying under a fresh id: the
// id is the author's, not this function's, so re-running is the caller's call.
export function newChangeFrom({ type, slug, title, from }, cwd = process.cwd()) {
  const text = readSource(from);
  const repo = loadRepo(cwd);
  assertSupportedSchema(repo.config);
  requireType(repo.config, type);

  let parsed;
  try {
    parsed = parseChange(text);
  } catch (e) {
    throw new Error(`the incoming document does not parse — ${e.message}`);
  }
  const fm = parsed.frontmatter ?? {};
  const id = String(fm.id ?? '');
  const created = String(fm.created ?? '');
  if (fm.type !== type) {
    throw new Error(`the incoming document declares type "${fm.type}", not "${type}"`);
  }
  if (fm.title !== title) {
    throw new Error(`the incoming document declares title "${fm.title}", not "${title}"`);
  }
  if (fm.status !== 'draft') {
    throw new Error(
      `a new change starts in "draft"; the incoming document declares "${fm.status}" — move it with \`changeledger status\` after it lands`,
    );
  }
  if (!created || idFromTimestamp(created) !== id) {
    throw new Error(`the incoming document's created "${created}" does not derive its id "${id}"`);
  }
  if (idTakenInRepo(repo, id)) {
    throw new Error(`id "${id}" is already taken — re-run \`--print\` for a free one`);
  }

  const name = `${id}-${slugify(slug)}.md`;
  const relPath = `changes/${name}`;
  const file = repo.state
    ? null
    : path.join(resolveRepoPath(repo.repoRoot, repo.config.changes_dir, 'changes_dir'), name);
  const candidate = { file, name, text, ...parsed };
  const { errors } = checkSelectedChange({ ...repo, changes: [...repo.changes, candidate] }, id);
  if (errors.length) {
    throw new Error(
      `the incoming document is invalid, nothing was written:\n${errors
        .map((e) => `  ${e.file}: ${e.message}`)
        .join('\n')}`,
    );
  }

  if (file) fs.mkdirSync(path.dirname(file), { recursive: true });
  writeLedgerFiles(repo, [{ relPath, file, text }], { message: `new: ${id}` });
  return repo.state ? relPath : file;
}

function idTakenInRepo(repo, id) {
  return repo.changes.some((c) => c.name.startsWith(`${id}-`));
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
    'related_to: []',
    ...(owner ? [`owner: ${serializeScalar(owner)}`] : []),
    '---',
    '',
  ].join('\n');
  const body = stages.map((s) => `## ${heading(s)}\n`).join('\n');
  return `${fm}\n${body}`;
}
