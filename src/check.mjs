// Pure validator: takes a loaded repo ({ config, changes }) and returns
// { errors, warnings }. No IO — the `sl check` command does the IO and printing.

const REQUIRED = ['id', 'title', 'type', 'status', 'created', 'depends_on'];
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const ID_FORM = /^\d{8}-\d{6}$/;

export function checkRepo({ config, changes, specs = [] }, opts = {}) {
  const errors = [];
  const warnings = [];
  const err = (c, message) => errors.push({ file: c?.name ?? '(repo)', message });
  const warn = (c, message) => warnings.push({ file: c?.name ?? '(repo)', message });

  checkConfig(config, err);

  const statuses = config.statuses ?? [];
  const types = config.types ?? {};
  const canonical = config.stages ?? [];

  // Scope: a single change (fast, post-write check) or the whole repo.
  let targets = changes;
  if (opts.id) {
    targets = changes.filter((c) => String(c.frontmatter?.id) === String(opts.id));
    if (!targets.length) err(null, `no change with id "${opts.id}"`);
  }

  for (const c of targets) {
    const fm = c.frontmatter ?? {};

    checkConflictMarkers(c, err);

    for (const k of REQUIRED) if (!(k in fm)) err(c, `missing frontmatter "${k}"`);
    if (fm.created && !ISO_UTC.test(fm.created)) err(c, `created not ISO 8601 UTC: ${fm.created}`);
    if (fm.id && !ID_FORM.test(String(fm.id))) err(c, `id not in YYYYMMDD-HHMMSS form: ${fm.id}`);
    if (fm.id && c.name && !c.name.startsWith(`${fm.id}-`))
      err(c, `filename does not match id "${fm.id}"`);
    if (fm.type && !types[fm.type]) err(c, `unknown type "${fm.type}"`);
    if (fm.status && !statuses.includes(fm.status)) err(c, `unknown status "${fm.status}"`);
    if ('depends_on' in fm && !Array.isArray(fm.depends_on)) err(c, 'depends_on must be a list');
    if ('archived' in fm && typeof fm.archived !== 'boolean') err(c, 'archived must be a boolean');
    if ('reviewed' in fm && typeof fm.reviewed !== 'boolean') err(c, 'reviewed must be a boolean');

    const present = (c.stages ?? []).map((s) => s.key);
    for (const k of present) if (!canonical.includes(k)) err(c, `unknown stage "## ${k}"`);

    const seenStages = new Set();
    for (const k of present) {
      if (seenStages.has(k)) err(c, `duplicate stage "## ${k}"`);
      else seenStages.add(k);
    }

    const known = present.filter((k) => canonical.includes(k));
    const ordered = [...known].sort((a, b) => canonical.indexOf(a) - canonical.indexOf(b));
    if (known.join(',') !== ordered.join(',')) err(c, 'stages are out of canonical order');

    const active = types[fm.type]?.stages;
    if (active) {
      for (const k of active)
        if (!present.includes(k)) err(c, `missing active stage "## ${k}" for type ${fm.type}`);
      // `log` is the lifecycle ledger — allowed on any type once status moves.
      for (const k of known)
        if (k !== 'log' && !active.includes(k))
          err(c, `stage "## ${k}" is not active for type ${fm.type}`);
    }

    const tasks = c.tasks ?? [];
    if (fm.status === 'done' && tasks.some((t) => t.state !== 'done')) {
      const pending = tasks.filter((t) => t.state !== 'done').length;
      warn(c, `status is "done" but ${pending} task(s) are not done`);
    }
    if (fm.status === 'blocked' && tasks.length && !tasks.some((t) => t.state === 'blocked')) {
      warn(c, 'status is "blocked" but no task is marked [!]');
    }

    checkCoverage(c, fm, active, config, warn);
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
  }

  const cycle = findCycle(graph);
  if (cycle) err(null, `dependency cycle: ${cycle.join(' → ')}`);

  checkSpecs(changes, specs, ids, err, warn);

  return { errors, warnings };
}

// The latest timestamp found in a change: its `created` plus every `**<iso>**`
// in its raw text (Log entries, task resolutions). Used to spot stale specs.
function latestActivity(change) {
  const stamps = [];
  if (change.frontmatter?.created) stamps.push(change.frontmatter.created);
  for (const m of String(change.text ?? '').matchAll(/\*\*(\d{4}-\d{2}-\d{2}T[^*]+)\*\*/g))
    stamps.push(m[1].trim());
  return stamps.sort().pop() ?? null;
}

// Validates the spec layer and its links to changes. `graduate` records two
// markers: in the change Log `graduado a spec \`<file>\``, and in the spec body
// `Graduado del change <id>`.
function checkSpecs(changes, specs, changeIds, err, warn) {
  const specNames = new Set(specs.map((s) => s.name));

  // change → spec links (from each change's Log graduation marker).
  const incoming = new Set(); // spec names a change graduated to
  const activityBySpec = new Map(); // spec name → latest linked-change activity
  for (const c of changes) {
    for (const m of String(c.text ?? '').matchAll(/graduado a spec `([^`]+)`/gi)) {
      const specName = m[1].trim();
      if (!specNames.has(specName)) {
        err(c, `graduated to a missing spec "${specName}"`);
        continue;
      }
      incoming.add(specName);
      const ts = latestActivity(c);
      const prev = activityBySpec.get(specName);
      if (ts && (!prev || ts > prev)) activityBySpec.set(specName, ts);
    }
  }

  for (const s of specs) {
    const fm = s.frontmatter ?? {};
    if (fm.updated && !ISO_UTC.test(fm.updated)) err(s, `updated not ISO 8601 UTC: ${fm.updated}`);

    // spec → change backlinks.
    let hasValidBacklink = false;
    for (const m of String(s.body ?? '').matchAll(/Graduado del change\s+(\d{8}-\d{6})/gi)) {
      if (changeIds.has(m[1])) hasValidBacklink = true;
      else err(s, `references a missing change "${m[1]}"`);
    }

    if (!incoming.has(s.name) && !hasValidBacklink) {
      warn(s, 'orphan spec (no change graduated it)');
    }

    const activity = activityBySpec.get(s.name);
    if (fm.updated && ISO_UTC.test(fm.updated) && activity && activity > fm.updated) {
      warn(s, `updated (${fm.updated}) is older than linked change activity (${activity})`);
    }
  }
}

// Git merge conflict markers: exactly 7 of <, = or > at the start of a line.
// `<` and `>` never appear in normal markdown; `=` could be a setext H1
// underline, but Spec Ledger uses ATX headings, so this is safe in practice.
const CONFLICT = /^(<{7}|={7}|>{7})(\s|$)/;

function checkConflictMarkers(c, err) {
  if (typeof c.text !== 'string') return;
  const lines = c.text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (CONFLICT.test(lines[i]))
      err(c, `merge conflict marker "${lines[i].slice(0, 7)}" at line ${i + 1}`);
  }
}

// Definition-of-Ready coverage: when `tdd` is on (default), a change being built
// (approved/in-progress) whose type activates `## Specification` must map
// criteria ↔ Plan tasks both ways. Warnings only — it nudges, never blocks.
// It checks coverage, not whether a criterion is "test-grade" (not parseable).
function checkCoverage(c, fm, active, config, warn) {
  if (config?.tdd === false) return;
  if (!active?.includes('specification')) return;
  if (fm.status !== 'approved' && fm.status !== 'in-progress') return;

  const declared = c.criteria ?? [];
  const tasks = c.tasks ?? [];
  const referenced = new Set(tasks.flatMap((t) => t.criteria ?? []));

  for (const cr of declared)
    if (!referenced.has(cr)) warn(c, `${cr} is not covered by any Plan task`);

  for (const t of tasks)
    if (!t.criteria?.length) {
      const label = t.text.length > 50 ? `${t.text.slice(0, 50)}…` : t.text;
      warn(c, `Plan task "${label}" references no criterion`);
    }
}

function checkConfig(config, err) {
  const c = config ?? {};
  for (const k of ['changes_dir', 'statuses', 'stages', 'types']) {
    if (!(k in c)) err(null, `config missing "${k}"`);
  }
  if ('statuses' in c && !Array.isArray(c.statuses)) err(null, 'config "statuses" must be a list');
  if ('stages' in c && !Array.isArray(c.stages)) err(null, 'config "stages" must be a list');
  const canonical = Array.isArray(c.stages) ? c.stages : [];
  for (const [type, def] of Object.entries(c.types ?? {})) {
    for (const s of def?.stages ?? []) {
      if (!canonical.includes(s))
        err(null, `config type "${type}" references unknown stage "${s}"`);
    }
  }
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
