# Closing Accepted Work

This change is delivered: resolve persistent truth before archiving. Run
`changeledger context <id>` once it reaches `done` even if the base context was loaded
earlier; this close overlay is not part of the base context. Changes describe a journey;
`.changeledger/specs/*.md` describe the current capability, architecture or domain truth
that code reflects.

Specs have no lifecycle or `status`. They use minimal frontmatter and free Markdown:

```yaml
---
title: Short title
updated: 2026-06-30T10:00:00Z
tags: []
graduated_from: []
---
```

First decide whether accepted work changed persistent truth:

- If it did, identify and reconcile every affected spec. Inspect existing specs
  before creating one; correct, replace or remove obsolete and contradictory
  claims before extending them with new truth. A spec states one coherent current
  capability, never a chronology of changes.
- Use `--new` only when no existing spec owns that truth. One change may create,
  correct or extend several specs; link each one individually with `--into` and
  do not archive until every affected spec is linked.
- Use `--skip` only when no persistent truth changed.
- A change with a `parent` never links a spec: its epic reconciles once at
  closure, and the child records its own decision with `--skip`.

No delegate reviews the reconciliation: the human reviews it when merging the change's
branch.

CR identifiers and headings are local traceability for a change; they must not
remain as structure in specs. Rewrite their substance as concise durable truth;
both `--into` and `changeledger check` reject CR headings outside code fences.

The two outcomes — spec reconciliation or `--skip` — are exclusive. Every graduation
command requires an explicit mode; a positional slug without one is an error, so words
such as `skip` or `skip-*` can never silently become specs.

For a new spec, follow this ordered recipe — `--new` alone does not finish it:

1. `changeledger graduate <id> <spec-slug> --new` creates a seed from the
   change's Specification or, lacking one, its Request, but leaves graduation
   pending; it does not set `reviewed: true`.
2. Rewrite the seed as concise durable current truth and remove the explicit
   scaffold marker.
3. `changeledger graduate <id> <spec-slug> --into` finalizes it; `--into`
   refuses an unrefined marked scaffold and sets `reviewed: true`.

For an existing spec affected by the change, reconcile its body first, then run
`changeledger graduate <id> <spec-slug> --into`: it refreshes `updated`, records the
link, leaves the body alone and sets `reviewed: true`.
`changeledger graduate <id> --skip [reason]` records that no persistent truth changed
and sets `reviewed: true`.

`reviewed: true` means the persistent-truth question was settled, not necessarily that
a spec was created, and it does not end a multi-spec reconciliation before every
affected spec is linked. `--into` records the link in both directions — the change Log
carries `graduado a spec` and the spec appends the change id to `graduated_from` — and
`changeledger check` requires both sides to agree.

After `--into` or `--skip`, create one final closure commit that coalesces any pending
`in-review → done` ledger updates with the graduation decision and durable spec edit.
If no lifecycle state is pending, the graduation or skip itself is the closure evidence.

`changeledger list`, `show` and `archive` print their filters with `--help`. Three rules
those filters do not carry: every id from `list --pending graduation` is resolved
individually with `--new`, `--into` or `--skip`, because graduation is never a bulk
mutation; `archive --graduated` without a filter stays repository-wide and deletes no
branches; and `archive <id>` deletes that change's own local branch once it is merged
into the integration branch, which editing `archived: false` does not undo.

Use Mermaid where it communicates persistent relationships better than prose.
After closure, share a brief retrospective: what went well and what caused friction.
