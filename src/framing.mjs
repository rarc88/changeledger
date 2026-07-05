import fs from 'node:fs';
import path from 'node:path';
import { packageRoot } from './paths.mjs';

// Single source of the installed version and the anti-truncation sentinels, so
// `context` and `agent-prompt` frame their output identically and never diverge
// through independent copies.
export const VERSION = JSON.parse(
  fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
).version;

const TRUNCATION_SUFFIX = 'if this line is missing, the output was truncated: stop and re-run';

// `kind` names the payload (e.g. "CONTEXT", "AGENT PROMPT"); `meta` is the
// already-formatted descriptor (e.g. "mode: implement — v0.8.0").
export function beginSentinel(kind, meta) {
  return `===== CHANGELEDGER ${kind} BEGIN — ${meta} =====`;
}

export function endSentinel(kind) {
  return `===== CHANGELEDGER ${kind} END — ${TRUNCATION_SUFFIX} =====`;
}
