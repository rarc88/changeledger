export const getProjects = () => fetch('/api/projects').then((r) => r.json());

const projectQuery = (project, repositoryPath) => {
  const params = new URLSearchParams({ project });
  if (typeof repositoryPath === 'string') params.set('repository_path', repositoryPath);
  return params.toString();
};

const projectBody = (project, repositoryPath) => ({
  project,
  ...(typeof repositoryPath === 'string' ? { repository_path: repositoryPath } : {}),
});

export const getProjectConfig = (project, repositoryPath) =>
  fetch(`/api/project-config?${projectQuery(project, repositoryPath)}`).then(jsonOrThrow);

export const getRepo = async (project, repositoryPath) => {
  const res = await fetch(`/api/repo?${projectQuery(project, repositoryPath)}`);
  if (!res.ok) {
    let body = null;
    try {
      if (typeof res.json === 'function') body = await res.json();
      else if (typeof res.text === 'function') body = JSON.parse(await res.text());
    } catch {
      // The HTTP status remains the fallback when an intermediary returns a non-JSON error.
    }
    const error = new Error(body?.error || `HTTP ${res.status}`);
    error.payload = body;
    throw error;
  }
  return res.text();
};

export const getGitRefs = (project, id, repositoryPath) =>
  fetch(`/api/git?${projectQuery(project, repositoryPath)}&id=${encodeURIComponent(id)}`).then(
    jsonOrThrow,
  );

export const searchAllProjects = (query) =>
  fetch(`/api/search?q=${encodeURIComponent(query)}`).then((r) => r.json());

export const postStatus = (project, id, status, reason, repositoryPath) =>
  fetch('/api/status', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-changeledger-token': window.__CHANGELEDGER_TOKEN__,
    },
    body: JSON.stringify({
      ...projectBody(project, repositoryPath),
      id,
      status,
      ...(reason ? { reason } : {}),
    }),
  });

const postProject = (route, body) =>
  fetch(route, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-changeledger-token': window.__CHANGELEDGER_TOKEN__,
    },
    body: JSON.stringify(body),
  });

const jsonOrThrow = async (response) => {
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.error || `HTTP ${response.status}`);
    error.payload = body;
    throw error;
  }
  return body;
};

export const getLedgerTree = (project) =>
  fetch(`/api/ledger-tree?project=${encodeURIComponent(project)}`).then(jsonOrThrow);

export const getLedgerDocument = (project, category, path) =>
  fetch(
    `/api/ledger-document?project=${encodeURIComponent(project)}&category=${encodeURIComponent(category)}&path=${encodeURIComponent(path)}`,
  ).then(jsonOrThrow);

export const postProjectConfig = (project, content, revision, repositoryPath) =>
  postProject('/api/project-config', {
    ...projectBody(project, repositoryPath),
    content,
    revision,
  });

export const getProjectConfigStructured = (project, repositoryPath) =>
  fetch(`/api/project-config-structured?${projectQuery(project, repositoryPath)}`).then(
    jsonOrThrow,
  );

export const patchProjectConfigApi = (project, patch, revision, repositoryPath) =>
  postProject('/api/project-config-patch', {
    ...projectBody(project, repositoryPath),
    patch,
    revision,
  });

export const getConfigMigrationPreview = (project, revision, repositoryPath) =>
  fetch(
    `/api/project-config-migrate-preview?${projectQuery(project, repositoryPath)}&revision=${encodeURIComponent(revision ?? '')}`,
  ).then(jsonOrThrow);

export const postConfigMigrationApply = (project, revision, repositoryPath) =>
  postProject('/api/project-config-migrate-apply', {
    ...projectBody(project, repositoryPath),
    revision,
  }).then(jsonOrThrow);

export const postProjectPath = (project, path, repositoryPath) =>
  postProject('/api/project-path', { ...projectBody(project, repositoryPath), path });

export const postProjectRemove = (project, confirm, repositoryPath) =>
  postProject('/api/project-remove', { ...projectBody(project, repositoryPath), confirm });

export const postCleanMissingProjects = (confirm, candidates) =>
  postProject('/api/projects/clean-missing', { confirm, candidates });

// The router caps a POST body and answers 413 before the request reaches the
// domain, so one body holding every candidate cleaned nothing at all once the
// registry was dirty enough: the bigger the mess, the less the cleaner worked.
// The candidates are split into bodies that fit. This budget must stay at or
// below the router's own cap, which a test pins.
export const CLEAN_MISSING_BODY_BUDGET = 64 * 1024;

// Sizes are counted the way the router counts them — the length of the JSON
// text — instead of re-serializing the growing batch per candidate, which is
// quadratic on exactly the registries this exists for.
export function batchCleanMissingCandidates(candidates, budget = CLEAN_MISSING_BODY_BUDGET) {
  const envelope = JSON.stringify({ confirm: true, candidates: [] }).length;
  const batches = [];
  let current = [];
  let size = envelope;
  for (const candidate of candidates) {
    const entry = JSON.stringify(candidate).length + (current.length > 0 ? 1 : 0);
    if (current.length > 0 && size + entry > budget) {
      batches.push(current);
      current = [];
      size = envelope;
    }
    // A single candidate wider than the budget still travels alone: it cannot
    // be split, and the router's own answer is the honest one.
    size += JSON.stringify(candidate).length + (current.length > 0 ? 1 : 0);
    current.push(candidate);
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
