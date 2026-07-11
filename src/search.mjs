// Deterministic lexical search over changes and specs. No embeddings, no
// network — a fixed-boost term-frequency score (title x3, headings/CR x2,
// body x1) with a stable tie-break, so repeated runs are byte-for-byte
// identical. See change 20260711-103758.

const ACCENTS = /[̀-ͯ]/g;
const CR_HEADING = /^###\s+CR\d+.*$/gm;
const MARKDOWN_HEADING = /^#{1,6}\s+(.+)$/gm;

// Lowercase + strip diacritics so "búsqueda" and "busqueda" match the same term.
export function normalize(text) {
  return (text ?? '').normalize('NFD').replace(ACCENTS, '').toLowerCase();
}

function tokenize(query) {
  return normalize(query)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function countOccurrences(haystackNormalized, term) {
  if (!term) return 0;
  let count = 0;
  let idx = 0;
  for (;;) {
    const found = haystackNormalized.indexOf(term, idx);
    if (found === -1) break;
    count++;
    idx = found + term.length;
  }
  return count;
}

// Locates the first case/accent-insensitive occurrence of `term` in `rawText`
// and returns a short surrounding snippet, or null when there is no match.
function findSnippet(rawText, term, span = 40) {
  const normalized = normalize(rawText);
  const idx = normalized.indexOf(term);
  if (idx === -1) return null;
  const start = Math.max(0, idx - span);
  const end = Math.min(rawText.length, idx + term.length + span);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < rawText.length ? '…' : '';
  return `${prefix}${rawText.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}

// Splits a change's stages into a heading/CR bucket (boost x2) and a body
// bucket (boost x1). CR heading lines are lifted out of the body so they are
// scored once, at the heading boost, not twice.
function changeHeadingsAndBody(stages) {
  const headings = [];
  const bodyParts = [];
  for (const stage of stages) {
    headings.push(stage.heading);
    const crHeadings = stage.body.match(CR_HEADING) ?? [];
    headings.push(...crHeadings);
    bodyParts.push(stage.body.replace(CR_HEADING, ''));
  }
  return { headings: headings.join('\n'), body: bodyParts.join('\n\n') };
}

// Same split for a spec's free-form body: its own `#`..`######` headings
// (boost x2) versus the remaining prose (boost x1).
function specHeadingsAndBody(body) {
  const headings = [...body.matchAll(MARKDOWN_HEADING)].map((m) => m[1]);
  const stripped = body.replace(MARKDOWN_HEADING, '');
  return { headings: headings.join('\n'), body: stripped };
}

// Builds the searchable corpus from a loaded repo (see repo.mjs `loadRepo`):
// every change — including archived ones — and every spec, reduced to the
// fields the scorer needs.
export function buildCorpus({ changes, specs }) {
  const fromChanges = changes.map((c) => {
    const { headings, body } = changeHeadingsAndBody(c.stages);
    return {
      ref: `#${c.frontmatter.id}`,
      kind: 'change',
      title: c.frontmatter.title ?? '',
      status: c.frontmatter.status ?? null,
      type: c.frontmatter.type ?? null,
      headings,
      body,
    };
  });

  const fromSpecs = specs.map((s) => {
    const slug = s.name.replace(/\.md$/, '');
    const { headings, body } = specHeadingsAndBody(s.body);
    return {
      ref: `spec:${slug}`,
      kind: 'spec',
      title: s.frontmatter.title ?? slug,
      status: null,
      type: null,
      headings,
      body,
    };
  });

  return [...fromChanges, ...fromSpecs];
}

function scoreDocument(doc, terms) {
  const titleN = normalize(doc.title);
  const headingsN = normalize(doc.headings);
  const bodyN = normalize(doc.body);
  let score = 0;
  for (const term of terms) {
    score += countOccurrences(titleN, term) * 3;
    score += countOccurrences(headingsN, term) * 2;
    score += countOccurrences(bodyN, term) * 1;
  }
  return score;
}

function buildSnippet(doc, terms) {
  for (const field of [doc.title, doc.headings, doc.body]) {
    for (const term of terms) {
      const snippet = findSnippet(field, term);
      if (snippet) return snippet;
    }
  }
  return '';
}

// Scores and ranks `docs` (as produced by `buildCorpus`) against `query`.
// On an equal score, a spec sorts before a change — specs are the current
// persistent truth, so that's what an agent should read first. Among equals
// of the same kind, ties break by `ref` descending so the same repo state
// always yields the same byte-for-byte output.
export function searchDocuments(docs, query, { limit = 10, type, status } = {}) {
  const terms = tokenize(query);
  if (!terms.length) return [];

  const hits = [];
  for (const doc of docs) {
    if (type && doc.type !== type) continue;
    if (status && doc.status !== status) continue;
    const score = scoreDocument(doc, terms);
    if (score <= 0) continue;
    hits.push({
      ref: doc.ref,
      kind: doc.kind,
      title: doc.title,
      type: doc.type,
      status: doc.status,
      score,
      snippet: buildSnippet(doc, terms),
    });
  }

  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.kind !== b.kind) return a.kind === 'spec' ? -1 : 1;
    if (a.ref === b.ref) return 0;
    return a.ref < b.ref ? 1 : -1;
  });

  return hits.slice(0, limit);
}
