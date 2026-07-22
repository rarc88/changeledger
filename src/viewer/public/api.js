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

export function captureLedgerTarget(project, source) {
  const ledgerRevision = source?.ledger_revision;
  return Object.freeze({
    project,
    ...(ledgerRevision ? { ledger_revision: ledgerRevision } : {}),
  });
}

export const postStatus = (target, id, status, reason) =>
  fetch('/api/status', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-changeledger-token': window.__CHANGELEDGER_TOKEN__,
    },
    body: JSON.stringify({
      ...target,
      id,
      status,
      ...(reason ? { reason } : {}),
    }),
  });

export const postStateSync = (project) =>
  postProject('/api/state-sync', { project }).then(jsonOrThrow);

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
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
};

export const postProjectConfig = (target, content, configRevision) =>
  postProject('/api/project-config', { ...target, content, config_revision: configRevision });

export const getProjectConfigStructured = (project) =>
  fetch(`/api/project-config-structured?project=${encodeURIComponent(project)}`).then(async (r) => {
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
    return body;
  });

export const patchProjectConfigApi = (target, patch, configRevision) =>
  postProject('/api/project-config-patch', { ...target, patch, config_revision: configRevision });

export const getConfigMigrationPreview = (target, configRevision) =>
  fetch(
    `/api/project-config-migrate-preview?project=${encodeURIComponent(target.project)}&config_revision=${encodeURIComponent(configRevision ?? '')}&ledger_revision=${encodeURIComponent(target.ledger_revision ?? '')}`,
  ).then(async (r) => {
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
    return body;
  });

export const postConfigMigrationApply = (target, configRevision) =>
  postProject('/api/project-config-migrate-apply', {
    ...target,
    config_revision: configRevision,
  }).then(jsonOrThrow);

export const postProjectPath = (project, path) =>
  postProject('/api/project-path', { project, path });

export const postProjectRemove = (project, confirm) =>
  postProject('/api/project-remove', { project, confirm });
