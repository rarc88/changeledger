// Token and cost snapshots (20261001-155612). With git config
// `changeledger.usage.collector=ccusage`, each creation and transition event
// that lands is followed by one snapshot of the cumulative usage of this
// repository's agent sessions, read by the pinned third-party `ccusage` from
// the harness logs. ChangeLedger keeps no price table and no per-harness
// parser: it only filters, renames and freezes what `ccusage` reports at that
// instant. The event is already written when the snapshot runs, so
// `snapshotUsage` catches its own failures and turns them into a gap record
// and/or a `usage: ` warning instead of throwing.
//
// Records live in the ledger (20261002-133728), as the `usage` collection:
// published to the state ref as one commit per record when the repo is
// activated, written to `.changeledger/usage/` in the worktree otherwise, where
// `changeledger commit` stages them with their change.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { usageCollector } from './config.mjs';
import { capturedRun, defaultRun as defaultGitRun, ownerHandle } from './git.mjs';
import {
  LedgerConflictError,
  mutateState,
  readStateRef,
  resolveOwnedActivation,
  STATE_ROOT,
} from './state-store.mjs';

export const CCUSAGE_VERSION = '20.0.26';
export const CCUSAGE_TIMEOUT_MS = 10_000;
export const USAGE_RECORD_SCHEMA = 1;

const CCUSAGE_COMMAND = ['npx', '--yes', `ccusage@${CCUSAGE_VERSION}`];
// Test seam in the spirit of CHANGELEDGER_NO_GH: a JSON array that replaces
// the `npx --yes ccusage@<version>` prefix, so CLI-level suites can drive a
// local fake instead of the network. Read only from the process environment.
const COMMAND_ENV = 'CHANGELEDGER_USAGE_COMMAND';
const SOURCE_NAME = /^[a-z][a-z0-9-]*$/;
const OUTPUT_LIMIT = 64 * 1024 * 1024;

const defaultWarn = (line) => process.stderr.write(`${line}\n`);

// Claude Code names a project after its directory: the absolute path with
// every non-alphanumeric character replaced by `-`. Not documented upstream,
// so a drift here only yields zero matched sessions, with a warning.
export function encodeProjectPath(p) {
  return String(p).replace(/[^A-Za-z0-9]/g, '-');
}

// --- the `usage` ledger collection (20261002-133728) -----------------------
//
// Each snapshot is one flat file in the ledger, named
// `<id>--<YYYYMMDDTHHMMSSZ>-<8 hex>.json`: under `.changeledger-state/usage/`
// in the state ref, under `.changeledger/usage/` in the worktree layout. The
// random suffix is what keeps two clones that snapshot the same change in the
// same second on different paths, so `sync` merges them without a conflict.

export const USAGE_COLLECTION = 'usage';
const USAGE_RECORD_NAME = /^(\d{8}-\d{6})--(\d{8}T\d{6}Z)-([0-9a-f]{8})\.json$/;
export const USAGE_RECORD_NAME_FORM = '<id>--<YYYYMMDDTHHMMSSZ>-<8 hex>.json';

// The worktree-layout directory of the collection, fixed like releases.
export function usageRecordsDir(repoRoot) {
  return path.join(repoRoot, '.changeledger', USAGE_COLLECTION);
}

// `{ change, instant, suffix }` from a record's file name, or `null` when the
// name does not follow USAGE_RECORD_NAME_FORM.
export function parseUsageRecordName(name) {
  const m = USAGE_RECORD_NAME.exec(String(name));
  return m ? { change: m[1], instant: m[2], suffix: m[3] } : null;
}

export function usageRecordName(change, at, suffix = randomBytes(4).toString('hex')) {
  return `${change}--${instantName(at)}-${suffix}.json`;
}

// One loaded record as both loaders expose it: associated to the change id its
// name carries (`null` for a name outside the form) and parsed, or carrying the
// parse failure in `error`. Never throws, so one bad record cannot stop the
// rest of the ledger from loading; `check` reports it.
export function usageEntry(name, text, file = null) {
  const change = parseUsageRecordName(name)?.change ?? null;
  if (text === null) return { file, name, change, record: null, error: 'cannot be read' };
  try {
    return { file, name, change, record: JSON.parse(text), error: null };
  } catch (e) {
    return { file, name, change, record: null, error: `invalid JSON: ${e.message}` };
  }
}

// How one call is launched: `{ file, args, shell }`. An explicit `command` or
// the CHANGELEDGER_USAGE_COMMAND override runs as an argument vector and never
// through a shell. The built-in `npx` command needs a shell only on Windows,
// where `npx` is a `.cmd` shim; there it is passed as one command string, built
// from tokens that must match SAFE_TOKEN (the fixed prefix, ccusage's fixed
// flags and source names already checked against SOURCE_NAME), so nothing
// reaches `cmd.exe` that could be read as shell syntax.
const SAFE_TOKEN = /^[A-Za-z0-9@._-]+$/;

export function ccusageInvocation(
  args,
  { command, env = process.env, platform = process.platform } = {},
) {
  const override = command ?? commandFromEnv(env);
  if (override) {
    const [file, ...prefix] = override;
    return { file, args: [...prefix, ...args], shell: false };
  }
  const [file, ...prefix] = CCUSAGE_COMMAND;
  const all = [...prefix, ...args];
  if (platform !== 'win32') return { file, args: all, shell: false };
  const unsafe = all.find((token) => !SAFE_TOKEN.test(token));
  if (unsafe !== undefined) {
    throw new Error(`unsafe ccusage argument for the Windows shell: ${unsafe}`);
  }
  return { file: [file, ...all].join(' '), args: [], shell: true };
}

function commandFromEnv(env) {
  const raw = env[COMMAND_ENV];
  if (!raw) return undefined;
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.length || !parsed.every((p) => typeof p === 'string')) {
    throw new Error(`${COMMAND_ENV} must be a JSON array of strings`);
  }
  return parsed;
}

// Supervisor run in a separate Node process so the call stays synchronous while
// the time limit applies to the call's process group: `spawnSync`'s own
// timeout signals only its direct child (`npx`), and the reviewer observed the
// real ccusage below it still alive 21 s later. The command starts in its own
// process group (POSIX; on Windows `taskkill /T /F` ends the tree), and that
// group is SIGKILLed when the limit expires, when the supervisor receives
// SIGINT, SIGTERM, SIGHUP or SIGQUIT (a Ctrl-C, Ctrl-\ or closed terminal reaches the CLI's
// group, which the supervisor shares but the command no longer does), or when
// relaying output fails because the CLI is gone. A descendant that starts its
// own process group or session escapes the kill. The outcome travels on fd 3
// as JSON; stdout and stderr are relayed untouched.
const SUPERVISOR = `
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const spec = JSON.parse(process.argv[1]);
const posix = spec.platform !== 'win32';
let child;
const killGroup = () => {
  if (!child?.pid) return;
  try {
    if (posix) process.kill(-child.pid, 'SIGKILL');
    else spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } catch {}
};
const abandon = (code) => {
  killGroup();
  process.exit(code);
};
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT']) {
  process.on(signal, () => abandon(128 + os.constants.signals[signal]));
}
process.stdout.on('error', () => abandon(1));
process.stderr.on('error', () => abandon(1));
let reported = false;
const report = (outcome) => {
  if (reported) return;
  reported = true;
  try {
    fs.writeSync(3, JSON.stringify(outcome));
  } catch {
    abandon(1);
  }
};
try {
  child = spawn(spec.file, spec.args, {
    shell: spec.shell,
    detached: posix,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
} catch (e) {
  report({ error: { code: e.code, message: e.message } });
  process.exit(0);
}
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  killGroup();
}, spec.timeoutMs);
child.on('error', (e) => {
  clearTimeout(timer);
  report({ error: { code: e.code, message: e.message } });
});
child.on('close', (status, signal) => {
  clearTimeout(timer);
  report(timedOut ? { timedOut: true } : { status, signal });
});
`;
// Grace for the supervisor itself beyond the call's own limit.
const SUPERVISOR_GRACE_MS = 5_000;

// Runs one `ccusage` call with a hard time limit over its whole process tree
// and returns a spawnSync-shaped result (`{ status, signal, stdout, stderr,
// error }`); a timeout is reported as an error with code ETIMEDOUT.
export function defaultCcusageRunner(
  args,
  { timeoutMs = CCUSAGE_TIMEOUT_MS, command, platform = process.platform } = {},
) {
  const empty = { status: null, signal: null, stdout: '', stderr: '' };
  let invocation;
  try {
    invocation = ccusageInvocation(args, { command, platform });
  } catch (error) {
    return { ...empty, error };
  }
  const spec = JSON.stringify({ ...invocation, timeoutMs, platform });
  const outer = spawnSync(process.execPath, ['-e', SUPERVISOR, spec], {
    encoding: 'utf8',
    timeout: timeoutMs + SUPERVISOR_GRACE_MS,
    killSignal: 'SIGKILL',
    maxBuffer: OUTPUT_LIMIT,
    stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const stdout = outer.stdout ?? '';
  const stderr = outer.stderr ?? '';
  if (outer.error) return { ...empty, stdout, stderr, error: outer.error };
  let outcome;
  try {
    outcome = JSON.parse(outer.output?.[3] || 'null');
  } catch {
    outcome = null;
  }
  if (!outcome) {
    const error = new Error(`ccusage supervisor exited with ${outer.status ?? outer.signal}`);
    return { ...empty, stdout, stderr, error };
  }
  if (outcome.timedOut) {
    const error = Object.assign(new Error(`timed out after ${timeoutMs} ms`), {
      code: 'ETIMEDOUT',
    });
    return { ...empty, stdout, stderr, error };
  }
  if (outcome.error) {
    const error = Object.assign(new Error(outcome.error.message), { code: outcome.error.code });
    return { ...empty, stdout, stderr, error };
  }
  return { status: outcome.status, signal: outcome.signal, stdout, stderr };
}

// One bounded call parsed as JSON; any failure throws with a message naming
// the call, which becomes the record's `error`.
function callJson(runner, args, timeoutMs) {
  const label = `ccusage ${args.join(' ')}`;
  const result = runner(args, { timeoutMs });
  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      throw new Error(`${label} timed out after ${timeoutMs / 1000} s`);
    }
    throw new Error(`${label} could not run: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = String(result.stderr ?? '')
      .trim()
      .split('\n')[0];
    const how = result.status === null ? `signal ${result.signal}` : `code ${result.status}`;
    throw new Error(`${label} exited with ${how}${detail ? `: ${detail}` : ''}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (e) {
    throw new Error(`${label} printed invalid JSON: ${e.message}`);
  }
}

function listSources(listing) {
  // The unified listing names its array `session` in 20.0.26; `sessions` is
  // accepted as well so a source-shaped document is not misread as empty.
  const sessions = listing?.session ?? listing?.sessions;
  if (!Array.isArray(sessions)) throw new Error('ccusage session listing has no session list');
  const sources = [];
  for (const s of sessions) {
    const source = s?.agent;
    if (typeof source !== 'string' || !SOURCE_NAME.test(source)) {
      throw new Error(`ccusage session listing names an unexpected source: ${String(source)}`);
    }
    if (!sources.includes(source)) sources.push(source);
  }
  return sources;
}

const tokenCount = (value) => (typeof value === 'number' ? value : null);

function modelCost(breakdown, unpriced) {
  // A model ccusage could not price reports `cost: 0`; a zero would read as
  // "free", so it is recorded as unknown instead.
  if (unpriced.has(breakdown.modelName) || breakdown.missingPricing === true) return null;
  if (typeof breakdown.cost === 'number') return breakdown.cost;
  if (typeof breakdown.costUSD === 'number') return breakdown.costUSD;
  return null;
}

function mapSession(source, session, unpriced) {
  const breakdowns = Array.isArray(session.modelBreakdowns) ? session.modelBreakdowns : [];
  return {
    source,
    session_id: session.sessionId ?? null,
    project_path: session.projectPath,
    first_activity: session.firstActivity ?? null,
    last_activity: session.lastActivity ?? null,
    models: breakdowns.map((b) => ({
      model: b.modelName,
      input_tokens: tokenCount(b.inputTokens),
      output_tokens: tokenCount(b.outputTokens),
      cache_read_tokens: tokenCount(b.cacheReadTokens),
      cache_write_tokens: tokenCount(b.cacheCreationTokens),
      cost_usd: modelCost(b, unpriced),
    })),
  };
}

// The snapshot proper: which sources have sessions, each source's sessions
// with online prices (offline on failure), filtered to this repo's encoded
// paths by equality — encodings are prefix-ambiguous, so a sibling repo named
// `<repo>-foo` must not match. Failures, bad input included, come back as a
// result with `error` set rather than as an exception.
export function collectUsage(options) {
  try {
    const {
      projectPaths,
      runner = defaultCcusageRunner,
      timeoutMs = CCUSAGE_TIMEOUT_MS,
    } = options ?? {};
    if (!Array.isArray(projectPaths)) throw new Error('collectUsage needs a projectPaths list');
    const targets = new Set(projectPaths.map(encodeProjectPath));
    const sources = listSources(
      callJson(runner, ['session', '--json', '--offline', '--no-cost'], timeoutMs),
    );
    let pricing = 'online';
    const sessions = [];
    const excluded = [];
    const exclusionWarnings = [];
    for (const source of sources) {
      let doc;
      try {
        doc = callJson(runner, [source, 'session', '--json'], timeoutMs);
        if (!Array.isArray(doc?.sessions)) throw new Error('no sessions list');
      } catch {
        doc = callJson(runner, [source, 'session', '--json', '--offline'], timeoutMs);
        pricing = 'offline';
      }
      if (!Array.isArray(doc?.sessions)) {
        throw new Error(`ccusage ${source} session --json printed no sessions list`);
      }
      const unpriced = new Set(
        Array.isArray(doc.totals?.unpricedModels) ? doc.totals.unpricedModels : [],
      );
      let withoutPath = 0;
      for (const session of doc.sessions) {
        if (typeof session?.projectPath !== 'string' || session.projectPath === '') {
          withoutPath++;
          continue;
        }
        if (targets.has(session.projectPath)) {
          sessions.push(mapSession(source, session, unpriced));
        }
      }
      if (withoutPath) {
        excluded.push({ source, sessions: withoutPath });
        exclusionWarnings.push(
          `usage: excluded ${source} (${withoutPath} ${withoutPath === 1 ? 'session' : 'sessions'} without projectPath)`,
        );
      }
    }
    const warnings = [];
    if (pricing === 'offline') {
      warnings.push('usage: online pricing unavailable; used ccusage offline prices');
    }
    warnings.push(...exclusionWarnings);
    if (!sessions.length) warnings.push('usage: no sessions matched this repository');
    return { pricing, sessions, excluded, warnings, error: null };
  } catch (e) {
    return {
      pricing: null,
      sessions: [],
      excluded: [],
      warnings: [`usage: snapshot failed: ${e.message}`],
      error: e.message,
    };
  }
}

// The paths whose sessions count: every worktree git lists, plus the
// ChangeLedger repo root itself. The common-dir probe is what tells a git
// repository apart from a directory outside one.
function gitContext(repoRoot, gitRun) {
  const raw = String(gitRun(['rev-parse', '--git-common-dir'], repoRoot) ?? '').trim();
  if (!raw) throw new Error('git rev-parse --git-common-dir printed nothing');
  const projectPaths = [repoRoot];
  try {
    const listing = String(gitRun(['worktree', 'list', '--porcelain'], repoRoot) ?? '');
    for (const line of listing.split('\n')) {
      if (line.startsWith('worktree ')) projectPaths.push(line.slice('worktree '.length));
    }
  } catch {
    // A failed listing still leaves the repo root to match against.
  }
  return { projectPaths };
}

// `YYYYMMDDTHHMMSSZ` from the event's ISO instant.
function instantName(at) {
  const m = String(at).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) throw new Error(`invalid event instant: ${at}`);
  return `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}${m[6]}Z`;
}

const randomSuffix = () => randomBytes(4).toString('hex');

// Worktree layout: the record goes to `.changeledger/usage/`, reserving its
// name with an exclusive create; a taken name (another record with the same
// change, instant and suffix) draws a new suffix instead of overwriting it.
function writeWorktreeRecord(repoRoot, record, body, suffix) {
  const dir = usageRecordsDir(repoRoot);
  fs.mkdirSync(dir, { recursive: true });
  for (;;) {
    const file = path.join(dir, usageRecordName(record.change, record.at, suffix()));
    try {
      fs.writeFileSync(file, body, { flag: 'wx' });
      return;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
}

// State-ref layout: one compare-and-swap commit that only adds the record,
// taken against the tip as it is NOW — after the transition landed and after
// ccusage returned, so no CAS window is held across the call. A ref that moved
// in between is retried once against its new tip; a second move, or any other
// failure, is thrown for the caller to report. A name the tip already holds
// draws a new suffix, as in the worktree layout; `mutateState` refuses to
// rewrite a record in any case.
function publishStateRecord(repoRoot, record, body, run, suffix) {
  const message = `usage: ${record.change} ${record.event}`;
  for (let attempt = 1; ; attempt++) {
    const expectedRevision = readStateRef(repoRoot, run);
    if (expectedRevision === null) throw new Error('state is not initialized');
    let name;
    do {
      name = usageRecordName(record.change, record.at, suffix());
    } while (stateHolds(repoRoot, expectedRevision, `${USAGE_COLLECTION}/${name}`, run));
    try {
      mutateState(
        repoRoot,
        { expectedRevision, message },
        (stage) => stage.write(`${USAGE_COLLECTION}/${name}`, body),
        run,
      );
      return;
    } catch (e) {
      if (!(e instanceof LedgerConflictError) || attempt === 2) throw e;
    }
  }
}

// Whether `revision` holds `relPath` under STATE_ROOT. A failed probe reads as
// absent: the write that follows is still refused by `mutateState` if the
// path turns out to be a record.
function stateHolds(repoRoot, revision, relPath, run) {
  try {
    run(['cat-file', '-e', `${revision}:${STATE_ROOT}/${relPath}`], repoRoot);
    return true;
  } catch {
    return false;
  }
}

// Entry point for the lifecycle commands, called only after their ledger
// write returned. `events` are the transition/creation events that write
// landed: `{ change, event, from, to, at }`, `at` being the instant written in
// the Log (or the `created` field). One collection serves every event of the
// same write. Without the git config value it reads that value and nothing
// else: no ccusage process, no record. A record that cannot be published is
// reported as `usage: record not published: <reason>` and nothing is written:
// the transition it follows already landed and is never undone.
//
// `usage` seams: `runner` (ccusage), `gitRun` (git config and worktree
// listing), `stateRun` (the state store's git runner), `ownerHandle` (the
// identity recorded as `recorded_by`, resolved like `owner`), `randomSuffix`
// (the 8-hex suffix draw) and `warn`.
export function snapshotUsage({ repoRoot, events, usage = {} }) {
  const warn = usage.warn ?? defaultWarn;
  const gitRun = usage.gitRun ?? defaultGitRun;
  const stateRun = usage.stateRun ?? capturedRun;
  const resolveOwner = usage.ownerHandle ?? ownerHandle;
  const suffix = usage.randomSuffix ?? randomSuffix;
  try {
    if (!events?.length) return;
    let collector;
    try {
      collector = usageCollector(repoRoot, gitRun);
    } catch (e) {
      warn(`usage: snapshot skipped: ${e.message}`);
      return;
    }
    if (collector === undefined) return;

    let context;
    try {
      context = gitContext(repoRoot, gitRun);
    } catch {
      warn('usage: snapshot failed: not a git repository, no usage record written');
      return;
    }

    const result = collectUsage({ projectPaths: context.projectPaths, runner: usage.runner });
    const recordedBy = resolveOwner(repoRoot) || null;
    let activated;
    try {
      activated = resolveOwnedActivation(repoRoot, stateRun) !== null;
    } catch (e) {
      warn(`usage: record not published: ${e.message}`);
      return;
    }
    for (const event of events) {
      const record = {
        schema: USAGE_RECORD_SCHEMA,
        change: String(event.change),
        at: event.at,
        event: event.event,
        from: event.from ?? null,
        to: event.to,
        recorded_by: recordedBy,
        collector: { name: collector, version: CCUSAGE_VERSION, pricing: result.pricing },
        sessions: result.sessions,
        excluded: result.excluded,
        error: result.error,
      };
      const body = `${JSON.stringify(record, null, 2)}\n`;
      try {
        if (activated) publishStateRecord(repoRoot, record, body, stateRun, suffix);
        else writeWorktreeRecord(repoRoot, record, body, suffix);
      } catch (e) {
        warn(`usage: record not published: ${e.message.split('\n')[0]}`);
      }
    }
    for (const line of result.warnings) warn(line);
  } catch (e) {
    warn(`usage: snapshot failed: ${e.message}`);
  }
}
