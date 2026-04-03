#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${RUNTIME_ROOT}/.." && pwd)"
OUTPUT_ROOT="${1:-${REPO_ROOT}/out/runtime-macos}"
STAGING_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/holaboss-runtime-macos.XXXXXX")"

cleanup() {
  rm -rf "${STAGING_ROOT}"
}
trap cleanup EXIT

require_cmd() {
  local name="$1"
  if ! command -v "${name}" >/dev/null 2>&1; then
    echo "required command not found: ${name}" >&2
    exit 1
  fi
}

resolve_output_root() {
  local target="$1"
  local parent
  local name

  parent="$(dirname "${target}")"
  name="$(basename "${target}")"
  mkdir -p "${parent}"
  (
    cd "${parent}"
    printf '%s/%s\n' "$(pwd)" "${name}"
  )
}

require_cmd git
OUTPUT_ROOT="$(resolve_output_root "${OUTPUT_ROOT}")"

"${SCRIPT_DIR}/build_runtime_root.sh" "${STAGING_ROOT}/runtime-root"

rm -rf "${OUTPUT_ROOT}"
mkdir -p "${OUTPUT_ROOT}"
cp -R "${STAGING_ROOT}/runtime-root" "${OUTPUT_ROOT}/runtime"
"${SCRIPT_DIR}/prune_packaged_tree.sh" "${OUTPUT_ROOT}/runtime" "macos"

NODE_RUNTIME_DIR="${OUTPUT_ROOT}/node-runtime"
BIN_DIR="${OUTPUT_ROOT}/bin"
PACKAGE_METADATA_PATH="${OUTPUT_ROOT}/package-metadata.json"
SKIP_NODE_DEPS="${HOLABOSS_SKIP_NODE_DEPS:-0}"
LOCAL_NODE_BIN="${NODE_RUNTIME_DIR}/node_modules/.bin/node"

NODE_VERSION="${HOLABOSS_RUNTIME_NODE_VERSION:-}"
if [ -z "${NODE_VERSION}" ]; then
  require_cmd node
  NODE_VERSION="$(node --version)"
  NODE_VERSION="${NODE_VERSION#v}"
fi

mkdir -p "${BIN_DIR}"

if [ "${SKIP_NODE_DEPS}" != "1" ]; then
  require_cmd npm
  mkdir -p "${NODE_RUNTIME_DIR}"
  npm install --prefix "${NODE_RUNTIME_DIR}" "node@${NODE_VERSION}"
  "${SCRIPT_DIR}/prune_packaged_tree.sh" "${NODE_RUNTIME_DIR}" "macos"
fi

cat > "${BIN_DIR}/sandbox-runtime" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BUNDLED_NODE_BIN="${BUNDLE_ROOT}/node-runtime/node_modules/.bin/node"

export HOLABOSS_RUNTIME_APP_ROOT="${BUNDLE_ROOT}/runtime"
export HOLABOSS_RUNTIME_ROOT="${BUNDLE_ROOT}/runtime"
export PATH="${BUNDLE_ROOT}/node-runtime/node_modules/.bin:${BUNDLE_ROOT}/node-runtime/bin:${PATH}"
if [ -x "${BUNDLED_NODE_BIN}" ]; then
  export HOLABOSS_RUNTIME_NODE_BIN="${BUNDLED_NODE_BIN}"
fi

exec "${BUNDLE_ROOT}/runtime/bootstrap/macos.sh" "$@"
EOF

chmod +x "${BIN_DIR}/sandbox-runtime"

cat > "${PACKAGE_METADATA_PATH}" <<EOF
{
  "platform": "macos",
  "node_deps_installed": $([ "${SKIP_NODE_DEPS}" = "1" ] && printf 'false' || printf 'true'),
  "bundled_node_bin": $([ "${SKIP_NODE_DEPS}" = "1" ] || [ ! -x "${LOCAL_NODE_BIN}" ] && printf 'false' || printf 'true'),
  "bundled_node_version": $([ "${SKIP_NODE_DEPS}" = "1" ] && printf 'null' || printf '"%s"' "${NODE_VERSION}")
}
EOF

echo "packaged macOS runtime bundle at ${OUTPUT_ROOT}" >&2
