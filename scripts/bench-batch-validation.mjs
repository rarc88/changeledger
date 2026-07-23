#!/usr/bin/env node
// Reproducible benchmark for change 20260722-203027: times validateStateUpdate
// over a pre-receive-style multi-commit batch, at the matrix the CR requires
// (1/50/256 commits x 1000/5000 changes x 1/3 changed docs per commit).
// Target: p95 < 30_000ms for 256 commits over 5000 changes.
//
// Usage: node scripts/bench-batch-validation.mjs [--commits 1,50,256]
//   [--sizes 1000,5000] [--docs 1,3] [--reps 3]

import fs from 'node:fs';
import path from 'node:path';
import { STATE_REF } from '../src/ledger-store.mjs';
import { validateStateUpdate } from '../src/state-validation.mjs';
import { changeText, createStateRepo, git, stateConfig } from '../test/helpers/state-repo.mjs';

const INTEGRATION_REF = 'refs/heads/dev';
const ROOMY = { max_commits: 300, max_object_bytes: 256 * 1024 * 1024, timeout_ms: 120_000 };

function buildFixture(size) {
  const changes = Array.from({ length: size }, (_, i) =>
    changeText({ id: `20260721-${String(i).padStart(6, '0')}`, title: `Synthetic ${i}` }),
  );
  const configText = stateConfig().replace(
    'statuses:',
    'git:\n  integration_branch: dev\nstatuses:',
  );
  const created = createStateRepo({ configText, changes });
  const authority = path.join(created.root, '.changeledger', 'authority.yml');
  fs.writeFileSync(
    authority,
    `format_version: 2\nstate_ref: ${STATE_REF}\nbaseline: ${created.baseline}\nproject_id: project-1\ninventory_digest: ${'a'.repeat(64)}\nminimum_client_version: 0.13.0\n`,
  );
  git(created.root, ['add', authority]);
  git(created.root, ['commit', '-qm', 'test: activate v2']);
  return created;
}

function buildChain(created, commits, docsPerCommit) {
  git(created.root, ['checkout', '-q', 'changeledger/state']);
  let head = created.baseline;
  for (let c = 0; c < commits; c++) {
    for (let d = 0; d < docsPerCommit; d++) {
      const index = (c * docsPerCommit + d) % 1000;
      const id = `20260721-${String(index).padStart(6, '0')}`;
      const file = path.join(created.state, 'changes', `${id}-change.md`);
      if (!fs.existsSync(file)) continue;
      fs.writeFileSync(
        file,
        fs.readFileSync(file, 'utf8').replace(/title: .*/, `title: Synthetic ${index} (rev ${c})`),
      );
    }
    git(created.root, ['add', '.changeledger-state']);
    git(created.root, ['commit', '-qm', `bench: commit ${c}`]);
    head = git(created.root, ['rev-parse', 'HEAD']);
  }
  git(created.root, ['checkout', '-q', 'dev']);
  return head;
}

function percentile(sorted, p) {
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

function main() {
  const args = process.argv.slice(2);
  const arg = (name, fallback) =>
    args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback;
  const commitCounts = arg('commits', '1,50,256').split(',').map(Number);
  const sizes = arg('sizes', '1000,5000').split(',').map(Number);
  const docCounts = arg('docs', '1,3').split(',').map(Number);
  const reps = Number(arg('reps', '3'));

  console.log('size\tcommits\tdocs_per_commit\tp50_ms\tp95_ms');
  for (const size of sizes) {
    for (const commits of commitCounts) {
      for (const docsPerCommit of docCounts) {
        const created = buildFixture(size);
        try {
          const head = buildChain(created, commits, docsPerCommit);
          const samples = [];
          for (let i = 0; i < reps; i++) {
            git(created.root, ['update-ref', STATE_REF, created.baseline]);
            const start = process.hrtime.bigint();
            validateStateUpdate({
              repoRoot: created.root,
              oldOid: created.baseline,
              newOid: head,
              ref: STATE_REF,
              stateRef: STATE_REF,
              integrationRef: INTEGRATION_REF,
              limits: ROOMY,
            });
            samples.push(Number(process.hrtime.bigint() - start) / 1e6);
          }
          samples.sort((a, b) => a - b);
          console.log(
            [
              size,
              commits,
              docsPerCommit,
              percentile(samples, 50).toFixed(1),
              percentile(samples, 95).toFixed(1),
            ].join('\t'),
          );
        } finally {
          fs.rmSync(created.root, { recursive: true, force: true });
        }
      }
    }
  }
}

main();
