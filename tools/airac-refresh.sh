#!/usr/bin/env bash
# Rebuild data/ for every airport at the AIRAC cycle effective today and, when it differs from the
# checked-out main, push it to airac/<cycle> and open a pull request (or leave the open one to pick up the push).
# Needs GH_TOKEN with contents: write and pull-requests: write, uv with the generator synced, and jq.
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN must hold a token that may push a branch and open a pull request}"

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

mapfile -t airports < <(jq -r '.[].icao' data/airports.json)
if [ "${#airports[@]}" -eq 0 ]; then
  echo "error: data/airports.json lists no airport" >&2
  exit 1
fi

cycle=$(uv run --project generator python -c \
  'from datetime import date; from craft_generator.cifp.cycle import cycle_id_for, effective_date_for; print(cycle_id_for(effective_date_for(date.today())))')
branch="airac/$cycle"
echo "AIRAC $cycle: rebuilding ${airports[*]}"

for icao in "${airports[@]}"; do
  uv run --project generator craft-gen build --airport "$icao" --cycle "$cycle" --skip-sop-verify
done

git add -- data/
if git diff --cached --quiet; then
  echo "data/ matches main for AIRAC $cycle; no pull request needed"
  exit 0
fi

git switch -C "$branch"
git -c user.name='github-actions[bot]' \
  -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
  commit --quiet -m "data: AIRAC $cycle"

auth_header="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)"
git -c "http.https://github.com/.extraheader=$auth_header" push --force origin "HEAD:refs/heads/$branch"

open_prs=$(gh pr list --head "$branch" --base main --state open --json number --jq 'length')
if [ "$open_prs" -gt 0 ]; then
  echo "updated $branch; its open pull request picks up the push"
  exit 0
fi

body=$(printf '%s\n\n%s\n\n%s\n' \
  "Rebuilds data/ for AIRAC $cycle (${airports[*]}) with \`craft-gen build --skip-sop-verify\`." \
  "The SOP and CPS-004 pins were not checked on the runner; run \`craft-gen verify-sop\` locally before merging." \
  "CI does not run on a PR opened by this workflow; close and reopen it, or push to the branch, to run it.")
gh pr create --base main --head "$branch" --title "data: AIRAC $cycle" --body "$body"
