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

## Changes and specs

- **Changes** describe a delta: why it is needed, what was learned, the chosen
  design, acceptance criteria, implementation tasks and execution log.
- **Specs** describe the current system after completed changes graduate. They
  have no work lifecycle and remain concise, durable product truth.

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
changeledger list [--status S] [--type T]
changeledger show <id> [--json]
changeledger status <id> <status>
changeledger task <id> done|block <n> [reason]
changeledger log <id> <message>
changeledger review <id> pass
changeledger review <id> fail --retry "<reason>"
changeledger review <id> fail --block "<reason>"
changeledger discard <id> <reason>
```

### Preserve completed truth

```sh
changeledger graduate <id> <spec-slug>           # create a persistent spec
changeledger graduate <id> <spec-slug> --into    # update an existing spec's provenance
changeledger graduate <id> --skip [reason]       # record that no spec is needed
changeledger archive --graduated [--dry-run]     # hide resolved changes from the board
```

Run `changeledger --help` or `changeledger <command> --help` for the complete command reference.

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
```

`init` places a small fail-closed bootstrap in the project-owned `AGENTS.md`;
there is no linked or copied contract under `.changeledger/`. Run
`changeledger register` after upgrading to refresh that bootstrap.

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
