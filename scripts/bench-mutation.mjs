#!/usr/bin/env node
// Reproducible benchmark for change 20260722-202100: times a real
// store.mutate() call through the production ledger-store API and counts how
// many full batch materializations (`git cat-file --batch`) it performs, at
// synthetic volumes matching the audit's measured scale (250/1000/5000).
//
// Usage: node scripts/bench-mutation.mjs [--sizes 250,1000,5000]

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultRun } from '../src/git.mjs';
import { loadLedgerStore } from '../src/ledger-store.mjs';
import { changeText, createStateRepo, stateConfig } from '../test/helpers/state-repo.mjs';

function countingRun() {
  const spy = { batchReads: 0 };
  const run = (args, cwd, options) => {
    if (args[0] === 'cat-file' && args[1] === '--batch') spy.batchReads++;
    return defaultRun(args, cwd, options);
  };
  return { run, spy };
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function buildFixture(size) {
  const changes = Array.from({ length: size }, (_, i) =>
    changeText({ id: `20260721-${String(i).padStart(6, '0')}`, title: `Synthetic ${i}` }),
  );
  return createStateRepo({ configText: stateConfig(), changes });
}

function convertToV2(root, baseline) {
  fs.writeFileSync(
    path.join(root, '.changeledger', 'authority.yml'),
    `format_version: 2\nstate_ref: refs/heads/changeledger/state\nbaseline: ${baseline}\nproject_id: project-1\ninventory_digest: ${'a'.repeat(64)}\nminimum_client_version: 0.13.0\n`,
  );
  git(root, ['add', '.changeledger/authority.yml']);
  git(root, ['commit', '-qm', 'chore: v2 authority']);
  git(root, ['update-ref', 'refs/changeledger/confirmed', baseline]);
}

function addRemote(root) {
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-bench-remote-'));
  git(remote, ['init', '--bare', '-q']);
  git(root, ['remote', 'add', 'origin', remote]);
  git(root, ['push', '-q', 'origin', 'refs/heads/changeledger/state']);
  return remote;
}

const SCENARIOS = {
  v1: () => {},
  'v2-offline': (root, baseline) => convertToV2(root, baseline),
  'v2-online': (root, baseline) => {
    convertToV2(root, baseline);
    addRemote(root);
  },
};

function main() {
  const args = process.argv.slice(2);
  const sizesArg = args.includes('--sizes') ? args[args.indexOf('--sizes') + 1] : '250,1000,5000';
  const sizes = sizesArg.split(',').map(Number);

  console.log('scenario\tsize\tmutation_ms\tbatch_materializations');
  for (const size of sizes) {
    for (const [name, setup] of Object.entries(SCENARIOS)) {
      const { root, baseline } = buildFixture(size);
      try {
        setup(root, baseline);
        const options = name === 'v2-offline' ? { offline: true } : undefined;
        const { run, spy } = countingRun();
        const store = loadLedgerStore(root, { run });
        const before = store.load();
        spy.batchReads = 0;
        const start = process.hrtime.bigint();
        store.mutate(
          { message: 'bench: mutation', expectedRevision: before.revision, ...options },
          ({ snapshot, write }) => {
            write(
              snapshot.changes[0].statePath,
              snapshot.changes[0].text.replace('Synthetic 0', 'Synthetic 0 (mutated)'),
            );
          },
        );
        const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
        console.log([name, size, elapsedMs.toFixed(1), spy.batchReads].join('\t'));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
}

main();
