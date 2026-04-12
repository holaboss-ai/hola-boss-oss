#!/usr/bin/env bash

set -euo pipefail

REPO_URL="https://github.com/holaboss-ai/holaboss-ai.git"
INSTALL_DIR="${HOME}/holaboss-ai"
REF="main"
LAUNCH=0

usage() {
  cat <<'EOF'
Usage: install.sh [--dir PATH] [--ref REF] [--launch] [--help]

Bootstrap Holaboss Desktop from a fresh machine:
- clone or update the repository checkout
- create desktop/.env if it does not exist yet
- install desktop dependencies
- run desktop:typecheck
- optionally launch desktop:dev

Examples:
  curl -fsSL https://raw.githubusercontent.com/holaboss-ai/holaboss-ai/main/scripts/install.sh | bash
  curl -fsSL https://raw.githubusercontent.com/holaboss-ai/holaboss-ai/main/scripts/install.sh | bash -s -- --launch
  bash scripts/install.sh --dir "$PWD" --launch
EOF
}

log() {
  printf '==> %s\n' "$*"
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)
      [[ $# -ge 2 ]] || die "--dir requires a value"
      INSTALL_DIR="$2"
      shift 2
      ;;
    --ref)
      [[ $# -ge 2 ]] || die "--ref requires a value"
      REF="$2"
      shift 2
      ;;
    --launch)
      LAUNCH=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

need_cmd git
need_cmd node
need_cmd npm

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [[ "$NODE_MAJOR" -lt 22 ]]; then
  die "Node.js 22+ is required"
fi

mkdir -p "$(dirname "$INSTALL_DIR")"
INSTALL_DIR="$(cd "$(dirname "$INSTALL_DIR")" && pwd)/$(basename "$INSTALL_DIR")"

if [[ -e "$INSTALL_DIR" && ! -d "$INSTALL_DIR" ]]; then
  die "install target exists and is not a directory: $INSTALL_DIR"
fi

if [[ -d "$INSTALL_DIR/.git" ]]; then
  if [[ -n "$(git -C "$INSTALL_DIR" status --porcelain)" ]]; then
    die "existing checkout at $INSTALL_DIR has local changes; clean it or choose --dir"
  fi

  log "Updating existing checkout in $INSTALL_DIR"
  git -C "$INSTALL_DIR" fetch origin "$REF" --depth 1
  git -C "$INSTALL_DIR" checkout -B "$REF" FETCH_HEAD
else
  if [[ -d "$INSTALL_DIR" ]] && [[ -n "$(find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
    die "install target already exists and is not an empty git checkout: $INSTALL_DIR"
  fi

  log "Cloning $REPO_URL into $INSTALL_DIR"
  git clone --depth 1 --branch "$REF" "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

if [[ ! -f desktop/.env ]]; then
  log "Creating desktop/.env from desktop/.env.example"
  cp desktop/.env.example desktop/.env
else
  log "desktop/.env already exists; leaving it unchanged"
fi

log "Installing desktop dependencies"
npm run desktop:install

log "Verifying desktop typecheck"
npm run desktop:typecheck

if [[ "$LAUNCH" -eq 1 ]]; then
  log "Starting desktop development environment"
  exec npm run desktop:dev
fi

cat <<EOF

Install complete.

Repository:
  $INSTALL_DIR

Next step:
  cd "$INSTALL_DIR" && npm run desktop:dev

To launch automatically from the installer:
  curl -fsSL https://raw.githubusercontent.com/holaboss-ai/holaboss-ai/main/scripts/install.sh | bash -s -- --launch
EOF
