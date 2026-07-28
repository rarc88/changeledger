const DOCUMENT_CATEGORIES = new Set(['project-docs', 'contract', 'templates']);

const messageOf = (error) => (error instanceof Error ? error.message : 'Unable to load document');
const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

export function createLedgerBrowser({ getTree, getDocument }) {
  const state = {
    project: null,
    category: 'specs',
    categories: [],
    documents: [],
    selectedPath: null,
    document: null,
    treeStatus: 'idle',
    documentStatus: 'idle',
    treeError: null,
    documentError: null,
  };
  let treeRevision = 0;
  let documentRevision = 0;
  let pendingTree = null;

  const resetDocument = () => {
    documentRevision++;
    state.selectedPath = null;
    state.document = null;
    state.documentStatus = 'idle';
    state.documentError = null;
  };

  const syncDocuments = () => {
    state.documents = [
      ...(state.categories.find((entry) => entry.category === state.category)?.documents ?? []),
    ].sort(byPath);
  };

  async function setContext(project, category) {
    const projectChanged = state.project !== project;
    const categoryChanged = state.category !== category;
    if (projectChanged || categoryChanged) {
      resetDocument();
      state.project = project;
      state.category = category;
    }
    if (projectChanged) {
      treeRevision++;
      state.categories = [];
      state.documents = [];
      state.treeStatus = 'idle';
      state.treeError = null;
      pendingTree = null;
    } else if (categoryChanged) {
      syncDocuments();
    }
    if (!DOCUMENT_CATEGORIES.has(category)) return;
    if (state.treeStatus === 'ready' || state.treeStatus === 'error') return;
    if (state.treeStatus === 'loading') {
      await pendingTree;
      syncDocuments();
      return;
    }

    const revision = treeRevision;
    state.treeStatus = 'loading';
    state.treeError = null;
    pendingTree = (async () => {
      try {
        const body = await getTree(project);
        if (revision !== treeRevision || state.project !== project) return;
        state.categories = Array.isArray(body?.categories) ? body.categories : [];
        state.treeStatus = 'ready';
      } catch (error) {
        if (revision !== treeRevision || state.project !== project) return;
        state.categories = [];
        state.treeStatus = 'error';
        state.treeError = messageOf(error);
      } finally {
        if (revision === treeRevision) syncDocuments();
      }
    })();
    await pendingTree;
  }

  async function open(path) {
    const allowed = state.documents.some((document) => document.path === path);
    if (!allowed || !DOCUMENT_CATEGORIES.has(state.category)) return false;
    const revision = ++documentRevision;
    const { project, category } = state;
    state.selectedPath = path;
    state.document = null;
    state.documentStatus = 'loading';
    state.documentError = null;
    try {
      const document = await getDocument(project, category, path);
      if (
        revision !== documentRevision ||
        state.project !== project ||
        state.category !== category ||
        state.selectedPath !== path
      ) {
        return false;
      }
      if (
        document?.category !== category ||
        document?.path !== path ||
        !['markdown', 'source'].includes(document?.format) ||
        typeof document?.content !== 'string'
      ) {
        throw new Error('document not found');
      }
      state.document = document;
      state.documentStatus = 'ready';
      return true;
    } catch (error) {
      if (revision !== documentRevision) return false;
      state.documentStatus = 'error';
      state.documentError = messageOf(error);
      return false;
    }
  }

  return { state, setContext, open, clearSelection: resetDocument };
}

export function buildLedgerDocumentTree(documents) {
  const root = { children: new Map() };
  for (const document of [...documents].sort(byPath)) {
    let parent = root;
    const segments = document.path.split('/');
    segments.forEach((name, index) => {
      const path = segments.slice(0, index + 1).join('/');
      const file = index === segments.length - 1;
      if (!parent.children.has(name)) {
        parent.children.set(name, {
          name,
          path,
          file,
          document: file ? document : null,
          children: new Map(),
        });
      }
      parent = parent.children.get(name);
    });
  }
  const serialize = (node) =>
    [...node.children.values()]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((child) => ({ ...child, children: serialize(child) }));
  return serialize(root);
}

export function resolveLedgerDocumentLink(href, currentPath, documents) {
  if (typeof href !== 'string' || !href || typeof currentPath !== 'string') return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('/') || /[?#\\\0]/.test(href)) {
    return null;
  }
  let decoded;
  try {
    decoded = decodeURIComponent(href);
  } catch {
    return null;
  }
  const segments = decoded.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null;
  const base = currentPath.split('/').slice(0, -1);
  const target = [...base, ...segments].join('/');
  return documents.some((document) => document.path === target) ? target : null;
}

export function handleLedgerDocumentLink(event, currentPath, documents, open) {
  const anchor = event.target.closest('a');
  if (!anchor) return false;
  const target = resolveLedgerDocumentLink(anchor.getAttribute('href'), currentPath, documents);
  if (!target) return false;
  event.preventDefault();
  open(target);
  return true;
}
