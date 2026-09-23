#!/usr/bin/env bash
# Orchestrates the 8-category tamper-detection suite as one process PER
# CATEGORY, restarting the local PGlite dev database between each one.
#
# Why: this sandbox's embedded PGlite dev database reliably wedges
# ("unexpected message from server") once enough organisations have been
# created/torn down in a single long-lived connection — confirmed while
# building this suite (running all 8 categories in one process crashed
# partway through category (d); the identical logic ran cleanly against a
# freshly-restarted instance). Each category here creates far fewer
# organisations than that threshold, so a fresh PGlite per category keeps
# the whole run reliable. This is a workaround for the sandbox's dev
# database, not a property of the verification logic under test.
set -euo pipefail
cd "$(dirname "$0")"

PGLITE_LOG="/tmp/pglite-category-suite.log"

start_pglite() {
  (cd ../.. && npx pglite-server -d ./.devdb/pgdata -p 5432 -m 20 > "$PGLITE_LOG" 2>&1 &)
  for i in $(seq 1 20); do
    if grep -q "listening" "$PGLITE_LOG" 2>/dev/null; then
      return 0
    fi
    sleep 0.5
  done
  echo "PGlite did not report ready in time; last log lines:"
  tail -20 "$PGLITE_LOG"
  return 1
}

stop_pglite() {
  local pid
  pid=$(netstat -ano 2>/dev/null | grep ":5432" | grep LISTENING | awk '{print $NF}' | head -1 || true)
  if [ -n "${pid:-}" ]; then
    taskkill //F //PID "$pid" > /dev/null 2>&1 || true
  fi
  sleep 1
}

rm -rf .suite-results
mkdir -p .suite-results

run_category_with_retry() {
  local category="$1"
  local max_attempts=3
  for attempt in $(seq 1 "$max_attempts"); do
    echo "=============================================="
    echo "Category ($category) — restarting PGlite first (attempt $attempt/$max_attempts)"
    echo "=============================================="
    stop_pglite
    start_pglite
    npx ts-node src/runCategorySuite.ts "--category=$category"
    if ! grep -q "INFRASTRUCTURE_HICCUP" ".suite-results/$category.json"; then
      return 0
    fi
    echo "Category ($category) hit a PGlite infrastructure hiccup on attempt $attempt — retrying against a fresh instance."
  done
  echo "Category ($category) still shows an infrastructure hiccup after $max_attempts attempts — leaving its result as-is."
}

for category in a b c d e f g h; do
  run_category_with_retry "$category"
done

echo "=============================================="
echo "Control trials — restarting PGlite first"
echo "=============================================="
stop_pglite
start_pglite
npx ts-node src/runCategorySuite.ts --control

echo "=============================================="
echo "Final report"
echo "=============================================="
set +e
npx ts-node src/runCategorySuite.ts --report
REPORT_EXIT=$?
set -e

stop_pglite

exit $REPORT_EXIT
