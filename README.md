# ChangeLedger (`changeledger`)

> Turn conversations into buildable changes.

ChangeLedger is a local-first workflow for planning software changes with coding
agents before implementation begins. Features, bugs, audits and refactors become
reviewable documents with an enforced lifecycle, acceptance criteria, tasks and
persistent product truth.

Its human layer is a local viewer: instead of reading scattered Markdown files,
you get a searchable board across all registered projects, rendered
specifications and dependency diagrams.

## Quick start

ChangeLedger requires **Node.js 24 or newer**. Install the CLI globally:

```sh
npm install --global changeledger
# or: pnpm add --global changeledger
```

In a repository that already has an `AGENTS.md`:

```sh
changeledger init
changeledger view
```

`changeledger init` creates `.changeledger/`, gives the project a stable identity
and installs a small context bootstrap in the project-owned `AGENTS.md`. The
repository keeps only its configuration and documents; the CLI, viewer and
canonical contract fragments remain in the global package.

## The workflow

```text
conversation → draft → human approval → implementation → review
             → human validation → persistent specification
```

A typical change starts like this:

```sh
changeledger new feature oauth-login "Add OAuth login"
changeledger view
```

The agent completes the generated stages under `.changeledger/changes/`. You approve the
draft in the viewer before implementation. From there, ChangeLedger validates
lifecycle transitions, task traceability and the final human acceptance gate.
When the work is done, its lasting truth graduates into `.changeledger/specs/`.

The contract is agent-agnostic: Codex, Claude Code, opencode, Copilot, Cursor and
other tools discover it through the repository's `AGENTS.md` reference.

### Optional global state branch

Repositories may move operational change documents to a dedicated,
append-only `changeledger/state` branch. The CLI reads and updates that ref via
Git objects without checking it out; configuration, specs and releases remain
on the declared integration branch. Repositories that do not activate it keep
the filesystem behavior above.

Activation is an explicit migration, never a side effect of upgrading config:

```sh
changeledger config migrate
changeledger state preview --ref dev --ref refs/remotes/origin/dev
changeledger state init --ref dev --ref refs/remotes/origin/dev
changeledger state publish
# Optionally install the receive validator on the bare remote, then:
changeledger state doctor
changeledger state activate --advisory "remote protection is managed outside ChangeLedger"
```

Protect the state branch against deletion and force-push, permit only
fast-forward writes, and restrict writers. Provider-neutral ChangeLedger cannot
inspect hosting-provider branch rules, so branch protection stays an advisory
you record with `--advisory <reason>`.

For content protection ChangeLedger ships a `pre-receive` validator: install
`changeledger state validate-receive --branch changeledger/state` as the bare
repository's `pre-receive` hook (push the integration branch before the state
commit so the hook can read the canonical config). It rejects invalid documents,
rewritten history and files outside the state layout on the server, using the
same engine as the CLI. Confirming the hook is a network mutation (it pushes a
nonce-bound invalid probe to origin), so it only runs when you pass
`--confirm-strong` to `state doctor` or `state activate`; by default protection
is reported `not-checked` and `state activate` still requires `--advisory`.
The hook certifies only a response that echoes that nonce and its exact configured
state branch: a generic rejection or a validator installed for another branch is
not evidence. Probes never force-push or delete refs. If an unprotected remote
accepts a probe, `state doctor` reports its `protection_probe` ref so an
authorized remote administrator can remove it; that result is always
`unverified`. With `--confirm-strong`, `state doctor` reports
`remote_protection: enforced` only after the branch-bound attestation, and
`state activate` completes without `--advisory` only in that case. A failed
publication remains visibly pending; `changeledger state
sync` publishes it or replays it only when remote edits touched different
change documents.

Before the first post-cutover state write, `changeledger state abort` restores
legacy authority while preserving the candidate. Afterwards use `changeledger
state recover --branch <new-branch>` and perform another explicit cutover; stale
legacy copies are never selected automatically.

## Changes and specs

- **Changes** describe a delta: why it is needed, what was learned, the chosen
  design, acceptance criteria, implementation tasks and execution log.
- **Specs** describe the intended current system after completed changes
  graduate. They have no work lifecycle and remain concise, durable ChangeLedger
  product truth. Work performed without the CLI may diverge; observed drift is
  reported for human resolution rather than reconciled automatically.

With the default Definition of Ready policy, `changeledger check` verifies that acceptance
criteria are test-grade and mapped to actionable tasks. Repositories doing
exploratory work can set `tdd: false`; run `changeledger context spec` or
`changeledger context implement` for the complete task-specific rules.

## Essential commands

### Set up and inspect

```sh
changeledger init                         # initialize and register the current repository
changeledger register                     # refresh registration and the context bootstrap
changeledger view                         # view every registered project
changeledger view .                       # view only the current project
changeledger check [id]                   # validate the repository or one change
```

### Work with changes

```sh
changeledger new <type> <slug> <title>    # create a draft change
changeledger list [--status S] [--type T] [--owner NAME|--unowned]
changeledger list [--pending graduation|archive] [--archived|--all]
changeledger show <id> [--json]
changeledger status <id> <status>
changeledger task <id> done|block <n> [reason]
changeledger log <id> <message>
changeledger review <id> pass
changeledger review <id> fail --retry "<reason>"
changeledger review <id> fail --block "<reason>"
changeledger discard <id> <reason>
changeledger owner <id> <new-owner>      # explicit, audited transfer
```

### Preserve completed truth

```sh
changeledger graduate <id> <spec-slug> --new     # create a marked scaffold; remains pending
# refine the scaffold and remove its marker
changeledger graduate <id> <spec-slug> --into    # finalize an existing refined spec
changeledger graduate <id> --skip [reason]       # record that no spec is needed
changeledger list --pending graduation --owner "Roberto Ruiz" # select personal decisions; resolve each id
changeledger list --pending archive --owner "Roberto Ruiz"    # preview the scoped bulk action
changeledger archive --graduated --owner "Roberto Ruiz"       # archive exactly that owner's candidates
changeledger archive --graduated                              # without a filter, archive every candidate
```

Run `changeledger --help` or `changeledger <command> --help` for the complete command reference.

Schema 4 adds `git.change_branch_format`, defaulting to `{type}/{id}`. Only
`{type}` and `{id}` are supported, and `{id}` must occur exactly once. Active
global stores additionally declare the atomic pair `git.state_branch` and
`git.state_baseline`; `config migrate` never invents either field.

## Release planning

ChangeLedger can calculate a portable SemVer release from completed changes
without assuming a package ecosystem:

```sh
changeledger release init 0.1.0       # adopt an existing published version once
changeledger release plan --json      # calculate the next version without writing
changeledger release record 0.2.0     # record the calculated release manifest
```

The CLI decides which changes belong to the release and calculates their
effective `release_impact`. The operating agent applies that version to the
project's own surfaces—`package.json`, `pubspec.yaml`, `Cargo.toml`, Gradle,
Xcode or a monorepo—then runs the local quality gates and release workflow.

## Repository integration

`changeledger check` exits non-zero on contract errors, so it can be used in Git hooks and
CI:

```sh
changeledger check || exit 1
```

The contract ships as task-focused fragments and is compiled on demand:

```sh
changeledger context                    # minimal non-negotiable core
changeledger context <change-id>        # lifecycle-aware rules + selected change
changeledger context review             # explicit task mode
changeledger agent-prompt <role>         # portable delegation skeleton
changeledger agent-context <role> [id]  # self-contained context for that delegate
```

`init` places a small optional-discovery bootstrap in the project-owned
`AGENTS.md`; there is no linked or copied contract under `.changeledger/`. Run
`changeledger register` after upgrading to refresh that bootstrap. An agent
attempts `changeledger context` and, on success, immediately captures its full
output through the END sentinel. When the command is unavailable it continues
normally without ChangeLedger; when the executable fails it reports the error
for human direction. A retained revision is checked with `--have <rev>` after
compaction.

Roles are `investigation`, `implementation`, `review` and `audit`. `audit` is a
read-only inspection of a change already in `in-validation` — after review has
already passed — for a human or orchestrator to consult before accepting or
rejecting it; it never moves the change or records a verdict. Each generated
delegation prompt explicitly replaces the bootstrap's default context load with
its specialized `agent-context` command.

### Upgrading an existing repo's configuration

Repos created before ChangeLedger 0.6 may have an older configuration schema.
Run this to inspect and apply available migrations:

```sh
changeledger config migrate --dry-run   # preview changes without writing
changeledger config migrate             # apply atomically
changeledger check                      # confirm the repo is valid
```

Migrations are safe to run more than once — if the config is already current,
the command reports so and exits without modifying any file.

## Compatibility and security

- Node.js **24+**.
- Tested on Linux, macOS and Windows.
- No symlink privileges are required on Windows; context fragments remain in the
  installed package and the CLI prints them on demand.
- The viewer binds to loopback and treats repository content as untrusted input.
  See [`SECURITY.md`](SECURITY.md) for the threat model and private reporting
  instructions.

## Project status

ChangeLedger is usable and self-hosting, but remains **pre-1.0**. Expect the
contract and CLI to evolve while the core workflow settles. Upgrade to the
latest `0.x` release to receive fixes.

Contributions are welcome. Development setup, quality gates and repository
conventions live in [`CONTRIBUTING.md`](CONTRIBUTING.md). The canonical agent
contract is composed from [`templates/contract/`](templates/contract/).

## Language policy

Structure is always English: frontmatter keys, enum values, stage headings, CLI
commands and filenames. Generated content follows the repository's configured
`language`.
