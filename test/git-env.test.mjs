// 20260810-010554: the fixture-side companion to git.test.mjs's 124836 CR7
// identity sweep. Real incident: a fixture that runs
// `execFileSync` on the `git` binary without stripping the GIT_DIR git
// exports during this repo's own pre-commit hook inherits it and silently
// redirects the write past `cwd` into the SHARED real `.git` — this actually
// corrupted this repo's `.git` (`core.bare=true`, test identity in config) on
// 2026-08-10. A per-file review catches today's offenders; only a suite-wide
// static sweep, re-run on every test file forever, keeps the next new fixture
// from reintroducing the class silently. A counter inside the git-env helper
// itself could not do this — its only reader would be its own unit test, so a
// regressed call site elsewhere in test/** stayed green.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Extracts the full text of every `<name>(` call in `source`, balancing
// parentheses so a call spread over several lines is read whole. Mirrors
// git.test.mjs's own `callsTo`: duplicated rather than imported, since a test
// helper reaching into another suite's private function would couple two
// independent sweeps for no shared behavior.
function callsTo(source, name) {
  const calls = [];
  const opener = `${name}(`;
  for (let at = source.indexOf(opener); at !== -1; at = source.indexOf(opener, at + 1)) {
    let depth = 0;
    let end = at + opener.length - 1;
    for (; end < source.length; end += 1) {
      if (source[end] === '(') depth += 1;
      else if (source[end] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push({
      start: at,
      end,
      line: source.slice(0, at).split('\n').length,
      text: source.slice(at, end + 1),
    });
  }
  return calls;
}

// True when a call's options carry an `env:` that resolves — directly or
// through one level of variable indirection, declared anywhere in the same
// file — to a `sanitizedEnv(...)` call. Presence of *some* `env:` is not
// enough: a hand-rolled `{ ...process.env, X }` re-opens exactly the hole
// `sanitizedEnv` closes, so the value itself is inspected, not just its key.
function usesSanitizedEnv(callText, source) {
  const match = callText.match(/\benv:\s*([^,}][^,}]*)/);
  if (!match) return false;
  const value = match[1].trim();
  if (value.includes('sanitizedEnv(')) return true;
  // An object spread (`{ ...CLI_ENV, ...extra }`) or a bare identifier: every
  // identifier mentioned must be either irrelevant overlay or itself declared
  // as `= sanitizedEnv(...)` — one being sanitized is what makes the whole
  // merge safe, since sanitization only ever narrows environment vars, never
  // reintroduces a stripped one by spreading after it.
  const identifiers = [...value.matchAll(/[A-Za-z_$][\w$]*/g)].map((m) => m[0]);
  return identifiers.some((identifier) => {
    const declaration = source.match(
      new RegExp(`\\b(?:const|let|var)\\s+${identifier}\\s*=\\s*([^;]*);`),
    );
    return Boolean(declaration?.[1].trim().startsWith('sanitizedEnv('));
  });
}

function gitInvocationOffenders(dir) {
  const suites = fs
    .readdirSync(dir, { recursive: true })
    .filter((name) => String(name).endsWith('.test.mjs'));
  const offenders = [];
  for (const suite of suites) {
    const source = fs.readFileSync(path.join(dir, suite), 'utf8');
    for (const helper of ['execFileSync', 'execSync', 'spawnSync', 'spawn']) {
      const firstArgPattern = new RegExp(`^${helper}\\(\\s*['"]git['"]`);
      for (const call of callsTo(source, helper)) {
        // Only a literal `'git'`/`"git"` first argument is in scope: a
        // variable first argument (e.g. `execFileSync(bin, …)` spawning the
        // CLI itself) invokes git only indirectly, through src/git.mjs's own
        // production `sanitizedEnv`, which this sweep does not police.
        if (!firstArgPattern.test(call.text)) continue;
        if (usesSanitizedEnv(call.text, source)) continue;
        offenders.push(`${suite}:${call.line} git invocation without a sanitized environment`);
      }
    }
  }
  return offenders;
}

test('20260810-010554 CR: no test fixture invokes git without a sanitized environment', () => {
  const dir = fileURLToPath(new URL('.', import.meta.url));
  assert.deepEqual(gitInvocationOffenders(dir), []);
});

// Proves the sweep itself is falsifiable: a fixture-shaped source string that
// really does invoke git with the raw, unstripped `process.env` must be
// caught, not waved through by some accidental leniency in the pattern above.
test('20260810-010554 CR: the sweep itself catches a literal unsanitized invocation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-git-env-sweep-'));
  try {
    // Assembled at runtime, never written as a contiguous literal in this
    // file's own source: this suite is itself swept by the same regex, and a
    // literal fixture string here would flag this very file as an offender.
    const offenderSource = ['execFileSync(', "'git'", ", ['init', '-q'], { cwd: root });\n"].join(
      '',
    );
    fs.writeFileSync(path.join(dir, 'offender.test.mjs'), offenderSource);
    assert.deepEqual(gitInvocationOffenders(dir), [
      'offender.test.mjs:1 git invocation without a sanitized environment',
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
