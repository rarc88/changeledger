// `changeledger search` — deterministic lexical discovery over changes
// (including archived) and specs. See change 20260711-103758.

import { loadRepo } from '../repo.mjs';
import { buildCorpus, searchDocuments } from '../search.mjs';

// Runs the search against the repo at `cwd` and returns ranked hits. Pure
// query, no mutation.
export function search(query, { limit, type, status } = {}, cwd = process.cwd()) {
  const { changes, specs } = loadRepo(cwd);
  const corpus = buildCorpus({ changes, specs });
  return searchDocuments(corpus, query, { limit, type, status });
}

function formatLabel(hit) {
  return hit.kind === 'spec' ? hit.ref : `${hit.ref} ${hit.status} ${hit.type}`;
}

// CLI entry point: prints text or `--json`, and `no matches` when nothing scores.
export function runSearch(queryParts, options = {}, cwd = process.cwd()) {
  const query = queryParts.join(' ').trim();
  const limit = options.limit !== undefined ? Number(options.limit) : undefined;
  const hits = search(query, { limit, type: options.type, status: options.status }, cwd);

  if (options.json) {
    console.log(
      JSON.stringify(
        hits.map(({ ref, title, score, snippet }) => ({ ref, title, score, snippet })),
        null,
        2,
      ),
    );
    return;
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
