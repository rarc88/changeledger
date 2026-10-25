// Validator: takes a loaded repo ({ config, changes }) and returns
// { errors, warnings, validated, notValidated } — the counts say how many
// documents were validated as subjects and how many were exempt as frozen
// history. It never writes; branch-name syntax delegates to Git's native
// read-only check-ref-format query. The `changeledger check` command owns
// repository loading and printing.

import { marked } from 'marked';
import {
  CANONICAL_STAGES,
  CHANGE_TYPES,
  childrenOpenError,
  parseChange,
  parseRequestSections,
  RETIRED_STAGES,
  RETIRED_TYPES,
  stageSource,
} from './change.mjs';
import {
  changeBranchFormat,
  integratesIntoError,
  integrationBranch,
  releaseBranch,
  releaseBranchRequirementError,
  renderChangeBranch,
  USAGE_COLLECTOR_GIT_KEY,
  usageCollector,
} from './config.mjs';
import { hasFixableDefects } from './fix.mjs';
import { mergeRecord } from './git.mjs';
import {
  CANONICAL_STATUSES,
  CHANGE_ID_FORM,
  canTransition,
  findingsInLog,
  LOG_EVENT_TYPES,
  parseLogEvent,
} from './lifecycle.mjs';
import { compareVersions, parseVersion, RELEASE_IMPACTS } from './release.mjs';
import {
  parseUsageRecordName,
  USAGE_RECORD_NAME_FORM,
  USAGE_RECORD_SCHEMA,
} from './usage-collector.mjs';
import { minCliVersionDeclarationError } from './version-guard.mjs';

const REQUIRED = ['id', 'title', 'type', 'status', 'created', 'depends_on'];
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const SEMANTIC_STAGES = new Set(['request', 'specification', 'plan']);
// The stages the `in-review` gate reads, and the ones an epic never carries:
// its children hold the implementation.
const REVIEWABLE_STAGES = ['specification', 'plan'];

// The defect a declared `type` carries, or null when it is `change` or `epic`.
// `check` reports it on a live document and `context <id>` refuses with it.
export function typeError(type) {
  if (CHANGE_TYPES.includes(type)) return null;
  // Only a plain string can be a retired type: `hasOwn` would coerce a list
  // such as `[feature]` to "feature" and send the author to `fix`, which
  // cannot read that line (20261024-121022 CR2).
  if (typeof type === 'string' && Object.hasOwn(RETIRED_TYPES, type)) {
    return `type "${type}" is retired: set type to "change"`;
  }
  return `unknown type "${type}"; valid types: ${CHANGE_TYPES.join(', ')}`;
}

// Effective tdd of a change: its own `tdd` frontmatter when it is a boolean,
// else the global `tdd`, else on. The context policy line asks here rather
// than re-deriving it; an empty frontmatter resolves the global value.
export const DEFAULT_TDD = true;

export function effectiveTdd(config, frontmatter) {
  if (typeof frontmatter?.tdd === 'boolean') return frontmatter.tdd;
  return typeof config?.tdd === 'boolean' ? config.tdd : DEFAULT_TDD;
}

// Configuration keys the 6 → 7 migration removes. A key present in either
// schema is reported with the command that removes it.
const RETIRED_CONFIG_KEYS = [
  ['types', (c) => 'types' in c],
  ['stages', (c) => 'stages' in c],
  ['release.impacts', (c) => isMapping(c.release) && 'impacts' in c.release],
  ['readiness', (c) => 'readiness' in c],
];

// Frozen history: `archived` is one-way (there is no `unarchive`) and
// `discarded` is a tombstone the contract forbids reopening, so a diagnostic
// about either could only be "fixed" by rewriting finished work. A frozen
// change therefore stops being the SUBJECT of the per-document loop while
// remaining DATA for every repo-wide invariant (duplicate ids, the depends_on
// graph, spec graduations, releases, mention backlinks). `done` without
// `archived` is live work pending graduation or archive; `archived` under an
// open status can only come from a hand edit, so it stays validated instead of
// hiding an anomaly. Single authority for the rule — callers ask, never
// re-derive. Returns the reason a change is frozen, or null when it is not.
export function frozenReason(change) {
  const fm = change?.frontmatter ?? {};
  if (fm.status === 'discarded') return 'discarded';
  if (fm.status === 'done' && fm.archived === true) return 'archived';
  return null;
}

// The usage collector is activated in git config, not in `config.yml`
// (20261001-155612), so validating it needs IO and stays out of the pure
// `checkRepo`: the `check` command adds these findings for the repo it loaded.
// A `usage` key in `config.yml` is neither read nor validated.
export function checkUsageGitConfig(repoRoot, run) {
  try {
    usageCollector(repoRoot, run);
    return [];
  } catch (error) {
    return [{ file: `(git config ${USAGE_COLLECTOR_GIT_KEY})`, message: error.message }];
  }
}

// Every `done` change whose acceptance git already proves while `accepted_at`
// is still unstamped, paired with the merge that proves it. Single authority
// for the predicate: `check` turns each entry into a warning and `sync` turns
// each into the stamp, so the two can never disagree about which changes are
// pending.
//
// Like `checkUsageGitConfig`, this needs the filesystem, so it stays out of
// the pure `checkRepo`: the callers feed it the repo they loaded. The branch
// comes from the change's own `[branch]` record, never from the checkout, and
// every uncertainty (no branch, no declared integration branch, a branch
// deleted or never fetched) resolves to "not pending".
//
// Archived changes are subjects here, unlike in the per-document loop
// (20261019-184719 CR3). The frozen-history rule exempts what could only be
// "fixed" by rewriting finished work; this is the opposite case — the merge
// that proves acceptance routinely lands AFTER the graduation that archived
// the change, so the datum is new, derived from git, and append-only.
// Skipping them would make the warning permanently unclearable.
export function pendingAcceptances(repoRoot, { config, changes = [] }, run) {
  let integration;
  try {
    integration = integrationBranch(config);
  } catch {
    return []; // checkConfig already reports a malformed git.integration_branch
  }
  // No `if (!integration) return []` short-circuit: `mergeRecord` is the single
  // authority on what counts as undetectable, and an undeclared integration
  // branch resolves there without a subprocess.

  const pending = [];
  for (const change of changes) {
    const fm = change.frontmatter ?? {};
    if (fm.status !== 'done' || fm.accepted_at) continue;
    const record = mergeRecord(repoRoot, recordedBranch(change), integration, run);
    if (record) pending.push({ change, record, integration });
  }
  return pending;
}

// Acceptance is telemetry, not a gate: `graduate` stamps `accepted_at` from
// the merge and `sync` seals what it could not reach, while `check` only ever
// says it is missing. It must stay a WARNING that never writes — `check` runs
// inside the versioned `hooks/pre-commit` and in CI, where a document rewrite
// is not an option and a non-zero exit would turn a merge that simply has not
// been graduated yet into a broken build.
export function checkPendingAcceptance(repoRoot, repo, run) {
  return pendingAcceptances(repoRoot, repo, run).map(({ change, record, integration }) => ({
    file: change.name ?? '(repo)',
    // `sync` is the seat that clears this for every subject, graduated or not;
    // `graduate` can only seal a change whose graduation is still pending.
    message: `accepted in ${integration} (merged ${record.sha}) but accepted_at is not stamped — run \`changeledger sync\``,
  }));
}

// The branch a change was worked on, as its Log records it: the LAST
// `[branch]` event wins, because rebinding is legal and `cleared` means the
// change has no branch again.
export function recordedBranch(c) {
  const log = (c.stages ?? []).find((s) => s.key === 'log');
  if (!log) return null;
  let branch = null;
  for (const line of log.body.split('\n')) {
    const event = parseLogEvent(line);
    if (event?.type === 'branch') branch = event.branch;
  }
  return branch;
}

const TERMINAL_STATUSES = ['done', 'discarded'];

// Statuses removed from the lifecycle (20261018-131621). Only a live document
// can still carry one — frozen history is never a subject — so the diagnostic
// names the hand edit that resolves it instead of a generic unknown status.
const RETIRED_STATUS_FIXES = {
  'in-validation': 'move it to "done" or "in-progress"',
  blocked: 'move it to "in-progress" and record a [!] task',
};

// `checkConfig` already reports a malformed `git.release_branch`, so it reads
// here as "nothing to add" rather than as a second error on every change.
function releaseRequirementError(config, frontmatter) {
  try {
    return releaseBranchRequirementError(config, frontmatter);
  } catch {
    return undefined;
  }
}

export function checkRepo({ config, changes, specs = [], releases = [], usage = [] }, opts = {}) {
  const errors = [];
  const warnings = [];
  const err = (c, message) => errors.push({ file: c?.name ?? '(repo)', message });
  const warn = (c, message) => warnings.push({ file: c?.name ?? '(repo)', message });

  const validChangeBranchFormat = checkConfig(config, (c, message) =>
    err(c ?? { name: '.changeledger/config.yml' }, message),
  );

  const statuses = Array.isArray(config.statuses) ? config.statuses : [];

  // Scope: a single change (fast, post-write check) or the whole repo.
  let scoped = changes;
  if (opts.id) {
    scoped = changes.filter((c) => String(c.frontmatter?.id) === String(opts.id));
    if (!scoped.length) err(null, `no change with id "${opts.id}"`);
  }

  // Subjects of the per-document loop. The data feed below stays `changes`.
  const targets = scoped.filter((c) => frozenReason(c) === null);
  const counts = { validated: targets.length, notValidated: scoped.length - targets.length };

  const knownIds = new Set(changes.map((c) => String(c.frontmatter?.id ?? '')).filter(Boolean));
  const incomingRelations = declaredBacklinks(changes);

  for (const c of targets) {
    const fm = c.frontmatter ?? {};

    if (validChangeBranchFormat) {
      try {
        renderChangeBranch(config, fm);
      } catch (error) {
        err(c, error.message);
      }
    }

    checkConflictMarkers(c, err);
    checkAutoFixable(c, fm, warn);

    for (const k of REQUIRED) if (!(k in fm)) err(c, `missing frontmatter "${k}"`);
    if (fm.created && !ISO_UTC.test(fm.created)) err(c, `created not ISO 8601 UTC: ${fm.created}`);
    if (fm.id && !CHANGE_ID_FORM.test(String(fm.id)))
      err(c, `id not in YYYYMMDD-HHMMSS form: ${fm.id}`);
    if (fm.id && c.name && !c.name.startsWith(`${fm.id}-`))
      err(c, `filename does not match id "${fm.id}"`);
    if (fm.type) {
      const defect = typeError(fm.type);
      if (defect) err(c, defect);
    }
    if (RETIRED_STATUS_FIXES[fm.status]) {
      err(c, `status "${fm.status}" is retired: ${RETIRED_STATUS_FIXES[fm.status]}`);
    } else if (fm.status && !statuses.includes(fm.status)) {
      err(c, `unknown status "${fm.status}"; valid statuses: ${statuses.join(', ')}`);
    }
    // A change integrating into a branch no declaration can host is stuck: its
    // context and its branch cannot load. Terminal changes are history, so
    // retiring `git.release_branch` later never turns them red (20261012-174310).
    const roleError = integratesIntoError(fm);
    if (roleError) {
      err(c, roleError);
    } else if (statuses.includes(fm.status) && !TERMINAL_STATUSES.includes(fm.status)) {
      const requirement = releaseRequirementError(config, fm);
      if (requirement) err(c, requirement);
    }
    if ('depends_on' in fm && !Array.isArray(fm.depends_on)) err(c, 'depends_on must be a list');
    if ('related_to' in fm && !Array.isArray(fm.related_to)) err(c, 'related_to must be a list');
    if ('parent' in fm) {
      if (Array.isArray(fm.parent)) err(c, 'parent must be a single change id, not a list');
      else if (typeof fm.parent !== 'string' || !CHANGE_ID_FORM.test(fm.parent)) {
        err(c, `parent "${fm.parent}" is not a change id`);
      }
    }
    if ('archived' in fm && typeof fm.archived !== 'boolean') err(c, 'archived must be a boolean');
    if ('reviewed' in fm && typeof fm.reviewed !== 'boolean') err(c, 'reviewed must be a boolean');
    if ('tdd' in fm && typeof fm.tdd !== 'boolean') err(c, 'tdd must be a boolean');
    if ('release_impact' in fm && !RELEASE_IMPACTS.includes(fm.release_impact)) {
      err(c, `release_impact "${fm.release_impact}" must be one of: ${RELEASE_IMPACTS.join(', ')}`);
    }
    // An epic always weighs `none` and publishes no `tdd=`: its own value of
    // either key has no reader, so it is named instead of silently ignored.
    if (fm.type === 'epic') {
      if ('release_impact' in fm) {
        warn(c, 'release_impact on an epic is ignored: its children carry the impact');
      }
      if ('tdd' in fm) warn(c, 'tdd on an epic is ignored: it carries no implementation');
    }

    const present = (c.stages ?? []).map((s) => s.key);
    for (const s of c.stages ?? []) {
      const k = s.key;
      if (!CANONICAL_STAGES.includes(k)) {
        const repair = RETIRED_STAGES.has(k) ? ' — run `changeledger fix`' : '';
        err(c, `unknown stage "## ${k}"; valid stages: ${CANONICAL_STAGES.join(', ')}${repair}`);
      } else if (s.heading && s.heading !== canonicalHeading(k)) {
        err(c, `stage heading must be canonical: expected "## ${canonicalHeading(k)}"`);
      }
    }

    const seenStages = new Set();
    for (const k of present) {
      if (seenStages.has(k)) err(c, `duplicate stage "## ${k}"`);
      else seenStages.add(k);
    }

    const known = present.filter((k) => CANONICAL_STAGES.includes(k));
    const ordered = [...known].sort(
      (a, b) => CANONICAL_STAGES.indexOf(a) - CANONICAL_STAGES.indexOf(b),
    );
    if (known.join(',') !== ordered.join(',')) err(c, 'stages are out of canonical order');

    if (fm.type === 'epic') {
      for (const k of REVIEWABLE_STAGES.filter((s) => present.includes(s)))
        err(c, `stage "## ${k}" does not belong in an epic: its children carry the work`);
    }

    const tasks = c.tasks ?? [];
    checkTasks(c, tasks, err);
    checkCriteria(c, c.criteria ?? [], err);
    checkCriterionReferences(c, tasks, err);

    if (fm.status === 'done' && tasks.some((t) => t.state !== 'done')) {
      const pending = tasks.filter((t) => t.state !== 'done').length;
      err(c, `status is "done" but ${pending} task(s) are not done`);
    }

    checkDeliveryVerdict(c, fm, err);
    checkLifecycleSequence(c, fm, err);
    checkFindingResolutions(c, err);
    checkUnclassifiedMentions(c, knownIds, incomingRelations, warn);
  }

  // Aggregate checks only make sense over the whole repo.
  if (opts.id) return { errors, warnings, ...counts };

  const seen = new Map();
  for (const c of changes) {
    const id = c.frontmatter?.id;
    if (!id) continue;
    if (seen.has(id)) err(c, `duplicate id "${id}" (also in ${seen.get(id)})`);
    else seen.set(id, c.name);
  }

  // A dep containing ':' is a cross-project reference (`<project>:<changeId>`).
  // It points at another repo, so the pure checker neither validates it nor
  // includes it in the local cycle graph.
  const isExternal = (d) => String(d).includes(':');
  const ids = new Set([...seen.keys()]);
  const graph = new Map();
  for (const c of changes) {
    const id = c.frontmatter?.id;
    const deps = c.frontmatter?.depends_on ?? [];
    // Frozen history (`frozenReason`) never emits these invariants as their
    // subject — a discarded or archived-done change can never be edited to fix
    // a dangling reference — but keeps feeding the dependency graph as data:
    // an open change resolving a frozen id must still resolve (CR6).
    const frozen = frozenReason(c) !== null;
    for (const d of deps) {
      if (!frozen && !isExternal(d) && !ids.has(d))
        err(c, `depends_on references missing change "${d}"`);
    }
    if (id)
      graph.set(
        id,
        deps.filter((d) => !isExternal(d) && ids.has(d)),
      );

    const relations = Array.isArray(c.frontmatter?.related_to) ? c.frontmatter.related_to : [];
    for (const raw of relations) {
      if (frozen) continue;
      const related = String(raw);
      if (String(id) === related) {
        err(c, `related_to cannot reference its own change "${related}"`);
      } else if (!isExternal(related) && !ids.has(related)) {
        err(c, `related_to references missing change "${related}"`);
      }
    }
  }

  checkParents(changes, ids, err);
  checkChildrenResolved(changes, err);

  const cycle = findCycle(graph);
  if (cycle) err(null, `dependency cycle: ${cycle.join(' → ')}`);

  checkSpecs(changes, specs, ids, err, warn);
  checkReleases(releases, new Map(changes.map((c) => [String(c.frontmatter?.id), c])), err);
  checkUsageRecords(usage, errors);

  return { errors, warnings, ...counts };
}

// Usage records (20261002-133728), as the loaders expose them: `{ name,
// change, record, error }`. Repo-wide only, like the other collections'
// aggregate checks. One finding per record, the first defect found, every
// message prefixed `usage record <name>: ` so it names the file in either
// layout.
function checkUsageRecords(usage, errors) {
  for (const entry of usage) {
    const issue = usageRecordIssue(entry);
    if (issue) {
      errors.push({ file: `usage/${entry.name}`, message: `usage record ${entry.name}: ${issue}` });
    }
  }
}

function usageRecordIssue({ name, record, error }) {
  const parsed = parseUsageRecordName(name);
  if (!parsed) return `name must follow ${USAGE_RECORD_NAME_FORM}`;
  if (error) return error;
  if (!isMapping(record)) return 'must be a JSON object';
  for (const field of ['schema', 'change', 'at']) {
    if (record[field] === undefined || record[field] === null) return `missing "${field}"`;
  }
  if (record.schema !== USAGE_RECORD_SCHEMA) {
    return `schema must be ${USAGE_RECORD_SCHEMA}, got ${JSON.stringify(record.schema)}`;
  }
  if (String(record.change) !== parsed.change) {
    return `change "${record.change}" does not match the id "${parsed.change}" in its name`;
  }
  if (typeof record.at !== 'string' || !ISO_UTC.test(record.at)) {
    return `at must be an ISO 8601 UTC instant, got ${JSON.stringify(record.at)}`;
  }
  return null;
}

// Every declared structural link that points AT a change, so naming its own
// counterpart in prose is not an undeclared mention. `related_to` was exempt
// in both directions and `parent` only in the child's, so an epic naming its
// own child warned — and the remedy the warning names is `depends_on` or
// `related_to`, the transitive edge this grouping exists to avoid
// (20261020-172221 D3a).
function declaredBacklinks(changes) {
  const incoming = new Map();
  const add = (target, source) => {
    if (target.includes(':')) return;
    if (!incoming.has(target)) incoming.set(target, new Set());
    incoming.get(target).add(source);
  };
  for (const change of changes) {
    const source = String(change.frontmatter?.id ?? '');
    if (!source) continue;
    const relations = change.frontmatter?.related_to;
    if (Array.isArray(relations)) for (const raw of relations) add(String(raw), source);
    const parent = change.frontmatter?.parent;
    if (typeof parent === 'string') add(parent, source);
  }
  return incoming;
}

function textOutsideFences(text) {
  const visible = [];
  let fence = null;
  for (const line of String(text ?? '').split('\n')) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = { char: marker[1][0], length: marker[1].length };
      else if (marker[1][0] === fence.char && marker[1].length >= fence.length) fence = null;
      continue;
    }
    if (!fence) visible.push(line);
  }
  return visible.join('\n');
}

// One message per heading, each naming only its own criterion: the admission
// diff keys errors by file and message, so a rewrite that removes one heading
// must remove exactly one message and leave the others' text unchanged.
export function specDurabilityIssues(body) {
  const issues = [];
  marked.walkTokens(marked.lexer(String(body ?? '')), (token) => {
    if (token.type !== 'heading') return;
    const criterion = String(token.text).match(/^(CR\d+)\b/)?.[1];
    if (criterion) {
      issues.push(
        `spec contains change-local criterion heading "${criterion}"; rewrite it as durable current truth`,
      );
    }
  });
  return issues;
}

// `parent` is the grouping edge, and it is deliberately NOT a second entry into
// the relation graph above. `depends_on` and `related_to` are transitive by
// nature — chained, `related_to` collapses two thirds of a real repo into one
// component, which is why asking what belongs to an epic has no answer today.
// So this edge is validated on its own and never joins `graph`: sharing a
// parent connects nothing, and a parent needs no backlink.
//
// Two levels, not a tree. A parent that may itself have a parent is the same
// transitive structure again, one field along. Walking upward catches both
// defects with one traversal, and the two are reported apart because the fix
// differs: a cycle is a contradiction, a third level is a modelling choice the
// human has to make.
// The closure invariant as a repo rule, not only as a write-seat guard:
// `apply` validates its accumulated candidate through `checkRepo`, so an entry
// order that closes the parent before the child exists is caught all the same
// (20261020-172221 D2). The write seats keep their own fail-fast guard, which
// refuses before any in-memory mutation and names the fix.
//
// Repo-wide, NOT a per-document diagnostic: the first cut put it in the
// subject loop, where it inherited the frozen-history exemption, so archiving
// an epic turned a red repo green and every creation seat then accepted new
// children under it. The exemption exists because a diagnostic about finished
// work could only be fixed by rewriting it — and that is not this case: the
// fix is to resolve the child, which is live. `frozenReason`'s own comment
// already says a frozen change stays DATA for every repo-wide invariant.
function checkChildrenResolved(changes, err) {
  for (const c of changes) {
    if (c.frontmatter?.status !== 'done') continue;
    const message = childrenOpenError(changes, c.frontmatter.id);
    if (message) err(c, message);
  }
}

function checkParents(changes, ids, err) {
  const parentOf = new Map();
  for (const c of changes) {
    const id = c.frontmatter?.id;
    const parent = c.frontmatter?.parent;
    if (id && typeof parent === 'string') parentOf.set(String(id), String(parent));
  }
  for (const c of changes) {
    if (frozenReason(c) !== null) continue;
    const id = String(c.frontmatter?.id ?? '');
    const parent = parentOf.get(id);
    if (parent === undefined) continue;
    // A malformed value is already reported once as a shape error; reading it
    // as a reference too would charge one defect two diagnostics.
    if (!CHANGE_ID_FORM.test(parent)) continue;
    if (parent === id) {
      err(c, `parent cannot reference its own change "${parent}"`);
      continue;
    }
    if (!ids.has(parent)) {
      err(c, `parent references missing change "${parent}"`);
      continue;
    }
    if (!parentOf.has(parent)) continue;
    // The parent has a parent of its own, which breaks the two levels. Which
    // way it breaks them is decided by where the walk upward ends: back at this
    // change is a cycle of any length, anywhere else is a third level. The two
    // need different fixes — a cycle is a contradiction, a third level is a
    // modelling choice — so they are never reported as each other.
    const chain = new Set([id]);
    let cursor = parent;
    while (cursor !== undefined && !chain.has(cursor)) {
      chain.add(cursor);
      cursor = parentOf.get(cursor);
    }
    if (cursor === id) {
      err(c, `parent cycle: ${[...chain, id].join(' → ')}`);
    } else {
      err(
        c,
        `parent "${parent}" declares a parent of its own: the hierarchy is two levels, an epic and its children`,
      );
    }
  }
}

function checkUnclassifiedMentions(change, knownIds, incomingRelations, warn) {
  const fm = change.frontmatter ?? {};
  if (frozenReason(change) !== null) return;

  const ownId = String(fm.id ?? '');
  const linkedIds = new Set(
    [
      ...(Array.isArray(fm.depends_on) ? fm.depends_on : []),
      ...(Array.isArray(fm.related_to) ? fm.related_to : []),
      ...(typeof fm.parent === 'string' ? [fm.parent] : []),
      ...(incomingRelations.get(ownId) ?? []),
    ].map(String),
  );
  const mentionedIds = new Set();

  for (const stage of change.stages ?? []) {
    if (!SEMANTIC_STAGES.has(stage.key)) continue;
    const body = textOutsideFences(stage.body);
    for (const match of body.matchAll(/(?<![:\d])\d{8}-\d{6}(?!\d)/g)) {
      const id = match[0];
      if (id !== ownId && knownIds.has(id) && !linkedIds.has(id)) mentionedIds.add(id);
    }
  }

  for (const id of mentionedIds) {
    warn(change, `mentions change "${id}" without declaring it in depends_on or related_to`);
  }
}

// Reuses the scoped validator for a selected change, optionally replacing its
// in-memory text with a candidate that has not been written yet. Callers gate
// mutations on errors only; warnings remain informational by contract.
export function checkSelectedChange(repo, id, candidateText) {
  let changes = repo.changes;
  if (candidateText !== undefined) {
    const index = changes.findIndex((c) => String(c.frontmatter?.id) === String(id));
    if (index !== -1) {
      const current = changes[index];
      const candidate = { ...current, text: candidateText, ...parseChange(candidateText) };
      changes = changes.with(index, candidate);
    }
  }
  return checkRepo({ ...repo, changes }, { id });
}

// Multiset diff of two `check` error lists by (file, message) identity: an
// error already present in `baseline` is not "introduced" by `candidate`, no
// matter how many times the candidate repeats it. This is what lets a write
// gate on repo-wide `check` errors without bricking every future write in an
// already-broken repo — an edit that fixes or simply does not touch a
// pre-existing error still proceeds (20260811-122031).
export function newErrors(baseline, candidate) {
  const remaining = new Map();
  for (const e of baseline) {
    const key = errorKey(e);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  return candidate.filter((e) => {
    const key = errorKey(e);
    const count = remaining.get(key) ?? 0;
    if (count > 0) {
      remaining.set(key, count - 1);
      return false;
    }
    return true;
  });
}

// The admission rule of the document write seats (20261022-213751): the
// `check` errors of `candidate`, a whole repo with the write in place, that
// `repo` does not already carry. `new`, `new --from`, `edit <id>`,
// `edit spec:` and `apply` gate on this one diff, and so does the standalone
// `task` command (20261023-094931).
export function introducedErrors(repo, candidate) {
  return newErrors(checkRepo(repo).errors, checkRepo(candidate).errors);
}

function errorKey(e) {
  return `${e.file}\u0000${e.message}`;
}

export function assertSelectedChangeValid(repo, id, candidateText) {
  const { errors } = checkSelectedChange(repo, id, candidateText);
  if (!errors.length) return;
  throw new Error(
    `change ${id} failed scoped validation:\n${errors.map((error) => `- ${error.message}`).join('\n')}`,
  );
}

// Validates one already-resolved file without loading or parsing siblings. This
// is the write-gate path for operations whose scope is exactly one change.
export function assertChangeTextValid(config, name, text) {
  const parsed = parseChange(text);
  const id = parsed.frontmatter.id;
  assertSelectedChangeValid(
    { config, changes: [{ name, text, ...parsed }], specs: [], releases: [] },
    id,
  );
}

// The human approves the objective and the frontier, nothing else
// (20261023-181753): `## Request` must have a body carrying `### Objective` and
// `### Frontier`, each with a body of its own. Every later stage may still be
// empty — Specification and Plan are written in `in-progress`. Called from the
// `approved` seat of `statusMutation`, which `approve` and the viewer share.
export function assertApprovable(text) {
  const request = parseChange(text).stages.find((s) => s.key === 'request');
  if (!request) throw new Error('cannot approve: "## Request" is missing');
  if (!request.body) throw new Error('cannot approve: "## Request" is empty');
  // The untrimmed lines, so the reader counts the fences the stage walk saw.
  const sections = parseRequestSections(stageSource(text, 'request'));
  const missing = sections.filter((s) => !s.present).map((s) => `"### ${s.name}"`);
  const empty = sections.filter((s) => s.present && !s.filled).map((s) => `"### ${s.name}"`);
  const defects = [];
  if (missing.length) defects.push(listed(missing, 'missing'));
  if (empty.length) defects.push(listed(empty, 'empty'));
  if (defects.length) throw new Error(`cannot approve: ${defects.join('; ')}`);
}

// The implementer's exit gate, at the `in-review` seat of `statusMutation`
// (20261023-181753 CR5, 20261024-121022): `## Specification` and `## Plan`
// are present with a body, and the Specification declares at least one
// `### CRn`. An epic never carries them, and never reaches this seat.
export function assertReviewable(text) {
  const { stages, criteria } = parseChange(text);
  const heading = (key) => `"## ${canonicalHeading(key)}"`;
  const found = REVIEWABLE_STAGES.map((key) => stages.find((s) => s.key === key));
  const missing = REVIEWABLE_STAGES.filter((_, i) => !found[i]).map(heading);
  const empty = found.filter((s) => s && !s.body).map((s) => heading(s.key));
  const defects = [];
  if (missing.length) defects.push(listed(missing, 'missing'));
  if (empty.length) defects.push(listed(empty, 'empty'));
  if (defects.length) throw new Error(`cannot request review: ${defects.join('; ')}`);
  if (!criteria.length) {
    throw new Error('cannot request review: "## Specification" declares no criterion');
  }
}

function listed(names, state) {
  return `${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} ${state}`;
}

function checkReleases(releases, changesById, err) {
  const seenVersions = new Set();
  const releasedChanges = new Map();
  const baselines = [];

  for (const release of releases) {
    const version = release.version;
    try {
      parseVersion(version);
    } catch (error) {
      err(release, error.message);
    }
    if (version && release.name !== `${version}.yml`) {
      err(release, `filename must match version "${version}.yml"`);
    }
    if (seenVersions.has(version)) err(release, `duplicate release version "${version}"`);
    else seenVersions.add(version);
    if (!ISO_UTC.test(release.created ?? '')) {
      err(release, `created not ISO 8601 UTC: ${release.created}`);
    }
    if (!Array.isArray(release.changes)) {
      err(release, 'changes must be a list');
      continue;
    }
    if ('baseline' in release && typeof release.baseline !== 'boolean') {
      err(release, 'baseline must be a boolean');
    }
    if (release.baseline === true) baselines.push(release);
    const local = new Set();
    for (const rawId of release.changes) {
      const id = String(rawId);
      const change = changesById.get(id);
      if (!change) err(release, `references missing change "${id}"`);
      else if (change.frontmatter?.status !== 'done') {
        err(release, `references change "${id}" whose status is not done`);
      }
      if (local.has(id)) err(release, `contains duplicate change "${id}"`);
      else local.add(id);
      if (releasedChanges.has(id)) {
        err(release, `change "${id}" already appears in ${releasedChanges.get(id)}`);
      } else {
        releasedChanges.set(id, release.name);
      }
    }
  }
  if (baselines.length > 1) {
    for (const release of baselines.slice(1))
      err(release, 'release history has multiple baselines');
  }
  if (baselines.length === 1) {
    const baseline = baselines[0];
    for (const release of releases) {
      try {
        if (compareVersions(release.version, baseline.version) < 0) {
          err(baseline, `baseline ${baseline.version} is not the earliest release`);
          break;
        }
      } catch {
        // Invalid versions are already reported above.
      }
    }
  }
}

function canonicalHeading(key) {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function checkTasks(c, tasks, err) {
  for (const issue of c.taskIssues ?? []) err(c, issue.message);
  for (const t of tasks) {
    if (t.state === 'done' && !ISO_UTC.test(t.resolvedAt ?? '')) {
      err(c, 'done task is missing an ISO 8601 UTC resolution timestamp');
    }
    if (t.state === 'blocked' && !String(t.reason ?? '').trim()) {
      err(c, 'blocked task is missing a reason');
    }
  }
}

function checkCriteria(c, criteria, err) {
  const seen = new Set();
  for (const cr of criteria) {
    if (seen.has(cr)) err(c, `duplicate criterion "${cr}"`);
    else seen.add(cr);
  }
}

// A Plan task citing a criterion the Specification does not declare is a broken
// reference, like an unknown stage: an error whatever the status of a validated
// change, the draft included (20261023-181753 CR4). `parseChange` reads `### CRn` only from
// `## Specification`, so a document without that stage declares none and any
// citation it carries is unknown.
function checkCriterionReferences(c, tasks, err) {
  const declared = new Set(c.criteria ?? []);
  for (const task of tasks) {
    for (const cr of task.criteria ?? []) {
      if (!declared.has(cr)) err(c, `Plan task references unknown criterion "${cr}"`);
    }
  }
}

// Validates the spec layer and its bidirectional links to changes. `graduate`
// records the event in the change Log and the durable provenance in the spec's
// `graduated_from` frontmatter; neither direction is sufficient on its own.
function checkSpecs(changes, specs, changeIds, err, warn) {
  const specNames = new Set(specs.map((s) => s.name));

  // change → spec links (from each change's Log graduation marker).
  const incomingBySpec = new Map(); // spec name → change ids that graduated to it
  const destinationsByChange = new Map(); // change id → spec names named by its Log
  const activityBySpec = new Map(); // spec name → latest linked-change activity
  for (const c of changes) {
    for (const event of graduationMarkers(c)) {
      const ts = event.at;
      const specName = event.spec;
      if (!specNames.has(specName)) {
        // Frozen history is never the emitting subject (CR6): the reference is
        // unfixable on a discarded or archived-done change either way.
        if (frozenReason(c) === null) err(c, `graduated to a missing spec "${specName}"`);
        continue;
      }
      const changeId = String(c.frontmatter?.id);
      if (!incomingBySpec.has(specName)) incomingBySpec.set(specName, new Set());
      incomingBySpec.get(specName).add(changeId);
      if (!destinationsByChange.has(changeId)) destinationsByChange.set(changeId, new Set());
      destinationsByChange.get(changeId).add(specName);
      const prev = activityBySpec.get(specName);
      if (ts && (!prev || ts > prev)) activityBySpec.set(specName, ts);
    }
  }

  for (const s of specs) {
    const fm = s.frontmatter ?? {};
    for (const issue of specDurabilityIssues(s.body)) err(s, issue);
    if (fm.updated && !ISO_UTC.test(fm.updated)) err(s, `updated not ISO 8601 UTC: ${fm.updated}`);

    let graduatedFrom = [];
    if ('graduated_from' in fm) {
      if (!Array.isArray(fm.graduated_from)) err(s, 'graduated_from must be a list');
      else graduatedFrom = fm.graduated_from.map(String);
    }
    const listed = new Set(graduatedFrom);
    for (const changeId of graduatedFrom) {
      if (!changeIds.has(changeId)) {
        err(s, `graduated_from references missing change "${changeId}"`);
      } else if (!destinationsByChange.get(changeId)?.has(s.name)) {
        err(s, `graduated_from "${changeId}" does not link back to spec "${s.name}"`);
      }
    }

    const incoming = incomingBySpec.get(s.name) ?? new Set();
    for (const changeId of incoming) {
      if (!listed.has(changeId)) err(s, `spec "${s.name}" missing graduated_from "${changeId}"`);
    }
    if (!incoming.size) warn(s, 'orphan spec (no change graduated it)');

    const activity = activityBySpec.get(s.name);
    if (fm.updated && ISO_UTC.test(fm.updated) && activity && activity > fm.updated) {
      warn(s, `updated (${fm.updated}) is older than linked change activity (${activity})`);
    }
  }
}

function logBody(change) {
  return String((change.stages ?? []).find((s) => s.key === 'log')?.body ?? '');
}

function* graduationMarkers(change) {
  for (const line of logBody(change).split('\n')) {
    const event = parseLogEvent(line);
    if (event?.type === 'graduation' && event.outcome === 'spec') yield event;
  }
}

// Git merge conflict markers: exactly 7 of <, = or > at the start of a line.
// `<` and `>` never appear in normal markdown; `=` could be a setext H1
// underline, but ChangeLedger uses ATX headings, so this is safe in practice.
const CONFLICT = /^(<{7}|={7}|>{7})(\s|$)/;

// Hints at `changeledger fix` rather than duplicating its repair rules: reuses
// the same pure detector so the two commands can never disagree about what
// counts as auto-fixable.
function checkAutoFixable(c, fm, warn) {
  if (typeof c.text !== 'string') return;
  if (hasFixableDefects(c.text)) {
    warn(c, `auto-fixable format defect(s) found; run: changeledger fix ${fm.id ?? ''}`.trimEnd());
  }
}

function checkConflictMarkers(c, err) {
  if (typeof c.text !== 'string') return;
  const lines = c.text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (CONFLICT.test(lines[i]))
      err(c, `merge conflict marker "${lines[i].slice(0, 7)}" at line ${i + 1}`);
  }
}

// Lifecycle history recorded under the previous contract (before
// `in-validation` became the universal human gate) stays readable without
// relaxing the current graph for new work (20260630-225210 CR3). Two bounded
// allowances, both covered by fixtures mirroring real history:
// - LEGACY_EDGES: skipping edges old flows wrote literally and `TRANSITIONS`
//   still refuses. An edge the graph has since adopted does no work here and
//   only hides which of the two authorities admitted a replay, so it is
//   removed: `in-review → done` and `in-progress → done` both became canonical
//   with the retirement of `in-validation` (20261019-184719 CR7).
// - Gap resync: old writers did not log every early move (draft → approved,
//   approved → in-progress). An explicit `status:` origin may fast-forward the
//   reconstruction, but only forward and only across pre-review states —
//   implied review/validation origins always require the exact sequence.
export const LEGACY_EDGES = new Set(['draft→in-progress']);
const LEGACY_RESYNC_RANK = { draft: 0, approved: 1, 'in-progress': 2 };
const CANONICAL = new Set(CANONICAL_STATUSES);

// The exit from review belongs to the reviewer's verdict. `review pass` made
// `in-review → done` canonical (20261018-131621), which cost the replay its
// only way to tell a reviewed delivery from a `[status]` one. The command
// seats refuse the `[status]` form (`statusMutation`); this is the same
// refusal for the hand-edited document `spec.md` declares a legitimate path,
// and the normal one in the consuming repos.
//
// Its own pass, not a step of the replay: the replay abandons the document at
// the first status it cannot model, and a Log that lived through
// `in-validation` is exactly where a hand-edited delivery would hide. Inside
// the replay this gate was void in every such document, which is most of what
// is still in flight in the repos that lived through the retirement.
function checkDeliveryVerdict(c, fm, err) {
  // Only a delivered document, which is CR1's own Given. Wider, the diagnostic
  // would name `review <id> pass` on a change that is no longer in review, so
  // the remedy it prints could not be taken.
  if (fm.status !== 'done') return;
  let inLog = false;
  const lines = (c.text ?? '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      inLog = /^##\s+Log\s*$/.test(lines[i]);
      continue;
    }
    if (!inLog) continue;
    const event = parseLogEvent(lines[i]);
    if (!event || event.type === 'review') continue;
    if (event.from === 'in-review' && event.to === 'done') {
      err(
        c,
        `Log line ${i + 1}: the review verdict delivers a change in review: use \`changeledger review ${fm.id} pass\``,
      );
      return;
    }
  }
}

// The lines under `## Log`, each with its 1-based line number in the document:
// the numbering every `Log line <n>` diagnostic cites.
function logSection(text) {
  const section = [];
  let inLog = false;
  for (const [i, line] of (text ?? '').split('\n').entries()) {
    if (/^##\s/.test(line)) {
      inLog = /^##\s+Log\s*$/.test(line);
      continue;
    }
    if (inLog) section.push({ number: i + 1, line });
  }
  return section;
}

// Replays `## Log` lifecycle events from `draft` against the transition graph
// in lifecycle.mjs. Stops at the first inconsistency to avoid cascading noise.
// Changes using non-canonical statuses are left alone — the graph cannot
// reason about states it does not model.
function checkLifecycleSequence(c, fm, err) {
  let current = 'draft';
  let events = 0;
  for (const { number, line } of logSection(c.text)) {
    const event = parseLogEvent(line);
    if (!event) {
      if (/^- /.test(line)) {
        err(
          c,
          `Log line ${number}: invalid typed event; valid types: ${LOG_EVENT_TYPES.join(', ')}; expected: - **YYYY-MM-DDTHH:MM:SSZ** \`[type]\` payload`,
        );
      }
      continue;
    }
    if (!['status', 'review', 'validation'].includes(event.type)) continue;
    // `[validation] accepted (merged <sha>)` is acceptance telemetry, not a
    // move: it records no origin, so it is skipped rather than read as an
    // unmodellable status, which would abandon the replay at that line.
    if (event.outcome === 'accepted') continue;
    if (!CANONICAL.has(event.from) || !CANONICAL.has(event.to)) return;
    events += 1;
    if (event.from !== current) {
      const legacyGap =
        event.type === 'status' &&
        LEGACY_RESYNC_RANK[current] !== undefined &&
        LEGACY_RESYNC_RANK[event.from] !== undefined &&
        LEGACY_RESYNC_RANK[event.from] > LEGACY_RESYNC_RANK[current];
      if (!legacyGap) {
        err(
          c,
          `Log line ${number}: transition "${event.from} → ${event.to}" starts from "${event.from}" but the reconstructed status is "${current}"`,
        );
        return;
      }
      current = event.from;
    }
    if (!canTransition(event.from, event.to) && !LEGACY_EDGES.has(`${event.from}→${event.to}`)) {
      err(c, `Log line ${number}: invalid lifecycle transition "${event.from} → ${event.to}"`);
      return;
    }
    current = event.to;
  }
  if (events && CANONICAL.has(fm.status) && current !== fm.status) {
    err(c, `Log reconstructs status "${current}" but frontmatter says "${fm.status}"`);
  }
}

// A finding resolution that resolves nothing — no finding opened before it, or
// one already resolved — makes the Log lie about what is pending. `finding`
// and `list` ignore it through the same reader; here it is an error.
function checkFindingResolutions(c, err) {
  const section = logSection(c.text);
  const { rejected } = findingsInLog(section.map(({ line }) => line).join('\n'));
  for (const { line, n, cause } of rejected) {
    const at = `Log line ${section[line].number}: finding F${n}`;
    err(
      c,
      cause === 'never recorded'
        ? `${at} resolved but never recorded`
        : `${at} already resolved at line ${section[cause.alreadyAt].number}`,
    );
  }
}

function checkConfig(config, err) {
  const c = config ?? {};
  let validChangeBranchFormat = true;
  try {
    const format = changeBranchFormat(c);
    if (format !== undefined) renderChangeBranch(c, { type: 'type', id: 'id' });
  } catch (error) {
    validChangeBranchFormat = false;
    err(null, error.message);
  }
  for (const k of ['changes_dir', 'statuses']) {
    if (!(k in c)) err(null, `config missing "${k}"`);
  }
  for (const [key, present] of RETIRED_CONFIG_KEYS) {
    if (present(c)) err(null, `config "${key}" is retired: run \`changeledger config migrate\``);
  }
  const minCliVersionError = minCliVersionDeclarationError(c);
  if (minCliVersionError) err(null, minCliVersionError);
  // changes_dir/specs_dir must stay inside the repo. The pure checker catches
  // shape escapes (absolute paths, `..` traversal); the symlink case is enforced
  // at command time by resolveRepoPath, which needs IO.
  for (const k of ['changes_dir', 'specs_dir']) {
    const v = c[k];
    if (v === undefined) continue;
    if (typeof v !== 'string' || v === '') err(null, `config "${k}" must be a relative path`);
    else if (isPathEscape(v)) err(null, `config "${k}" escapes the repo root: ${v}`);
  }
  if ('statuses' in c && !Array.isArray(c.statuses)) err(null, 'config "statuses" must be a list');
  if ('git' in c) {
    // A non-mapping `git` is one defect, reported once rather than per branch key.
    const resolvers = isMapping(c.git) ? [integrationBranch, releaseBranch] : [integrationBranch];
    const resolved = [];
    for (const resolve of resolvers) {
      try {
        resolved.push(resolve(c));
      } catch (error) {
        err(null, error.message);
      }
    }
    // Equal branches leave a change integrating into the release branch without
    // its back-merge target and its start guard, so the pair is checked only
    // once both resolve cleanly.
    const [integration, release] = resolved;
    if (resolved.length === 2 && integration !== undefined && integration === release) {
      err(
        null,
        `config "git.release_branch" must differ from "git.integration_branch" (both are "${integration}")`,
      );
    }
  }
  if ('release' in c) checkReleaseConfig(c.release, err);
  return validChangeBranchFormat;
}

function isMapping(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function checkReleaseConfig(release, err) {
  if (!isMapping(release)) {
    err(null, 'config "release" must be a mapping');
    return;
  }
  if ('default_impact' in release && !RELEASE_IMPACTS.includes(release.default_impact)) {
    err(null, `config "release.default_impact" must be one of: ${RELEASE_IMPACTS.join(', ')}`);
  }
}

// IO-free escape detection for configured paths: absolute (POSIX or Windows) or
// containing a `..` segment. Symlink escapes need IO and are caught at runtime.
function isPathEscape(p) {
  if (/^([a-zA-Z]:[\\/]|[\\/])/.test(p)) return true;
  return p.split(/[\\/]/).some((seg) => seg === '..');
}

function findCycle(graph) {
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map([...graph.keys()].map((k) => [k, WHITE]));
  const stack = [];

  const visit = (node) => {
    color.set(node, GRAY);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (color.get(next) === GRAY) return [...stack.slice(stack.indexOf(next)), next];
      if (color.get(next) === WHITE) {
        const found = visit(next);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(node, BLACK);
    return null;
  };

  for (const node of graph.keys()) {
    if (color.get(node) === WHITE) {
      const found = visit(node);
      if (found) return found;
    }
  }
  return null;
}
