# Usage capture (`changeledger.usage.collector`)

Optional record of the tokens and cost spent on each change, taken from the
harness logs by the third-party [`ccusage`](https://github.com/ryoppippi/ccusage)
(pinned to 20.0.26). ChangeLedger keeps no price table and no per-harness parser;
it filters, renames and freezes what `ccusage` reports at the moment of capture.
Each clone decides whether it measures; what it measures is stored in the ledger
and shared like the rest of it.

## Enabling it

Capture measures the local machine, so each clone turns it on in git config,
not in `.changeledger/config.yml`:

```sh
git config changeledger.usage.collector ccusage          # this clone
git config --global changeledger.usage.collector ccusage # this user, where no local value overrides it
```

The value is read with `git config --get changeledger.usage.collector`, so git
resolves it from its usual scopes (local, global, system), and a repository's
worktrees share its local value. It works the same in an activated repository,
whose `config.yml` lives in the state ref.

- Unset: a transition reads that one value and nothing else runs; no record is
  written and the state ref gains no commit.
- `ccusage`: capture is on.
- Any other value, including an empty one or another letter case: `changeledger
  check` reports `git config "changeledger.usage.collector" must be "ccusage"`,
  and a transition skips the snapshot with a
  `usage: snapshot skipped: git config "changeledger.usage.collector" must be "ccusage"`
  warning.

A `usage` key in `config.yml` is not read and not validated.

## When a snapshot is taken

After the ledger write succeeds, for:

- change creation: `changeledger new` (scaffold or `--from`) and an `apply`
  entry with `target: "new"` — `event: "created"`, `from: null`, `to: "draft"`,
  `at` = the document's `created`;
- each `[status]`, `[review]` and `[validation]` Log event written by `status`,
  `approve`, `review`, `validation`, `reopen`, `discard`, a viewer transition or
  an `apply` `status` entry — `at` = the instant of that Log line.

`log`, `task`, `owner`, `branch`, `archive`, `graduate`, `edit`, `fix` and a
dry-run `apply` have no snapshot wired and take none. One `apply` that writes several events
collects once and writes one record per event.

## How a snapshot is composed

Each call runs `npx --yes ccusage@20.0.26 …` with a 10 s limit. The limit
covers the call's process group: the command runs in its own process group, and
the group is killed with SIGKILL (on Windows, `taskkill /T /F`) when the limit
expires, when SIGINT, SIGTERM, SIGHUP or SIGQUIT reach the CLI's process group (Ctrl-C, Ctrl-\,
a closed terminal), or when the CLI process is killed alone and the call's
next output can no longer be relayed (a call that writes nothing is then ended
by the limit). That also ends descendants that stayed in the
group, such as the process `npx` starts; a descendant that moves to a new
process group or session escapes it. Tested on Linux with a local stand-in that
starts a long-sleeping child and keeps writing output; the Windows path is
untested. Only on Windows, and only for the built-in `npx` command, the
call goes through `cmd.exe`, as one command line built from fixed tokens and
validated source names.

The snapshot is composed in four steps:

1. `session --json --offline --no-cost` lists which sources (`agent`) have
   sessions on this machine.
2. Per source, `<source> session --json` with online prices; if that call fails,
   it is repeated with `--offline` and `collector.pricing` becomes `"offline"`
   (warning `usage: online pricing unavailable; used ccusage offline prices`).
3. Only sessions whose `projectPath` equals the encoding of the repository root
   or of one of its worktrees (`git worktree list --porcelain`) are kept. The
   encoding is the absolute path with each non-alphanumeric character replaced
   by `-`; the comparison is by equality, because `<repo>-foo` encodes to a
   string that starts with `<repo>`'s encoding. Sessions without `projectPath`
   are counted per source in `excluded` (warning
   `usage: excluded <source> (<n> sessions without projectPath)`). Zero kept
   sessions warns `usage: no sessions matched this repository`.
4. A model listed in `totals.unpricedModels` (or flagged `missingPricing`) is
   recorded with `cost_usd: null` instead of the `0` ccusage reports for it.

Totals are cumulative per session; the consumption of a stretch is the
difference between two consecutive records, left to a future analyzer.

## Where records live

Records are the ledger's `usage` collection, one flat file per record:

```
.changeledger-state/usage/<id>--<YYYYMMDDTHHMMSSZ>-<8 hex>.json   # activated: in the state ref
.changeledger/usage/<id>--<YYYYMMDDTHHMMSSZ>-<8 hex>.json         # worktree layout
```

`<id>` is the change, `<YYYYMMDDTHHMMSSZ>` the event's instant and `<8 hex>` a
random suffix. Two clones that record the same change in the same second
write different paths unless their random suffixes coincide (one chance in
2³² per pair), so `changeledger sync` merges their records like any other
disjoint documents.

- Activated repository: each record is published as its own commit on the state
  ref, `usage: <id> <event>`, that only adds that file. It is taken after the
  transition's commit and after `ccusage` returned, against the tip as it is
  then. If another writer moved the ref in between, the commit is retried once
  against the new tip.
- Worktree layout: the record is written to `.changeledger/usage/` and left
  unstaged. `changeledger commit` stages the records whose file name carries
  one of the change ids of that commit, never another change's, so they travel
  with the change's commit like its Log. A `--no-change` commit stages none, and
  a commit in an activated repository stages none either.

The repository's linked worktrees record into the ledger they work on: the
shared state ref when activated, their own worktree otherwise. ChangeLedger has
no command that edits or deletes a record; `cutover` and `import --from <ref>` carry
them under the same name (`import` identifies a record by its file name, so the
same name with different bytes is a conflict), and a state-ref mutation that
would drop one is refused, even through an explicit removal. `sync`'s
reconciliation and fast-forward do not run that check: they keep whatever
the two journals hold. Records from the first version of the collector, kept in
`<git-common-dir>/changeledger/usage/`, are neither read nor migrated.

A ledger outside a git repository has no worktree list to match sessions
against: without a value (git can still resolve a global one there) nothing
happens; with `ccusage` the snapshot is skipped with a
`usage: snapshot failed: not a git repository, no usage record written` warning.

`changeledger check` validates every record of the collection, and each finding
starts with `usage record <name>: `: a name outside the form above, invalid
JSON, a value that is not an object, a `schema` other than `1`, or a `change`
that differs from the id in the name. Both loaders (the CLI's and the viewer's)
expose the records with the rest of the ledger, as `usage` entries
`{ name, change, record, error }`; a record that is not valid JSON (or, in the
worktree layout, cannot be read) stays an entry with `record: null` and does
not stop the rest of the ledger from loading.

Record shape (`schema: 1`):

```json
{
  "schema": 1,
  "change": "<id>",
  "at": "<ISO instant of the event>",
  "event": "created | status | review | validation",
  "from": "<status or null>",
  "to": "<status>",
  "recorded_by": "<the identity resolved for owner, or null>",
  "collector": { "name": "ccusage", "version": "20.0.26", "pricing": "online | offline | null" },
  "sessions": [
    {
      "source": "claude",
      "session_id": "<sessionId>",
      "project_path": "<projectPath>",
      "first_activity": "<ISO>",
      "last_activity": "<ISO>",
      "models": [
        {
          "model": "<modelName>",
          "input_tokens": 0,
          "output_tokens": 0,
          "cache_read_tokens": 0,
          "cache_write_tokens": 0,
          "cost_usd": 0.0
        }
      ]
    }
  ],
  "excluded": [{ "source": "<source>", "sessions": 0 }],
  "error": null
}
```

## Failures

A missing `npx`, a call over 10 s, a non-zero exit on both attempts or invalid
JSON leaves a record with `sessions: []`, `pricing: null` and a non-null
`error`, plus a `usage: snapshot failed: …` warning on stderr. The transition is
already written by then; the command keeps its output and exit code.

A record that cannot be stored — the state ref moved again after the retry, or
any other failure to publish or write it — is dropped with a
`usage: record not published: <reason>` warning on stderr. Nothing is written
anywhere for it, and the transition and the command's exit code stay as they
were.

`recorded_by` is resolved the way `owner` is (GitHub login through `gh`, else
`git config user.name`), once per snapshot; an empty result is stored as
`null`.

## Known limits

- `ccusage` recomputes a session's cumulative cost with the prices current at
  each snapshot, so a price change during a session mixes tables between two
  records; both records keep their own values.
- The `projectPath` encoding is not documented upstream; a drift there shows up
  as `no sessions matched this repository`, not as an error.
- Sources whose sessions carry no `projectPath` cannot be attributed to a
  repository and are only counted in `excluded`.
