// The registry's seat outside the viewer. The viewer's Projects panel can only
// be reached with a browser, and a registry dirty enough to need pruning is
// also one that gets in the viewer's way, so the only recourse used to be
// editing `.registry.json` by hand. This reuses the viewer's probe and its
// mutation rather than restating the rule that makes an absence confirmed.

import { cleanMissingProjects, listProjects, probeProject } from '../registry.mjs';

// `unreadable` covers both an inconclusive probe and an entry the listing could
// not inspect at all: neither is a confirmed absence, so neither is ever a
// cleanup candidate.
export function inspectProjects() {
  return listProjects({ tolerant: true }).map((project) => {
    const reason = project.listingError ?? project.activationError;
    if (reason) return { ...project, health: 'unreadable', reason };
    const { alive, missing } = probeProject(project.path);
    if (alive) return { ...project, health: 'available' };
    return { ...project, health: missing ? 'missing' : 'unreadable' };
  });
}

export function projectsCommand({ cleanMissing = false, dryRun = false } = {}) {
  // Silently ignoring it would let someone believe a cleanup was previewed
  // when nothing was ever going to be removed.
  if (dryRun && !cleanMissing) throw new Error('--dry-run only applies to --clean-missing');
  const projects = inspectProjects();
  if (!cleanMissing) return { projects };
  const candidates = projects
    .filter((project) => project.health === 'missing')
    .map(({ id, path }) => ({ id, path }));
  if (dryRun) {
    return { projects, candidates, dryRun: true, removedIds: [], removed: 0, skipped: 0 };
  }
  return { projects, candidates, ...cleanMissingProjects(candidates) };
}
