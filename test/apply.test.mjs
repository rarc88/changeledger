// `changeledger apply` — the batch landing seam (20260811-110629). The suite
// pins the property the human fixed as non-negotiable: a whole manifest of
// documents and agent-owned events is ONE journal entry, all-or-nothing, and
// every per-entry guard is the same one its individual command applies.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseChange } from '../src/change.mjs';
import { show } from '../src/commands/agent.mjs';
import { apply } from '../src/commands/apply.mjs';
import { init as initializeRepo } from '../src/commands/init.mjs';
import { newChange, scaffoldChange } from '../src/commands/new.mjs';
import { STATE_REF, STATE_ROOT, writeActivation } from '../src/state-store.mjs';
import { initGitFixture, sanitizedEnv } from './helpers/git-env.mjs';
import { buildTree, commitTree, updateRef } from './helpers/state-repo.mjs';

process.env.CHANGELEDGER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));

const SPEC_NAME = 'demo-spec.md';

const specText = (body = 'Contrato de ejemplo: café, 東京.') =>
  `---\ntitle: Demo spec\nupdated: 2026-08-08T00:00:00Z\ntags: [demo]\ngraduated_from: []\n---\n\n# Demo spec\n\n${body}\n`;

function baseRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-apply-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  initializeRepo(root);
  const configFile = path.join(root, '.changeledger', 'config.yml');
  fs.writeFileSync(
    configFile,
    fs
      .readFileSync(configFile, 'utf8')
      .replace(/^ {2}change_branch_format:.*$/m, '  change_branch_format: null'),
  );
  const file = newChange(
    { type: 'quick', slug: 'x', title: 'X', now: '2026-06-13T12:00:00Z' },
    root,
    {
      ownerHandle: () => '',
    },
  );
  const specsDir = path.join(root, '.changeledger', 'specs');
  fs.mkdirSync(specsDir, { recursive: true });
  fs.writeFileSync(path.join(specsDir, SPEC_NAME), specText());
  const text = filled(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, text);
  return { root, file, name: path.basename(file), text, id: parseChange(text).frontmatter.id };
}

function inactiveRepo() {
  const base = baseRepo();
  initGitFixture(base.root);
  git(base.root, ['add', '-A']);
  git(base.root, ['commit', '-qm', 'chore: seed']);
  return base;
}

// The worktree copies are removed before activation, so any read or write that
// fell back to disk fails outright instead of silently succeeding on a stale
// document.
function activatedRepo({ status = 'draft', spec = specText() } = {}) {
  const { root, file, name, text: draft, id } = baseRepo();
  const text = draft.replace('status: draft', `status: ${status}`);
  const configText = fs.readFileSync(path.join(root, '.changeledger', 'config.yml'), 'utf8');
  fs.rmSync(file);
  fs.rmSync(path.join(root, '.changeledger', 'specs'), { recursive: true, force: true });

  initGitFixture(root);
  const tree = buildTree(root, {
    '.changeledger-state/manifest.yml': 'format_version: 1\nproject_id: demo\n',
    '.changeledger-state/config.yml': configText,
    [`.changeledger-state/changes/${name}`]: text,
    [`.changeledger-state/specs/${SPEC_NAME}`]: spec,
  });
  const revision = commitTree(root, tree, { message: 'chore: state' });
  updateRef(root, STATE_REF, revision);
  writeActivation(root, { stateRef: STATE_REF });
  return { root, name, text, id, revision };
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, env: sanitizedEnv(), encoding: 'utf8' }).trim();
}

const stateTip = (root) => git(root, ['rev-parse', STATE_REF]);
const stateCommits = (root) => Number(git(root, ['rev-list', '--count', STATE_REF]));
const stateDoc = (root, relPath) =>
  execFileSync('git', ['cat-file', 'blob', `${stateTip(root)}:${STATE_ROOT}/${relPath}`], {
    cwd: root,
    env: sanitizedEnv(),
    encoding: 'utf8',
  });

function filled(text, body = 'Cuerpo redactado: café, mañana, 東京.') {
  return text.replace('## Request\n', `## Request\n\n${body}\n`);
}

// A complete, valid draft ready to be a `new` entry's content.
function draftFor(root, { slug, title, now, body = 'Cuerpo del draft.' }) {
  return filled(
    scaffoldChange({ type: 'quick', slug, title, owner: 'rarc88', now }, root).text,
    body,
  );
}

function manifest(root, entries, file = 'batch.json') {
  const target = path.join(root, file);
  fs.writeFileSync(target, JSON.stringify(entries, null, 2));
  return target;
}

test('CR1: a manifest of N documents lands in exactly one commit', () => {
  const { root, name, text, id } = activatedRepo();
  const before = stateCommits(root);
  const a = draftFor(root, { slug: 'alpha', title: 'Alpha', now: '2026-08-11T10:00:00Z' });
  const b = draftFor(root, { slug: 'beta', title: 'Beta', now: '2026-08-11T10:00:01Z' });
  const edited = text.replace('Cuerpo redactado', 'Cuerpo reescrito');

  apply(
    {
      from: manifest(root, [
        { target: 'new', slug: 'alpha', content: a },
        { target: 'new', slug: 'beta', content: b },
        { target: `change:${id}`, content: edited },
      ]),
    },
    root,
  );

  assert.equal(stateCommits(root) - before, 1);
  assert.equal(stateDoc(root, `changes/${name}`), edited);
  assert.equal(stateDoc(root, 'changes/20260811-100000-alpha.md'), a);
  assert.equal(stateDoc(root, 'changes/20260811-100001-beta.md'), b);
  assert.match(git(root, ['log', '-1', '--format=%s', STATE_REF]), /^apply: /);
  assert.equal(fs.existsSync(path.join(root, STATE_ROOT)), false);
});

test('CR1: a manifest may land a spec alongside changes', () => {
  const { root } = activatedRepo();
  const before = stateCommits(root);
  const nextSpec = specText('Verdad persistente reescrita.');

  apply({ from: manifest(root, [{ target: `spec:${SPEC_NAME}`, content: nextSpec }]) }, root);

  assert.equal(stateCommits(root) - before, 1);
  assert.equal(stateDoc(root, `specs/${SPEC_NAME}`), nextSpec);
});

test('CR2: one invalid entry keeps the whole batch off the ref', () => {
  const { root, name, text, id } = activatedRepo();
  const tip = stateTip(root);
  const a = draftFor(root, { slug: 'alpha', title: 'Alpha', now: '2026-08-11T10:00:00Z' });
  const broken = text.replace('status: draft', 'status: approved');

  assert.throws(
    () =>
      apply(
        {
          from: manifest(root, [
            { target: 'new', slug: 'alpha', content: a },
            { target: `change:${id}`, content: broken },
          ]),
        },
        root,
      ),
    (e) => {
      assert.match(e.message, /entry 2/);
      assert.match(e.message, new RegExp(`change:${id}`));
      assert.match(e.message, /"status" is owned by `changeledger status`/);
      return true;
    },
  );

  assert.equal(stateTip(root), tip);
  assert.equal(stateDoc(root, `changes/${name}`), text);
  assert.throws(() => stateDoc(root, 'changes/20260811-100000-alpha.md'));
});

test('CR3: agent events share the single entry and keep their own validations', () => {
  const { root, name, id } = activatedRepo({ status: 'approved' });
  const before = stateCommits(root);

  apply(
    {
      from: manifest(root, [
        { op: 'status', id, to: 'in-progress' },
        { op: 'owner', id, name: 'rarc88' },
        { op: 'log', id, message: 'arranque del lote' },
      ]),
    },
    root,
  );

  assert.equal(stateCommits(root) - before, 1);
  const landed = stateDoc(root, `changes/${name}`);
  const fm = parseChange(landed).frontmatter;
  assert.equal(fm.status, 'in-progress');
  assert.equal(fm.owner, 'rarc88');
  assert.match(landed, /`\[note\]` arranque del lote/);
  assert.match(landed, /`\[status\]` approved → in-progress/);
  assert.equal(show(id, root).frontmatter.status, 'in-progress');
});

test('CR3: an illegal transition inside the batch is refused like its own command', () => {
  const { root, id } = activatedRepo();
  const tip = stateTip(root);

  assert.throws(
    () => apply({ from: manifest(root, [{ op: 'status', id, to: 'in-review' }]) }, root),
    /entry 1 \(status\).*draft.*in-review/s,
  );
  assert.equal(stateTip(root), tip);
});

test('CR4: human-owned transitions never travel in a batch', () => {
  const { root, id } = activatedRepo();
  const tip = stateTip(root);

  assert.throws(
    () => apply({ from: manifest(root, [{ op: 'status', id, to: 'approved' }]) }, root),
    /`changeledger approve`/,
  );
  assert.throws(
    () => apply({ from: manifest(root, [{ op: 'validation', id, verdict: 'pass' }]) }, root),
    /"validation".*`changeledger validation`/s,
  );
  assert.throws(
    () => apply({ from: manifest(root, [{ op: 'discard', id, reason: 'x' }]) }, root),
    /"discard".*`changeledger discard`/s,
  );
  assert.throws(
    () => apply({ from: manifest(root, [{ op: 'status', id, to: 'done' }]) }, root),
    /human validation/,
  );
  assert.equal(stateTip(root), tip);
});

test('CR5: a net-empty manifest is a no-op with no new commit', () => {
  const { root, text, id } = activatedRepo();
  const a = draftFor(root, { slug: 'alpha', title: 'Alpha', now: '2026-08-11T10:00:00Z' });
  const entries = [
    { target: 'new', slug: 'alpha', content: a },
    { target: `change:${id}`, content: text },
  ];

  apply({ from: manifest(root, entries) }, root);
  const after = stateCommits(root);
  const tip = stateTip(root);

  const result = apply(
    { from: manifest(root, [{ target: `change:${id}`, content: text }], 'again.json') },
    root,
  );

  assert.equal(stateCommits(root), after);
  assert.equal(stateTip(root), tip);
  assert.deepEqual(result.changed, []);
});

test('CR6: an inactive repo gets the same effect with no commit anywhere', () => {
  const { root, file, text, id } = inactiveRepo();
  const commitsBefore = Number(git(root, ['rev-list', '--count', '--all']));
  const a = draftFor(root, { slug: 'alpha', title: 'Alpha', now: '2026-08-11T10:00:00Z' });
  const edited = text.replace('Cuerpo redactado', 'Cuerpo reescrito');

  apply(
    {
      from: manifest(root, [
        { target: 'new', slug: 'alpha', content: a },
        { target: `change:${id}`, content: edited },
        { op: 'log', id, message: 'nota del lote' },
      ]),
    },
    root,
  );

  const landed = fs.readFileSync(file, 'utf8');
  assert.match(landed, /Cuerpo reescrito/);
  assert.match(landed, /`\[note\]` nota del lote/);
  assert.equal(
    fs.readFileSync(path.join(root, '.changeledger/changes/20260811-100000-alpha.md'), 'utf8'),
    a,
  );
  assert.equal(Number(git(root, ['rev-list', '--count', '--all'])), commitsBefore);
  assert.equal(git(root, ['for-each-ref', '--format=%(refname)', 'refs/heads/changeledger']), '');
});

test('CR7: dry-run reports the warnings check would report and writes nothing', () => {
  const { root, name, text, id } = activatedRepo();
  const tip = stateTip(root);
  const a = draftFor(root, { slug: 'alpha', title: 'Alpha', now: '2026-08-11T10:00:00Z' });
  const mentioning = text.replace('Cuerpo redactado', 'Depende de 20260811-100000 sin declararlo');

  const dirty = apply(
    {
      dryRun: true,
      from: manifest(root, [
        { target: 'new', slug: 'alpha', content: a },
        { target: `change:${id}`, content: mentioning },
      ]),
    },
    root,
  );

  assert.deepEqual(
    dirty.warnings.filter((w) => w.file === name),
    [
      {
        file: name,
        message:
          'mentions change "20260811-100000" without declaring it in depends_on or related_to',
      },
    ],
  );

  // The clean manifest adds nothing to what the ledger already warns about —
  // measured against the repo's own baseline, not against an assumed-empty one.
  const baseline = apply({ dryRun: true, from: manifest(root, [], 'empty.json') }, root);
  const clean = apply(
    {
      dryRun: true,
      from: manifest(
        root,
        [{ target: `change:${id}`, content: filled(text, 'Otro cuerpo.') }],
        'clean.json',
      ),
    },
    root,
  );
  assert.deepEqual(clean.warnings, baseline.warnings);
  assert.deepEqual(
    clean.warnings.filter((w) => /mentions change/.test(w.message)),
    [],
  );

  assert.equal(stateTip(root), tip);
  assert.equal(stateDoc(root, `changes/${name}`), text);
  assert.equal(fs.existsSync(path.join(root, STATE_ROOT)), false);
});

test('CR7: dry-run in an inactive repo leaves every worktree file untouched', () => {
  const { root, file, text, id } = inactiveRepo();
  const a = draftFor(root, { slug: 'alpha', title: 'Alpha', now: '2026-08-11T10:00:00Z' });

  apply(
    {
      dryRun: true,
      from: manifest(root, [
        { target: 'new', slug: 'alpha', content: a },
        { target: `change:${id}`, content: filled(text, 'Otro cuerpo.') },
      ]),
    },
    root,
  );

  assert.equal(fs.readFileSync(file, 'utf8'), text);
  assert.equal(
    fs.existsSync(path.join(root, '.changeledger/changes/20260811-100000-alpha.md')),
    false,
  );
  assert.equal(git(root, ['status', '--porcelain', '.changeledger']), '');
});

// A spec carrying a change-local criterion heading: a repo-wide `check` ERROR
// that the per-entry guards of a change-only manifest are not scoped to see,
// so it reaches the candidate exactly as it would reach `check` after landing.
const erroringSpec = specText('## CR1 — criterio local\n\nTexto.');

test('CR7: dry-run refuses a candidate that carries check errors', () => {
  const { root, text, id } = activatedRepo({ spec: erroringSpec });
  const tip = stateTip(root);

  assert.throws(
    () =>
      apply(
        {
          dryRun: true,
          from: manifest(root, [{ target: `change:${id}`, content: filled(text, 'Otro cuerpo.') }]),
        },
        root,
      ),
    (e) => {
      assert.match(e.message, /dry run/);
      assert.match(e.message, /demo-spec\.md: spec contains change-local criterion heading "CR1"/);
      return true;
    },
  );
  assert.equal(stateTip(root), tip);
});

test('CR7: dry-run stays clean when the candidate carries only warnings', () => {
  const { root, id, text } = activatedRepo();

  const result = apply(
    {
      dryRun: true,
      from: manifest(root, [{ target: `change:${id}`, content: filled(text, 'Otro cuerpo.') }]),
    },
    root,
  );

  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.length > 0);
  assert.equal(result.changed.length, 1);
});

// 20260811-122031: landing used to print `check`'s errors and still exit 0 —
// only `--dry-run` was a gate. This pins the decision to close that gap: a
// candidate carrying errors refuses at LANDING too, before any write, with
// wording that no longer claims "dry run".
test('landing refuses a candidate that carries check errors, same as dry-run', () => {
  const { root, name, text, id } = activatedRepo({ spec: erroringSpec });
  const tip = stateTip(root);

  assert.throws(
    () =>
      apply(
        {
          from: manifest(root, [{ target: `change:${id}`, content: filled(text, 'Otro cuerpo.') }]),
        },
        root,
      ),
    (e) => {
      assert.doesNotMatch(e.message, /dry run/);
      assert.match(e.message, /apply refused, nothing was written/);
      assert.match(e.message, /demo-spec\.md: spec contains change-local criterion heading "CR1"/);
      return true;
    },
  );
  assert.equal(stateTip(root), tip);
  assert.equal(stateDoc(root, `changes/${name}`), text);
});

test('CR7: the CLI exits non-zero on a dry run whose candidate carries check errors', () => {
  const { root, text, id } = activatedRepo({ spec: erroringSpec });
  const bin = fileURLToPath(new URL('../bin/changeledger.mjs', import.meta.url));
  const batch = JSON.stringify([{ target: `change:${id}`, content: filled(text, 'Otro cuerpo.') }]);
  const run = (args) =>
    spawnSync(process.execPath, [bin, ...args], {
      cwd: root,
      env: sanitizedEnv(),
      input: batch,
      encoding: 'utf8',
    });

  const dry = run(['apply', '--from', '-', '--dry-run']);
  assert.equal(dry.status, 1);
  assert.match(dry.stderr, /spec contains change-local criterion heading "CR1"/);
  // Parity with the gate a composer would hit next: `check` refuses the same
  // candidate, so `apply --dry-run && apply` can no longer walk past it.
  assert.equal(run(['check']).status, 1);
});

test('CR1/CR7: the CLI reads the manifest from stdin and refuses to land a dry run', () => {
  const { root, name, text, id } = activatedRepo();
  const tip = stateTip(root);
  const edited = text.replace('Cuerpo redactado', 'Cuerpo del CLI');
  const batch = JSON.stringify([{ target: `change:${id}`, content: edited }]);
  const bin = fileURLToPath(new URL('../bin/changeledger.mjs', import.meta.url));
  const run = (args) =>
    execFileSync(process.execPath, [bin, ...args], {
      cwd: root,
      env: sanitizedEnv(),
      input: batch,
      encoding: 'utf8',
    });

  const dry = run(['apply', '--from', '-', '--dry-run']);
  assert.match(dry, /Dry run: 1 document\(s\) would change/);
  assert.equal(stateTip(root), tip);

  const landed = run(['apply', '--from', '-']);
  assert.match(landed, new RegExp(`Applied 1 document\\(s\\): changes/${name}`));
  assert.equal(stateDoc(root, `changes/${name}`), edited);
  assert.equal(stateCommits(root), 2);
});

test('CR2: a manifest that is not a JSON array of entries is refused by shape', () => {
  const { root } = activatedRepo();
  const tip = stateTip(root);
  const file = path.join(root, 'bad.json');

  fs.writeFileSync(file, '{ nope');
  assert.throws(() => apply({ from: file }, root), /does not parse/);

  fs.writeFileSync(file, '{"entries": []}');
  assert.throws(() => apply({ from: file }, root), /array of entries/);

  fs.writeFileSync(file, '[{"target": "spec:missing"}]');
  assert.throws(() => apply({ from: file }, root), /entry 1.*"content"/s);

  assert.equal(stateTip(root), tip);
});
