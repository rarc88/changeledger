// Token and cost snapshots (20261001-155612). With `usage.collector: ccusage`,
// each lifecycle event that lands is followed by one snapshot of the
// cumulative usage of this repository's agent sessions, read by the pinned
// third-party `ccusage` from the harness logs. ChangeLedger keeps no price
// table and no per-harness parser: it only filters, renames and freezes what
// `ccusage` reports at that instant. The snapshot never blocks the event it
// follows — the event is already written — so every failure here becomes a
// gap record plus a `usage: ` warning, never an exception.
//
// Records live in `<git-common-dir>/changeledger/usage/<id>/`, outside the
// ledger: shared by every worktree of the repo, never versioned by git, and
// read by no ledger command.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { usageCollector } from './config.mjs';
import { defaultRun as defaultGitRun } from './git.mjs';

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

export function usageDir(gitCommonDir) {
  return path.join(gitCommonDir, 'changeledger', 'usage');
}

// Runs one `ccusage` call with a hard time limit and returns the spawnSync
// result (`{ status, stdout, stderr, error }`). On Windows `npx` is a `.cmd`
// shim, which Node only launches through a shell; the arguments are fixed
// tokens plus source names already checked against SOURCE_NAME.
export function defaultCcusageRunner(args, { timeoutMs = CCUSAGE_TIMEOUT_MS, command } = {}) {
  const [file, ...prefix] = command ?? commandFromEnv() ?? CCUSAGE_COMMAND;
  return spawnSync(file, [...prefix, ...args], {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: OUTPUT_LIMIT,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32' && command === undefined && file === 'npx',
    windowsHide: true,
  });
}

function commandFromEnv() {
  const raw = process.env[COMMAND_ENV];
  if (!raw) return undefined;
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.length || !parsed.every((p) => typeof p === 'string')) {
    throw new Error(`${COMMAND_ENV} must be a JSON array of strings`);
  }
  return parsed;
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
// `<repo>-foo` must not match. Never throws.
export function collectUsage({
  projectPaths,
  runner = defaultCcusageRunner,
  timeoutMs = CCUSAGE_TIMEOUT_MS,
}) {
  const targets = new Set(projectPaths.map(encodeProjectPath));
  try {
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

// The git common dir (absolute) and the paths whose sessions count: every
// worktree git lists, plus the ChangeLedger repo root itself.
function gitContext(repoRoot, gitRun) {
  const raw = String(gitRun(['rev-parse', '--git-common-dir'], repoRoot) ?? '').trim();
  if (!raw) throw new Error('git rev-parse --git-common-dir printed nothing');
  const commonDir = path.resolve(repoRoot, raw);
  const projectPaths = [repoRoot];
  try {
    const listing = String(gitRun(['worktree', 'list', '--porcelain'], repoRoot) ?? '');
    for (const line of listing.split('\n')) {
      if (line.startsWith('worktree ')) projectPaths.push(line.slice('worktree '.length));
    }
  } catch {
    // A failed listing still leaves the repo root to match against.
  }
  return { commonDir, projectPaths };
}

// `YYYYMMDDTHHMMSSZ` from the event's ISO instant.
function instantName(at) {
  const m = String(at).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) throw new Error(`invalid event instant: ${at}`);
  return `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}${m[6]}Z`;
}

// Writes the record under the first free `<instant>-<n>.json`, reserving the
// name with an exclusive create so concurrent snapshots never overwrite each
// other.
export function writeUsageRecord(gitCommonDir, record) {
  const dir = path.join(usageDir(gitCommonDir), String(record.change));
  fs.mkdirSync(dir, { recursive: true });
  const stem = instantName(record.at);
  const body = `${JSON.stringify(record, null, 2)}\n`;
  for (let n = 1; ; n++) {
    const file = path.join(dir, `${stem}-${n}.json`);
    try {
      fs.writeFileSync(file, body, { flag: 'wx' });
      return file;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
}

// Entry point for the lifecycle commands, called only after their ledger
// write returned. `events` are the transition/creation events that write
// landed: `{ change, event, from, to, at }`, `at` being the instant written in
// the Log (or the `created` field). One collection serves every event of the
// same write. Without the `usage` key it returns before any subprocess.
export function snapshotUsage({ config, repoRoot, events, usage = {} }) {
  const warn = usage.warn ?? defaultWarn;
  try {
    if (!events?.length) return;
    let collector;
    try {
      collector = usageCollector(config);
    } catch (e) {
      warn(`usage: snapshot skipped: ${e.message}`);
      return;
    }
    if (collector === undefined) return;

    let context;
    try {
      context = gitContext(repoRoot, usage.gitRun ?? defaultGitRun);
    } catch {
      warn('usage: snapshot failed: not a git repository, no usage record written');
      return;
    }

    const result = collectUsage({ projectPaths: context.projectPaths, runner: usage.runner });
    for (const event of events) {
      writeUsageRecord(context.commonDir, {
        schema: USAGE_RECORD_SCHEMA,
        change: String(event.change),
        at: event.at,
        event: event.event,
        from: event.from ?? null,
        to: event.to,
        collector: { name: collector, version: CCUSAGE_VERSION, pricing: result.pricing },
        sessions: result.sessions,
        excluded: result.excluded,
        error: result.error,
      });
    }
    for (const line of result.warnings) warn(line);
  } catch (e) {
    warn(`usage: snapshot failed: ${e.message}`);
  }
}
