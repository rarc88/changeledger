export const getProjects = () => fetch('/api/projects').then((r) => r.json());

export const getProjectConfig = (project) =>
  fetch(`/api/project-config?project=${encodeURIComponent(project)}`).then(async (response) => {
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  });

export const getRepo = async (project) => {
  const res = await fetch(`/api/repo?project=${encodeURIComponent(project)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
};

export const getGitRefs = (project, id) =>
  fetch(`/api/git?project=${encodeURIComponent(project)}&id=${encodeURIComponent(id)}`).then((r) =>
    r.json(),
  );

export const searchAllProjects = (query) =>
  fetch(`/api/search?q=${encodeURIComponent(query)}`).then((r) => r.json());

export const postStatus = (project, id, status, reason) =>
  fetch('/api/status', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-changeledger-token': window.__CHANGELEDGER_TOKEN__,
    },
    body: JSON.stringify({ project, id, status, ...(reason ? { reason } : {}) }),
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

export const postProjectConfig = (project, content, revision) =>
  postProject('/api/project-config', { project, content, revision });

export const getProjectConfigStructured = (project) =>
  fetch(`/api/project-config-structured?project=${encodeURIComponent(project)}`).then(async (r) => {
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
    return body;
  });

export const patchProjectConfigApi = (project, patch, revision) =>
  postProject('/api/project-config-patch', { project, patch, revision });

export const getConfigMigrationPreview = (project, revision) =>
  fetch(
    `/api/project-config-migrate-preview?project=${encodeURIComponent(project)}&revision=${encodeURIComponent(revision ?? '')}`,
  ).then(async (r) => {
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
    return body;
  });

export const postConfigMigrationApply = (project, revision) =>
  postProject('/api/project-config-migrate-apply', { project, revision });

export const postProjectPath = (project, path) =>
  postProject('/api/project-path', { project, path });

export const postProjectRemove = (project, confirm) =>
  postProject('/api/project-remove', { project, confirm });
