import fs from 'node:fs';
import path from 'node:path';
import { findChangeledgerDir } from '../config.mjs';
import { beginSentinel, endSentinel, VERSION } from '../framing.mjs';
import { contractTemplatesDir } from '../paths.mjs';
import { loadRepo, resolveChangeInRepo } from '../repo.mjs';
import { changeParseFailureMessage, transversalPolicy } from './context.mjs';

export const AGENT_ROLES = ['review'];
const ALLOWED_STATUSES = {
  review: ['in-review'],
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

// `repo` resolves against whichever authority it was loaded under — the
// state-ref snapshot on an activated repo, never a worktree phantom
// (20260808-151641 CR7).
function selectedChange(role, changeId, repo) {
  let resolved;
  try {
    resolved = resolveChangeInRepo(repo, changeId);
  } catch (error) {
    const parseFailure = changeParseFailureMessage(changeId, repo.changeErrors);
    if (parseFailure) throw new Error(`Change "${changeId}" failed to parse: ${parseFailure}`);
    throw error;
  }
  const { frontmatter } = resolved;
  const allowed = ALLOWED_STATUSES[role];
  if (allowed && !allowed.includes(frontmatter.status)) {
    const expected = allowed.join(' or ');
    throw new Error(`role ${role} requires change status ${expected}; got ${frontmatter.status}`);
  }
  return { id: frontmatter.id, frontmatter, text: resolved.text };
}

export function buildAgentContext(role, changeId, cwd = process.cwd()) {
  if (!AGENT_ROLES.includes(role)) {
    throw new Error(`Unknown role "${role}" — valid roles: ${AGENT_ROLES.join(', ')}`);
  }
  requireRepo(cwd);
  if (!changeId) throw new Error(`role ${role} requires a change id`);
  const repo = loadRepo(cwd, { isolateChangeErrors: true });
  const selected = selectedChange(role, changeId, repo);
  const sections = [
    beginSentinel('AGENT CONTEXT', `role: ${role} — change: #${selected.id} — v${VERSION}`),
    // The delegate's capsule conditions its obligations on this line, so the
    // selected change publishes its own tdd.
    transversalPolicy(repo.config, selected.frontmatter),
    capsule(role),
    '---\n\n# Selected change',
    selected.text.trim(),
    endSentinel('AGENT CONTEXT'),
  ];
  return `${sections.join('\n\n')}\n`;
}

export function agentContext(role, changeId, cwd = process.cwd(), output = console.log) {
  output(buildAgentContext(role, changeId, cwd).trimEnd());
}
