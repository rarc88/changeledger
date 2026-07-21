import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

export const stateConfig = ({ schemaVersion = 3 } = {}) =>
  [
    `schema_version: ${schemaVersion}`,
    'project_id: project-1',
    'language: en',
    'tdd: false',
    'changes_dir: .changeledger/changes',
    'specs_dir: .changeledger/specs',
    'release:',
    '  impacts:',
    '    feature: minor',
    '    bug: patch',
    'statuses: [draft, approved, in-progress, in-review, in-validation, blocked, done, discarded]',
    'stages: [request, plan, log]',
    'types:',
    '  feature:',
    '    stages: [request, plan, log]',
    '    review_required: true',
    '  bug:',
    '    stages: [request, plan, log]',
    '    review_required: true',
    '',
  ].join('\n');

export function changeText({
  id = '20260721-000000',
  title = 'Demo',
  type = 'feature',
  status = 'draft',
  reviewed,
  archived,
} = {}) {
  const paths = {
    approved: [['draft', 'approved']],
    'in-progress': [
      ['draft', 'approved'],
      ['approved', 'in-progress'],
    ],
    'in-review': [
      ['draft', 'approved'],
      ['approved', 'in-progress'],
      ['in-progress', 'in-review'],
    ],
    'in-validation': [
      ['draft', 'approved'],
      ['approved', 'in-progress'],
      ['in-progress', 'in-review'],
      ['in-review', 'in-validation'],
    ],
    done: [
      ['draft', 'approved'],
      ['approved', 'in-progress'],
      ['in-progress', 'in-review'],
      ['in-review', 'in-validation'],
      ['in-validation', 'done'],
    ],
  };
  const history = (paths[status] ?? [])
    .map(([from, to], index) => `- **2026-07-21T00:00:0${index}Z** \`[status]\` ${from} → ${to}`)
    .join('\n');
  const completed = status === 'in-validation' || status === 'done';
  const optional = [
    reviewed === undefined ? null : `reviewed: ${reviewed}`,
    archived === undefined ? null : `archived: ${archived}`,
  ]
    .filter(Boolean)
    .join('\n');
  return `---
id: "${id}"
title: ${title}
type: ${type}
status: ${status}
created: 2026-07-21T00:00:00Z
depends_on: []
${optional ? `${optional}\n` : ''}---

## Request

Demo.

## Plan

- [${completed ? 'x' : ' '}] Do it
${completed ? '  - **Resolved:** `2026-07-21T00:00:05Z`\n' : ''}

## Log
${history ? `\n${history}\n` : ''}
`;
}

export function createStateRepo({
  objectFormat = 'sha1',
  configText = stateConfig(),
  changes = [changeText()],
  specs = {},
  releases = {},
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-state-repo-'));
  const initArgs = ['init', '-q', '-b', 'dev'];
  if (objectFormat !== 'sha1') initArgs.push(`--object-format=${objectFormat}`);
  git(root, initArgs);
  git(root, ['config', 'user.name', 'Test User']);
  git(root, ['config', 'user.email', 'test@example.com']);
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  fs.mkdirSync(path.join(root, '.changeledger'), { recursive: true });
  fs.writeFileSync(path.join(root, '.changeledger', 'legacy-sentinel'), 'unchanged\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'chore: base']);

  git(root, ['checkout', '-q', '--orphan', 'changeledger/state']);
  git(root, ['rm', '-qrf', '--ignore-unmatch', '.']);
  const state = path.join(root, '.changeledger-state');
  fs.mkdirSync(path.join(state, 'changes'), { recursive: true });
  fs.mkdirSync(path.join(state, 'specs'), { recursive: true });
  fs.mkdirSync(path.join(state, 'releases'), { recursive: true });
  fs.writeFileSync(path.join(state, 'manifest.yml'), 'format_version: 1\nproject_id: project-1\n');
  fs.writeFileSync(path.join(state, 'config.yml'), configText);
  changes.forEach((text, index) => {
    const id = text.match(/^id: "([^"]+)"$/m)?.[1] ?? String(index);
    fs.writeFileSync(path.join(state, 'changes', `${id}-change.md`), text);
  });
  for (const [name, text] of Object.entries(specs)) {
    fs.writeFileSync(path.join(state, 'specs', name), text);
  }
  for (const [name, text] of Object.entries(releases)) {
    fs.writeFileSync(path.join(state, 'releases', name), text);
  }
  git(root, ['add', '.changeledger-state']);
  git(root, ['commit', '-qm', 'chore: state']);
  const baseline = git(root, ['rev-parse', 'HEAD']);

  git(root, ['checkout', '-q', 'dev']);
  fs.writeFileSync(
    path.join(root, '.changeledger', 'authority.yml'),
    `format_version: 1\nstate_ref: refs/heads/changeledger/state\nbaseline: ${baseline}\nproject_id: project-1\n`,
  );
  git(root, ['add', '.changeledger/authority.yml']);
  git(root, ['commit', '-qm', 'chore: authority']);
  return { root, state, baseline };
}
