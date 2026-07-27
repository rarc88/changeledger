import assert from 'node:assert/strict';
import fs from 'node:fs';

// Context budgets: one threshold per dimension, shared by every suite that
// measures a composed context. Loaded from the contract so a test can never
// drift from the declared budget.
export const contextBudgets = JSON.parse(
  fs.readFileSync(new URL('../templates/contract/budgets.yml', import.meta.url), 'utf8'),
);

// Emitted lines: what `wc -l` reports for the CLI stdout and what `head -<N>`
// must be given. A composed context ends with a single trailing newline, so its
// last split segment is empty and does not count; a text without that newline
// still ends in a real line.
export function emittedLines(text) {
  const segments = text.split('\n');
  return segments[segments.length - 1] === '' ? segments.length - 1 : segments.length;
}

// A budget entry declares `lines` and `bytes`, and both are ceilings that fail —
// there is no target band and no warning. A warning is exactly how core drifted
// past its own target with no gate ever saying so, and a second number that can
// never fire is false precision.
//
// A ceiling is never a goal. Nothing in a contract fragment may be removed to
// fit one: a rule leaves the contract only when its new home is named and a grep
// of the obligation itself — not of similar words — finds it there. Measuring
// `output` whole is deliberate: the BEGIN and END delimiters cost lines and
// bytes like any other content, so both dimensions count them.
export function assertWithinBudget(label, output, budget) {
  const lines = emittedLines(output);
  const bytes = Buffer.byteLength(output, 'utf8');
  assert.ok(lines <= budget.lines, `${label} exceeds ${budget.lines} lines: ${lines}`);
  assert.ok(bytes <= budget.bytes, `${label} exceeds ${budget.bytes} bytes: ${bytes}`);
}

// Synthetic output of an exact size in the budget convention: `lines` newlines
// (so the text ends with one and reports `lines` emitted lines) plus filler up
// to `bytes`.
export function sizedOutput(lines, bytes) {
  assert.ok(bytes >= lines, `cannot fit ${lines} lines in ${bytes} bytes`);
  return `${'x'.repeat(bytes - lines)}${'\n'.repeat(lines)}`;
}
