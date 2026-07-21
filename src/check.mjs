// Pure validator: takes a loaded repo ({ config, changes }) and returns
// { errors, warnings }. No IO — the `changeledger check` command does the IO and printing.

import { parseChange } from './change.mjs';
import { hasFixableDefects } from './fix.mjs';
import { CANONICAL_STATUSES, canTransition, parseLogEvent } from './lifecycle.mjs';
import { compareVersions, parseVersion, RELEASE_IMPACTS } from './release.mjs';

const REQUIRED = ['id', 'title', 'type', 'status', 'created', 'depends_on'];
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const ID_FORM = /^\d{8}-\d{6}$/;
const CLOSED_STATUSES = new Set(['done', 'discarded']);
const SEMANTIC_STAGES = new Set(['request', 'investigation', 'proposal', 'specification', 'plan']);

export function checkRepo({ config, changes, specs = [], releases = [] }, opts = {}) {
  const errors = [];
  const warnings = [];
  const err = (c, message) => errors.push({ file: c?.name ?? '(repo)', message });
  const warn = (c, message) => warnings.push({ file: c?.name ?? '(repo)', message });

  checkConfig(config, (c, message) => err(c ?? { name: '.changeledger/config.yml' }, message));

  const statuses = Array.isArray(config.statuses) ? config.statuses : [];
  const types = isMapping(config.types) ? config.types : {};
  const canonical = Array.isArray(config.stages) ? config.stages : [];

  // Scope: a single change (fast, post-write check) or the whole repo.
  let targets = changes;
  if (opts.id) {
    targets = changes.filter((c) => String(c.frontmatter?.id) === String(opts.id));
    if (!targets.length) err(null, `no change with id "${opts.id}"`);
  }

  const knownIds = new Set(changes.map((c) => String(c.frontmatter?.id ?? '')).filter(Boolean));
  const incomingRelations = relatedBacklinks(changes);

  for (const c of targets) {
    const fm = c.frontmatter ?? {};

    checkConflictMarkers(c, err);
    checkAutoFixable(c, fm, warn);

    for (const k of REQUIRED) if (!(k in fm)) err(c, `missing frontmatter "${k}"`);
    if (fm.created && !ISO_UTC.test(fm.created)) err(c, `created not ISO 8601 UTC: ${fm.created}`);
    if (fm.id && !ID_FORM.test(String(fm.id))) err(c, `id not in YYYYMMDD-HHMMSS form: ${fm.id}`);
    if (fm.id && c.name && !c.name.startsWith(`${fm.id}-`))
      err(c, `filename does not match id "${fm.id}"`);
    if (fm.type && !types[fm.type]) err(c, `unknown type "${fm.type}"`);
    if (fm.status && !statuses.includes(fm.status)) err(c, `unknown status "${fm.status}"`);
    if ('depends_on' in fm && !Array.isArray(fm.depends_on)) err(c, 'depends_on must be a list');
    if ('related_to' in fm && !Array.isArray(fm.related_to)) err(c, 'related_to must be a list');
    if ('archived' in fm && typeof fm.archived !== 'boolean') err(c, 'archived must be a boolean');
    if ('reviewed' in fm && typeof fm.reviewed !== 'boolean') err(c, 'reviewed must be a boolean');
    if ('release_impact' in fm && !RELEASE_IMPACTS.includes(fm.release_impact)) {
      err(c, `release_impact "${fm.release_impact}" must be one of: ${RELEASE_IMPACTS.join(', ')}`);
    }

    const present = (c.stages ?? []).map((s) => s.key);
    for (const s of c.stages ?? []) {
      const k = s.key;
      if (!canonical.includes(k)) err(c, `unknown stage "## ${k}"`);
      else if (s.heading && s.heading !== canonicalHeading(k)) {
        err(c, `stage heading must be canonical: expected "## ${canonicalHeading(k)}"`);
      }
    }

    const seenStages = new Set();
    for (const k of present) {
      if (seenStages.has(k)) err(c, `duplicate stage "## ${k}"`);
      else seenStages.add(k);
    }

    const known = present.filter((k) => canonical.includes(k));
    const ordered = [...known].sort((a, b) => canonical.indexOf(a) - canonical.indexOf(b));
    if (known.join(',') !== ordered.join(',')) err(c, 'stages are out of canonical order');

    const typeDefinition = isMapping(types[fm.type]) ? types[fm.type] : null;
    const active = Array.isArray(typeDefinition?.stages) ? typeDefinition.stages : null;
    if (active) {
      for (const k of active)
        if (!present.includes(k)) err(c, `missing active stage "## ${k}" for type ${fm.type}`);
      // `log` is the lifecycle ledger — allowed on any type once status moves.
      for (const k of known)
        if (k !== 'log' && !active.includes(k))
          err(c, `stage "## ${k}" is not active for type ${fm.type}`);
    }

    const tasks = c.tasks ?? [];
    checkTasks(c, tasks, err);
    checkCriteria(c, c.criteria ?? [], err);

    if (fm.status === 'done' && tasks.some((t) => t.state !== 'done')) {
      const pending = tasks.filter((t) => t.state !== 'done').length;
      err(c, `status is "done" but ${pending} task(s) are not done`);
    }
    if (fm.status === 'blocked' && tasks.length && !tasks.some((t) => t.state === 'blocked')) {
      warn(c, 'status is "blocked" but no task is marked [!]');
    }

    checkCoverage(c, fm, active, config, warn, err);
    checkLifecycleSequence(c, fm, err);
    checkUnclassifiedMentions(c, knownIds, incomingRelations, warn);
  }

  // Aggregate checks only make sense over the whole repo.
  if (opts.id) return { errors, warnings };

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
    for (const d of deps) {
      if (!isExternal(d) && !ids.has(d)) err(c, `depends_on references missing change "${d}"`);
    }
    if (id)
      graph.set(
        id,
        deps.filter((d) => !isExternal(d) && ids.has(d)),
      );

    const relations = Array.isArray(c.frontmatter?.related_to) ? c.frontmatter.related_to : [];
    for (const raw of relations) {
      const related = String(raw);
      if (String(id) === related) {
        err(c, `related_to cannot reference its own change "${related}"`);
      } else if (!isExternal(related) && !ids.has(related)) {
        err(c, `related_to references missing change "${related}"`);
      }
    }
  }

  const cycle = findCycle(graph);
  if (cycle) err(null, `dependency cycle: ${cycle.join(' → ')}`);

  checkSpecs(changes, specs, ids, err, warn);
  checkReleases(releases, new Map(changes.map((c) => [String(c.frontmatter?.id), c])), err);

  return { errors, warnings };
}

function relatedBacklinks(changes) {
  const incoming = new Map();
  for (const change of changes) {
    const source = String(change.frontmatter?.id ?? '');
    const relations = change.frontmatter?.related_to;
    if (!source || !Array.isArray(relations)) continue;
    for (const raw of relations) {
      const target = String(raw);
      if (target.includes(':')) continue;
      if (!incoming.has(target)) incoming.set(target, new Set());
      incoming.get(target).add(source);
    }
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

function checkUnclassifiedMentions(change, knownIds, incomingRelations, warn) {
  const fm = change.frontmatter ?? {};
  if (CLOSED_STATUSES.has(fm.status) || fm.archived === true) return;

  const ownId = String(fm.id ?? '');
  const linkedIds = new Set(
    [
      ...(Array.isArray(fm.depends_on) ? fm.depends_on : []),
      ...(Array.isArray(fm.related_to) ? fm.related_to : []),
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
        err(c, `graduated to a missing spec "${specName}"`);
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
// - LEGACY_EDGES: closing/skipping edges old flows wrote literally.
// - Gap resync: old writers did not log every early move (draft → approved,
//   approved → in-progress). An explicit `status:` origin may fast-forward the
//   reconstruction, but only forward and only across pre-review states —
//   implied review/validation origins always require the exact sequence.
const LEGACY_EDGES = new Set(['in-review→done', 'in-progress→done', 'draft→in-progress']);
const LEGACY_RESYNC_RANK = { draft: 0, approved: 1, 'in-progress': 2 };
const CANONICAL = new Set(CANONICAL_STATUSES);

// Replays `## Log` lifecycle events from `draft` against the transition graph
// in lifecycle.mjs. Stops at the first inconsistency to avoid cascading noise.
// Changes using non-canonical statuses are left alone — the graph cannot
// reason about states it does not model.
function checkLifecycleSequence(c, fm, err) {
  const lines = (c.text ?? '').split('\n');
  let inLog = false;
  let current = 'draft';
  let events = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s/.test(line)) {
      inLog = /^##\s+Log\s*$/.test(line);
      continue;
    }
    if (!inLog) continue;
    const event = parseLogEvent(line);
    if (!event) {
      if (/^- /.test(line)) err(c, `Log line ${i + 1}: invalid typed event`);
      continue;
    }
    if (!['status', 'review', 'validation'].includes(event.type)) continue;
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
          `Log line ${i + 1}: transition "${event.from} → ${event.to}" starts from "${event.from}" but the reconstructed status is "${current}"`,
        );
        return;
      }
      current = event.from;
    }
    if (!canTransition(event.from, event.to) && !LEGACY_EDGES.has(`${event.from}→${event.to}`)) {
      err(c, `Log line ${i + 1}: invalid lifecycle transition "${event.from} → ${event.to}"`);
      return;
    }
    current = event.to;
  }
  if (events && CANONICAL.has(fm.status) && current !== fm.status) {
    err(c, `Log reconstructs status "${current}" but frontmatter says "${fm.status}"`);
  }
}

// Definition-of-Ready coverage: when `tdd` is on (default), a change whose type
// activates `## Specification` is checked in draft, approved and in-progress.
// Draft reports everything as warnings. In approved/in-progress, readiness
// defects (criterion missing Given/When/Then, reference to an unknown
// criterion, CR-bearing task without target+verification) are errors, while
// coverage gaps (uncovered criterion, non-support task without a CR) stay
// warnings. Only the Given/When/Then structure is machine-checkable; semantic
// test-grade quality remains the documenting agent's judgment.
function checkCoverage(c, fm, active, config, warn, err = () => {}) {
  if (config?.tdd === false) return;
  if (!active?.includes('specification')) return;
  if (!['draft', 'approved', 'in-progress'].includes(fm.status)) return;
  const report = fm.status === 'draft' ? warn : err;

  const declared = c.criteria ?? [];
  const declaredSet = new Set(declared);
  const tasks = c.tasks ?? [];
  const referenced = new Set(tasks.flatMap((t) => t.criteria ?? []));

  for (const cr of c.criterionBlocks ?? []) {
    const steps = new Set(cr.steps ?? []);
    if (!steps.has('Given') || !steps.has('When') || !steps.has('Then')) {
      report(c, `${cr.id} is not test-grade: missing Given/When/Then`);
    }
  }

  for (const t of tasks) {
    if (!t.criteria?.length) continue;
    for (const cr of t.criteria) {
      if (!declaredSet.has(cr)) report(c, `Plan task references unknown criterion "${cr}"`);
    }
    if (!namesTargetAndVerification(t.text, config)) {
      const hint = readinessHint(config);
      const misplaced = misplacedVerificationSuffix(t, config);
      for (const cr of t.criteria) {
        if (misplaced) {
          report(
            c,
            `Plan task for ${cr} puts verification in the reserved suffix; move "${misplaced}" before the final (CRn) block because "— ..." is reserved for done timestamps and blocked reasons`,
          );
        } else {
          report(c, `Plan task for ${cr} must name target and verification (${hint})`);
        }
      }
    }
  }

  for (const cr of declared)
    if (!referenced.has(cr)) warn(c, `${cr} is not covered by any Plan task`);

  for (const t of tasks)
    if (!t.criteria?.length && !isSupportTask(t.text)) {
      const label = t.text.length > 50 ? `${t.text.slice(0, 50)}…` : t.text;
      warn(c, `Plan task "${label}" references no criterion`);
    }
}

// A task ending with `(support)` is intentionally operational (running tests,
// reading docs, scaffolding) and is exempt from the "references no criterion"
// warning. Readiness checks (target + verification patterns) already skip
// tasks with no criteria, so no additional exclusion is needed there.
function isSupportTask(text) {
  return /\(support\)\s*$/.test(text);
}

function namesTargetAndVerification(text, config) {
  const readiness = readinessConfig(config);
  return (
    matchesAnyReadinessPattern(text, readiness.target_patterns) &&
    matchesAnyReadinessPattern(text, readiness.verification_patterns)
  );
}

function misplacedVerificationSuffix(task, config) {
  if (task.state !== 'todo' || !task.suffix) return null;
  const readiness = readinessConfig(config);
  return readiness.verification_patterns.find((pattern) =>
    readinessPatternMatches(task.suffix, pattern),
  );
}

function readinessConfig(config) {
  const readiness = isMapping(config?.readiness) ? config.readiness : null;
  return {
    target_patterns:
      readiness && 'target_patterns' in readiness
        ? Array.isArray(readiness.target_patterns)
          ? readiness.target_patterns
          : []
        : ['src/**'],
    verification_patterns:
      readiness && 'verification_patterns' in readiness
        ? Array.isArray(readiness.verification_patterns)
          ? readiness.verification_patterns
          : []
        : ['test/**'],
  };
}

function readinessHint(config) {
  const readiness = readinessConfig(config);
  const source = config?.readiness ? 'configured readiness' : 'default readiness';
  return `${source}: target_patterns=${formatPatterns(readiness.target_patterns)}, verification_patterns=${formatPatterns(readiness.verification_patterns)}`;
}

function formatPatterns(patterns) {
  return `[${patterns.map((p) => JSON.stringify(p)).join(', ')}]`;
}

function matchesAnyReadinessPattern(text, patterns) {
  return patterns.some((pattern) => readinessPatternMatches(text, pattern));
}

function readinessPatternMatches(text, pattern) {
  if (/[*?]/.test(pattern)) return readinessGlob(pattern).test(text);
  return text.includes(pattern);
}

function readinessGlob(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*';
        i++;
      } else {
        out += '[^\\s`)]+';
      }
    } else if (ch === '?') {
      out += '[^\\s`)]';
    } else {
      out += escapeRegExp(ch);
    }
  }
  return new RegExp(out);
}

function escapeRegExp(text) {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function checkConfig(config, err) {
  const c = config ?? {};
  for (const k of ['changes_dir', 'statuses', 'stages', 'types']) {
    if (!(k in c)) err(null, `config missing "${k}"`);
  }
  if (
    Array.isArray(c.statuses) &&
    c.statuses.includes('done') &&
    !c.statuses.includes('in-validation')
  ) {
    err(null, 'config statuses must include "in-validation" before "done"');
  }
  if (
    Array.isArray(c.statuses) &&
    c.statuses.includes('in-validation') &&
    c.statuses.includes('done') &&
    c.statuses.indexOf('in-validation') > c.statuses.indexOf('done')
  ) {
    err(null, 'config status "in-validation" must appear before "done"');
  }
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
  if ('stages' in c && !Array.isArray(c.stages)) err(null, 'config "stages" must be a list');
  if ('types' in c && !isMapping(c.types)) err(null, 'config "types" must be a mapping');
  if ('readiness' in c) checkReadinessConfig(c.readiness, err);
  if ('git' in c) checkGitConfig(c.git, err);
  const configuredTypes = isMapping(c.types) ? c.types : {};
  if ('release' in c) checkReleaseConfig(c.release, configuredTypes, err);
  const canonical = Array.isArray(c.stages) ? c.stages : [];
  for (const [type, def] of Object.entries(configuredTypes)) {
    if (!isMapping(def)) {
      err(null, `config type "${type}" must be a mapping`);
      continue;
    }
    if (!Array.isArray(def.stages)) {
      err(null, `config type "${type}": stages must be a list`);
      continue;
    }
    for (const s of def.stages) {
      if (!canonical.includes(s))
        err(null, `config type "${type}" references unknown stage "${s}"`);
    }
    if (def && 'review_required' in def && typeof def.review_required !== 'boolean')
      err(null, `config type "${type}": review_required must be a boolean`);
  }
}

function checkGitConfig(git, err) {
  if (!isMapping(git)) {
    err(null, 'config "git" must be a mapping');
    return;
  }
  if (
    'integration_branch' in git &&
    git.integration_branch !== null &&
    (typeof git.integration_branch !== 'string' || !git.integration_branch.trim())
  ) {
    err(null, 'config "git.integration_branch" must be a non-empty string');
  }
  const format = git.change_branch_format;
  if (format !== undefined) {
    if (typeof format !== 'string' || !format.trim()) {
      err(null, 'config "git.change_branch_format" must be a non-empty string');
    } else {
      const placeholders = [...format.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]);
      const unknown = placeholders.find((name) => !['type', 'id'].includes(name));
      if (unknown) {
        err(null, `config "git.change_branch_format" has unknown placeholder "{${unknown}}"`);
      }
      if ((format.match(/\{id\}/g) ?? []).length !== 1) {
        err(null, 'config "git.change_branch_format" must contain "{id}" exactly once');
      }
      if (/[{}]/.test(format.replaceAll('{type}', '').replaceAll('{id}', ''))) {
        err(null, 'config "git.change_branch_format" contains malformed placeholders');
      }
    }
  }
  const hasBranch = Object.hasOwn(git, 'state_branch');
  const hasBaseline = Object.hasOwn(git, 'state_baseline');
  if (hasBranch !== hasBaseline) {
    err(null, 'config "git.state_branch" and "git.state_baseline" must be configured together');
  }
  if (hasBranch && !isPureGitBranch(git.state_branch)) {
    err(null, 'config "git.state_branch" must be a valid Git branch');
  }
  if (
    hasBaseline &&
    (typeof git.state_baseline !== 'string' ||
      !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(git.state_baseline))
  ) {
    err(null, 'config "git.state_baseline" must be a full Git object id');
  }
}

function isPureGitBranch(value) {
  return (
    typeof value === 'string' &&
    Boolean(value) &&
    !value.startsWith('-') &&
    !value.startsWith('/') &&
    !value.endsWith('/') &&
    !value.endsWith('.') &&
    !value.includes('..') &&
    !value.includes('@{') &&
    ![...value].some((char) => char.charCodeAt(0) <= 32) &&
    !/[~^:?*[\\]/.test(value) &&
    !value.split('/').some((part) => !part || part.startsWith('.') || part.endsWith('.lock'))
  );
}

function isMapping(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function checkReleaseConfig(release, types, err) {
  if (!release || typeof release !== 'object' || Array.isArray(release)) {
    err(null, 'config "release" must be a mapping');
    return;
  }
  if (!release.impacts || typeof release.impacts !== 'object' || Array.isArray(release.impacts)) {
    err(null, 'config "release.impacts" must be a mapping');
    return;
  }
  for (const [type, impact] of Object.entries(release.impacts)) {
    if (!(type in types)) err(null, `config release impact references unknown type "${type}"`);
    if (!RELEASE_IMPACTS.includes(impact)) {
      err(
        null,
        `config release impact "${impact}" for "${type}" must be one of: ${RELEASE_IMPACTS.join(', ')}`,
      );
    }
  }
}

function checkReadinessConfig(readiness, err) {
  if (!readiness || typeof readiness !== 'object' || Array.isArray(readiness)) {
    err(null, 'config "readiness" must be a mapping');
    return;
  }
  for (const key of ['target_patterns', 'verification_patterns']) {
    if (!(key in readiness)) continue;
    if (!Array.isArray(readiness[key])) {
      err(null, `config "readiness.${key}" must be a list`);
      continue;
    }
    for (const pattern of readiness[key]) {
      if (typeof pattern !== 'string' || pattern.trim() === '') {
        err(null, `config "readiness.${key}" entries must be non-empty strings`);
      }
    }
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
