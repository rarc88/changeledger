# Closing Accepted Work

The human accepted this change. Graduate persistent truth before archiving:

- `changeledger graduate <id> <spec-slug>` creates a new spec.
- `changeledger graduate <id> <spec-slug> --into` links an existing spec and
  refreshes `updated` without overwriting the spec body (the agent edits the body manually).
- `changeledger graduate <id> --skip [reason]` records that no persistent truth
  changed.
- `changeledger graduate --pending` lists unresolved graduation decisions.
- `changeledger archive <id>` hides the completed record from the default board.

Specs have no lifecycle: minimal frontmatter (`title`, `updated`, `tags`) plus
free Markdown describing current capabilities, architecture or domain truth.
The change is the journey; the spec is the destination.

After closure, share a brief retrospective. New work needs a new authorized
change; `done` never reopens.
