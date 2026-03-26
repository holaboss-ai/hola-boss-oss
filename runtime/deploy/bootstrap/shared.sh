#!/usr/bin/env bash
set -euo pipefail

holaboss_runtime_log() {
  printf '[sandbox-entrypoint] %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2
}

holaboss_runtime_dump_startup_diagnostics() {
  holaboss_runtime_log "startup diagnostics: process list"
  ps -ef >&2 || true
  holaboss_runtime_log "startup diagnostics: listening ports"
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp >&2 || true
  fi
  if [ -f /tmp/opencode-server.log ]; then
    holaboss_runtime_log "startup diagnostics: /tmp/opencode-server.log"
    tail -n 200 /tmp/opencode-server.log >&2 || true
  fi
  if [ -f /tmp/dockerd.log ]; then
    holaboss_runtime_log "startup diagnostics: /tmp/dockerd.log"
    tail -n 200 /tmp/dockerd.log >&2 || true
  fi
}

holaboss_runtime_opencode_http_reachable() {
  local base_url="$1"
  local path=""
  for path in ${OPENCODE_READY_PATHS}; do
    if curl -sS --max-time 2 -o /dev/null "${base_url}${path}" >/dev/null 2>&1; then
      OPENCODE_READY_PATH_HIT="${path}"
      return 0
    fi
  done
  return 1
}

holaboss_runtime_log_opencode_listener_state() {
  local pids=""
  local pid=""
  local matched=0
  local pid_list=""

  if [ -n "${OPCODE_PID:-}" ] && kill -0 "${OPCODE_PID}" >/dev/null 2>&1; then
    pid_list="${OPCODE_PID}"
  fi

  pids="$(ps -eo pid=,args= 2>/dev/null | awk '/[o]pencode serve --hostname/ {print $1}' | tr '\n' ' ' | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//')"
  if [ -n "${pids}" ]; then
    if [ -n "${pid_list}" ]; then
      pid_list="${pid_list} ${pids}"
    else
      pid_list="${pids}"
    fi
  fi

  if [ -z "${pid_list}" ]; then
    holaboss_runtime_log "opencode pid candidates: none"
    return 0
  fi

  pid_list="$(printf '%s\n' ${pid_list} | awk '!seen[$0]++' | tr '\n' ' ' | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//')"
  holaboss_runtime_log "opencode pid candidates: ${pid_list}"

  if command -v ss >/dev/null 2>&1; then
    for pid in ${pid_list}; do
      if ss -ltnp 2>/dev/null | grep -F "pid=${pid}," >&2; then
        matched=1
      fi
    done
  fi

  if [ "${matched}" -eq 0 ]; then
    holaboss_runtime_log "no listening sockets found for opencode pid candidates"
  fi
}

holaboss_runtime_prepare_roots() {
  SANDBOX_ROOT="${HB_SANDBOX_ROOT:-/holaboss}"
  SANDBOX_ROOT="${SANDBOX_ROOT%/}"
  if [ -z "${SANDBOX_ROOT}" ]; then
    SANDBOX_ROOT="/holaboss"
  fi

  WORKSPACE_ROOT="${SANDBOX_ROOT}/workspace"
  MEMORY_ROOT_DIR_DEFAULT="${SANDBOX_ROOT}/memory"
  STATE_ROOT_DIR_DEFAULT="${SANDBOX_ROOT}/state"

  mkdir -p "${WORKSPACE_ROOT}"
  mkdir -p "${MEMORY_ROOT_DIR_DEFAULT}"
  mkdir -p "${STATE_ROOT_DIR_DEFAULT}"

  export HOLABOSS_RUNTIME_APP_ROOT="${HOLABOSS_RUNTIME_APP_ROOT:-/app}"
  export HOLABOSS_RUNTIME_ROOT="${HOLABOSS_RUNTIME_ROOT:-${HOLABOSS_RUNTIME_APP_ROOT}}"
  export HOLABOSS_RUNTIME_PYTHON="${HOLABOSS_RUNTIME_PYTHON:-/opt/venv/bin/python}"
  export HOLABOSS_RUNTIME_SITE_PACKAGES="${HOLABOSS_RUNTIME_SITE_PACKAGES:-}"
  mkdir -p "${HOLABOSS_RUNTIME_APP_ROOT}"
  export PYTHONPATH="${HOLABOSS_RUNTIME_APP_ROOT}${HOLABOSS_RUNTIME_SITE_PACKAGES:+:${HOLABOSS_RUNTIME_SITE_PACKAGES}}${PYTHONPATH:+:${PYTHONPATH}}"
  export HOLABOSS_USER_ID="${SANDBOX_HOLABOSS_USER_ID:-}"
  export HB_SANDBOX_ROOT="${SANDBOX_ROOT}"
  export MEMORY_ROOT_DIR="${MEMORY_ROOT_DIR:-${MEMORY_ROOT_DIR_DEFAULT}}"
  export STATE_ROOT_DIR="${STATE_ROOT_DIR:-${STATE_ROOT_DIR_DEFAULT}}"

}

holaboss_runtime_enter_workspace_root() {
  local workspace_root="${WORKSPACE_ROOT:-${HB_SANDBOX_ROOT:-/holaboss}/workspace}"
  mkdir -p "${workspace_root}"
  cd "${workspace_root}"
  holaboss_runtime_log "using workspace root cwd=${workspace_root}"
}

holaboss_runtime_selected_harness() {
  local configured_harness="${SANDBOX_AGENT_HARNESS:-}"
  if [ -n "${configured_harness}" ]; then
    printf '%s' "${configured_harness}" | tr '[:upper:]' '[:lower:]'
    return 0
  fi
  printf 'opencode'
}

holaboss_runtime_write_opencode_config() {
  "${HOLABOSS_RUNTIME_PYTHON}" - <<'PY'
from sandbox_agent_runtime.product_config import (
    write_opencode_bootstrap_config_if_available,
)

config_path = write_opencode_bootstrap_config_if_available()
if config_path is None:
    raise SystemExit(0)
print(str(config_path))
PY
}

holaboss_runtime_ensure_opencode_ready() {
  HARNESS="$(holaboss_runtime_selected_harness)"
  OPCODE_HOST="${OPENCODE_SERVER_HOST:-127.0.0.1}"
  OPCODE_PORT="${OPENCODE_SERVER_PORT:-4096}"
  : "${OPENCODE_BASE_URL:=http://${OPCODE_HOST}:${OPCODE_PORT}}"
  OPENCODE_READY_PATHS="${OPENCODE_READY_PATHS:-/health /global/health /mcp /doc /}"
  export OPENCODE_BASE_URL
  holaboss_runtime_log "bootstrap harness=${HARNESS} opencode_base_url=${OPENCODE_BASE_URL}"

  if [ "${HARNESS}" != "opencode" ]; then
    holaboss_runtime_log "harness=${HARNESS}; skipping opencode sidecar bootstrap"
    return 0
  fi

  holaboss_runtime_write_opencode_config

  OPCODE_READY=0
  OPCODE_PID=""
  OPENCODE_READY_PATH_HIT=""
  if holaboss_runtime_opencode_http_reachable "${OPENCODE_BASE_URL}"; then
    holaboss_runtime_log "opencode already reachable at ${OPENCODE_BASE_URL}${OPENCODE_READY_PATH_HIT}"
    OPCODE_READY=1
  else
    holaboss_runtime_log "starting opencode serve host=${OPCODE_HOST} port=${OPCODE_PORT}"
    opencode serve --hostname "${OPCODE_HOST}" --port "${OPCODE_PORT}" >/tmp/opencode-server.log 2>&1 &
    OPCODE_PID="$!"
    holaboss_runtime_log "opencode launched pid=${OPCODE_PID}"
  fi

  OPCODE_READY_MAX_ATTEMPTS="${OPENCODE_READY_MAX_ATTEMPTS:-240}"
  OPENCODE_READY_POLL_INTERVAL_S="${OPENCODE_READY_POLL_INTERVAL_S:-0.5}"
  OPENCODE_DIAG_EVERY_ATTEMPTS="${OPENCODE_DIAG_EVERY_ATTEMPTS:-6}"
  for attempt in $(seq 1 "${OPCODE_READY_MAX_ATTEMPTS}"); do
    OPENCODE_READY_PATH_HIT=""
    if holaboss_runtime_opencode_http_reachable "${OPENCODE_BASE_URL}"; then
      OPCODE_READY=1
      holaboss_runtime_log "opencode ready attempt=${attempt} via ${OPENCODE_BASE_URL}${OPENCODE_READY_PATH_HIT}"
      break
    fi
    if [ -n "${OPCODE_PID}" ] && ! kill -0 "${OPCODE_PID}" >/dev/null 2>&1; then
      holaboss_runtime_log "opencode process exited before readiness pid=${OPCODE_PID}"
      break
    fi
    if [ $((attempt % 10)) -eq 0 ]; then
      holaboss_runtime_log "waiting for opencode readiness attempt=${attempt}/${OPCODE_READY_MAX_ATTEMPTS}"
    fi
    if [ $((attempt % OPENCODE_DIAG_EVERY_ATTEMPTS)) -eq 0 ]; then
      holaboss_runtime_log_opencode_listener_state
      if [ -f /tmp/opencode-server.log ]; then
        tail -n 40 /tmp/opencode-server.log >&2 || true
      fi
    fi
    sleep "${OPENCODE_READY_POLL_INTERVAL_S}"
  done

  if [ "${OPCODE_READY:-0}" -ne 1 ]; then
    holaboss_runtime_log "failed to start opencode server at ${OPENCODE_BASE_URL}"
    holaboss_runtime_dump_startup_diagnostics
    exit 1
  fi
}

holaboss_runtime_start_api() {
  export HOLABOSS_RUNTIME_NODE_BIN="${HOLABOSS_RUNTIME_NODE_BIN:-node}"
  export SANDBOX_RUNTIME_API_HOST="${SANDBOX_RUNTIME_API_HOST:-${SANDBOX_AGENT_BIND_HOST:-0.0.0.0}}"
  export SANDBOX_RUNTIME_API_PORT="${SANDBOX_RUNTIME_API_PORT:-${SANDBOX_AGENT_BIND_PORT:-8080}}"

  local runtime_api_entry=""
  local candidate=""
  for candidate in \
    "${HOLABOSS_RUNTIME_APP_ROOT%/}/api-server/dist/index.mjs" \
    "${HOLABOSS_RUNTIME_APP_ROOT%/}/../api-server/dist/index.mjs"
  do
    if [ -f "${candidate}" ]; then
      runtime_api_entry="${candidate}"
      break
    fi
  done
  if [ ! -f "${runtime_api_entry}" ]; then
    holaboss_runtime_log "runtime api entrypoint not found under HOLABOSS_RUNTIME_APP_ROOT=${HOLABOSS_RUNTIME_APP_ROOT}"
    exit 1
  fi
  if ! command -v "${HOLABOSS_RUNTIME_NODE_BIN}" >/dev/null 2>&1; then
    holaboss_runtime_log "runtime node binary not found: ${HOLABOSS_RUNTIME_NODE_BIN}"
    exit 1
  fi

  holaboss_runtime_log "starting sandbox runtime TS API on ${SANDBOX_RUNTIME_API_HOST}:${SANDBOX_RUNTIME_API_PORT}"
  exec "${HOLABOSS_RUNTIME_NODE_BIN}" "${runtime_api_entry}"
}

holaboss_runtime_shared_main() {
  holaboss_runtime_prepare_roots
  holaboss_runtime_enter_workspace_root
  holaboss_runtime_start_api
}
