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

NODE_RUNTIME_DIR="${OUTPUT_ROOT}/node-runtime"
BIN_DIR="${OUTPUT_ROOT}/bin"
PACKAGE_METADATA_PATH="${OUTPUT_ROOT}/package-metadata.json"
SKIP_NODE_DEPS="${HOLABOSS_SKIP_NODE_DEPS:-0}"
INSTALL_OPENCODE="${HOLABOSS_INSTALL_OPENCODE:-1}"
INSTALL_QMD="${HOLABOSS_INSTALL_QMD:-1}"

mkdir -p "${BIN_DIR}"

NODE_PACKAGES=()
if [ "${INSTALL_OPENCODE}" = "1" ]; then
  NODE_PACKAGES+=("opencode-ai@latest")
fi
if [ "${INSTALL_QMD}" = "1" ]; then
  NODE_PACKAGES+=("@tobilu/qmd@latest")
fi

if [ "${SKIP_NODE_DEPS}" != "1" ] && [ "${#NODE_PACKAGES[@]}" -gt 0 ]; then
  require_cmd npm
  mkdir -p "${NODE_RUNTIME_DIR}"
  npm install --global --prefix "${NODE_RUNTIME_DIR}" "${NODE_PACKAGES[@]}"
fi

cat > "${BIN_DIR}/sandbox-runtime" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

export HOLABOSS_RUNTIME_APP_ROOT="${BUNDLE_ROOT}/runtime"
export HOLABOSS_RUNTIME_ROOT="${BUNDLE_ROOT}/runtime"
export PATH="${BUNDLE_ROOT}/node-runtime/bin:${PATH}"

exec "${BUNDLE_ROOT}/runtime/bootstrap/linux.sh" "$@"
EOF

chmod +x "${BIN_DIR}/sandbox-runtime"

cat > "${PACKAGE_METADATA_PATH}" <<EOF
{
  "platform": "linux",
  "node_deps_installed": $([ "${SKIP_NODE_DEPS}" = "1" ] && printf 'false' || printf 'true'),
  "opencode_installed": $([ "${SKIP_NODE_DEPS}" = "1" ] || [ "${INSTALL_OPENCODE}" != "1" ] && printf 'false' || printf 'true'),
  "qmd_installed": $([ "${SKIP_NODE_DEPS}" = "1" ] || [ "${INSTALL_QMD}" != "1" ] && printf 'false' || printf 'true')
}
EOF

echo "packaged Linux runtime bundle at ${OUTPUT_ROOT}" >&2
