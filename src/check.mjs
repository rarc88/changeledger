// Pure validator: takes a loaded repo ({ config, changes }) and returns
// { errors, warnings }. No IO — the `sl check` command does the IO and printing.

const REQUIRED = ['id', 'title', 'type', 'status', 'created', 'depends_on'];
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const ID_FORM = /^\d{8}-\d{6}$/;

export function checkRepo({ config, changes }, opts = {}) {
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

    const present = (c.stages ?? []).map((s) => s.key);
    for (const k of present) if (!canonical.includes(k)) err(c, `unknown stage "## ${k}"`);

    const known = present.filter((k) => canonical.includes(k));
    const ordered = [...known].sort((a, b) => canonical.indexOf(a) - canonical.indexOf(b));
    if (known.join(',') !== ordered.join(',')) err(c, 'stages are out of canonical order');

    const active = types[fm.type]?.stages;
    if (active) {
      for (const k of active)
        if (!present.includes(k)) err(c, `missing active stage "## ${k}" for type ${fm.type}`);
      for (const k of known)
        if (!active.includes(k)) err(c, `stage "## ${k}" is not active for type ${fm.type}`);
    }

    const tasks = c.tasks ?? [];
    if (fm.status === 'done' && tasks.some((t) => t.state !== 'done')) {
      const pending = tasks.filter((t) => t.state !== 'done').length;
      warn(c, `status is "done" but ${pending} task(s) are not done`);
    }
    if (fm.status === 'blocked' && tasks.length && !tasks.some((t) => t.state === 'blocked')) {
      warn(c, 'status is "blocked" but no task is marked [!]');
    }
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

  return { errors, warnings };
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
