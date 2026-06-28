# Implementing an Approved Change

1. Keep one concern per change. Work necessary for the authorized objective may
   update Specification, Plan and Log. Materially expanded observable scope
   needs explicit human authorization; independent work is proposed separately.
   If related work materially expands observable scope, obtain explicit human
   authorization before adding it.
2. Never implement approved changes on `main`, `master`, or `dev`. Inspect the
   worktree first. If unrelated changes exist, do not include them silently.
3. Commit the approved change documentation before touching implementation code.
   Implement one change at a time.
4. Commit a completed unit before continuing when another task or shared edit makes attribution
   ambiguous. Commit messages reference the id. If shared files force a combined
   commit, record that explicitly. If shared files make a combined commit
   unavoidable, name every change sharing the surface.
5. Keep the change current with `changeledger task`, `changeledger log`,
   `changeledger owner` and `changeledger status`.
6. Follow the Specification exactly. Write a failing test from each criterion,
   make it pass, then refactor. Do not silently drift the document.
7. Leave no TODO/FIXME, dead code or unrelated residue without explicit agreement.
8. When implementation and tasks are complete, move to `in-review` if the type
   requires independent review; otherwise move to `in-validation` and stop.

## Correction isolation

After review `fail --retry`, keep the candidate correction uncommitted while a
fresh clean-context reviewer checks it. If it fails again, iterate on that diff.
After `pass`, commit the confirmed correction and ledger truth before asking for
human validation.

After human rejection (`in-validation → in-progress`), keep the correction
uncommitted until the human confirms it. Do not start another task or change
while a correction waits; the worktree is the isolation boundary.

## Triage friction at handoff; retrospect after completion

Before handing the human completed or blocked work, classify discovered
friction:

- If necessary to fulfill the purpose of an active change, update that change.
- If it is an operational step such as verify, commit, graduate or archive,
  execute or record it in the current flow.
- If independent or materially larger, propose its type, title, and reason to
  the human. Create the draft only after explicit authorization.
- If too vague for backlog, mention it without creating a file.

When a change reaches `done`, also share a brief retrospective with the human.

## Useful commands

- `changeledger status <id> <status>`
- `changeledger task <id> done|block <n> [reason]`
- `changeledger log <id> "<message>"`
- `changeledger owner <id> <name|->`
- `changeledger check [id]`
