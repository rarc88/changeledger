export const getProjects = () => fetch('/api/projects').then((r) => r.json());

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
    headers: { 'Content-Type': 'application/json', 'x-sl-token': window.__SL_TOKEN__ },
    body: JSON.stringify({ project, id, status, ...(reason ? { reason } : {}) }),
  });
