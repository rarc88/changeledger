import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildContext } from '../src/commands/context.mjs';
import { init } from '../src/commands/init.mjs';
import { runSearch, search } from '../src/commands/search.mjs';
import { loadRepo } from '../src/repo.mjs';
import { buildCorpus, normalize, searchDocuments } from '../src/search.mjs';

process.env.CHANGELEDGER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-search-home-'));

function change({ id, title, type, status, body }) {
  return `---
id: "${id}"
title: ${title}
type: ${type}
status: ${status}
created: 2026-01-01T00:00:00Z
depends_on: []
---

${body}
`;
}

// A repo with a deliberately mixed corpus: a title hit, a body-only hit, a
// bug/done hit and a bug/approved hit (for the type+status filter), plus one
// spec — everything CR1-CR3 need in a single fixture.
function repoWithFixtures() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-search-repo-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  init(root);
  const changesDir = path.join(root, '.changeledger', 'changes');
  const specsDir = path.join(root, '.changeledger', 'specs');
  fs.mkdirSync(specsDir, { recursive: true });

  // Title hit: "wallet" in the title, bug/done (matches CR1 and the CR2 filter).
  fs.writeFileSync(
    path.join(changesDir, '20260101-000001-wallet-rounding.md'),
    change({
      id: '20260101-000001',
      title: 'Wallet balance rounding',
      type: 'bug',
      status: 'done',
      body: `## Request

Balances look wrong after a purchase.

## Investigation

Root cause unrelated to the term.

## Specification

### CR1 — Round half up
- **Given** a fractional balance
- **When** it is displayed
- **Then** it rounds half up

## Plan

- [ ] fix it (CR1)

## Log

- 2026-01-01T00:00:00Z — created`,
    }),
  );

  // Body-only hit: "wallet" appears once in the body, not the title, feature/approved.
  fs.writeFileSync(
    path.join(changesDir, '20260101-000002-ledger-export.md'),
    change({
      id: '20260101-000002',
      title: 'Ledger export tool',
      type: 'feature',
      status: 'approved',
      body: `## Request

We need an export tool. It also touches the wallet balance display.

## Investigation

n/a

## Proposal

n/a

## Specification

### CR1 — Export
- **Given** a ledger
- **When** exported
- **Then** it produces a file

## Plan

- [ ] build it (CR1)

## Log

- 2026-01-01T00:00:00Z — created`,
    }),
  );

  // Same term in the title but wrong type+status for the CR2 filter (right type, wrong status).
  fs.writeFileSync(
    path.join(changesDir, '20260101-000003-wallet-icon.md'),
    change({
      id: '20260101-000003',
      title: 'Wallet icon polish',
      type: 'bug',
      status: 'approved',
      body: `## Request

Polish the wallet icon.

## Investigation

n/a

## Specification

### CR1 — Icon
- **Given** g
- **When** w
- **Then** t

## Plan

- [ ] polish (CR1)

## Log

- 2026-01-01T00:00:00Z — created`,
    }),
  );

  fs.writeFileSync(
    path.join(specsDir, 'wallet-notes.md'),
    `---
title: Wallet notes
updated: 2026-01-01T00:00:00Z
tags: []
---

## Balance

Persistent truth about the wallet balance rules.
`,
  );

  return root;
}

test('normalize lowercases and strips accents', () => {
  assert.equal(normalize('Búsqueda ÑOÑO'), 'busqueda nono');
});

test('CR1 — title boost ranks a title hit above a body-only hit, both returned', () => {
  const root = repoWithFixtures();
  const hits = search('wallet', {}, root);
  const refs = hits.map((h) => h.ref);
  assert.ok(refs.includes('#20260101-000001'));
  assert.ok(refs.includes('#20260101-000002'));
  const titleHitIndex = refs.indexOf('#20260101-000001');
  const bodyHitIndex = refs.indexOf('#20260101-000002');
  assert.ok(titleHitIndex < bodyHitIndex, 'title hit must rank before the body-only hit');

  const titleHit = hits[titleHitIndex];
  assert.equal(titleHit.status, 'done');
  assert.equal(titleHit.type, 'bug');
  assert.equal(titleHit.title, 'Wallet balance rounding');
  assert.match(titleHit.snippet, /wallet/i);
});

test('CR2 — --type and --status narrow to a single change', () => {
  const root = repoWithFixtures();
  const hits = search('wallet', { type: 'bug', status: 'done' }, root);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].ref, '#20260101-000001');
  assert.equal(hits[0].type, 'bug');
  assert.equal(hits[0].status, 'done');
});

test('CR3 — specs are included and identified as spec:<slug>', () => {
  const root = repoWithFixtures();
  const hits = search('wallet', {}, root);
  const specHit = hits.find((h) => h.ref === 'spec:wallet-notes');
  assert.ok(specHit, 'expected a spec:wallet-notes hit');
  assert.equal(specHit.title, 'Wallet notes');
});

test('CR4 — --json prints a parseable, order-preserving array', () => {
  const root = repoWithFixtures();
  const hits = search('wallet', {}, root);

  const logs = [];
  const originalLog = console.log;
  console.log = (msg) => logs.push(msg);
  try {
    runSearch(['wallet'], { json: true }, root);
  } finally {
    console.log = originalLog;
  }

  const parsed = JSON.parse(logs.join('\n'));
  assert.equal(parsed.length, hits.length);
  assert.deepEqual(
    parsed.map((p) => p.ref),
    hits.map((h) => h.ref),
  );
  for (const p of parsed) {
    assert.ok('ref' in p && 'title' in p && 'score' in p && 'snippet' in p);
  }
});

test('CR5 — no matches prints "no matches" and does not throw', () => {
  const root = repoWithFixtures();
  const logs = [];
  const originalLog = console.log;
  console.log = (msg) => logs.push(msg);
  try {
    runSearch(['zzzz'], {}, root);
  } finally {
    console.log = originalLog;
  }
  assert.match(logs[0], /^Project: .+ \(repo: .+\)$/);
  assert.deepEqual(logs.slice(1), ['no matches']);
});

test('CR6 — the same query run twice yields byte-identical output', () => {
  const root = repoWithFixtures();
  const run = () => {
    const logs = [];
    const originalLog = console.log;
    console.log = (msg) => logs.push(msg);
    try {
      runSearch(['wallet'], { json: true }, root);
    } finally {
      console.log = originalLog;
    }
    return logs.join('\n');
  };
  assert.equal(run(), run());
});

test('CR6 — searchDocuments breaks score ties by ref descending', () => {
  const docs = [
    {
      ref: '#1',
      kind: 'change',
      title: 'x',
      status: 'done',
      type: 'bug',
      headings: '',
      body: 'echo',
    },
    {
      ref: '#2',
      kind: 'change',
      title: 'x',
      status: 'done',
      type: 'bug',
      headings: '',
      body: 'echo',
    },
  ];
  const hits = searchDocuments(docs, 'echo');
  assert.deepEqual(
    hits.map((h) => h.ref),
    ['#2', '#1'],
  );
});

test('on an equal score, a spec sorts before a change (specs are current truth)', () => {
  const docs = [
    {
      ref: '#1',
      kind: 'change',
      title: 'x',
      status: 'done',
      type: 'bug',
      headings: '',
      body: 'echo',
    },
    {
      ref: 'spec:echo-notes',
      kind: 'spec',
      title: 'x',
      status: undefined,
      type: undefined,
      headings: '',
      body: 'echo',
    },
  ];
  const hits = searchDocuments(docs, 'echo');
  assert.deepEqual(
    hits.map((h) => h.ref),
    ['spec:echo-notes', '#1'],
  );
});

test('among tied specs, the existing ref-descending tie-break still applies', () => {
  const docs = [
    {
      ref: 'spec:a',
      kind: 'spec',
      title: 'x',
      status: undefined,
      type: undefined,
      headings: '',
      body: 'echo',
    },
    {
      ref: 'spec:b',
      kind: 'spec',
      title: 'x',
      status: undefined,
      type: undefined,
      headings: '',
      body: 'echo',
    },
  ];
  const hits = searchDocuments(docs, 'echo');
  assert.deepEqual(
    hits.map((h) => h.ref),
    ['spec:b', 'spec:a'],
  );
});

test('CR7 — the spec context mandates changeledger search before Investigation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-search-ctx-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  init(root);
  const out = buildContext('spec', root);
  assert.match(out, /changeledger search/);
  assert.match(out, /before writing Investigation/i);
});

test('buildCorpus reduces changes and specs to scorable documents', () => {
  const root = repoWithFixtures();
  const { changes, specs } = loadRepo(root);
  const corpus = buildCorpus({ changes, specs });
  assert.ok(corpus.some((d) => d.ref === '#20260101-000001'));
  assert.ok(corpus.some((d) => d.ref === 'spec:wallet-notes'));
});

test('a non-numeric --limit fails fast instead of silently returning no matches', () => {
  const root = repoWithFixtures();
  assert.throws(() => runSearch(['wallet'], { limit: 'abc' }, root), /--limit/);
});

test('a --limit below 1 fails fast', () => {
  const root = repoWithFixtures();
  assert.throws(() => runSearch(['wallet'], { limit: '0' }, root), /--limit/);
  assert.throws(() => runSearch(['wallet'], { limit: '-1' }, root), /--limit/);
});

test('a fractional --limit fails fast', () => {
  const root = repoWithFixtures();
  assert.throws(() => runSearch(['wallet'], { limit: '1.5' }, root), /--limit/);
});

test('a valid --limit still narrows the results as before', () => {
  const root = repoWithFixtures();
  const logs = [];
  const originalLog = console.log;
  console.log = (msg) => logs.push(msg);
  try {
    runSearch(['wallet'], { limit: '1', json: true }, root);
  } finally {
    console.log = originalLog;
  }
  const parsed = JSON.parse(logs.join('\n'));
  assert.equal(parsed.length, 1);
});
