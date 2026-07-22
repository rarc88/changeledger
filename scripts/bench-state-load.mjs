#!/usr/bin/env node
// Reproducible benchmark for change 20260722-202059: compares the per-file
// `git show` read pattern this change removes against the single
// `ls-tree` + `cat-file --batch` pattern in src/git-batch.mjs, at synthetic
// volumes matching the audit's measured scale (250/1000/5000 documents).
//
// Usage: node scripts/bench-state-load.mjs [--sizes 250,1000,5000] [--reps 5]

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { batchBlobReader, treeEntries } from '../src/git-batch.mjs';

function run(args, cwd, { encoding = 'utf8', input } = {}) {
  return execFileSync('git', args, { cwd, encoding, input, stdio: ['pipe', 'pipe', 'ignore'] });
}

function buildRepo(size) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-bench-'));
  run(['init', '--quiet'], dir);
  run(['config', 'user.name', 'bench'], dir);
  run(['config', 'user.email', 'bench@local'], dir);
  const changesDir = path.join(dir, 'changes');
  fs.mkdirSync(changesDir);
  for (let i = 0; i < size; i++) {
    const id = String(i).padStart(6, '0');
    fs.writeFileSync(
      path.join(changesDir, `${id}-change.md`),
      `---\nid: "20260722-${id}"\ntitle: Synthetic change ${i}\ntype: feature\nstatus: draft\n---\n\n## Request\n\nSynthetic content for benchmark document ${i}.\n`,
    );
  }
  run(['add', '.'], dir);
  run(['commit', '--quiet', '-m', 'seed'], dir);
  const commit = run(['rev-parse', 'HEAD'], dir).trim();
  return { dir, commit };
}

function percentile(sorted, p) {
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

function timeOnce(fn) {
  const start = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - start) / 1e6;
}

function perFileGitShow(dir, commit, files) {
  for (const file of files) {
    run(['show', `${commit}:${file}`], dir);
  }
}

function batchRead(dir, commit) {
  const entries = treeEntries(dir, commit, run);
  const readBlob = batchBlobReader(dir, entries, run);
  for (const entry of entries) readBlob(entry.oid);
}

function bench(dir, commit, files, reps, fn) {
  const samples = [];
  for (let i = 0; i < reps; i++) samples.push(timeOnce(() => fn(dir, commit, files)));
  samples.sort((a, b) => a - b);
  return {
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
  };
}

function main() {
  const args = process.argv.slice(2);
  const sizesArg = args.includes('--sizes') ? args[args.indexOf('--sizes') + 1] : '250,1000,5000';
  const repsArg = args.includes('--reps') ? Number(args[args.indexOf('--reps') + 1]) : 5;
  const sizes = sizesArg.split(',').map(Number);

  console.log('size\told_p50_ms\told_p95_ms\tbatch_p50_ms\tbatch_p95_ms\tspeedup_p50');
  for (const size of sizes) {
    const { dir, commit } = buildRepo(size);
    try {
      const files = fs.readdirSync(path.join(dir, 'changes')).map((name) => `changes/${name}`);
      const oldReps = size >= 1000 ? Math.max(1, Math.min(3, repsArg)) : repsArg;
      const oldResult = bench(dir, commit, files, oldReps, perFileGitShow);
      const batchResult = bench(dir, commit, files, repsArg, batchRead);
      console.log(
        [
          size,
          oldResult.p50.toFixed(1),
          oldResult.p95.toFixed(1),
          batchResult.p50.toFixed(1),
          batchResult.p95.toFixed(1),
          `${(oldResult.p50 / batchResult.p50).toFixed(1)}x`,
        ].join('\t'),
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

main();
