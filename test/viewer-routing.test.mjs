import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createLedgerNavigation,
  parseLedgerUrl,
  readLedgerRoute,
  serializeLedgerUrl,
  serializeNonLedgerUrl,
  writeLedgerRoute,
} from '../src/viewer/public/viewer-routing.js';

function memoryNavigation(initialUrl) {
  const location = { href: initialUrl };
  const entries = [{ url: initialUrl, state: null }];
  let index = 0;
  const write = (replace, state, url) => {
    const absolute = new URL(url, location.href).href;
    if (replace) entries[index] = { url: absolute, state };
    else {
      entries.splice(index + 1);
      entries.push({ url: absolute, state });
      index++;
    }
    location.href = absolute;
  };
  const history = {
    pushState: (state, _title, url) => write(false, state, url),
    replaceState: (state, _title, url) => write(true, state, url),
    back() {
      if (index > 0) index--;
      location.href = entries[index].url;
      return entries[index];
    },
    forward() {
      if (index < entries.length - 1) index++;
      location.href = entries[index].url;
      return entries[index];
    },
  };
  return { location, history, entries };
}

test('141859 CR6: valid Ledger URLs parse to exact shareable state', () => {
  assert.deepEqual(
    parseLedgerUrl(
      'https://viewer.test/?view=ledger&project=alpha%2Fbeta&category=contract&doc=agent-prompts%2Fimplementation.md',
    ),
    {
      kind: 'valid',
      state: {
        view: 'ledger',
        project: 'alpha/beta',
        category: 'contract',
        doc: 'agent-prompts/implementation.md',
      },
    },
  );
  assert.deepEqual(
    parseLedgerUrl('https://viewer.test/?view=ledger&project=alpha&category=specs'),
    {
      kind: 'valid',
      state: { view: 'ledger', project: 'alpha', category: 'specs', doc: null },
    },
  );
});

test('141859 CR6/CR7: URL reads distinguish absent state from invalid partial Ledger state', () => {
  assert.deepEqual(parseLedgerUrl('https://viewer.test/'), { kind: 'absent' });
  assert.deepEqual(parseLedgerUrl('https://viewer.test/?view=board'), { kind: 'absent' });

  const invalidUrls = [
    '?view=ledger',
    '?view=ledger&project=alpha',
    '?view=ledger&category=specs',
    '?project=alpha&category=specs',
    '?view=board&project=alpha',
    '?view=ledger&project=&category=specs',
    '?view=ledger&project=alpha&category=',
    '?view=ledger&project=alpha&category=unknown',
    '?view=ledger&project=alpha&category=specs&doc=',
    '?view=ledger&project=%E0%A4%A&category=specs',
    '?view=ledger&project=alpha&category=%E0%A4%A',
    '?view=ledger&view=ledger&project=alpha&category=specs',
    '?view=ledger&project=alpha&project=beta&category=specs',
  ];
  for (const url of invalidUrls) {
    assert.deepEqual(parseLedgerUrl(url), { kind: 'invalid' }, url);
  }
});

test('141859 CR7: valid URL state can override storage while an absent URL permits fallback', () => {
  const storageState = {
    view: 'ledger',
    project: 'stored',
    category: 'templates',
    doc: 'config.yml',
  };
  const valid = parseLedgerUrl('?view=ledger&project=url&category=project-docs&doc=README.md');
  const absent = parseLedgerUrl('/');

  assert.deepEqual(valid.kind === 'valid' ? valid.state : storageState, {
    view: 'ledger',
    project: 'url',
    category: 'project-docs',
    doc: 'README.md',
  });
  assert.equal(absent.kind, 'absent');
  assert.deepEqual(absent.kind === 'valid' ? absent.state : storageState, storageState);
});

test('141859 CR6: serialization is canonical, encoded and drops stale query state', () => {
  const serialized = serializeLedgerUrl(
    {
      view: 'ledger',
      project: 'alpha & beta/γ',
      category: 'project-docs',
      doc: 'folder/a b.md?raw=1',
    },
    'https://viewer.test/ledger?view=ledger&project=old&category=contract&doc=old.md&stale=yes#section',
  );

  assert.equal(
    serialized,
    '/ledger?view=ledger&project=alpha+%26+beta%2F%CE%B3&category=project-docs&doc=folder%2Fa+b.md%3Fraw%3D1#section',
  );
  assert.equal(
    serializeLedgerUrl(
      { view: 'ledger', project: 'new', category: 'specs', doc: null },
      'https://viewer.test/?doc=stale.md&category=contract&project=old&view=ledger&other=stale',
    ),
    '/?view=ledger&project=new&category=specs',
  );
});

test('141859 CR6: serialization rejects non-canonical state', () => {
  const invalidStates = [
    { view: 'board', project: 'alpha', category: 'specs', doc: null },
    { view: 'ledger', project: '', category: 'specs', doc: null },
    { view: 'ledger', project: 'alpha', category: 'unknown', doc: null },
    { view: 'ledger', project: 'alpha', category: 'specs', doc: '' },
  ];
  for (const state of invalidStates) {
    assert.throws(() => serializeLedgerUrl(state, 'https://viewer.test/'), /invalid Ledger state/);
  }
});

test('141859 CR6: history writes choose push or replace explicitly', () => {
  const calls = [];
  const history = {
    pushState: (...args) => calls.push(['push', ...args]),
    replaceState: (...args) => calls.push(['replace', ...args]),
  };
  const location = { href: 'https://viewer.test/' };
  const state = { view: 'ledger', project: 'alpha', category: 'specs', doc: null };

  assert.equal(writeLedgerRoute(state, { location, history, mode: 'push' }), true);
  assert.equal(writeLedgerRoute(state, { location, history, mode: 'replace' }), true);
  assert.deepEqual(calls, [
    ['push', null, '', '/?view=ledger&project=alpha&category=specs'],
    ['replace', null, '', '/?view=ledger&project=alpha&category=specs'],
  ]);
  assert.throws(
    () => writeLedgerRoute(state, { location, history, mode: 'automatic' }),
    /history mode must be push or replace/,
  );
});

test('141859 CR6: popstate-friendly reads inspect injected location without history writes', () => {
  const location = {
    href: 'https://viewer.test/?view=ledger&project=alpha&category=templates&doc=config.yml',
  };
  let writes = 0;
  const history = {
    pushState: () => {
      writes += 1;
    },
    replaceState: () => {
      writes += 1;
    },
  };

  assert.deepEqual(readLedgerRoute(location), {
    kind: 'valid',
    state: {
      view: 'ledger',
      project: 'alpha',
      category: 'templates',
      doc: 'config.yml',
    },
  });
  assert.equal(writes, 0);
  assert.ok(history);
});

test('141859 CR6/CR7: injectable navigation pushes canonical Ledger entries and clears them for other views', () => {
  const memory = memoryNavigation('https://viewer.test/?view=ledger&project=old&category=specs');
  const navigation = createLedgerNavigation(memory);

  navigation.push({ view: 'ledger', project: 'alpha', category: 'specs', doc: null });
  navigation.push({
    view: 'ledger',
    project: 'alpha',
    category: 'templates',
    doc: 'config.yml',
  });
  navigation.clear('push', 'board');

  assert.equal(memory.entries.length, 4);
  assert.equal(
    memory.entries[1].url,
    'https://viewer.test/?view=ledger&project=alpha&category=specs',
  );
  assert.equal(
    memory.entries[2].url,
    'https://viewer.test/?view=ledger&project=alpha&category=templates&doc=config.yml',
  );
  assert.equal(memory.entries[3].url, 'https://viewer.test/');
  assert.deepEqual(memory.entries[3].state, { view: 'board' });

  memory.history.back();
  assert.deepEqual(navigation.read(), {
    kind: 'valid',
    state: {
      view: 'ledger',
      project: 'alpha',
      category: 'templates',
      doc: 'config.yml',
    },
  });
  memory.history.back();
  assert.equal(navigation.read().state.doc, null);
  memory.history.forward();
  assert.equal(navigation.read().state.doc, 'config.yml');
  assert.equal(memory.entries.length, 4, 'reads and traversal never add entries');
});

test('141859 CR6: replace canonicalizes bootstrap without adding history', () => {
  const memory = memoryNavigation('https://viewer.test/?view=ledger&project=stale');
  const navigation = createLedgerNavigation(memory);
  navigation.replace({ view: 'ledger', project: 'stored', category: 'contract', doc: null });
  assert.equal(memory.entries.length, 1);
  assert.equal(
    memory.location.href,
    'https://viewer.test/?view=ledger&project=stored&category=contract',
  );
  navigation.clear('replace', 'table');
  assert.equal(memory.entries.length, 1);
  assert.equal(memory.location.href, 'https://viewer.test/');
  assert.deepEqual(memory.entries[0].state, { view: 'table' });
  assert.equal(serializeNonLedgerUrl('https://viewer.test/path?doc=stale#top'), '/path#top');
});
