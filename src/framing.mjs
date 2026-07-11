import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { packageRoot } from './paths.mjs';

// Single source of the installed version and the anti-truncation sentinels, so
// `context`, `agent-prompt` and `agent-context` share framing and never diverge
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

// 12-hex-char content revision for a composed body. Callers hash the body
// only (never the BEGIN/END lines themselves) so the revision never
// references its own framing.
export function contentRev(body) {
  return crypto.createHash('sha256').update(body).digest('hex').slice(0, 12);
}
