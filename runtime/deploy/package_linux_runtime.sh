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

require_cmd git
require_cmd uv
PYTHON_BIN="${HOLABOSS_LINUX_PYTHON_BIN:-python3}"
require_cmd "${PYTHON_BIN}"
OUTPUT_ROOT="$("${PYTHON_BIN}" -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "${OUTPUT_ROOT}")"

PYTHON_VERSION="$("${PYTHON_BIN}" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
case "${PYTHON_VERSION}" in
  3.12) ;;
  *)
    echo "Linux runtime packaging requires Python 3.12; got ${PYTHON_VERSION} from ${PYTHON_BIN}" >&2
    echo "set HOLABOSS_LINUX_PYTHON_BIN to a Python 3.12 executable and retry" >&2
    exit 1
    ;;
esac

"${SCRIPT_DIR}/build_runtime_root.sh" "${STAGING_ROOT}/runtime-root"

rm -rf "${OUTPUT_ROOT}"
mkdir -p "${OUTPUT_ROOT}"
cp -R "${STAGING_ROOT}/runtime-root" "${OUTPUT_ROOT}/runtime"

PYTHON_ROOT_DIR="${OUTPUT_ROOT}/python"
PYTHON_PACKAGES_DIR="${OUTPUT_ROOT}/python-packages"
NODE_RUNTIME_DIR="${OUTPUT_ROOT}/node-runtime"
BIN_DIR="${OUTPUT_ROOT}/bin"
PACKAGE_METADATA_PATH="${OUTPUT_ROOT}/package-metadata.json"
SKIP_PYTHON_DEPS="${HOLABOSS_SKIP_PYTHON_DEPS:-0}"
SKIP_NODE_DEPS="${HOLABOSS_SKIP_NODE_DEPS:-0}"
INSTALL_OPENCODE="${HOLABOSS_INSTALL_OPENCODE:-1}"
INSTALL_QMD="${HOLABOSS_INSTALL_QMD:-1}"

mkdir -p "${BIN_DIR}"

BUNDLED_PYTHON_VERSION="${HOLABOSS_LINUX_PYTHON_VERSION:-3.12}"
uv python install "${BUNDLED_PYTHON_VERSION}" \
  --install-dir "${PYTHON_ROOT_DIR}" \
  --managed-python \
  --force

BUNDLED_PYTHON_PREFIX="$(find "${PYTHON_ROOT_DIR}" -mindepth 1 -maxdepth 1 -type d | head -n1)"
if [ -z "${BUNDLED_PYTHON_PREFIX}" ]; then
  echo "failed to resolve bundled Python prefix under ${PYTHON_ROOT_DIR}" >&2
  exit 1
fi

BUNDLED_PYTHON="$(find "${BUNDLED_PYTHON_PREFIX}/bin" -maxdepth 1 -type f \( -name 'python3.12' -o -name 'python3' \) | head -n1)"
if [ -z "${BUNDLED_PYTHON}" ] || [ ! -x "${BUNDLED_PYTHON}" ]; then
  echo "bundled Python interpreter not found under ${BUNDLED_PYTHON_PREFIX}/bin" >&2
  exit 1
fi

if [ "${SKIP_PYTHON_DEPS}" != "1" ]; then
  REQUIREMENTS_TXT="${STAGING_ROOT}/requirements-linux.txt"
  (
    cd "${OUTPUT_ROOT}/runtime/app"
    uv export --frozen --no-dev --no-editable --no-emit-project -o "${REQUIREMENTS_TXT}" >/dev/null
  )
  mkdir -p "${PYTHON_PACKAGES_DIR}"
  PIP_DISABLE_PIP_VERSION_CHECK=1 \
    "${PYTHON_BIN}" -m pip install \
    --requirement "${REQUIREMENTS_TXT}" \
    --target "${PYTHON_PACKAGES_DIR}"
fi

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

cat > "${BIN_DIR}/hb" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUNTIME_PYTHON="$(find "${BUNDLE_ROOT}/python" -type f \( -path '*/bin/python3.12' -o -path '*/bin/python3' \) | head -n1)"

if [ -z "${RUNTIME_PYTHON}" ]; then
  echo "failed to resolve bundled runtime Python under ${BUNDLE_ROOT}/python" >&2
  exit 1
fi

export HOLABOSS_RUNTIME_APP_ROOT="${BUNDLE_ROOT}/runtime/app"
export HOLABOSS_RUNTIME_ROOT="${BUNDLE_ROOT}/runtime"
export HOLABOSS_RUNTIME_PYTHON="${RUNTIME_PYTHON}"
export HOLABOSS_RUNTIME_SITE_PACKAGES="${BUNDLE_ROOT}/python-packages"
export PATH="${BUNDLE_ROOT}/node-runtime/bin:${PATH}"

exec "${BUNDLE_ROOT}/runtime/bin/hb" "$@"
EOF

cat > "${BIN_DIR}/sandbox-runtime" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUNTIME_PYTHON="$(find "${BUNDLE_ROOT}/python" -type f \( -path '*/bin/python3.12' -o -path '*/bin/python3' \) | head -n1)"

if [ -z "${RUNTIME_PYTHON}" ]; then
  echo "failed to resolve bundled runtime Python under ${BUNDLE_ROOT}/python" >&2
  exit 1
fi

export HOLABOSS_RUNTIME_APP_ROOT="${BUNDLE_ROOT}/runtime/app"
export HOLABOSS_RUNTIME_ROOT="${BUNDLE_ROOT}/runtime"
export HOLABOSS_RUNTIME_PYTHON="${RUNTIME_PYTHON}"
export HOLABOSS_RUNTIME_SITE_PACKAGES="${BUNDLE_ROOT}/python-packages"
export PATH="${BUNDLE_ROOT}/node-runtime/bin:${PATH}"

exec "${BUNDLE_ROOT}/runtime/bootstrap/linux.sh" "$@"
EOF

chmod +x "${BIN_DIR}/hb" "${BIN_DIR}/sandbox-runtime"

cat > "${PACKAGE_METADATA_PATH}" <<EOF
{
  "platform": "linux",
  "python_runtime_path": "$(basename "${BUNDLED_PYTHON_PREFIX}")",
  "python_deps_installed": $([ "${SKIP_PYTHON_DEPS}" = "1" ] && printf 'false' || printf 'true'),
  "node_deps_installed": $([ "${SKIP_NODE_DEPS}" = "1" ] && printf 'false' || printf 'true'),
  "opencode_installed": $([ "${SKIP_NODE_DEPS}" = "1" ] || [ "${INSTALL_OPENCODE}" != "1" ] && printf 'false' || printf 'true'),
  "qmd_installed": $([ "${SKIP_NODE_DEPS}" = "1" ] || [ "${INSTALL_QMD}" != "1" ] && printf 'false' || printf 'true')
}
EOF

echo "packaged Linux runtime bundle at ${OUTPUT_ROOT}" >&2
