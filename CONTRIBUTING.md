# Contributing to Spec Ledger

Thanks for your interest. Spec Ledger **dogfoods itself**: changes are planned
as documents under `.sl/` before code is written. Please follow the same flow.

## The flow

1. **Plan first.** Scaffold a change: `sl new <type> <slug> "<title>"`. Fill the
   stages your type activates (see [`AGENTS.md`](AGENTS.md)). Open `sl view` to
   read it rendered.
2. **Get it approved.** A change starts in `draft`. Don't implement until it's
   `approved` (the human's one move, in the viewer or by editing the file).
3. **Implement via TDD.** With `tdd: true`, write the failing test from each
   acceptance criterion (`CRn`), make it pass, refactor. Tick tasks as you go
   (`sl task <id> done <n>`) and move status with `sl status`.
4. **Independent review.** Types with `review_required` pass through `in-review`
   before `done` — a fresh, clean-context review verifies every `CRn` is met and
   no residue is left.
5. **Graduate the truth.** On `done`, update or create the affected `specs/`
   doc (`sl graduate ...`), or `--skip` when there's no persistent truth.

The full contract for agents is [`AGENTS.md`](AGENTS.md).

## Quality gate

Every commit must pass the gate. Enable the hook and run it locally:

```sh
git config core.hooksPath hooks   # enable the pre-commit gate
pnpm verify                       # lint (Biome) + tests (node --test) + sl check
```

- **Atomic commits** referencing the change id: `feat(scope): description [#<id>]`.
- Commit messages in English, Conventional Commits, subject ≤ 50 chars.
- No `TODO`/`FIXME` or dead code in delivered work.

## Reporting security issues

See [`SECURITY.md`](SECURITY.md) — report vulnerabilities privately, not as a
public issue.
