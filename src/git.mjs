// Links a change to git via its `[#<id>]` commit-message convention (AGENTS.md
// §6.4). `run(args)` executes git and returns stdout; it is injectable so the
// logic is testable without a real repo. Any git failure yields empty refs.

import { execFileSync } from 'node:child_process';

const SEP = String.fromCharCode(31); // ASCII unit separator — safe field delimiter
const RECORD_SEP = String.fromCharCode(30);

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

// The subset of location vars Git exports to a `pre-receive` hook to point at
// the push's quarantined object directory. A client command must never inherit
// them (that is what sanitizedEnv guarantees); the receive-validation path is
// the sole exception — without them it cannot read the very objects it must
// validate before Git decides whether to accept the push.
const GIT_QUARANTINE_ENV_VARS = ['GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES'];

// Builds the `gitEnv` override the receive path passes to `objectRun`: only the
// quarantine vars that are actually present, re-added on top of the otherwise
// sanitized base so incoming objects become visible. Returns an empty object
// outside a real push (no quarantine exported), which reads objects normally.
export function receiveGitEnv(env = process.env) {
  const gitEnv = {};
  for (const key of GIT_QUARANTINE_ENV_VARS) {
    if (env[key] != null) gitEnv[key] = env[key];
  }
  return gitEnv;
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

// Run variant for mutating git commands (e.g. `commit`), where git's stderr is
// the only clue to a failure (failed hook, nothing staged, missing identity,
// lock). Pipes stderr and, on failure, throws an Error whose message includes
// the captured diagnostic. Query paths keep `defaultRun` and degrade silently.
export function mutatingRun(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      env: sanitizedEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    const detail = [e.stderr, e.stdout]
      .map((s) => (typeof s === 'string' ? s.trim() : ''))
      .filter(Boolean)
      .join('\n');
    throw new Error(detail ? `${e.message}\n${detail}` : e.message, { cause: e });
  }
}

export function objectRun(args, cwd, { input, env: extraEnv = {} } = {}) {
  try {
    return execFileSync('git', args, {
      cwd,
      env: { ...sanitizedEnv(), ...extraEnv },
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    const detail = [e.stderr, e.stdout]
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean)
      .join('\n');
    throw new Error(detail ? `${e.message}\n${detail}` : e.message, { cause: e });
  }
}

export function objectRunBuffer(args, cwd, { input, env: extraEnv = {} } = {}) {
  try {
    return execFileSync('git', args, {
      cwd,
      env: { ...sanitizedEnv(), ...extraEnv },
      input,
      encoding: null,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    const detail = [e.stderr, e.stdout]
      .map((value) => (Buffer.isBuffer(value) ? value.toString('utf8').trim() : ''))
      .filter(Boolean)
      .join('\n');
    throw new Error(detail ? `${e.message}\n${detail}` : e.message, { cause: e });
  }
}

export function isValidBranchName(name, run = defaultRun, cwd = process.cwd()) {
  if (typeof name !== 'string' || !name) return false;
  try {
    run(['check-ref-format', '--branch', name], cwd);
    return true;
  } catch {
    return false;
  }
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

// Commits in `range` (e.g. `main..HEAD`): sha, subject, body and whether each is
// a merge (more than one parent) — the git metadata `check --commits` lints.
export function commitsInRange(repoRoot, range, run = defaultRun) {
  let out;
  try {
    out = run(['log', range, `--pretty=format:%H${SEP}%P${SEP}%s${SEP}%b${RECORD_SEP}`], repoRoot);
  } catch (e) {
    throw new Error(`git log failed for range "${range}": ${e.message}`);
  }
  return out
    .split(RECORD_SEP)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, parents, subject, body = ''] = record.split(SEP);
      return {
        sha,
        subject,
        body: body.trim(),
        isMerge: parents.trim().split(/\s+/).filter(Boolean).length > 1,
      };
    });
}

const MARKER_RE = /\[#[^\]\s]+\]$/;
const ANY_MARKER_RE = /\[#[^\]\s]+\]/g;
const MULTI_BODY_RE = /^ChangeLedger: (\[#[^\]\s]+\])( \[#[^\]\s]+\])+$/;

export function hasCommitMarker(subject) {
  return MARKER_RE.test(subject.trim());
}

function commitMarkerViolation({ subject, body }) {
  const subjectMarkers = subject.match(ANY_MARKER_RE) ?? [];
  const trimmedBody = body.trim();
  const hasBodyLabel = trimmedBody.includes('ChangeLedger:');
  const validMultiBody = MULTI_BODY_RE.test(trimmedBody);

  if (subjectMarkers.length > 1) return 'multiple [#id] markers must be in the body';
  if (hasBodyLabel && !validMultiBody) return 'malformed ChangeLedger body';
  if (subjectMarkers.length === 1 && hasCommitMarker(subject) && !hasBodyLabel) return null;
  if (subjectMarkers.length === 0 && validMultiBody) return null;
  if (subjectMarkers.length === 1 && validMultiBody)
    return 'ambiguous [#id] markers in both subject and body';
  return 'missing [#id] marker';
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
    const reason = commitMarkerViolation(c);
    if (reason) violations.push({ sha: c.sha.slice(0, 7), subject: c.subject, reason });
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
