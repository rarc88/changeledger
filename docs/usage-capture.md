# Usage capture (`changeledger.usage.collector`)

Optional, local record of the tokens and cost spent on each change, taken from
the harness logs by the third-party [`ccusage`](https://github.com/ryoppippi/ccusage)
(pinned to 20.0.26). ChangeLedger keeps no price table and no per-harness parser;
it filters, renames and freezes what `ccusage` reports at the moment of capture.

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

- Unset: a transition reads that one value and nothing else runs; no record
  directory is created.
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

Each call runs `npx --yes ccusage@20.0.26 …` with a 10 s limit:

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

```
<git rev-parse --git-common-dir>/changeledger/usage/<id>/<YYYYMMDDTHHMMSSZ>-<n>.json
```

The repository's worktrees resolve the same common dir, so their records land
side by side. The directory sits inside the git directory: `git status` does not
list it, the state ref does not carry it, and `changeledger check` ignores it.
`<n>` starts at
1 and grows when a record with the same instant already exists. A ledger
outside a git repository has no common dir: without a value (git can still
resolve a global one there) nothing happens; with `ccusage` the snapshot is
skipped with a `usage: snapshot failed: not a git repository, no usage record
written` warning.

Record shape (`schema: 1`):

```json
{
  "schema": 1,
  "change": "<id>",
  "at": "<ISO instant of the event>",
  "event": "created | status | review | validation",
  "from": "<status or null>",
  "to": "<status>",
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

## Known limits

- `ccusage` recomputes a session's cumulative cost with the prices current at
  each snapshot, so a price change during a session mixes tables between two
  records; both records keep their own values.
- The `projectPath` encoding is not documented upstream; a drift there shows up
  as `no sessions matched this repository`, not as an error.
- Sources whose sessions carry no `projectPath` cannot be attributed to a
  repository and are only counted in `excluded`.
