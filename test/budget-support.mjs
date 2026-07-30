import assert from 'node:assert/strict';
import fs from 'node:fs';
import { countTokens } from 'gpt-tokenizer/encoding/o200k_base';
import { emittedLines } from '../src/commands/context.mjs';

// Context budgets: one threshold per dimension, shared by every suite that
// measures a composed context. Loaded from the contract so a test can never
// drift from the declared budget.
export const contextBudgets = JSON.parse(
  fs.readFileSync(new URL('../templates/contract/budgets.yml', import.meta.url), 'utf8'),
);

// The unit is "tokens according to a pinned reference tokenizer", not the tokens a
// particular model consumes: counting through a model's API is network, neither
// deterministic nor free, and unusable in a gate. A local BPE is deterministic and
// free at the price of being an approximation, so the reference is named — the
// package at an exact version, and the encoding in the import path itself — and a
// BPE update cannot silently move ten ceilings.
export const TOKENIZER_PACKAGE = 'gpt-tokenizer';

export function tokenCount(text) {
  return countTokens(text);
}

// Re-exported so every suite that imports `emittedLines` from this module
// keeps resolving, but the counter itself has a single home:
// `src/commands/context.mjs`, whose BEGIN line publishes it.
export { emittedLines };

// A budget entry declares `tokens` and `lines`, and both are ceilings that fail —
// there is no target band and no warning. A warning is exactly how core drifted
// past its own target with no gate ever saying so, and a second number that can
// never fire is false precision.
//
// The two dimensions do different jobs, so neither is redundant: tokens are the
// cost actually paid on every message, lines are the transport bound the
// bootstrap's `head` has to cover.
//
// A ceiling is never a goal, and having margin is no licence to spend it. Nothing
// in a contract fragment may be removed to fit a ceiling: a rule leaves the
// contract only when its new home is named and a grep of the obligation itself —
// not of similar words — finds it there. Measuring `output` whole is deliberate:
// the BEGIN and END delimiters cost tokens and lines like any other content, so
// both dimensions count them.
export function assertWithinBudget(label, output, budget) {
  const lines = emittedLines(output);
  const tokens = tokenCount(output);
  assert.ok(lines <= budget.lines, `${label} exceeds ${budget.lines} lines: ${lines}`);
  assert.ok(tokens <= budget.tokens, `${label} exceeds ${budget.tokens} tokens: ${tokens}`);
}

// Synthetic output in the budget convention: `lines` newlines (so the text ends
// with one and reports `lines` emitted lines) preceded by `filler` characters of
// content. The token occupancy of the result is measured, never derived from
// `filler`: BPE merges make a character count a poor proxy for a token count.
export function sizedOutput(lines, filler = 0) {
  return `${'x'.repeat(filler)}${'\n'.repeat(lines)}`;
}
