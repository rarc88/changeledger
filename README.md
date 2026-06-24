# Spec Ledger (`sl`)

> Documents are the source of truth. Code is their reflection.

Spec Ledger is a local-first workflow for planning software changes with coding
agents before implementation begins. Features, bugs, audits and refactors become
reviewable documents with an enforced lifecycle, acceptance criteria, tasks and
persistent product truth.

Its human layer is a local viewer: instead of reading scattered Markdown files,
you get a searchable board across all registered projects, rendered
specifications and dependency diagrams.

## Quick start

Spec Ledger requires **Node.js 24 or newer**. Install the CLI globally:

```sh
npm install --global @rarc88/spec-ledger
# or: pnpm add --global @rarc88/spec-ledger
```

In a repository that already has an `AGENTS.md`:

```sh
sl init
sl view
```

`sl init` creates `.sl/`, gives the project a stable identity and links the
installed agent contract. The repository keeps only its configuration and
documents; the CLI and viewer remain in the global package.

## The workflow

```text
conversation → draft → human approval → implementation → review
             → human validation → persistent specification
```

A typical change starts like this:

```sh
sl new feature oauth-login "Add OAuth login"
sl view
```

The agent completes the generated stages under `.sl/changes/`. You approve the
draft in the viewer before implementation. From there, Spec Ledger validates
lifecycle transitions, task traceability and the final human acceptance gate.
When the work is done, its lasting truth graduates into `.sl/specs/`.

The contract is agent-agnostic: Codex, Claude Code, opencode, Copilot, Cursor and
other tools discover it through the repository's `AGENTS.md` reference.

## Changes and specs

- **Changes** describe a delta: why it is needed, what was learned, the chosen
  design, acceptance criteria, implementation tasks and execution log.
- **Specs** describe the current system after completed changes graduate. They
  have no work lifecycle and remain concise, durable product truth.

With the default Definition of Ready policy, `sl check` verifies that acceptance
criteria are test-grade and mapped to actionable tasks. Repositories doing
exploratory work can set `tdd: false`; the complete rules live in
[`AGENTS.md`](AGENTS.md).

## Essential commands

### Set up and inspect

```sh
sl init                         # initialize and register the current repository
sl register                     # relink a moved or freshly cloned repository
sl view                         # view every registered project
sl view .                       # view only the current project
sl check [id]                   # validate the repository or one change
```

### Work with changes

```sh
sl new <type> <slug> <title>    # create a draft change
sl list [--status S] [--type T]
sl show <id> [--json]
sl status <id> <status>
sl task <id> done|block <n> [reason]
sl log <id> <message>
sl review <id> pass|fail        # record the independent review verdict
sl discard <id> <reason>
```

### Preserve completed truth

```sh
sl graduate <id> <spec-slug>           # create a persistent spec
sl graduate <id> <spec-slug> --into    # update an existing spec's provenance
sl graduate <id> --skip [reason]       # record that no spec is needed
sl archive --graduated [--dry-run]     # hide resolved changes from the board
```

Run `sl --help` or `sl <command> --help` for the complete command reference.

## Release planning

Spec Ledger can calculate a portable SemVer release from completed changes
without assuming a package ecosystem:

```sh
sl release init 0.1.0       # adopt an existing published version once
sl release plan --json      # calculate the next version without writing
sl release record 0.2.0     # record the calculated release manifest
```

The CLI decides which changes belong to the release and calculates their
effective `release_impact`. The operating agent applies that version to the
project's own surfaces—`package.json`, `pubspec.yaml`, `Cargo.toml`, Gradle,
Xcode or a monorepo—then runs the local quality gates and release workflow.

## Repository integration

`sl check` exits non-zero on contract errors, so it can be used in Git hooks and
CI:

```sh
sl check || exit 1
```

The contract itself ships with the CLI and is linked as `.sl/AGENTS.md`. It is
per-machine and gitignored, so upgrades do not leave committed copies behind.
Run `sl register` after cloning, moving a repository or updating the global
installation.

## Compatibility and security

- Node.js **24+**.
- Tested on Linux, macOS and Windows.
- On Windows, contract linking uses a symlink when permitted and falls back to a
  copy when Developer Mode or administrator privileges are unavailable.
- The viewer binds to loopback and treats repository content as untrusted input.
  See [`SECURITY.md`](SECURITY.md) for the threat model and private reporting
  instructions.

## Project status

Spec Ledger is usable and self-hosting, but remains **pre-1.0**. Expect the
contract and CLI to evolve while the core workflow settles. Upgrade to the
latest `0.x` release to receive fixes.

Contributions are welcome. Development setup, quality gates and repository
conventions live in [`CONTRIBUTING.md`](CONTRIBUTING.md). The canonical agent
contract is [`AGENTS.md`](AGENTS.md).

## Language policy

Structure is always English: frontmatter keys, enum values, stage headings, CLI
commands and filenames. Generated content follows the repository's configured
`language`.
