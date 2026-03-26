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

rewrite_absolute_symlinks() {
  local root="$1"

  while IFS= read -r -d '' link_path; do
    local target
    target="$(readlink "${link_path}")"

    case "${target}" in
      "${root}"/*)
        local relative_target
        relative_target="$("${PYTHON_BIN}" -c 'import os,sys; print(os.path.relpath(sys.argv[2], os.path.dirname(sys.argv[1])))' "${link_path}" "${target}")"
        ln -sfn "${relative_target}" "${link_path}"
        ;;
    esac
  done < <(find "${root}" -type l -print0)
}

require_cmd() {
  local name="$1"
  if ! command -v "${name}" >/dev/null 2>&1; then
    echo "required command not found: ${name}" >&2
    exit 1
  fi
}

require_cmd git
require_cmd uv
PYTHON_BIN="${HOLABOSS_MACOS_PYTHON_BIN:-python3}"
require_cmd "${PYTHON_BIN}"
OUTPUT_ROOT="$("${PYTHON_BIN}" -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "${OUTPUT_ROOT}")"

PYTHON_VERSION="$("${PYTHON_BIN}" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
case "${PYTHON_VERSION}" in
  3.12) ;;
  *)
    echo "macOS runtime packaging requires Python 3.12; got ${PYTHON_VERSION} from ${PYTHON_BIN}" >&2
    echo "set HOLABOSS_MACOS_PYTHON_BIN to a Python 3.12 executable and retry" >&2
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

BUNDLED_PYTHON_VERSION="${HOLABOSS_MACOS_PYTHON_VERSION:-3.12}"
uv python install "${BUNDLED_PYTHON_VERSION}" \
  --install-dir "${PYTHON_ROOT_DIR}" \
  --managed-python \
  --force

BUNDLED_PYTHON_PREFIX="$(find "${PYTHON_ROOT_DIR}" -mindepth 1 -maxdepth 1 -type d | head -n1)"
if [ -z "${BUNDLED_PYTHON_PREFIX}" ]; then
  echo "failed to resolve bundled Python prefix under ${PYTHON_ROOT_DIR}" >&2
  exit 1
fi

BUNDLED_PYTHON="${BUNDLED_PYTHON_PREFIX}/bin/python3.12"
if [ ! -x "${BUNDLED_PYTHON}" ]; then
  echo "bundled Python interpreter not found at ${BUNDLED_PYTHON}" >&2
  exit 1
fi

if [ "${SKIP_PYTHON_DEPS}" != "1" ]; then
  REQUIREMENTS_TXT="${STAGING_ROOT}/requirements-macos.txt"
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

rewrite_absolute_symlinks "${OUTPUT_ROOT}"

cat > "${BIN_DIR}/hb" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUNTIME_PYTHON="$(find "${BUNDLE_ROOT}/python" -path '*/bin/python3.12' -type f | head -n1)"

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
RUNTIME_PYTHON="$(find "${BUNDLE_ROOT}/python" -path '*/bin/python3.12' -type f | head -n1)"

if [ -z "${RUNTIME_PYTHON}" ]; then
  echo "failed to resolve bundled runtime Python under ${BUNDLE_ROOT}/python" >&2
  exit 1
fi

export HOLABOSS_RUNTIME_APP_ROOT="${BUNDLE_ROOT}/runtime/app"
export HOLABOSS_RUNTIME_ROOT="${BUNDLE_ROOT}/runtime"
export HOLABOSS_RUNTIME_PYTHON="${RUNTIME_PYTHON}"
export HOLABOSS_RUNTIME_SITE_PACKAGES="${BUNDLE_ROOT}/python-packages"
export PATH="${BUNDLE_ROOT}/node-runtime/bin:${PATH}"

exec "${BUNDLE_ROOT}/runtime/bootstrap/macos.sh" "$@"
EOF

chmod +x "${BIN_DIR}/hb" "${BIN_DIR}/sandbox-runtime"

cat > "${PACKAGE_METADATA_PATH}" <<EOF
{
  "platform": "macos",
  "python_runtime_path": "$(basename "${BUNDLED_PYTHON_PREFIX}")",
  "python_deps_installed": $([ "${SKIP_PYTHON_DEPS}" = "1" ] && printf 'false' || printf 'true'),
  "node_deps_installed": $([ "${SKIP_NODE_DEPS}" = "1" ] && printf 'false' || printf 'true'),
  "opencode_installed": $([ "${SKIP_NODE_DEPS}" = "1" ] || [ "${INSTALL_OPENCODE}" != "1" ] && printf 'false' || printf 'true'),
  "qmd_installed": $([ "${SKIP_NODE_DEPS}" = "1" ] || [ "${INSTALL_QMD}" != "1" ] && printf 'false' || printf 'true')
}
EOF

echo "packaged macOS runtime bundle at ${OUTPUT_ROOT}" >&2
