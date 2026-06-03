#!/usr/bin/env bash
# Reset OpenClawNode: kill running instances, rebuild, repackage, relaunch.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_BUNDLE="${OPENCLAWNODE_APP_BUNDLE:-}"
PRODUCT="OpenClawNode"
APP_PROCESS_PATTERN="OpenClawNode.app/Contents/MacOS/OpenClawNode"
DEBUG_PROCESS_PATTERN="${ROOT_DIR}/apps/macos/.build/debug/OpenClawNode"
LOCK_KEY="$(printf '%s' "${ROOT_DIR}-node" | shasum -a 256 | cut -c1-8)"
LOCK_DIR="${TMPDIR:-/tmp}/openclaw-node-restart-${LOCK_KEY}"
LOCK_PID_FILE="${LOCK_DIR}/pid"
WAIT_FOR_LOCK=0
LOG_PATH="${OPENCLAWNODE_RESTART_LOG:-/tmp/openclaw-node-restart.log}"

log()  { printf '%s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

export PATH="${ROOT_DIR}/node_modules/.bin:${PATH}"

run_step() {
  local label="$1"; shift
  log "==> ${label}"
  if ! "$@"; then
    fail "${label} failed"
  fi
}

cleanup() {
  if [[ -d "${LOCK_DIR}" ]]; then
    rm -rf "${LOCK_DIR}"
  fi
}

acquire_lock() {
  while true; do
    if mkdir "${LOCK_DIR}" 2>/dev/null; then
      echo "$$" > "${LOCK_PID_FILE}"
      return 0
    fi

    local existing_pid=""
    if [[ -f "${LOCK_PID_FILE}" ]]; then
      existing_pid="$(cat "${LOCK_PID_FILE}" 2>/dev/null || true)"
    fi

    if [[ -n "${existing_pid}" ]] && kill -0 "${existing_pid}" 2>/dev/null; then
      if [[ "${WAIT_FOR_LOCK}" == "1" ]]; then
        log "==> Another restart is running (pid ${existing_pid}); waiting..."
        while kill -0 "${existing_pid}" 2>/dev/null; do
          sleep 1
        done
        continue
      fi
      log "==> Another restart is running (pid ${existing_pid}); re-run with --wait."
      exit 0
    fi

    rm -rf "${LOCK_DIR}"
  done
}

trap cleanup EXIT INT TERM

for arg in "$@"; do
  case "${arg}" in
    --wait|-w) WAIT_FOR_LOCK=1 ;;
    --help|-h)
      log "Usage: $(basename "$0") [--wait]"
      log "  --wait    Wait for other restart to complete instead of exiting"
      exit 0
      ;;
    *) ;;
  esac
done

mkdir -p "$(dirname "$LOG_PATH")"
rm -f "$LOG_PATH"
exec > >(tee "$LOG_PATH") 2>&1
log "==> Log: ${LOG_PATH}"

acquire_lock

kill_all_openclawnode() {
  for _ in {1..10}; do
    pkill -f "${APP_PROCESS_PATTERN}" 2>/dev/null || true
    pkill -f "${DEBUG_PROCESS_PATTERN}" 2>/dev/null || true
    pkill -x "${PRODUCT}" 2>/dev/null || true
    if ! pgrep -f "${APP_PROCESS_PATTERN}" >/dev/null 2>&1 \
       && ! pgrep -f "${DEBUG_PROCESS_PATTERN}" >/dev/null 2>&1 \
       && ! pgrep -x "${PRODUCT}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.3
  done
}

# 1) Kill all running instances first.
log "==> Killing existing OpenClawNode instances"
kill_all_openclawnode

# 2) Rebuild into the same path the packager consumes (.build).
run_step "clean build cache" bash -lc "cd '${ROOT_DIR}/apps/macos' && rm -rf .build .build-swift .swiftpm 2>/dev/null || true"
run_step "swift build" bash -lc "cd '${ROOT_DIR}/apps/macos' && swift build -q --product ${PRODUCT}"

# 3) Package app.
run_step "package app" bash -lc "cd '${ROOT_DIR}' && '${ROOT_DIR}/scripts/package-mac-node.sh'"

choose_app_bundle() {
  if [[ -n "${APP_BUNDLE}" && -d "${APP_BUNDLE}" ]]; then
    return 0
  fi

  if [[ -d "${ROOT_DIR}/dist/OpenClawNode.app" ]]; then
    APP_BUNDLE="${ROOT_DIR}/dist/OpenClawNode.app"
    return 0
  fi

  fail "App bundle not found. Set OPENCLAWNODE_APP_BUNDLE to your installed OpenClawNode.app"
}

choose_app_bundle

# 4) Launch the app.
run_step "launch app" env -i \
  HOME="${HOME}" \
  USER="${USER:-$(id -un)}" \
  LOGNAME="${LOGNAME:-$(id -un)}" \
  TMPDIR="${TMPDIR:-/tmp}" \
  PATH="/usr/bin:/bin:/usr/sbin:/sbin" \
  LANG="${LANG:-en_US.UTF-8}" \
  /usr/bin/open "${APP_BUNDLE}"

# 5) Verify the app is alive.
sleep 1.5
if pgrep -f "${APP_PROCESS_PATTERN}" >/dev/null 2>&1; then
  log "OK: OpenClawNode is running."
else
  fail "App exited immediately. Check ${LOG_PATH} or Console.app (User Reports)."
fi
