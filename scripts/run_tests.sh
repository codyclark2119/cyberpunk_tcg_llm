#!/usr/bin/env bash
# Single local validation command (GitHub runs nothing automatically).
#
# Usage: scripts/run_tests.sh [--quick | --full] [--only STEP]... [--fail-fast]
#                             [--no-infra] [--list] [--help]
#
#   (default)     full tier: every quick step plus build, deck rules and the
#                 database integration suite
#   --quick       quick tier: guard tests, typecheck, lint, card validation,
#                 unit suite and the Python harness suites
#   --full        explicit full tier (the default)
#   --only STEP   run only STEP (repeatable); tiers are ignored. See --list.
#   --fail-fast   stop at the first failing step (default: run every step and
#                 report all failures at the end)
#   --no-infra    do not run `npm run infra:up` before the integration suite;
#                 the database must already be reachable
#   --list        print step names with their tier and exit
#   -h, --help    print this help and exit
#
# Environment:
#   PYTHON              Python interpreter (default: python3, else python)
#   TEST_MONGODB_URI    integration MongoDB URI; defaults to the docker-compose
#                       service on MONGO_PORT (default 27017)
#   RUN_TESTS_BASE      base ref for the whitespace diff check
#                       (default: merge-base with origin/master, else master)
#
# Logs go to ${TMPDIR:-/tmp}/run_tests.<pid>/<step>.log. Exit status is 0 only
# when every selected step passed; 2 means a usage error.
#
# Must run on macOS bash 3.2: no mapfile, associative arrays or ${x,,}.

set -euo pipefail

# ============================================================================
# STEP AND PASS-LINE PIN TABLE (the single place to edit when counts change)
# ============================================================================
# One row per step, in execution order:   name | tier | command | checks
#   tier     quick (runs in both tiers) or full (full tier only)
#   command  run through `eval` from the repo root, output teed to the log;
#            its exit status must be 0 (pipefail)
#   checks   ';;'-separated list, all must hold on the step's log:
#              line:TEXT      some log line is exactly TEXT
#              contains:TEXT  some log line contains TEXT
#              absent:TEXT    no log line contains TEXT
#              tap:N          complete Node TAP summary, zero fail/skip/todo/
#                             cancelled, at least N tests (assert-test-summary)
#              -              exit status only
# Columns are trimmed of surrounding spaces; TEXT keeps its inner spacing.
STEP_TABLE='
guard-tests          | quick | node --test scripts/validation/*.test.mjs      | tap:1
typecheck            | quick | npm run typecheck                               | -
lint                 | quick | npm run lint                                    | -
validate-cards       | quick | npm run validate:cards                          | -
unit                 | quick | npm test                                        | tap:1
build                | full  | npm run build                                   | -
diff-check           | full  | run_diff_check                                  | -
py-deps              | quick | check_py_deps                                   | -
py-compile           | quick | "$PY" -m compileall -q games harness scripts    | -
py-cyberpunk         | quick | "$PY" scripts/test_cyberpunk.py                 | line:all 89 tests passed
py-harness-core      | quick | "$PY" scripts/test_harness_core.py              | line:48 tests passed
py-engine-candidates | quick | "$PY" scripts/test_engine_candidates.py         | line:PASS 3/3
py-policy-bot        | quick | "$PY" scripts/test_policy_bot.py                | line:PASS policy layer: 27/27
py-policy-mlx        | quick | "$PY" scripts/test_policy_mlx.py                | line:PASS local MLX bot: 32/32
py-engine-adapter    | quick | "$PY" scripts/test_engine_adapter.py --app-root . | -
py-local-match       | quick | "$PY" scripts/test_local_match.py               | line:PASS local match runner: 14/14
py-local-prompt      | quick | "$PY" scripts/test_local_prompt.py              | line:PASS local prompt: 9/9
py-validation-console| quick | "$PY" scripts/test_validation_console.py        | line:PASS validation console: 8/8
py-play-app          | quick | "$PY" scripts/test_play_app.py                  | line:PASS local play UI: 12/12
py-assistant-tools   | quick | "$PY" scripts/test_assistant_tools.py           | line:PASS assistant tools: 14/14
py-assistant-decks   | quick | "$PY" scripts/test_assistant_deck_tools.py      | line:PASS assistant deck tools: 12/12
py-assistant-loop    | quick | "$PY" scripts/test_assistant_loop.py            | line:PASS assistant loop: 16/16
deck-rules           | full  | "$PY" scripts/check_deck_rules.py --negative-control | contains:agree:    272/272;;contains:reproduce budget AND usage exactly: 272/272;;absent:<-- LOOK
integration          | full  | prepare_integration && npm run test:integration | tap:3
'
# ============================================================================

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
GUARD="$REPO_ROOT/scripts/validation/assert-test-summary.mjs"

usage() { sed -n '2,/^# Must run/p' "${BASH_SOURCE[0]}" | sed -e 's/^# \{0,1\}//' -e '/^Must run/d'; }
die_usage() { echo "run_tests.sh: $*" >&2; echo "Try 'scripts/run_tests.sh --help'." >&2; exit 2; }

trim() {
  local s=$1
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

# Parse the table into parallel indexed arrays (bash 3.2 safe).
STEP_NAMES=(); STEP_TIERS=(); STEP_CMDS=(); STEP_CHECKS=()
while IFS='|' read -r f_name f_tier f_cmd f_checks; do
  f_name=$(trim "$f_name")
  [ -n "$f_name" ] || continue
  STEP_NAMES+=("$f_name")
  STEP_TIERS+=("$(trim "$f_tier")")
  STEP_CMDS+=("$(trim "$f_cmd")")
  STEP_CHECKS+=("$(trim "$f_checks")")
done <<EOF
$STEP_TABLE
EOF

step_index() {
  local i
  for i in "${!STEP_NAMES[@]}"; do
    if [ "${STEP_NAMES[$i]}" = "$1" ]; then echo "$i"; return 0; fi
  done
  return 1
}

# ---------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------
TIER=full
FAIL_FAST=0
NO_INFRA=0
ONLY=()
while [ $# -gt 0 ]; do
  case "$1" in
    --quick) TIER=quick ;;
    --full) TIER=full ;;
    --fail-fast) FAIL_FAST=1 ;;
    --no-infra) NO_INFRA=1 ;;
    --only)
      [ $# -ge 2 ] || die_usage "--only needs a step name"
      step_index "$2" >/dev/null || die_usage "unknown step '$2' (see --list)"
      ONLY+=("$2"); shift ;;
    --only=*)
      step_index "${1#--only=}" >/dev/null || die_usage "unknown step '${1#--only=}' (see --list)"
      ONLY+=("${1#--only=}") ;;
    --list)
      for i in "${!STEP_NAMES[@]}"; do printf '%-22s %s\n' "${STEP_NAMES[$i]}" "${STEP_TIERS[$i]}"; done
      exit 0 ;;
    -h|--help) usage; exit 0 ;;
    *) die_usage "unknown argument '$1'" ;;
  esac
  shift
done

cd "$REPO_ROOT"

if [ -n "${PYTHON:-}" ]; then PY=$PYTHON
elif command -v python3 >/dev/null 2>&1; then PY=python3
else PY=python
fi
export PYTHONDONTWRITEBYTECODE=1

LOG_DIR="${TMPDIR:-/tmp}"
LOG_DIR="${LOG_DIR%/}/run_tests.$$"
mkdir -p "$LOG_DIR"

# ---------------------------------------------------------------------------
# Step helpers (referenced from the table)
# ---------------------------------------------------------------------------
run_diff_check() {
  local base=${RUN_TESTS_BASE:-}
  if [ -z "$base" ]; then
    local ref
    for ref in origin/master master; do
      if git rev-parse --verify -q "$ref^{commit}" >/dev/null; then
        base=$(git merge-base HEAD "$ref") && break
      fi
    done
  fi
  [ -n "$base" ] || { echo "no base ref found (set RUN_TESTS_BASE)" >&2; return 1; }
  echo "git diff --check $base (committed and uncommitted changes)"
  git diff --check "$base"
}

# The harness web UI tests need fastapi, and FastAPI's TestClient needs httpx;
# fail early with the install command.
check_py_deps() {
  "$PY" --version
  "$PY" -c 'import fastapi, httpx' || {
    echo "missing Python dependency: fastapi/httpx (install with: $PY -m pip install fastapi httpx)" >&2
    return 1
  }
}

# Wait until host:port from a database URL accepts TCP connections.
wait_for_url() {
  local url=$1 tries=${2:-60}
  node -e '
    const net = require("node:net");
    const u = new URL(process.argv[1]);
    const port = Number(u.port) || (u.protocol.startsWith("mongo") ? 27017 : 5432);
    const host = (u.hostname || "127.0.0.1").replace(/^\[|\]$/g, "");
    let left = Number(process.argv[2]);
    (function attempt() {
      const s = net.connect({ host, port });
      s.setTimeout(2000);
      const retry = () => { s.destroy(); if (--left <= 0) { console.error(`unreachable: ${host}:${port}`); process.exit(1); } setTimeout(attempt, 1000); };
      s.once("connect", () => { s.end(); console.log(`reachable: ${host}:${port}`); process.exit(0); });
      s.once("error", retry); s.once("timeout", retry);
    })();
  ' "$url" "$tries"
}

prepare_integration() {
  local defaulted=0
  if [ -z "${TEST_MONGODB_URI:-}" ]; then
    export TEST_MONGODB_URI="mongodb://127.0.0.1:${MONGO_PORT:-27017}"
    defaulted=1
  fi
  echo "TEST_MONGODB_URI=$TEST_MONGODB_URI"
  if [ "$NO_INFRA" = 1 ]; then
    echo "--no-infra: not starting docker compose services"
  elif [ "$defaulted" = 1 ]; then
    # docker compose up --wait blocks until the Mongo healthcheck passes.
    npm run infra:up
  else
    echo "TEST_MONGODB_URI set explicitly: not starting docker compose services"
  fi
  wait_for_url "$TEST_MONGODB_URI" 60
}

# Apply one check to a log; prints the reason on failure.
apply_check() {
  local check=$1 log=$2
  case "$check" in
    -|'') return 0 ;;
    line:*)
      grep -qxF -- "${check#line:}" "$log" || { echo "missing exact line: '${check#line:}'"; return 1; } ;;
    contains:*)
      grep -qF -- "${check#contains:}" "$log" || { echo "missing text: '${check#contains:}'"; return 1; } ;;
    absent:*)
      if grep -qF -- "${check#absent:}" "$log"; then echo "forbidden text present: '${check#absent:}'"; return 1; fi ;;
    tap:*)
      node "$GUARD" "$log" --minimum-tests "${check#tap:}" || { echo "TAP summary guard rejected the log"; return 1; } ;;
    *) echo "unknown check '$check' in STEP_TABLE"; return 1 ;;
  esac
}

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------
SELECTED=()
for i in "${!STEP_NAMES[@]}"; do
  if [ ${#ONLY[@]} -gt 0 ]; then
    for o in "${ONLY[@]}"; do
      if [ "$o" = "${STEP_NAMES[$i]}" ]; then SELECTED+=("$i"); break; fi
    done
  elif [ "$TIER" = full ] || [ "${STEP_TIERS[$i]}" = quick ]; then
    SELECTED+=("$i")
  fi
done

if [ ! -d node_modules ]; then
  echo "run_tests.sh: node_modules is missing; run 'npm ci' first." >&2
  exit 2
fi

RESULTS=(); DURATIONS=(); FAILED=0; STOPPED=0
if [ ${#ONLY[@]} -gt 0 ]; then mode="only: ${ONLY[*]}"; else mode="$TIER tier"; fi
echo "run_tests.sh: $mode, ${#SELECTED[@]} step(s), logs in $LOG_DIR"

for i in "${SELECTED[@]}"; do
  name=${STEP_NAMES[$i]}
  log="$LOG_DIR/$name.log"
  if [ "$STOPPED" = 1 ]; then RESULTS+=("SKIP"); DURATIONS+=("-"); continue; fi
  echo
  echo "==> $name"
  echo "    \$ ${STEP_CMDS[$i]}"
  start=$(date +%s)
  status=0
  ( set -euo pipefail; eval "${STEP_CMDS[$i]}" ) 2>&1 | tee "$log" || status=$?
  result=PASS
  if [ "$status" -ne 0 ]; then
    echo "    FAIL: command exited with status $status" | tee -a "$log"
    result=FAIL
  else
    rest="${STEP_CHECKS[$i]};;"
    while [ -n "$rest" ]; do
      check=${rest%%;;*}
      rest=${rest#*;;}
      if ! reason=$(apply_check "$check" "$log" 2>&1); then
        printf '    FAIL: %s\n' "$reason" | tee -a "$log"
        result=FAIL
      fi
    done
  fi
  DURATIONS+=("$(( $(date +%s) - start ))s")
  RESULTS+=("$result")
  if [ "$result" = FAIL ]; then
    FAILED=$((FAILED + 1))
    [ "$FAIL_FAST" = 1 ] && STOPPED=1
  fi
done

echo
echo "==> summary"
printf '%-22s %-6s %6s  %s\n' STEP RESULT TIME LOG
n=0
for i in "${SELECTED[@]}"; do
  name=${STEP_NAMES[$i]}
  logcol="$LOG_DIR/$name.log"
  [ "${RESULTS[$n]}" = SKIP ] && logcol="(not run: --fail-fast)"
  printf '%-22s %-6s %6s  %s\n' "$name" "${RESULTS[$n]}" "${DURATIONS[$n]}" "$logcol"
  n=$((n + 1))
done
echo
if [ "$FAILED" -gt 0 ]; then
  echo "run_tests.sh: $FAILED step(s) failed."
  exit 1
fi
echo "run_tests.sh: all ${#SELECTED[@]} step(s) passed."
