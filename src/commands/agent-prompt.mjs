import fs from 'node:fs';
import path from 'node:path';
import { beginSentinel, endSentinel, VERSION } from '../framing.mjs';
import { contractTemplatesDir } from '../paths.mjs';

// Portable role skeletons ship inside the package, so this command works even
// outside an initialized ChangeLedger repo — it never reads project config.
const ROLES = ['investigation', 'implementation', 'review'];

export function buildAgentPrompt(role) {
  if (!ROLES.includes(role)) {
    throw new Error(`Unknown role "${role}" — valid roles: ${ROLES.join(', ')}`);
  }
  const file = path.join(contractTemplatesDir, 'agent-prompts', `${role}.md`);
  const body = fs.readFileSync(file, 'utf8').trim();
  const begin = beginSentinel('AGENT PROMPT', `role: ${role} — v${VERSION}`);
  return `${begin}\n\n${body}\n\n${endSentinel('AGENT PROMPT')}\n`;
}

export function agentPrompt(role, output = console.log) {
  output(buildAgentPrompt(role).trimEnd());
}
