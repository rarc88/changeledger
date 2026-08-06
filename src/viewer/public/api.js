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
