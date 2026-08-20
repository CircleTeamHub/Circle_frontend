#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "perf-ios.sh requires macOS (Darwin)." >&2
  exit 1
fi

: "${PERF_RESULTS_DIR:?PERF_RESULTS_DIR is required}"
: "${PERF_DEVICE_ID:?PERF_DEVICE_ID must be an explicit iOS Simulator UDID}"
: "${E2E_RUN_ID:?E2E_RUN_ID is required}"
: "${E2E_EXECUTE:?E2E_EXECUTE=true is required}"

APP_ID="com.yiboding.circleim"
SUITE="${PERF_SUITE:-conversation-list-scroll}"
TRACE_SECONDS="${PERF_TRACE_DURATION_SECONDS:-60}"
if [[ "$PERF_RESULTS_DIR" = /* ]]; then
  RESULT_DIR="$PERF_RESULTS_DIR"
else
  RESULT_DIR="$PWD/$PERF_RESULTS_DIR"
fi
if [[ "$RESULT_DIR" == '/' ]]; then
  echo 'PERF_RESULTS_DIR must not be the filesystem root.' >&2
  exit 1
fi
mkdir -p "$RESULT_DIR"

command -v xcrun >/dev/null
command -v node >/dev/null
xcrun simctl list devices | grep -F "$PERF_DEVICE_ID" | grep -Fq '(Booted)'
xcrun simctl get_app_container "$PERF_DEVICE_ID" "$APP_ID" app >/dev/null

launch_output="$(xcrun simctl launch "$PERF_DEVICE_ID" "$APP_ID")"
pid="${launch_output##*: }"
if [[ ! "$pid" =~ ^[0-9]+$ ]]; then
  echo "Unable to determine simulator process id from: $launch_output" >&2
  exit 1
fi

read_rss_kb() {
  xcrun simctl spawn "$PERF_DEVICE_ID" ps -o rss= -p "$pid" | tr -d '[:space:]'
}

baseline_kb="$(read_rss_kb)"
trace_path="$RESULT_DIR/ios-animation-hitches.trace"
trace_log="$RESULT_DIR/ios-xctrace.log"
trace_toc="$RESULT_DIR/ios-animation-hitches-toc.xml"
sim_log="$RESULT_DIR/ios-system-log.txt"
metrics_csv="$RESULT_DIR/ios-normalized-metrics.csv"
report_json="$RESULT_DIR/performance-report.json"

xcrun xctrace record \
  --template 'Animation Hitches' \
  --device "$PERF_DEVICE_ID" \
  --attach "$pid" \
  --time-limit "${TRACE_SECONDS}s" \
  --output "$trace_path" >"$trace_log" 2>&1 &
xctrace_pid=$!

cleanup() {
  if kill -0 "$xctrace_pid" 2>/dev/null; then
    kill -INT "$xctrace_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

export MAESTRO_DEVICE_ID="$PERF_DEVICE_ID"
node scripts/run-e2e.mjs "$SUITE"
wait "$xctrace_pid" || true
trap - EXIT

xcrun xctrace export --input "$trace_path" --toc --output "$trace_toc"
peak_kb="$(read_rss_kb)"
xcrun simctl spawn "$PERF_DEVICE_ID" log show --last 10m \
  --predicate "process == 'CircleIM' OR eventMessage CONTAINS[c] '$APP_ID'" \
  >"$sim_log" 2>&1 || true
crashes="$(grep -Eic 'crash|fatal exception' "$sim_log" || true)"
watchdogs="$(grep -Eic 'watchdog|0x8badf00d' "$sim_log" || true)"

baseline_mb="$(awk -v kb="$baseline_kb" 'BEGIN { printf "%.2f", kb / 1024 }')"
peak_mb="$(awk -v kb="$peak_kb" 'BEGIN { printf "%.2f", kb / 1024 }')"
{
  printf 'metric,value,unit\n'
  printf 'memory_baseline_mb,%s,MB\n' "$baseline_mb"
  printf 'memory_peak_mb,%s,MB\n' "$peak_mb"
  printf 'crashes,%s,count\n' "$crashes"
  printf 'watchdogs,%s,count\n' "$watchdogs"
  if [[ -n "${PERF_IOS_JANK_PERCENT:-}" ]]; then
    printf 'janky_frames_percent,%s,percent\n' "$PERF_IOS_JANK_PERCENT"
  fi
  if [[ -n "${PERF_OPEN_P95_MS:-}" ]]; then
    printf 'open_conversation_p95_ms,%s,ms\n' "$PERF_OPEN_P95_MS"
  fi
} >"$metrics_csv"

node scripts/testing/performance-report.mjs \
  --platform ios \
  --ios-metrics "$metrics_csv" \
  --out "$report_json" \
  --run-id "$E2E_RUN_ID" \
  --device "$PERF_DEVICE_ID" \
  --build "${PERF_BUILD_ID:-local-release}"

echo "Raw Animation Hitches trace: $trace_path"
echo "Use Instruments to inspect hitch intervals; normalized overrides are optional and never inferred from unstable XML schemas."
