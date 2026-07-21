import fs from 'node:fs';
import path from 'node:path';
import { parseChange } from '../change.mjs';
import { findChangeledgerDir } from '../config.mjs';
import { beginSentinel, endSentinel, VERSION } from '../framing.mjs';
import { contractTemplatesDir } from '../paths.mjs';
import { loadRepo } from '../repo.mjs';
import { transversalPolicy } from './context.mjs';

const ROLES = ['investigation', 'implementation', 'review', 'audit'];
const ALLOWED_STATUSES = {
  implementation: ['approved', 'in-progress'],
  review: ['in-review'],
  audit: ['in-validation'],
};

function requireRepo(cwd) {
  const dir = findChangeledgerDir(cwd);
  if (!dir) throw new Error('Not a ChangeLedger repo. Run `changeledger init` first.');
  return dir;
}

function capsule(role) {
  return fs
    .readFileSync(path.join(contractTemplatesDir, 'agent-contexts', `${role}.md`), 'utf8')
    .trim();
}

function selectedChange(role, changeId, repo) {
  if (role !== 'investigation' && !changeId) {
    throw new Error(`role ${role} requires a change id`);
  }
  if (!changeId) return undefined;

  const selected = repo.changes.find(
    (change) => String(change.frontmatter.id) === String(changeId),
  );
  if (!selected) {
    throw new Error(
      `No change with id "${changeId}" (use the exact id; run \`changeledger check\` if a filename's id looks wrong)`,
    );
  }
  const text = selected.text;
  const { id, status } = parseChange(text).frontmatter;
  const allowed = ALLOWED_STATUSES[role];
  if (allowed && !allowed.includes(status)) {
    const expected = allowed.join(' or ');
    throw new Error(`role ${role} requires change status ${expected}; got ${status}`);
  }
  return { id, text };
}

export function buildAgentContext(role, changeId, cwd = process.cwd()) {
  if (!ROLES.includes(role)) {
    throw new Error(`Unknown role "${role}" — valid roles: ${ROLES.join(', ')}`);
  }
  requireRepo(cwd);
  const repo = loadRepo(cwd);
  const selected = selectedChange(role, changeId, repo);
  const change = selected ? ` — change: #${selected.id}` : '';
  const sections = [
    beginSentinel('AGENT CONTEXT', `role: ${role}${change} — v${VERSION}`),
    transversalPolicy(repo.config),
    capsule(role),
  ];
  if (selected) sections.push('---\n\n# Selected change', selected.text.trim());
  sections.push(endSentinel('AGENT CONTEXT'));
  return `${sections.join('\n\n')}\n`;
}

export function agentContext(role, changeId, cwd = process.cwd(), output = console.log) {
  output(buildAgentContext(role, changeId, cwd).trimEnd());
}
