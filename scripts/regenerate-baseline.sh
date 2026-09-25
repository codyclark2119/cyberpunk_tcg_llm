#!/usr/bin/env bash
# Regenerate every engine-pinned artifact after an engine identity change:
# wire schemas, ordinary replays, the 192-game Demo matrix and its reviews.
#
# Usage:
#   npm run baseline:regenerate
#   npm run baseline:regenerate -- --preserved <git-ref>
#
# --preserved first audits that the replays committed at <git-ref> (normally
# the last commit before the runtime change) still reproduce their original
# decisions under the current engine. The script never commits; review the
# diff, run the full gates, and commit the regenerated tree explicitly.
set -euo pipefail

cd "$(dirname "$0")/.."

preserved=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --preserved) preserved="${2:?--preserved requires a git ref}"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

if command -v sha256sum >/dev/null; then sha=(sha256sum); else sha=(shasum -a 256); fi
tree_manifest() {
  find packages/wire/schemas tests/fixtures -type f -print0 | sort -z | xargs -0 "${sha[@]}"
}

tmp="$(mktemp -d "${TMPDIR:-/tmp}/tcg-baseline.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

echo "Engine identity: $(node --import tsx scripts/print-engine-identity.ts)"

if [[ -n "$preserved" ]]; then
  echo "== Preserved replay compatibility ($preserved) =="
  git archive "$preserved" tests/fixtures | tar -xf - -C "$tmp"
  node --import tsx scripts/audit-replay-compatibility.ts "$tmp/tests/fixtures"
fi

# The matrix, its trace-backed reviews and the Reboot multiplicity replays run
# separately below; every other generate-*.ts is an independent writer.
generators=()
for script in scripts/generate-*.ts; do
  case "$(basename "$script")" in
    generate-demo-match-matrix.ts|generate-demo-match-matrix-coordinate.ts|generate-reboot-multiplicity-replays.ts) ;;
    *) generators+=("$script") ;;
  esac
done

echo "== Wire schemas and ${#generators[@]} replay writers =="
npm run contracts:export
for script in "${generators[@]}"; do
  echo "== $(basename "$script") =="
  node --import tsx "$script"
done
node --import tsx scripts/generate-reboot-multiplicity-replays.ts
node --import tsx scripts/generate-reboot-multiplicity-replays.ts --check

echo "== Demo matrix =="
DEMO_MATRIX_CONCURRENCY="${DEMO_MATRIX_CONCURRENCY:-8}" npm run test:matrix

echo "== Matrix-dependent reviews =="
node --import tsx scripts/review-reboot-multiplicity-matrix.ts
node --import tsx scripts/review-reboot-multiplicity-matrix.ts --check
node --import tsx scripts/review-demo-matrix-positions.ts
node --import tsx scripts/review-demo-matrix-positions.ts --check
npm run review:descriptor-v2
npm run review:descriptor-v2 -- --check

echo "== Final writer stability =="
tree_manifest > "$tmp/final.sha256"
npm run contracts:export
node --import tsx scripts/generate-reboot-multiplicity-replays.ts --check
node --import tsx scripts/review-reboot-multiplicity-matrix.ts --check
node --import tsx scripts/review-demo-matrix-positions.ts --check
npm run review:descriptor-v2 -- --check
tree_manifest > "$tmp/final-check.sha256"
diff -u "$tmp/final.sha256" "$tmp/final-check.sha256"

echo "== Changed generated paths =="
git status --short -- tests/fixtures packages/wire/schemas
