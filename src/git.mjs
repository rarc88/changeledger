// Links a change to git via its `[#<id>]` commit-message convention (AGENTS.md
// §6.4). `run(args)` executes git and returns stdout; it is injectable so the
// logic is testable without a real repo. Any git failure yields empty refs.

import { execFileSync } from 'node:child_process';

const SEP = String.fromCharCode(31); // ASCII unit separator — safe field delimiter

// Repo-location env vars git itself exports while running a hook (e.g. this
// project's own pre-commit). Left inherited, a child `git` call would silently
// target the hook's repo/worktree instead of the given `cwd` — strip them so
// every invocation stays anchored on `cwd`.
const GIT_LOCATION_ENV_VARS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CEILING_DIRECTORIES',
];

function sanitizedEnv() {
  const env = { ...process.env };
  for (const key of GIT_LOCATION_ENV_VARS) delete env[key];
  return env;
}

// Exported so other commands (e.g. `changeledger commit`) share the same
// GIT_* sanitization instead of re-implementing it.
export function defaultRun(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    env: sanitizedEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

// Local git identity (`git config user.name`), or '' if unavailable. Tolerant.
export function gitUser(cwd, run = defaultRun) {
  try {
    return run(['config', 'user.name'], cwd).trim();
  } catch {
    return '';
  }
}

function defaultGhRun(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

// GitHub username via `gh api user --jq .login`, or '' if gh is missing,
// unauthenticated, or offline. Tolerant by design.
export function githubLogin(run = defaultGhRun) {
  try {
    return run(['api', 'user', '--jq', '.login']).trim();
  } catch {
    return '';
  }
}

// Preferred owner handle when work starts: the GitHub login, falling back to the
// local git user.name. Empty if neither is available.
export function ownerHandle(cwd, run = defaultRun, ghRun = defaultGhRun) {
  return githubLogin(ghRun) || gitUser(cwd, run);
}

// Detects the branch `changeledger check --commits` should diff against when
// no base is given: the remote's HEAD if configured, else a local `main` or
// `master`. Throws with actionable guidance if neither is resolvable.
export function defaultBaseBranch(repoRoot, run = defaultRun) {
  try {
    const out = run(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], repoRoot);
    const name = out.trim().replace(/^origin\//, '');
    if (name) return name;
  } catch {
    // no configured remote HEAD — fall through to local candidates
  }
  for (const candidate of ['main', 'master']) {
    try {
      run(['rev-parse', '--verify', '--quiet', candidate], repoRoot);
      return candidate;
    } catch {
      // candidate branch does not exist locally — try the next one
    }
  }
  throw new Error(
    'Could not detect a default branch (no origin/HEAD, main, or master); pass one explicitly: changeledger check --commits <base>',
  );
}

// Commits in `range` (e.g. `main..HEAD`): sha, subject and whether each is a
// merge (more than one parent) — the git metadata `check --commits` lints.
export function commitsInRange(repoRoot, range, run = defaultRun) {
  let out;
  try {
    out = run(['log', range, `--pretty=format:%H${SEP}%P${SEP}%s`], repoRoot);
  } catch (e) {
    throw new Error(`git log failed for range "${range}": ${e.message}`);
  }
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, parents, subject] = line.split(SEP);
      return {
        sha,
        subject,
        isMerge: parents.trim().split(/\s+/).filter(Boolean).length > 1,
      };
    });
}

// A well-formed marker is one or more `[#id]` groups, each separated by a
// single space, terminating the subject — the canonical multi-id shape is
// separate brackets (`[#A] [#B]`), never a comma list in one bracket.
const MARKER_RE = /(\[#[^\]\s]+\])(\s\[#[^\]\s]+\])*$/;
export function hasCommitMarker(subject) {
  return MARKER_RE.test(subject.trim());
}

// Lints `range`: every non-merge commit must carry a well-formed `[#id]`
// marker, except `chore(release)` prep commits. Returns only the violations
// (sha + subject); never throws for a clean range.
export function lintCommitRange(repoRoot, range, run = defaultRun) {
  const commits = commitsInRange(repoRoot, range, run);
  const violations = [];
  for (const c of commits) {
    if (c.isMerge) continue;
    if (/^chore\(release\):/.test(c.subject)) continue;
    if (!hasCommitMarker(c.subject))
      violations.push({ sha: c.sha.slice(0, 7), subject: c.subject });
  }
  return violations;
}

export function gitRefs(repoRoot, id, run = defaultRun) {
  const refs = { commits: [], branches: [] };
  if (!id) return refs;

  try {
    const out = run(
      ['log', '--all', '-n', '100', '-F', `--grep=[#${id}]`, `--pretty=format:%H${SEP}%s${SEP}%cI`],
      repoRoot,
    );
    refs.commits = out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha, subject, date] = line.split(SEP);
        return { sha, subject, date };
      });
  } catch {
    // not a git repo, or git unavailable — leave commits empty
  }

  try {
    const out = run(['branch', '--all', '--format=%(refname:short)'], repoRoot);
    refs.branches = out
      .split('\n')
      .map((s) => s.trim())
      .filter((name) => name?.includes(id));
  } catch {
    // leave branches empty
  }

  return refs;
}
