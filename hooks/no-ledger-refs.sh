#!/bin/sh
# Rejects added lines that cite the ledger (a change id or a `CRn` criterion)
# outside .changeledger/. The contract keeps that reference one-way: the change
# points at code through Target, Verify and the [#id] commit marker. test/helpers/
# is exempt: it is where a test builds the ledger-shaped fixtures it needs.
#   no-ledger-refs.sh --cached          staged diff (pre-commit)
#   no-ledger-refs.sh origin/dev...HEAD any `git diff` range (CI)
# Exit 1, after reporting every offence, when one is found.
set -eu

[ $# -eq 1 ] || { echo "usage: $0 --cached | <range>" >&2; exit 2; }
if [ "$1" = "--cached" ]; then target=--cached; else target=$1; fi

# -U0 plus --diff-filter=AMR: added, modified or renamed files, only their changed
# lines. Fixed prefixes and no external driver: the `+++ b/` header is parsed below.
diff=$(git -c core.quotePath=false diff -U0 --diff-filter=AMR --no-color --no-ext-diff \
  --src-prefix=a/ --dst-prefix=b/ "$target") || exit 2

printf '%s\n' "$diff" | awk '
BEGIN {
  d = "[0-9]"
  idRe = "(^|[^0-9])" d d d d d d d d "-" d d d d d d "([^0-9]|$)"
  crRe = "(^|[^A-Za-z0-9_])CR[0-9]+([^A-Za-z0-9_]|$)"
}
/^diff --git / { inHunk = 0; path = ""; next }
!inHunk && /^\+\+\+ / { path = substr($0, 7); sub(/\t.*/, "", path); next }
/^@@ / { inHunk = 1; match($0, /\+[0-9]+/); line = substr($0, RSTART + 1, RLENGTH - 1) + 0; next }
!inHunk { next }
/^\+/ {
  text = substr($0, 2)
  n = line++
  if (index(path, ".changeledger/") == 1 || index(path, ".changeledger-state/") == 1 \
      || index(path, "test/helpers/") == 1 || path == "templates/contract/spec.md") next
  hit = ""; at = 0
  if (match(text, idRe)) {
    off = RSTART; m = substr(text, RSTART, RLENGTH); match(m, /[0-9]+-[0-9]+/)
    hit = substr(m, RSTART, RLENGTH); at = off + RSTART
  }
  if (match(text, crRe)) {
    off = RSTART; m = substr(text, RSTART, RLENGTH); match(m, /CR[0-9]+/)
    if (hit == "" || off + RSTART < at) hit = substr(m, RSTART, RLENGTH)
  }
  if (hit != "") { print path ":" n ": ledger reference outside .changeledger/: " hit; bad = 1 }
  next
}
/^ / { line++ }
END { exit bad }
'
