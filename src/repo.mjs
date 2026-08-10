import fs from 'node:fs';
import path from 'node:path';
import { parseChange } from './change.mjs';
import { findChangeledgerDir, loadConfig, resolveRepoPath, resolveSpecsDir } from './config.mjs';
import { capturedRun } from './git.mjs';
import { loadReleases, loadReleasesAsync } from './release.mjs';
import { parseSpec } from './spec.mjs';
import { readSnapshot, resolveOwnedActivation, STATE_ROOT } from './state-store.mjs';
import { parseYaml } from './yaml.mjs';

// Single authority for resolving a change id to its file. Matches by EXACT
// frontmatter.id equality — never by filename prefix — so a partial or ambiguous
// id (timestamp ids share prefixes) cannot silently target the first file that
// happens to share it, and a misleading filename cannot stand in for a change
// whose frontmatter id differs. A file that fails to parse cannot be the exact
// match, so it is skipped rather than aborting the search. Shared by every
// mutating and locating command.
export function resolveChange(start, id) {
  const changeledgerDir = findChangeledgerDir(start);
  if (!changeledgerDir) throw new Error('Not a ChangeLedger repo. Run `changeledger init` first.');
  const config = loadConfig(changeledgerDir);
  const repoRoot = path.dirname(changeledgerDir);
  const changesDir = resolveRepoPath(repoRoot, config.changes_dir, 'changes_dir');
  if (fs.existsSync(changesDir)) {
    for (const name of fs.readdirSync(changesDir).sort()) {
      if (!name.endsWith('.md')) continue;
      const file = path.join(changesDir, name);
      let frontmatter;
      try {
        ({ frontmatter } = parseChange(fs.readFileSync(file, 'utf8')));
      } catch {
        continue; // unparseable file can't be the exact match
      }
      if (String(frontmatter.id) === String(id)) return { config, repoRoot, changesDir, file };
    }
  }
  throw new Error(
    `No change with id "${id}" (use the exact id; run \`changeledger check\` if a filename's id looks wrong)`,
  );
}

// Read-only sibling of `resolveChange` for a caller that already holds a
// loaded repo (`loadRepo`/`loadRepoAsync`): same exact frontmatter.id match,
// but against `repo.changes` instead of a fresh disk read — so it inherits
// whichever authority `repo` was loaded under (the worktree when inactive,
// the state-ref snapshot when activated; see the routing in
// `loadRepoWithConfig`/`loadRepoAsync` above) rather than resolveChange's
// fixed worktree read. `context`/`agent-context` use this for their
// dependency, related-change and change-id lookups (20260808-151641 CR7);
// every caller of `resolveChange` that needs a real `file` path to write
// (agent.mjs, the viewer's write paths) is a mutator and stays on
// `resolveChange` — that routing is explicitly out of scope here and belongs
// to the next change.
export function resolveChangeInRepo(repo, id) {
  const found = repo.changes.find((c) => String(c.frontmatter.id) === String(id));
  if (!found) {
    throw new Error(
      `No change with id "${id}" (use the exact id; run \`changeledger check\` if a filename's id looks wrong)`,
    );
  }
  return found;
}

// Reads and parses one change document, naming the offending path on any
// failure instead of letting a raw fs or parse error surface unattributed. A
// consumer repo can hand `changes_dir` a directory whose name happens to look
// like a document (raw `EISDIR`) or a symlink to a file with no frontmatter
// block (a message with no path at all) — both must name the file and the
// cause so the operator knows which entry to fix.
function readChangeFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'EISDIR') {
      throw new Error(`${file}: expected a change document but found a directory`);
    }
    throw new Error(`${file}: cannot read change document (${e.message})`);
  }
  try {
    return { file, text, ...parseChange(text) };
  } catch (e) {
    throw new Error(`${file}: ${e.message}`);
  }
}

// Resolves ownership and, when this repo owns the activation, the one state
// read the whole load is built on: the snapshot that answers both "what is the config?" and "what are
// the documents?". Reading it here rather than in each branch is what keeps an
// activated load at a single tree enumeration (20260809-194235) — the config
// bootstrap used to enumerate the tree for `config.yml` and the activated
// branch then enumerated it again for the documents. `null` snapshot means
// inactive, and `resolveOwnedActivation` keeps a directory outside any git repo
// at zero subprocesses. Routing content by ownership rather than by git
// ancestry is what keeps a nested project's `list`/`show` on its own documents
// while the host above it is activated.
function readBootstrap(repoRoot, changeledgerDir, run) {
  if (!resolveOwnedActivation(repoRoot, run)) {
    return { snapshot: null, config: loadConfig(changeledgerDir) };
  }
  // Ownership was already decided above: an activation that resolves here is anchored to this very ledger, so its snapshot IS the
  // config — no second, identity-shaped question about the worktree marker.
  const snapshot = readSnapshot(repoRoot, {}, run);
  return { snapshot, config: snapshot.config };
}

// Builds `{ config, changes, changeErrors, specs, releases, state }` from the
// state ref's snapshot instead of the worktree — the activated half of the
// read-routing spec. Fail-closed by construction: the `readSnapshot` that
// produced `snapshot` (and the `readStateRef`/`assertCommitObject` it calls)
// throws on an absent or non-commit ref, and nothing on this path catches that
// to fall back to disk. `isolateChangeErrors` mirrors the worktree loaders' own
// split: the default sync loader dies on the first bad change document (named
// with its virtual snapshot path), while the async loader and the explicit sync
// opt-in collect `changeErrors`. The sync opt-in exists for read-only id
// resolution in context commands; normal `loadRepo` and `check` remain
// fail-fast. Specs and releases are never isolated in either loader, so neither
// is here.
function loadActiveContent(snapshot, { isolateChangeErrors }) {
  const names = Object.keys(snapshot.documents).sort();

  const changes = [];
  const changeErrors = [];
  for (const name of names) {
    if (!name.startsWith('changes/') || !name.endsWith('.md')) continue;
    const base = name.slice('changes/'.length);
    const text = snapshot.documents[name];
    try {
      changes.push({ file: null, name: base, text, ...parseChange(text) });
    } catch (e) {
      if (!isolateChangeErrors) {
        throw new Error(`${STATE_ROOT}/${name}: ${e.message}`);
      }
      changeErrors.push({ file: null, name: base, message: e.message });
    }
  }
  changes.sort((a, b) => String(a.frontmatter.id).localeCompare(String(b.frontmatter.id)));

  const specs = [];
  for (const name of names) {
    if (!name.startsWith('specs/') || !name.endsWith('.md')) continue;
    const base = name.slice('specs/'.length);
    const text = snapshot.documents[name];
    try {
      specs.push({ file: null, name: base, ...parseSpec(text) });
    } catch (e) {
      throw new Error(`${STATE_ROOT}/${name}: ${e.message}`);
    }
  }

  const releases = [];
  for (const name of names) {
    if (!name.startsWith('releases/') || !name.endsWith('.yml')) continue;
    const base = name.slice('releases/'.length);
    const text = snapshot.documents[name];
    try {
      releases.push({ file: null, name: base, ...parseYaml(text) });
    } catch (error) {
      throw new Error(`Invalid release manifest "${base}": ${error.message}`);
    }
  }

  return {
    config: snapshot.config,
    changes,
    changeErrors,
    specs,
    releases,
    state: { revision: snapshot.revision },
  };
}

// Loads a ChangeLedger repo: locates .changeledger/, reads config and every change file.
// Shared by `changeledger view` and `changeledger check`. `options.run` is an
// injectable git runner (default `capturedRun`) — a test seam for proving the
// inactive path invokes no subprocess at all, never a knob for production code.
export function loadRepo(start = process.cwd(), options = {}) {
  const changeledgerDir = findChangeledgerDir(start);
  if (!changeledgerDir) {
    throw new Error(
      'Not a ChangeLedger repo (no .changeledger/ found). Run `changeledger init` first.',
    );
  }
  const repoRoot = path.dirname(changeledgerDir);
  const run = options.run ?? capturedRun;
  const { snapshot, config } = readBootstrap(repoRoot, changeledgerDir, run);
  return loadRepoWithConfig(repoRoot, changeledgerDir, config, { ...options, run, snapshot });
}

// Loads repository content using an already parsed candidate config. The viewer
// uses this before replacing config.yml so changes to configured directories are
// validated against the content they would actually expose after the save.
// When the repo is activated, the candidate `config` is not consulted for reads
// (see the read-routing spec's declared config-authority frontier); the
// candidate still governs the pre-load worktree callers that boundary leaves
// untouched.
// `options.snapshot` carries a state read the caller already paid for: a
// snapshot to serve, or `null` for "resolved, and this repo is inactive".
// Absent — every caller that enters here without a bootstrap, such as the
// viewer validating a candidate config — it resolves activation and reads the
// snapshot itself, exactly as before.
export function loadRepoWithConfig(repoRoot, changeledgerDir, config, options = {}) {
  const run = options.run ?? capturedRun;
  const snapshot =
    options.snapshot === undefined
      ? resolveOwnedActivation(repoRoot, run)
        ? readSnapshot(repoRoot, {}, run)
        : null
      : options.snapshot;
  if (snapshot) {
    const active = loadActiveContent(snapshot, {
      isolateChangeErrors: options.isolateChangeErrors === true,
    });
    if (options.isolateChangeErrors === true) {
      return { changeledgerDir, repoRoot, ...active };
    }
    const { changeErrors: _unused, ...content } = active;
    return { changeledgerDir, repoRoot, ...content };
  }

  const changesDir = resolveRepoPath(repoRoot, config.changes_dir, 'changes_dir');

  // A `changes_dir` that resolves to the repo root collapses every other file
  // in the repo (AGENTS.md, README, whatever else lives there) into "looks
  // like a change document" — the parser then dies on the first ordinary
  // markdown file with a raw, path-less error. Name the collapse itself as
  // the cause before any of that parsing is attempted, consistent with the
  // commit guard's own diagnosis of the same collapse (162616 CR9).
  if (path.resolve(changesDir) === path.resolve(repoRoot)) {
    throw new Error(
      `changes_dir "${config.changes_dir}" resolves to the repo root; the commit guard cannot judge staged paths — configure changes_dir to a subdirectory`,
    );
  }

  const changes = [];
  const changeErrors = [];
  if (fs.existsSync(changesDir)) {
    for (const name of fs.readdirSync(changesDir).sort()) {
      if (!name.endsWith('.md')) continue;
      const file = path.join(changesDir, name);
      try {
        changes.push({ name, ...readChangeFile(file) });
      } catch (error) {
        if (options.isolateChangeErrors !== true) throw error;
        changeErrors.push({ file, name, message: error.message });
      }
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

  const releases = loadReleases(repoRoot);

  return {
    changeledgerDir,
    repoRoot,
    config,
    changes,
    ...(options.isolateChangeErrors === true ? { changeErrors } : {}),
    specs,
    releases,
    state: null,
  };
}

// Async equivalent for HTTP paths that should not monopolize the Node event
// loop while reading large change/spec histories. The synchronous loader remains
// the command API for CLI code.
export async function loadRepoAsync(start = process.cwd(), options = {}) {
  const changeledgerDir = findChangeledgerDir(start);
  if (!changeledgerDir) {
    throw new Error(
      'Not a ChangeLedger repo (no .changeledger/ found). Run `changeledger init` first.',
    );
  }
  const repoRoot = path.dirname(changeledgerDir);
  const run = options.run ?? capturedRun;
  const { snapshot, config } = readBootstrap(repoRoot, changeledgerDir, run);
  if (snapshot) {
    const active = loadActiveContent(snapshot, { isolateChangeErrors: true });
    return { changeledgerDir, repoRoot, ...active };
  }

  const changesDir = resolveRepoPath(repoRoot, config.changes_dir, 'changes_dir');

  if (path.resolve(changesDir) === path.resolve(repoRoot)) {
    throw new Error(
      `changes_dir "${config.changes_dir}" resolves to the repo root; the commit guard cannot judge staged paths — configure changes_dir to a subdirectory`,
    );
  }

  const changes = [];
  const changeErrors = [];
  let changeNames = [];
  try {
    changeNames = (await fs.promises.readdir(changesDir)).sort();
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  for (const name of changeNames) {
    if (!name.endsWith('.md')) continue;
    const file = path.join(changesDir, name);
    let text;
    try {
      text = await fs.promises.readFile(file, 'utf8');
    } catch (e) {
      const message =
        e.code === 'EISDIR'
          ? 'expected a change document but found a directory'
          : `cannot read change document (${e.code ?? 'unknown error'})`;
      changeErrors.push({ file, name, message });
      continue;
    }
    try {
      changes.push({ file, name, text, ...parseChange(text) });
    } catch (e) {
      changeErrors.push({ file, name, message: e.message });
    }
  }
  changes.sort((a, b) => String(a.frontmatter.id).localeCompare(String(b.frontmatter.id)));

  const specs = [];
  const specsDir = resolveSpecsDir(repoRoot, config);
  try {
    const names = (await fs.promises.readdir(specsDir)).sort();
    for (const name of names) {
      if (!name.endsWith('.md')) continue;
      const file = path.join(specsDir, name);
      specs.push({ file, name, ...parseSpec(await fs.promises.readFile(file, 'utf8')) });
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  const releases = await loadReleasesAsync(repoRoot);

  return { changeledgerDir, repoRoot, config, changes, changeErrors, specs, releases, state: null };
}
