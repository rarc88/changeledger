#!/bin/sh
# Rejects added lines that cite the ledger (a change id or a `CRn` criterion)
# outside .changeledger/. The contract keeps that reference one-way: the change
# points at code through Target, Verify and the [#id] commit marker.
#   no-ledger-refs.sh --cached          staged diff (pre-commit)
#   no-ledger-refs.sh origin/dev...HEAD any `git diff` range (CI)
# Exit 1, after reporting every offence, when one is found.
set -eu

[ $# -eq 1 ] || { echo "usage: $0 --cached | <range>" >&2; exit 2; }
if [ "$1" = "--cached" ]; then target=--cached; else target=$1; fi

# -U0 plus --diff-filter=AM: only added or modified files, only their changed lines.
diff=$(git -c core.quotePath=false diff -U0 --diff-filter=AM --no-color "$target") || exit 2

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
      || path == "templates/contract/spec.md") next
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
