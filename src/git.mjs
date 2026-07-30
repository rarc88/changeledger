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

// Git localizes its diagnostics, but `mutatingRun` hands that stderr to an agent
// that classifies failures by message. Pin the locale so the text a caller reads
// never depends on the host's language.
function sanitizedEnv() {
  const env = { ...process.env, LC_ALL: 'C' };
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

// git's default `diff --name-only` output is a *presentation* surface: the
// surrounding repo's configuration changes its format, so parsing it unpinned
// makes every config axis a hole in `commit()`'s guard. Two review rounds found
// three such holes. Every flag below pins one axis, and `-c` beats both repo
// and user config:
//
// - `core.quotePath=false` + `-z`: by default git wraps a path in double quotes
//   and octal/C-escapes it as soon as it holds a non-ASCII byte, a quote or a
//   control character (`".changeledger/changes/…-a\303\261adir.md"`). `-z` is
//   the stronger of the two — it emits raw, NUL-terminated bytes and never
//   quotes — but `core.quotePath=false` is kept so any future non-`-z` read of
//   this argv is not silently re-escaped.
// - `--no-renames`: change documents are ~98% boilerplate, so a staged deletion
//   of one paired with a staged addition of another is detected as a rename and
//   collapsed to only the destination path, hiding the deletion of a foreign
//   document. Disabled, the delete and the add are two visible entries.
// - `--no-relative`: `diff.relative=true` (a repo config or a user alias) makes
//   paths relative to the cwd instead of the top-level. `commit()` additionally
//   invokes this with the top-level *as* the cwd, so the two coordinate systems
//   coincide even if this flag were ever dropped.
// - `--ignore-submodules=none`: `diff.ignoreSubmodules=all` would otherwise
//   hide a staged gitlink entry from the listing.
//
// Returns the raw entries (relative to git's own top-level directory — see
// `gitTopLevel`), never trimmed: leading/trailing whitespace and newlines are
// legal in a filename and trimming them would corrupt the path the caller has
// to judge. Splitting on NUL, not newline, is what makes that safe.
const STAGED_ARGS = [
  '-c',
  'core.quotePath=false',
  'diff',
  '--cached',
  '-z',
  '--no-renames',
  '--no-relative',
  '--ignore-submodules=none',
  '--name-only',
];

// Minimum git that understands `--no-relative` (git 2.28, 2020). Older git
// rejects the pinned invocation; `stagedFiles` then fails loudly with this
// floor rather than falling back to an unpinned read whose format the repo
// could steer.
const GIT_FLOOR = '2.28';

// An old git names the option it does not know, and `sanitizedEnv` pins LC_ALL=C
// so that text is stable. Anything else — a corrupt or locked index, a missing
// repo, a killed process — is a different failure and must be reported as
// itself: attributing it to the version floor sent the reader looking for a git
// upgrade that would not fix anything.
const UNKNOWN_NO_RELATIVE_RE = /unknown option[^\n]*no-relative/i;

export function stagedFiles(cwd, run = defaultRun) {
  let out;
  try {
    out = run(STAGED_ARGS, cwd);
  } catch (e) {
    // Both branches fail closed; only the attribution differs.
    const message = UNKNOWN_NO_RELATIVE_RE.test(e.message)
      ? `Cannot read the staged index; git >= ${GIT_FLOOR} is required for --no-relative: ${e.message}`
      : `Cannot read the staged index: ${e.message}`;
    throw new Error(message, { cause: e });
  }
  return out.split('\0').filter((entry) => entry !== '');
}

// Git's own repository root, via `git rev-parse --show-toplevel`. This is the
// coordinate system `stagedFiles`' paths are relative to, regardless of `cwd`
// — which differs from a ChangeLedger repo's `repoRoot` (dirname of
// `.changeledger/`, see src/repo.mjs) whenever the ledger lives below the git
// root. `commit()`'s guard must resolve staged paths against this, not
// `repoRoot`, or it silently never matches anything.
export function gitTopLevel(cwd, run = defaultRun) {
  return run(['rev-parse', '--show-toplevel'], cwd).trim();
}

// Local git identity (`git config user.name`), or '' if unavailable. Tolerant.
export function gitUser(cwd, run = defaultRun) {
  try {
    return run(['config', 'user.name'], cwd).trim();
  } catch {
    return '';
  }
}

// Kill-switch: with CHANGELEDGER_NO_GH set, returns '' before any subprocess
// runs, so a hermetic suite can never reach api.github.com through this
// default runner regardless of what a given test injects. Injected runners
// (e.g. `githubLogin(spy)`) are unaffected — the switch lives only here.
export function defaultGhRun(args) {
  if (process.env.CHANGELEDGER_NO_GH) return '';
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

// The operational-commit exemption: a body whose declaration is exactly this
// (house style: em dash, single space either side) exempts the commit from the
// [#id] marker. Anchored on the declaration line — like MULTI_BODY_RE — so a
// shape that only contains the declaration never matches; it falls through to
// the "malformed ChangeLedger body" catch below rather than silently matching.
const NONE_BARE_RE = /^ChangeLedger: none$/;
const NONE_REASON_RE = /^ChangeLedger: none — (\S.*)$/;

const DECLARATION_LABEL = 'ChangeLedger:';

// What the body declares: its FIRST line, so the lines below are free text (the
// why-paragraph Conventional Commits asks for, trailers like Co-Authored-By)
// with no effect on the lint. One exception keeps the relaxation fail-closed: a
// later line opening with the label is a second, conflicting declaration, so
// the body declares nothing ('') and the caller reports it malformed. A
// declaration buried under any other line is likewise not in head position and
// so declares nothing.
function bodyDeclaration(body) {
  const [head = '', ...tail] = body.trim().split('\n');
  const conflicting = tail.some((line) => line.trim().startsWith(DECLARATION_LABEL));
  return conflicting ? '' : head.trim();
}

export function hasCommitMarker(subject) {
  return MARKER_RE.test(subject.trim());
}

function commitMarkerViolation({ subject, body }) {
  const subjectMarkers = subject.match(ANY_MARKER_RE) ?? [];
  const declaration = bodyDeclaration(body);
  // Deliberately the whole body, not just the declaration: a label anywhere in
  // a body that declares nothing valid stays malformed instead of being read as
  // prose, so the free tail never becomes a route to the exemption.
  const hasBodyLabel = body.includes(DECLARATION_LABEL);
  const validMultiBody = MULTI_BODY_RE.test(declaration);

  // The declaration is checked before the marker-shape rules below: a bare or
  // reasoned `none` is a different grammar than the `[#id]` body label, and
  // must resolve on its own terms rather than be judged as a malformed marker.
  if (NONE_BARE_RE.test(declaration)) return 'ChangeLedger: none requires a reason';
  if (NONE_REASON_RE.test(declaration)) {
    return subjectMarkers.length > 0
      ? 'ChangeLedger: none cannot coexist with an [#id] marker'
      : null;
  }

  if (subjectMarkers.length > 1) return 'multiple [#id] markers must be in the body';
  if (hasBodyLabel && !validMultiBody) return 'malformed ChangeLedger body';
  if (subjectMarkers.length === 1 && hasCommitMarker(subject) && !hasBodyLabel) return null;
  if (subjectMarkers.length === 0 && validMultiBody) return null;
  if (subjectMarkers.length === 1 && validMultiBody)
    return 'ambiguous [#id] markers in both subject and body';
  return 'missing [#id] marker';
}

// Lints `range`: every non-merge commit must carry a well-formed `[#id]`
// marker, except `chore(release)` prep commits and a body-declared
// `ChangeLedger: none — <reason>` operational commit (see
// commitMarkerViolation). Returns only the violations (sha + subject); never
// throws for a clean range.
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

// A commit is attributed to `id` by exactly two seats — the marker closing its
// subject, and the canonical multi-id declaration heading its body. An `[#id]`
// anywhere else is prose: a `ChangeLedger: none` reason may cite the change it
// supersedes, and a note may cite related work, without either commit joining
// that change's refs.
function attributesTo({ subject, body }, id) {
  const marker = `[#${id}]`;
  if (subject.trim().match(MARKER_RE)?.[0] === marker) return true;
  const declaration = bodyDeclaration(body);
  return MULTI_BODY_RE.test(declaration) && declaration.includes(marker);
}

export function gitRefs(repoRoot, id, run = defaultRun) {
  const refs = { commits: [], branches: [] };
  if (!id) return refs;

  try {
    // The grep only prefilters candidates: it matches the whole message, so
    // attributesTo decides which of them the id actually belongs to.
    const out = run(
      [
        'log',
        '--all',
        '-n',
        '100',
        '-F',
        `--grep=[#${id}]`,
        `--pretty=format:%H${SEP}%s${SEP}%cI${SEP}%b${RECORD_SEP}`,
      ],
      repoRoot,
    );
    refs.commits = out
      .split(RECORD_SEP)
      .map((record) => record.trim())
      .filter(Boolean)
      .map((record) => {
        const [sha, subject, date, body = ''] = record.split(SEP);
        return { sha, subject, date, body };
      })
      .filter((commit) => attributesTo(commit, id))
      .map(({ sha, subject, date }) => ({ sha, subject, date }));
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
