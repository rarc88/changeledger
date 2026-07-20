import fs from 'node:fs';
import path from 'node:path';
import { parseChange } from './change.mjs';
import {
  findChangeledgerDir,
  loadConfig,
  resolveRepoPath,
  resolveSpecsDir,
  stateConfig,
} from './config.mjs';
import { objectRun } from './git.mjs';
import { loadReleases, loadReleasesAsync } from './release.mjs';
import { parseSpec } from './spec.mjs';
import { readStateStore } from './state-store.mjs';
import { parseYaml } from './yaml.mjs';

function configAt(repoRoot, ref) {
  try {
    return parseYaml(objectRun(['show', `${ref}:.changeledger/config.yml`], repoRoot));
  } catch {
    return undefined;
  }
}

function specsAt(repoRoot, revision, config) {
  const dir = config.specs_dir ?? '.changeledger/specs';
  resolveRepoPath(repoRoot, dir, 'specs_dir');
  let names;
  try {
    names = objectRun(['ls-tree', '-r', '--name-only', revision, '--', dir], repoRoot)
      .split('\n')
      .filter((name) => name.endsWith('.md'))
      .sort();
  } catch {
    return [];
  }
  return names.map((name) => ({
    file: path.join(repoRoot, name),
    name: path.basename(name),
    ...parseSpec(objectRun(['show', `${revision}:${name}`], repoRoot)),
  }));
}

function stateCandidate(ref) {
  if (ref.startsWith('refs/heads/')) {
    return {
      branch: ref.slice('refs/heads/'.length),
      sourceRef: ref,
      integrationPrefix: 'refs/heads',
    };
  }
  const remote = ref.match(/^refs\/remotes\/([^/]+)\/(.+)$/);
  if (!remote || remote[2] === 'HEAD') return undefined;
  return {
    branch: remote[2],
    sourceRef: ref,
    integrationPrefix: `refs/remotes/${remote[1]}`,
    remoteOnly: true,
  };
}

function readonlyState(state, remoteOnly) {
  if (!remoteOnly && !state.readOnly) return state;
  const reason = remoteOnly
    ? 'global state is active on origin; update integration branch and fetch state branch before mutating'
    : `state manifest schema ${state.manifest.schema_version} requires a newer version; update ChangeLedger before mutating`;
  return {
    ...state,
    remoteOnly,
    assertWritable() {
      throw new Error(reason);
    },
  };
}

function discoverCanonicalState(repoRoot, localConfig) {
  const localState = stateConfig(localConfig);
  const candidates = [];
  if (localState) candidates.push(stateCandidate(`refs/heads/${localState.branch}`));
  try {
    const refs = objectRun(
      ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes'],
      repoRoot,
    )
      .split('\n')
      .filter(Boolean);
    for (const ref of refs) {
      const candidate = stateCandidate(ref);
      if (candidate && !candidates.some((item) => item.sourceRef === candidate.sourceRef)) {
        candidates.push(candidate);
      }
    }
  } catch {
    // A non-Git legacy repository remains supported.
  }

  for (const candidate of candidates) {
    const { branch, sourceRef, integrationPrefix, remoteOnly = false } = candidate;
    let store;
    try {
      store = readStateStore(repoRoot, branch, { sourceRef: remoteOnly ? sourceRef : undefined });
    } catch {
      continue;
    }
    const integration = String(store.manifest.integration_branch ?? '');
    const canonical = configAt(repoRoot, `${integrationPrefix}/${integration}`);
    const canonicalState = canonical ? stateConfig(canonical) : undefined;
    if (canonicalState?.branch === branch) {
      const state = readStateStore(repoRoot, branch, {
        baseline: canonicalState.baseline,
        sourceRef: remoteOnly ? sourceRef : undefined,
      });
      state.integrationRef = `${integrationPrefix}/${integration}`;
      return {
        config: canonical,
        state: readonlyState(state, remoteOnly),
      };
    }
    // `state activate` changes the integration worktree before that cutover
    // commit exists. Honor its complete local pair, but never an inactive candidate.
    if (!remoteOnly && localState?.branch === branch) {
      return {
        config: localConfig,
        state: readonlyState(
          readStateStore(repoRoot, branch, { baseline: localState.baseline }),
          false,
        ),
      };
    }
  }
  return { config: localConfig, state: undefined };
}

export function resolveRepoAuthority(start = process.cwd()) {
  const changeledgerDir = findChangeledgerDir(start);
  if (!changeledgerDir) throw new Error('Not a ChangeLedger repo. Run `changeledger init` first.');
  const repoRoot = path.dirname(changeledgerDir);
  const localConfig = loadConfig(changeledgerDir);
  return { changeledgerDir, repoRoot, ...discoverCanonicalState(repoRoot, localConfig) };
}

export function assertRepoStateWritable(repo) {
  repo.state?.assertWritable?.();
  if (repo.state?.readOnly) {
    throw new Error(
      `state manifest schema ${repo.state.manifest.schema_version} is newer than supported; update ChangeLedger before mutating`,
    );
  }
}

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
  const repoRoot = path.dirname(changeledgerDir);
  const localConfig = loadConfig(changeledgerDir);
  const discovered = discoverCanonicalState(repoRoot, localConfig);
  const config = discovered.config;
  const changesDir = resolveRepoPath(repoRoot, config.changes_dir, 'changes_dir');
  if (!discovered.state) {
    if (fs.existsSync(changesDir)) {
      for (const name of fs.readdirSync(changesDir).sort()) {
        if (!name.endsWith('.md')) continue;
        const file = path.join(changesDir, name);
        let parsed;
        let text;
        try {
          text = fs.readFileSync(file, 'utf8');
          parsed = parseChange(text);
        } catch {
          continue;
        }
        if (String(parsed.frontmatter.id) === String(id)) {
          return {
            config,
            repoRoot,
            changesDir,
            file,
            change: { file, name, text, ...parsed },
            state: undefined,
          };
        }
      }
    }
    throw new Error(
      `No change with id "${id}" (use the exact id; run \`changeledger check\` if a filename's id looks wrong)`,
    );
  }

  const matches = discovered.state.changes.filter(
    (change) => String(change.frontmatter?.id) === String(id),
  );
  if (matches.length === 1) {
    const change = matches[0];
    return {
      config,
      repoRoot,
      changesDir,
      file: path.join(changesDir, change.name),
      change,
      state: discovered.state,
    };
  }
  if (matches.length > 1) throw new Error(`Duplicate change id "${id}"`);
  throw new Error(
    `No change with id "${id}" (use the exact id; run \`changeledger check\` if a filename's id looks wrong)`,
  );
}

// Loads a ChangeLedger repo: locates .changeledger/, reads config and every change file.
// Shared by `changeledger view` and `changeledger check`.
export function loadRepo(start = process.cwd()) {
  let authority;
  try {
    authority = resolveRepoAuthority(start);
  } catch (error) {
    if (!/^Not a ChangeLedger repo/.test(error.message)) throw error;
    throw new Error(
      'Not a ChangeLedger repo (no .changeledger/ found). Run `changeledger init` first.',
    );
  }
  const { repoRoot, changeledgerDir, config, state } = authority;
  return loadRepoWithConfig(repoRoot, changeledgerDir, config, state);
}

// Loads repository content using an already parsed candidate config. The viewer
// uses this before replacing config.yml so changes to configured directories are
// validated against the content they would actually expose after the save.
export function loadRepoWithConfig(repoRoot, changeledgerDir, config, discoveredState) {
  const changesDir = resolveRepoPath(repoRoot, config.changes_dir, 'changes_dir');

  const activeState = stateConfig(config);
  let state;
  let changes;
  if (discoveredState || activeState) {
    state =
      discoveredState ??
      readStateStore(repoRoot, activeState.branch, { baseline: activeState.baseline });
    changes = state.changes;
  } else {
    changes = [];
    if (fs.existsSync(changesDir)) {
      for (const name of fs.readdirSync(changesDir).sort()) {
        if (!name.endsWith('.md')) continue;
        const file = path.join(changesDir, name);
        const text = fs.readFileSync(file, 'utf8');
        changes.push({ file, name, text, ...parseChange(text) });
      }
    }
  }
  changes.sort((a, b) => String(a.frontmatter.id).localeCompare(String(b.frontmatter.id)));

  const specs = [];
  const specsDir = resolveSpecsDir(repoRoot, config);
  if (state) {
    specs.push(
      ...specsAt(
        repoRoot,
        state.integrationRef ?? `refs/heads/${state.manifest.integration_branch}`,
        config,
      ),
    );
  } else if (fs.existsSync(specsDir)) {
    for (const name of fs.readdirSync(specsDir).sort()) {
      if (!name.endsWith('.md')) continue;
      const file = path.join(specsDir, name);
      specs.push({ file, name, ...parseSpec(fs.readFileSync(file, 'utf8')) });
    }
  }

  const releases = loadReleases(repoRoot);

  return { changeledgerDir, repoRoot, config, changes, specs, releases, state };
}

// Async equivalent for HTTP paths that should not monopolize the Node event
// loop while reading large change/spec histories. The synchronous loader remains
// the command API for CLI code.
export async function loadRepoAsync(start = process.cwd()) {
  const changeledgerDir = findChangeledgerDir(start);
  if (!changeledgerDir) {
    throw new Error(
      'Not a ChangeLedger repo (no .changeledger/ found). Run `changeledger init` first.',
    );
  }
  const repoRoot = path.dirname(changeledgerDir);
  const localConfig = loadConfig(changeledgerDir);
  const discovered = discoverCanonicalState(repoRoot, localConfig);
  const config = discovered.config;
  const changesDir = resolveRepoPath(repoRoot, config.changes_dir, 'changes_dir');

  const activeState = stateConfig(config);
  let state;
  let changes;
  if (discovered.state || activeState) {
    state =
      discovered.state ??
      readStateStore(repoRoot, activeState.branch, { baseline: activeState.baseline });
    changes = state.changes;
  } else {
    changes = [];
    try {
      const names = (await fs.promises.readdir(changesDir)).sort();
      for (const name of names) {
        if (!name.endsWith('.md')) continue;
        const file = path.join(changesDir, name);
        const text = await fs.promises.readFile(file, 'utf8');
        changes.push({ file, name, text, ...parseChange(text) });
      }
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  changes.sort((a, b) => String(a.frontmatter.id).localeCompare(String(b.frontmatter.id)));

  const specs = [];
  const specsDir = resolveSpecsDir(repoRoot, config);
  if (state) {
    specs.push(
      ...specsAt(
        repoRoot,
        state.integrationRef ?? `refs/heads/${state.manifest.integration_branch}`,
        config,
      ),
    );
  } else
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

  return { changeledgerDir, repoRoot, config, changes, specs, releases, state };
}
