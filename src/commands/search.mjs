// `changeledger search` — deterministic lexical discovery over changes
// (including archived) and specs. See change 20260711-103758.

import { loadRepo } from '../repo.mjs';
import { buildCorpus, searchDocuments } from '../search.mjs';

// Runs the search against the repo at `cwd` and returns ranked hits. Pure
// query, no mutation.
export function search(query, { limit, type, status } = {}, cwd = process.cwd()) {
  const repo = loadRepo(cwd);
  const corpus = buildCorpus(repo);
  const hits = searchDocuments(corpus, query, { limit, type, status });
  Object.defineProperties(hits, {
    ledgerRevision: { value: repo.revision ?? null },
    ledgerFreshness: { value: repo.revision ? 'local' : null },
  });
  return hits;
}

function formatLabel(hit) {
  return hit.kind === 'spec' ? hit.ref : `${hit.ref} ${hit.status} ${hit.type}`;
}

// A non-numeric or <1 `--limit` used to degrade silently to "no matches"
// (see change 20260711-160443); fail fast with a clear error instead.
function parseLimit(limitStr) {
  if (limitStr === undefined) return undefined;
  const n = Number(limitStr);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`--limit must be a whole number >= 1, got "${limitStr}"`);
  }
  return n;
}

// CLI entry point: prints text or `--json`, and `no matches` when nothing scores.
export function runSearch(queryParts, options = {}, cwd = process.cwd()) {
  const query = queryParts.join(' ').trim();
  const limit = parseLimit(options.limit);
  const hits = search(query, { limit, type: options.type, status: options.status }, cwd);

  if (options.json) {
    const formatted = hits.map(({ ref, title, score, snippet }) => ({
      ref,
      title,
      score,
      snippet,
    }));
    console.log(
      JSON.stringify(
        hits.ledgerRevision
          ? {
              ledger_revision: hits.ledgerRevision,
              ledger_freshness: hits.ledgerFreshness,
              hits: formatted,
            }
          : formatted,
        null,
        2,
      ),
    );
    return;
  }

  if (hits.ledgerRevision) {
    console.log(`Ledger revision: ${hits.ledgerRevision} (freshness: ${hits.ledgerFreshness})`);
  }

  if (!hits.length) {
    console.log('no matches');
    return;
  }

  for (const hit of hits) {
    console.log(`${formatLabel(hit)} — ${hit.title}`);
    console.log(`  ${hit.snippet}`);
  }
}
