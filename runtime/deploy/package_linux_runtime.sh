#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${RUNTIME_ROOT}/.." && pwd)"
OUTPUT_ROOT="${1:-${REPO_ROOT}/out/runtime-linux}"
STAGING_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/holaboss-runtime-linux.XXXXXX")"

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
"${SCRIPT_DIR}/prune_packaged_tree.sh" "${OUTPUT_ROOT}/runtime" "linux"

NODE_RUNTIME_DIR="${OUTPUT_ROOT}/node-runtime"
PYTHON_RUNTIME_DIR="${OUTPUT_ROOT}/python-runtime"
BIN_DIR="${OUTPUT_ROOT}/bin"
PACKAGE_METADATA_PATH="${OUTPUT_ROOT}/package-metadata.json"
SKIP_NODE_DEPS="${HOLABOSS_SKIP_NODE_DEPS:-0}"
LOCAL_NODE_BIN="${NODE_RUNTIME_DIR}/node_modules/node/bin/node"
LOCAL_NPM_BIN="${NODE_RUNTIME_DIR}/node_modules/.bin/npm"
LOCAL_PYTHON_BIN="${PYTHON_RUNTIME_DIR}/bin/python"

NODE_VERSION="${HOLABOSS_RUNTIME_NODE_VERSION:-}"
if [ -z "${NODE_VERSION}" ]; then
  require_cmd node
  NODE_VERSION="$(node --version)"
  NODE_VERSION="${NODE_VERSION#v}"
fi

NPM_VERSION="${HOLABOSS_RUNTIME_NPM_VERSION:-}"
if [ -z "${NPM_VERSION}" ]; then
  require_cmd npm
  NPM_VERSION="$(npm --version)"
fi

PYTHON_VERSION="${HOLABOSS_RUNTIME_PYTHON_VERSION:-3.12.13}"
PYTHON_ARCH_RAW="${HOLABOSS_RUNTIME_PYTHON_ARCH:-$(uname -m)}"
case "${PYTHON_ARCH_RAW}" in
  x64|amd64|x86_64)
    PYTHON_TARGET="x86_64-unknown-linux-gnu"
    ;;
  arm64|aarch64)
    PYTHON_TARGET="aarch64-unknown-linux-gnu"
    ;;
  *)
    echo "unsupported Python runtime architecture: ${PYTHON_ARCH_RAW}" >&2
    exit 1
    ;;
esac

mkdir -p "${BIN_DIR}"

if [ "${SKIP_NODE_DEPS}" != "1" ]; then
  require_cmd npm
  mkdir -p "${NODE_RUNTIME_DIR}"
  npm install --prefix "${NODE_RUNTIME_DIR}" "node@${NODE_VERSION}" "npm@${NPM_VERSION}"
  "${SCRIPT_DIR}/prune_packaged_tree.sh" "${NODE_RUNTIME_DIR}" "linux"
fi

require_cmd node
node "${SCRIPT_DIR}/stage_python_runtime.mjs" "${OUTPUT_ROOT}" "linux"

cat > "${BIN_DIR}/sandbox-runtime" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BUNDLED_NODE_BIN="${BUNDLE_ROOT}/node-runtime/node_modules/node/bin/node"

export HOLABOSS_RUNTIME_APP_ROOT="${BUNDLE_ROOT}/runtime"
export HOLABOSS_RUNTIME_ROOT="${BUNDLE_ROOT}/runtime"
export PATH="${BUNDLE_ROOT}/python-runtime/bin:${BUNDLE_ROOT}/python-runtime/python/bin:${BUNDLE_ROOT}/node-runtime/node_modules/node/bin:${BUNDLE_ROOT}/node-runtime/node_modules/.bin:${PATH}"
if [ -x "${BUNDLED_NODE_BIN}" ]; then
  export HOLABOSS_RUNTIME_NODE_BIN="${BUNDLED_NODE_BIN}"
fi

exec "${BUNDLE_ROOT}/runtime/bootstrap/linux.sh" "$@"
EOF

chmod +x "${BIN_DIR}/sandbox-runtime"

cat > "${PACKAGE_METADATA_PATH}" <<EOF
{
  "platform": "linux",
  "node_deps_installed": $([ "${SKIP_NODE_DEPS}" = "1" ] && printf 'false' || printf 'true'),
  "bundled_node_bin": $([ "${SKIP_NODE_DEPS}" = "1" ] || [ ! -x "${LOCAL_NODE_BIN}" ] && printf 'false' || printf 'true'),
  "bundled_node_version": $([ "${SKIP_NODE_DEPS}" = "1" ] && printf 'null' || printf '"%s"' "${NODE_VERSION}"),
  "bundled_npm_bin": $([ "${SKIP_NODE_DEPS}" = "1" ] || [ ! -x "${LOCAL_NPM_BIN}" ] && printf 'false' || printf 'true'),
  "bundled_npm_version": $([ "${SKIP_NODE_DEPS}" = "1" ] && printf 'null' || printf '"%s"' "${NPM_VERSION}"),
  "bundled_python_bin": $([ ! -x "${LOCAL_PYTHON_BIN}" ] && printf 'false' || printf 'true'),
  "bundled_python_version": "${PYTHON_VERSION}",
  "bundled_python_target": "${PYTHON_TARGET}"
}
EOF

echo "packaged Linux runtime bundle at ${OUTPUT_ROOT}" >&2
