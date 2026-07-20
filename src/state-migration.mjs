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

function logicalBranch(repoRoot, ref, gitEnv) {
  let full = '';
  try {
    full = run(repoRoot, ['rev-parse', '--symbolic-full-name', ref], gitEnv);
  } catch {
    return undefined;
  }
  if (full.startsWith('refs/heads/')) return full.slice('refs/heads/'.length);
  if (full.startsWith('refs/remotes/origin/')) {
    return full.slice('refs/remotes/origin/'.length);
  }
  return undefined;
}

function portableOriginRef(repoRoot, ref, gitEnv) {
  const full = run(repoRoot, ['rev-parse', '--symbolic-full-name', ref], gitEnv);
  const remote = full.match(/^refs\/remotes\/[^/]+\/(.+)$/);
  if (remote) return `refs/heads/${remote[1]}`;
  return full || ref;
}

export function previewStateMigration(repoRoot, { refs, gitEnv = {} } = {}) {
  const inspectedRefs = [...new Set(refs ?? [])].sort();
  if (!inspectedRefs.length) throw new Error('state migration preview requires at least one ref');

  const records = [];
  const conflicts = [];
  const resolvedRefs = new Map();
  for (const ref of inspectedRefs) {
    let commit;
    let config;
    try {
      commit = run(repoRoot, ['rev-parse', '--verify', ref], gitEnv);
      config = parseYaml(readAt(repoRoot, commit, '.changeledger/config.yml', gitEnv));
      resolvedRefs.set(ref, {
        commit,
        branch: logicalBranch(repoRoot, ref, gitEnv),
      });
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
          originRef: portableOriginRef(repoRoot, ref, gitEnv),
          commit,
          blob,
          file,
          name: path.posix.basename(file),
          text,
          integrationBranch: config.git?.integration_branch,
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
  const legacyBranches = {};
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

    const selected =
      variants.find(
        (variant) => resolvedRefs.get(variant.ref)?.branch === variant.integrationBranch,
      ) ?? variants[0];
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
      const branches = [
        ...new Set(
          inspectedRefs
            .map((ref) => logicalBranch(repoRoot, ref, gitEnv))
            .filter((branch) => branch?.split('/').includes(id)),
        ),
      ].sort();
      if (branches.length !== 1) {
        conflicts.push(
          conflict(
            'ambiguous-branch',
            id,
            `in-progress change "${id}" requires exactly one implementation branch`,
            branches,
          ),
        );
      } else {
        const branch = branches[0];
        const branchTips = [
          ...new Set(
            [...resolvedRefs.values()]
              .filter((item) => item.branch === branch)
              .map((item) => item.commit),
          ),
        ];
        const integration = selected.integrationBranch;
        const integrationTips = [
          ...new Set(
            [...resolvedRefs.values()]
              .filter((item) => item.branch === integration)
              .map((item) => item.commit),
          ),
        ];
        const hasValidBaseline =
          branchTips.length === 1 &&
          integrationTips.length > 0 &&
          integrationTips.some((base) => {
            try {
              run(repoRoot, ['merge-base', '--is-ancestor', base, branchTips[0]], gitEnv);
              return true;
            } catch {
              return false;
            }
          });
        if (!hasValidBaseline) {
          conflicts.push(
            conflict(
              'invalid-branch-baseline',
              id,
              `implementation branch "${branch}" must descend from integration branch "${integration}"`,
              inspectedRefs.filter((ref) => resolvedRefs.get(ref)?.branch === branch),
            ),
          );
        } else {
          legacyBranches[id] = branch;
        }
      }
    }
    changes.push({ name: selected.name, text: selected.text, ...parseChange(selected.text) });
    for (const variant of variants) {
      const origin = { id, ref: variant.originRef, commit: variant.commit, blob: variant.blob };
      if (
        !origins.some(
          (item) =>
            item.id === origin.id &&
            item.ref === origin.ref &&
            item.commit === origin.commit &&
            item.blob === origin.blob,
        )
      ) {
        origins.push(origin);
      }
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
    legacyBranches,
    conflicts,
  };
}
