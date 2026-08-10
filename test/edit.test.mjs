// `changeledger edit` — the document-authoring seam (20260810-182641). The
// suite pins the property the human fixed as non-negotiable: a document lands
// COMPLETE in exactly one journal entry, and every guard refuses BEFORE any
// write, so a rejected edit leaves the state ref at the very oid it was read
// from.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseChange } from '../src/change.mjs';
import { show } from '../src/commands/agent.mjs';
import { edit } from '../src/commands/edit.mjs';
import { init as initializeRepo } from '../src/commands/init.mjs';
import { newChange, newChangeFrom, scaffoldChange } from '../src/commands/new.mjs';
import { readSnapshot, STATE_REF, STATE_ROOT, writeActivation } from '../src/state-store.mjs';
import { sanitizedEnv } from './helpers/git-env.mjs';
import { buildTree, commitTree, updateRef } from './helpers/state-repo.mjs';

process.env.CHANGELEDGER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-home-'));

const SPEC_NAME = 'demo-spec.md';

// Multibyte on purpose: a byte-identity assertion over pure ASCII is nearly
// vacuous, and the whole point of a full-document replace is byte fidelity.
const specText = ({ title = 'Demo spec', body = 'Contrato de ejemplo: café, 東京.' } = {}) =>
  `---\ntitle: ${title}\nupdated: 2026-08-08T00:00:00Z\ntags: [demo]\ngraduated_from: []\n---\n\n# ${title}\n\n${body}\n`;

function inactiveRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-edit-'));
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
  const text = fs.readFileSync(file, 'utf8');
  return { root, file, name: path.basename(file), text, id: parseChange(text).frontmatter.id };
}

// The worktree copy of the change is removed before activation, so any read or
// write that fell back to disk fails outright instead of silently succeeding
// against a stale document.
function activatedRepo() {
  const { root, file, name, text, id } = inactiveRepo();
  const configText = fs.readFileSync(path.join(root, '.changeledger', 'config.yml'), 'utf8');
  fs.rmSync(file);
  fs.rmSync(path.join(root, '.changeledger', 'specs'), { recursive: true, force: true });

  execFileSync('git', ['init', '-q'], { cwd: root, env: sanitizedEnv(), stdio: 'ignore' });
  const tree = buildTree(root, {
    '.changeledger-state/manifest.yml': 'format_version: 1\nproject_id: demo\n',
    '.changeledger-state/config.yml': configText,
    [`.changeledger-state/changes/${name}`]: text,
    [`.changeledger-state/specs/${SPEC_NAME}`]: specText(),
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

// Writes `text` to a scratch file and returns its path — the `--from` source.
function source(root, text) {
  const file = path.join(root, 'incoming.md');
  fs.writeFileSync(file, text);
  return file;
}

// The fixture change with a filled Request stage: the exact shape the seam
// exists for (a body the lifecycle commands cannot write).
function filled(text, body = 'Cuerpo redactado: café, mañana, 東京.') {
  return text.replace('## Request\n', `## Request\n\n${body}\n`);
}

test('CR1: edit replaces the whole document in exactly one CAS commit', () => {
  const { root, name, text, id } = activatedRepo();
  const before = stateCommits(root);
  const incoming = filled(text);

  const result = edit(id, { from: source(root, incoming) }, root);

  assert.equal(result.changed, true);
  assert.equal(stateDoc(root, `changes/${name}`), incoming);
  assert.equal(stateCommits(root) - before, 1);
  assert.equal(git(root, ['log', '-1', '--format=%s', STATE_REF]), `edit: ${id}`);
  const request = show(id, root).stages.find((s) => s.key === 'request');
  assert.match(request.body, /Cuerpo redactado/);
  assert.equal(fs.existsSync(path.join(root, STATE_ROOT)), false);
});

test('CR2: an invalid document is refused and the state ref does not move', () => {
  const { root, text, id } = activatedRepo();
  const before = stateTip(root);
  const broken = filled(text).replace('## Log', '## Nonsense');

  assert.throws(
    () => edit(id, { from: source(root, broken) }, root),
    /nothing was written[\s\S]*unknown stage "## nonsense"/i,
  );
  assert.equal(stateTip(root), before);
});

test('CR3: immutables and command-owned fields are refused by name', () => {
  const { root, text, id } = activatedRepo();
  const before = stateTip(root);

  assert.throws(
    () =>
      edit(id, { from: source(root, text.replace(`id: "${id}"`, 'id: "20200101-000000"')) }, root),
    /"id" is immutable/,
  );
  assert.throws(
    () =>
      edit(
        id,
        {
          from: source(
            root,
            text.replace('created: 2026-06-13T12:00:00Z', 'created: 2020-01-01T00:00:00Z'),
          ),
        },
        root,
      ),
    /"created" is immutable/,
  );
  assert.throws(
    () => edit(id, { from: source(root, text.replace('status: draft', 'status: approved')) }, root),
    /"status" is owned by `changeledger status`/,
  );
  assert.throws(
    () =>
      edit(
        id,
        { from: source(root, filled(text).replace('---\n\n##', 'owner: octocat\n---\n\n##')) },
        root,
      ),
    /"owner" is owned by `changeledger owner`/,
  );
  assert.throws(
    () =>
      edit(
        id,
        { from: source(root, filled(text).replace('---\n\n##', 'branch: work/x\n---\n\n##')) },
        root,
      ),
    /"branch" is owned by `changeledger branch`/,
  );
  assert.throws(
    () =>
      edit(
        id,
        { from: source(root, filled(text).replace('---\n\n##', 'archived: true\n---\n\n##')) },
        root,
      ),
    /"archived" is owned by `changeledger archive`/,
  );
  assert.throws(
    () =>
      edit(
        id,
        { from: source(root, filled(text).replace('---\n\n##', 'reviewed: true\n---\n\n##')) },
        root,
      ),
    /"reviewed" is owned by `changeledger review`/,
  );
  assert.equal(stateTip(root), before);
});

test('CR4: a byte-identical document is a no-op with an immobile journal', () => {
  const { root, text, id } = activatedRepo();
  const before = stateTip(root);

  const result = edit(id, { from: source(root, text) }, root);

  assert.equal(result.changed, false);
  assert.equal(stateTip(root), before);
});

test('CR5: an inactive repo gets the same semantics and creates no commit at all', () => {
  const { root, file, text, id } = inactiveRepo();
  // A real git repo on purpose: "commits nothing" is only a claim worth making
  // where a commit could have been created.
  execFileSync('git', ['init', '-q'], { cwd: root, env: sanitizedEnv(), stdio: 'ignore' });
  const incoming = filled(text);

  assert.throws(
    () => edit(id, { from: source(root, incoming.replace('## Log', '## Nonsense')) }, root),
    /nothing was written/,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), text, 'a refused edit leaves the file untouched');
  assert.throws(
    () =>
      edit(id, { from: source(root, incoming.replace('status: draft', 'status: approved')) }, root),
    /"status" is owned by `changeledger status`/,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), text);

  const written = edit(id, { from: source(root, incoming) }, root);
  assert.equal(written.changed, true);
  assert.equal(written.path, file);
  assert.equal(fs.readFileSync(file, 'utf8'), incoming);
  assert.equal(edit(id, { from: source(root, incoming) }, root).changed, false);

  assert.equal(git(root, ['for-each-ref']), '', 'no ref was created in the inactive repo');
  // The atomic replace leaves neither its temp file nor its lock behind.
  assert.deepEqual(
    fs.readdirSync(path.dirname(file)).filter((n) => n.startsWith('.')),
    [],
  );
});

test('CR6: activated `new` refuses to publish an empty scaffold', () => {
  const { root } = activatedRepo();
  const before = stateTip(root);

  assert.throws(
    () => newChange({ type: 'quick', slug: 'y', title: 'Y', now: '2026-06-14T12:00:00Z' }, root),
    /--from/,
  );
  assert.equal(stateTip(root), before);
});

test('CR6: --print emits the scaffold in both modes and writes nothing', () => {
  const active = activatedRepo();
  const before = stateTip(active.root);
  const printed = scaffoldChange(
    { type: 'quick', slug: 'y', title: 'Y', now: '2026-06-14T12:00:00Z' },
    active.root,
    { ownerHandle: () => '' },
  );
  assert.match(printed.text, /^---\nid: "20260614-120000"\n/);
  assert.match(printed.text, /## Request\n\n## Log\n$/);
  assert.equal(stateTip(active.root), before);

  const inactive = inactiveRepo();
  const scaffold = scaffoldChange(
    { type: 'quick', slug: 'y', title: 'Y', now: '2026-06-14T12:00:00Z' },
    inactive.root,
    { ownerHandle: () => '' },
  );
  assert.equal(scaffold.name, '20260614-120000-y.md');
  assert.equal(
    fs.existsSync(path.join(inactive.root, '.changeledger', 'changes', scaffold.name)),
    false,
  );
});

test('CR6: --from lands the complete document in one commit', () => {
  const { root } = activatedRepo();
  const before = stateCommits(root);
  const scaffold = scaffoldChange(
    { type: 'quick', slug: 'y', title: 'Y', now: '2026-06-14T12:00:00Z' },
    root,
    { ownerHandle: () => '' },
  );
  const document = filled(scaffold.text, 'Cuerpo completo desde el primer commit: 東京.');

  const written = newChangeFrom(
    { type: 'quick', slug: 'y', title: 'Y', from: source(root, document) },
    root,
  );

  assert.equal(written, `changes/${scaffold.name}`);
  assert.equal(stateDoc(root, written), document);
  assert.equal(stateCommits(root) - before, 1);
  assert.equal(git(root, ['log', '-1', '--format=%s', STATE_REF]), `new: ${scaffold.id}`);
});

test('CR6: --from refuses a document whose id is already published', () => {
  const { root, text, id } = activatedRepo();
  const before = stateTip(root);

  assert.throws(
    () => newChangeFrom({ type: 'quick', slug: 'x', title: 'X', from: source(root, text) }, root),
    new RegExp(`id "${id}" is already taken`),
  );
  assert.equal(stateTip(root), before);
});

// CR8 mirrors CR2 (change-store.test.mjs)'s stale-revision fixture, but the
// concurrent writer has to land for real: `newChangeFrom` re-reads the state
// ref itself, so a revision captured beforehand can never go stale from the
// outside. A `git` shim on PATH intercepts the one `commit-tree` this call
// makes for its own candidate and, from inside that single subprocess, lands
// an unrelated commit that advances STATE_REF past the revision `newChangeFrom`
// already committed to — the same race a second concurrent `changeledger`
// process would cause. The final CAS `update-ref` then finds the ref moved.
test('CR8: a CAS conflict during `newChangeFrom` propagates undisguised, no retry, no partial write', () => {
  const { root, revision } = activatedRepo();
  const scaffold = scaffoldChange(
    { type: 'quick', slug: 'z', title: 'Z', now: '2026-06-15T12:00:00Z' },
    root,
    { ownerHandle: () => '' },
  );
  const document = filled(scaffold.text, 'Cuerpo perdido por la carrera: 東京.');

  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'changeledger-git-shim-'));
  const flagFile = path.join(shimDir, '.raced');
  fs.writeFileSync(
    path.join(shimDir, 'git'),
    `#!/bin/sh
if [ "$1" = "commit-tree" ] && [ ! -f "${flagFile}" ]; then
  touch "${flagFile}"
  TREE=$("${realGit}" -C "${root}" rev-parse "${revision}^{tree}")
  NEWC=$("${realGit}" -C "${root}" commit-tree -p "${revision}" -m "concurrent writer" "$TREE")
  "${realGit}" -C "${root}" update-ref "${STATE_REF}" "$NEWC" "${revision}"
fi
exec "${realGit}" "$@"
`,
  );
  fs.chmodSync(path.join(shimDir, 'git'), 0o755);

  const before = stateTip(root);
  const beforeCommits = stateCommits(root);
  const savedPath = process.env.PATH;
  process.env.PATH = `${shimDir}:${savedPath}`;
  try {
    assert.throws(
      () =>
        newChangeFrom({ type: 'quick', slug: 'z', title: 'Z', from: source(root, document) }, root),
      /state ref moved: expected/,
    );
  } finally {
    process.env.PATH = savedPath;
  }
  // The concurrent writer's commit is the one and only advance; `newChangeFrom`
  // neither retried under the new tip nor left any trace of its own candidate.
  assert.notEqual(stateTip(root), before);
  assert.equal(stateCommits(root) - beforeCommits, 1);
  const snapshot = readSnapshot(root, { revision: stateTip(root) });
  assert.equal(snapshot.documents[`changes/${scaffold.name}`], undefined);
});

test('CR7: a spec is edited by slug with the same guarantees', () => {
  const { root } = activatedRepo();
  const slug = SPEC_NAME.replace(/\.md$/, '');
  const before = stateCommits(root);
  const current = specText();
  const reconciled = specText({ body: 'Verdad reconciliada tras la graduación: café, 東京.' });

  assert.throws(
    () => edit(`spec:${slug}`, { from: source(root, `${current}\n### CR1 — algo\n`) }, root),
    /nothing was written[\s\S]*criterion heading "CR1"/,
  );
  assert.throws(
    () =>
      edit(
        `spec:${slug}`,
        {
          from: source(
            root,
            current.replace('graduated_from: []', 'graduated_from: ["20260613-120000"]'),
          ),
        },
        root,
      ),
    /"graduated_from" is owned by `changeledger graduate`/,
  );
  assert.equal(stateCommits(root), before);

  const written = edit(`spec:${slug}`, { from: source(root, reconciled) }, root);
  assert.equal(written.changed, true);
  assert.equal(written.path, `specs/${SPEC_NAME}`);
  assert.equal(stateDoc(root, `specs/${SPEC_NAME}`), reconciled);
  assert.equal(stateCommits(root) - before, 1);
  assert.equal(git(root, ['log', '-1', '--format=%s', STATE_REF]), `edit: spec ${SPEC_NAME}`);
  assert.equal(edit(`spec:${slug}`, { from: source(root, reconciled) }, root).changed, false);
  assert.equal(stateCommits(root) - before, 1);
});

test('CR7: the same spec edit is a plain atomic file replace when inactive', () => {
  const { root } = inactiveRepo();
  const file = path.join(root, '.changeledger', 'specs', SPEC_NAME);
  const reconciled = specText({ body: 'Verdad reconciliada sin activación.' });

  const written = edit(`spec:${SPEC_NAME}`, { from: source(root, reconciled) }, root);

  assert.equal(written.path, file);
  assert.equal(fs.readFileSync(file, 'utf8'), reconciled);
});

const bin = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'bin',
  'changeledger.mjs',
);

test('CR1: the CLI reads the document from stdin and names what it wrote', () => {
  const { root, name, text, id } = activatedRepo();
  const incoming = filled(text, 'Cuerpo por stdin: 東京.');

  const out = execFileSync('node', [bin, 'edit', id, '--from', '-'], {
    cwd: root,
    env: { ...sanitizedEnv(), CHANGELEDGER_HOME: process.env.CHANGELEDGER_HOME },
    input: incoming,
    encoding: 'utf8',
  });

  assert.equal(out.trim(), `Edited changes/${name}`);
  assert.equal(stateDoc(root, `changes/${name}`), incoming);
});
