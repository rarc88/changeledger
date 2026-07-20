import path from 'node:path';
import { parseChange } from './change.mjs';
import { objectRun } from './git.mjs';
import { parseYaml } from './yaml.mjs';

function run(repoRoot, args, gitEnv) {
  return objectRun(args, repoRoot, { env: gitEnv }).trim();
}

function assertRepoRelative(value, field) {
  if (typeof value !== 'string' || !value || path.posix.isAbsolute(value)) {
    throw new Error(`${field} must be a relative Git tree path`);
  }
  const normalized = path.posix.normalize(value);
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`${field} escapes the repository tree`);
  }
  return normalized.replace(/^\.\//, '');
}

function readAt(repoRoot, revision, file, gitEnv) {
  return objectRun(['show', `${revision}:${file}`], repoRoot, { env: gitEnv });
}

function conflict(kind, id, detail, refs = []) {
  return { kind, id: id ? String(id) : null, detail, refs: [...refs].sort() };
}

export function previewStateMigration(repoRoot, { refs, gitEnv = {} } = {}) {
  const inspectedRefs = [...new Set(refs ?? [])].sort();
  if (!inspectedRefs.length) throw new Error('state migration preview requires at least one ref');

  const records = [];
  const conflicts = [];
  for (const ref of inspectedRefs) {
    let commit;
    let config;
    try {
      commit = run(repoRoot, ['rev-parse', '--verify', ref], gitEnv);
      config = parseYaml(readAt(repoRoot, commit, '.changeledger/config.yml', gitEnv));
    } catch (error) {
      conflicts.push(conflict('unreadable-ref', null, error.message, [ref]));
      continue;
    }

    let changesDir;
    try {
      changesDir = assertRepoRelative(config.changes_dir, 'changes_dir');
    } catch (error) {
      conflicts.push(conflict('invalid-config', null, error.message, [ref]));
      continue;
    }

    let names;
    try {
      names = run(repoRoot, ['ls-tree', '-r', '--name-only', commit, '--', changesDir], gitEnv)
        .split('\n')
        .filter((name) => name.endsWith('.md'))
        .sort();
    } catch (error) {
      conflicts.push(conflict('unreadable-ref', null, error.message, [ref]));
      continue;
    }

    for (const file of names) {
      try {
        const text = readAt(repoRoot, commit, file, gitEnv);
        const parsed = parseChange(text);
        const blob = run(repoRoot, ['rev-parse', `${commit}:${file}`], gitEnv);
        records.push({
          ref,
          commit,
          blob,
          file,
          name: path.posix.basename(file),
          text,
          ...parsed,
        });
      } catch (error) {
        conflicts.push(conflict('invalid-change', null, `${file}: ${error.message}`, [ref]));
      }
    }
  }

  const groups = new Map();
  for (const record of records) {
    const id = String(record.frontmatter.id);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(record);
  }

  const changes = [];
  const origins = [];
  for (const [id, variants] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    variants.sort((a, b) => a.ref.localeCompare(b.ref) || a.file.localeCompare(b.file));
    const blobs = new Set(variants.map((variant) => variant.blob));
    if (blobs.size > 1) {
      conflicts.push(
        conflict(
          'divergent-content',
          id,
          `change "${id}" has ${blobs.size} different blobs`,
          variants.map((variant) => variant.ref),
        ),
      );
    }

    const selected = variants[0];
    const missingOwner = variants.find(
      (variant) =>
        ['approved', 'in-progress'].includes(variant.frontmatter.status) &&
        !variant.frontmatter.owner,
    );
    if (missingOwner) {
      conflicts.push(
        conflict(
          'missing-owner',
          id,
          `change "${id}" in ${missingOwner.frontmatter.status} requires an owner`,
          [missingOwner.ref],
        ),
      );
    }
    if (variants.some((variant) => variant.frontmatter.status === 'in-progress')) {
      const branches = inspectedRefs.filter(
        (ref) => ref.split('/').at(-1)?.includes(id) || ref.includes(id),
      );
      if (branches.length !== 1) {
        conflicts.push(
          conflict(
            'ambiguous-branch',
            id,
            `in-progress change "${id}" requires exactly one implementation branch`,
            branches,
          ),
        );
      }
    }
    changes.push({ name: selected.name, text: selected.text, ...parseChange(selected.text) });
    for (const variant of variants) {
      origins.push({ id, ref: variant.ref, commit: variant.commit, blob: variant.blob });
    }
  }

  conflicts.sort(
    (a, b) =>
      String(a.id ?? '').localeCompare(String(b.id ?? '')) ||
      a.kind.localeCompare(b.kind) ||
      a.detail.localeCompare(b.detail),
  );
  origins.sort(
    (a, b) =>
      a.id.localeCompare(b.id) || a.ref.localeCompare(b.ref) || a.commit.localeCompare(b.commit),
  );
  return {
    refs: inspectedRefs,
    warnings: ['Only explicitly provided, already-fetched refs were inspected.'],
    changes,
    origins,
    conflicts,
  };
}
