// `changeledger search` — deterministic lexical discovery over changes
// (including archived) and specs. See change 20260711-103758.

import { formatLedgerReceipt, repoProvenance } from '../ledger-store.mjs';
import { loadRepo } from '../repo.mjs';
import { buildCorpus, searchDocuments } from '../search.mjs';

// Runs the search against the repo at `cwd` and returns ranked hits. Pure
// query, no mutation.
export function search(query, { limit, type, status } = {}, cwd = process.cwd()) {
  const repo = loadRepo(cwd);
  const corpus = buildCorpus(repo);
  const hits = searchDocuments(corpus, query, { limit, type, status });
  const provenance = repoProvenance(cwd);
  Object.defineProperties(hits, {
    ledgerRevision: { value: repo.revision ?? null },
    ledgerFreshness: { value: repo.revision ? (repo.ledgerFreshness ?? 'local') : null },
    ledgerConfirmation: { value: repo.revision ? (repo.ledgerConfirmation ?? 'local') : null },
    ledgerObservedAt: { value: repo.revision ? (repo.ledgerObservedAt ?? null) : null },
    projectId: { value: provenance.project_id },
    repositoryPath: { value: provenance.repository_path },
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
              project_id: hits.projectId,
              repository_path: hits.repositoryPath,
              ledger_revision: hits.ledgerRevision,
              ledger_freshness: hits.ledgerFreshness,
              ledger_confirmation: hits.ledgerConfirmation,
              ledger_observed_at: hits.ledgerObservedAt,
              hits: formatted,
            }
          : formatted,
        null,
        2,
      ),
    );
    return;
  }

  console.log(`Project: ${hits.projectId ?? 'unknown'} (repo: ${hits.repositoryPath})`);
  if (hits.ledgerRevision) {
    console.log(
      formatLedgerReceipt({
        ledger_revision: hits.ledgerRevision,
        ledger_freshness: hits.ledgerFreshness,
        ledger_confirmation: hits.ledgerConfirmation,
        ledger_observed_at: hits.ledgerObservedAt,
      }),
    );
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
