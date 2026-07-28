const LEDGER_CATEGORIES = new Set(['specs', 'project-docs', 'contract', 'templates']);
const LEDGER_PARAMS = ['view', 'project', 'category', 'doc'];
const URL_BASE = 'http://changeledger.local';

function toUrl(urlLike) {
  const value = typeof urlLike === 'string' ? urlLike : urlLike?.href;
  if (typeof value !== 'string') throw new TypeError('URL or location with href is required');
  return new URL(value, URL_BASE);
}

function isCanonicalState(state) {
  return (
    state?.view === 'ledger' &&
    typeof state.project === 'string' &&
    state.project.length > 0 &&
    LEDGER_CATEGORIES.has(state.category) &&
    (state.doc === undefined ||
      state.doc === null ||
      (typeof state.doc === 'string' && state.doc.length > 0))
  );
}

export function parseLedgerUrl(urlLike) {
  const { searchParams } = toUrl(urlLike);
  const hasSelection = ['project', 'category', 'doc'].some((key) => searchParams.has(key));
  const view = searchParams.get('view');
  if (view !== 'ledger') return hasSelection ? { kind: 'invalid' } : { kind: 'absent' };
  if (LEDGER_PARAMS.some((key) => searchParams.getAll(key).length > 1)) {
    return { kind: 'invalid' };
  }

  const state = {
    view: 'ledger',
    project: searchParams.get('project'),
    category: searchParams.get('category'),
    doc: searchParams.has('doc') ? searchParams.get('doc') : null,
  };
  return isCanonicalState(state) ? { kind: 'valid', state } : { kind: 'invalid' };
}

export function readLedgerRoute(location) {
  return parseLedgerUrl(location);
}

export function serializeLedgerUrl(state, currentUrl) {
  if (!isCanonicalState(state)) throw new TypeError('invalid Ledger state');
  const url = toUrl(currentUrl);
  url.search = '';
  url.searchParams.set('view', 'ledger');
  url.searchParams.set('project', state.project);
  url.searchParams.set('category', state.category);
  if (state.doc) url.searchParams.set('doc', state.doc);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function serializeNonLedgerUrl(currentUrl) {
  const url = toUrl(currentUrl);
  url.search = '';
  return `${url.pathname}${url.hash}`;
}

export function writeLedgerRoute(state, { location, history, mode }) {
  if (mode !== 'push' && mode !== 'replace') {
    throw new TypeError('history mode must be push or replace');
  }
  const url = serializeLedgerUrl(state, location);
  history[mode === 'push' ? 'pushState' : 'replaceState'](null, '', url);
  return true;
}

export function createLedgerNavigation({ location, history }) {
  const write = (state, mode) => writeLedgerRoute(state, { location, history, mode });
  const clear = (mode, view) => {
    if (mode !== 'push' && mode !== 'replace') {
      throw new TypeError('history mode must be push or replace');
    }
    history[mode === 'push' ? 'pushState' : 'replaceState'](
      { view },
      '',
      serializeNonLedgerUrl(location),
    );
    return true;
  };
  return {
    read: () => readLedgerRoute(location),
    push: (state) => write(state, 'push'),
    replace: (state) => write(state, 'replace'),
    clear,
  };
}
