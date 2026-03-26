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
  mkdir -p "${HOLABOSS_RUNTIME_APP_ROOT}"
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
