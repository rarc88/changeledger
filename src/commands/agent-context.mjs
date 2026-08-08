import fs from 'node:fs';
import path from 'node:path';
import { findChangeledgerDir, loadConfig } from '../config.mjs';
import { beginSentinel, endSentinel, VERSION } from '../framing.mjs';
import { contractTemplatesDir } from '../paths.mjs';
import { loadRepo, resolveChangeInRepo } from '../repo.mjs';
import { transversalPolicy } from './context.mjs';

const ROLES = ['investigation', 'implementation', 'review', 'post-review'];
const ALLOWED_STATUSES = {
  implementation: ['approved', 'in-progress'],
  review: ['in-review'],
  'post-review': ['in-validation'],
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

// `repo` is `null` unless `changeId` is truthy: `investigation` with no id
// never needs a change document, so it must not pay for a full `loadRepo`
// (whose sync loader throws on the first unparseable change document
// anywhere in the repo — a regression the confirmation review caught, since
// this guard used to run with no repo touched at all). When `repo` is
// non-null, it resolves against whichever authority it was loaded under —
// the state-ref snapshot on an activated repo, never a worktree phantom
// (20260808-151641 CR7).
function selectedChange(role, changeId, repo) {
  if (role !== 'investigation' && !changeId) {
    throw new Error(`role ${role} requires a change id`);
  }
  if (!changeId) return undefined;

  const resolved = resolveChangeInRepo(repo, changeId);
  const { id, status } = resolved.frontmatter;
  const allowed = ALLOWED_STATUSES[role];
  if (allowed && !allowed.includes(status)) {
    const expected = allowed.join(' or ');
    throw new Error(`role ${role} requires change status ${expected}; got ${status}`);
  }
  return { id, text: resolved.text };
}

export function buildAgentContext(role, changeId, cwd = process.cwd()) {
  if (!ROLES.includes(role)) {
    throw new Error(`Unknown role "${role}" — valid roles: ${ROLES.join(', ')}`);
  }
  const changeledgerDir = requireRepo(cwd);
  const repo = changeId ? loadRepo(cwd) : null;
  const selected = selectedChange(role, changeId, repo);
  const config = repo ? repo.config : loadConfig(changeledgerDir);
  const change = selected ? ` — change: #${selected.id}` : '';
  const sections = [
    beginSentinel('AGENT CONTEXT', `role: ${role}${change} — v${VERSION}`),
    transversalPolicy(config),
    capsule(role),
  ];
  if (selected) sections.push('---\n\n# Selected change', selected.text.trim());
  sections.push(endSentinel('AGENT CONTEXT'));
  return `${sections.join('\n\n')}\n`;
}

export function agentContext(role, changeId, cwd = process.cwd(), output = console.log) {
  output(buildAgentContext(role, changeId, cwd).trimEnd());
}
