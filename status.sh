#!/usr/bin/env bash
# Update the door sign status. Run from anywhere inside the doorsign repo clone.
#
#   ./status.sh "In a meeting" "Back at 15:00"
#   ./status.sh "WFH today"
#   ./status.sh clear          # removes the status strip from the page

set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)
FILE="$REPO_ROOT/status.json"

[ $# -ge 1 ] || { echo "usage: status.sh \"<status>\" [\"<note>\"]  |  status.sh clear"; exit 1; }

if [ "$1" = "clear" ]; then
  printf '{}\n' > "$FILE"
  MSG="status: clear"
else
  STATUS=$1
  NOTE=${2:-}
  UPDATED=$(date +%Y-%m-%dT%H:%M:%S%z)
  printf '{\n  "status": "%s",\n  "note": "%s",\n  "updated": "%s"\n}\n' \
    "$STATUS" "$NOTE" "$UPDATED" > "$FILE"
  MSG="status: $STATUS${NOTE:+ — $NOTE}"
fi

git -C "$REPO_ROOT" add "$FILE"
git -C "$REPO_ROOT" commit -m "$MSG" --quiet
git -C "$REPO_ROOT" push --quiet
echo "done: $MSG (live in ~1 min after Pages rebuild)"
