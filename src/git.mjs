// Links a change to git via its `[#<id>]` commit-message convention (AGENTS.md
// §6.4). `run(args)` executes git and returns stdout; it is injectable so the
// logic is testable without a real repo. Any git failure yields empty refs.

import { execFileSync } from 'node:child_process';

const SEP = String.fromCharCode(31); // ASCII unit separator — safe field delimiter

function defaultRun(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
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
