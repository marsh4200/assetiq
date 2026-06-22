#!/usr/bin/env bash
# ============================================================ AssetIQ =====
# One-line install / update:
#   curl -fsSL https://raw.githubusercontent.com/marsh4200/assetiq/main/install.sh | bash
#
# Optional overrides:
#   ASSETIQ_DIR=/opt/assetiq  ASSETIQ_PORT=9920  ASSETIQ_BRANCH=main \
#     bash -c "$(curl -fsSL https://raw.githubusercontent.com/marsh4200/assetiq/main/install.sh)"
# =========================================================================
set -euo pipefail

REPO="marsh4200/assetiq"
BRANCH="${ASSETIQ_BRANCH:-main}"
DIR="${ASSETIQ_DIR:-/opt/assetiq}"
PORT="${ASSETIQ_PORT:-9920}"

c()  { printf '\033[1;36m%s\033[0m\n' "$*"; }   # cyan
ok() { printf '\033[1;32m%s\033[0m\n' "$*"; }   # green
err(){ printf '\033[1;31m%s\033[0m\n' "$*" >&2; } # red

c "AssetIQ installer"
echo "  repo:   $REPO ($BRANCH)"
echo "  dir:    $DIR"
echo "  port:   $PORT"
echo

# --- sudo helper (only escalate when the target dir needs it) --------------
SUDO=""
parent="$(dirname "$DIR")"
if [ ! -w "$parent" ] && [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then SUDO="sudo"; else
    err "Need write access to $parent (run as root or install sudo)."; exit 1
  fi
fi

# --- docker check ----------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  err "Docker is not installed. Install Docker Engine first: https://docs.docker.com/engine/install/"
  exit 1
fi
if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  err "Docker Compose not found. Install the Compose plugin: https://docs.docker.com/compose/install/"
  exit 1
fi

# --- fetch / update the code ----------------------------------------------
if [ -d "$DIR/.git" ]; then
  c "Updating existing install…"
  $SUDO git -C "$DIR" fetch --depth 1 origin "$BRANCH"
  $SUDO git -C "$DIR" reset --hard "origin/$BRANCH"
elif command -v git >/dev/null 2>&1; then
  c "Cloning repository…"
  $SUDO rm -rf "$DIR"
  $SUDO git clone --depth 1 -b "$BRANCH" "https://github.com/$REPO.git" "$DIR"
else
  c "Downloading archive…"
  tmp="$(mktemp -d)"
  curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" -o "$tmp/src.tgz"
  $SUDO rm -rf "$DIR"; $SUDO mkdir -p "$DIR"
  tar -xzf "$tmp/src.tgz" -C "$tmp"
  $SUDO cp -a "$tmp/$(basename "$REPO")-$BRANCH/." "$DIR/"
  rm -rf "$tmp"
fi

$SUDO mkdir -p "$DIR/data"

# --- apply the chosen port -------------------------------------------------
if [ "$PORT" != "9920" ]; then
  c "Setting port to $PORT…"
  $SUDO sed -i "s/\"9920:9920\"/\"$PORT:9920\"/" "$DIR/docker-compose.yml"
fi

# --- build & launch --------------------------------------------------------
c "Building and starting the container…"
$SUDO $COMPOSE -f "$DIR/docker-compose.yml" up -d --build

echo
ok "AssetIQ is up."
ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo "  Local:  http://localhost:$PORT"
[ -n "${ip:-}" ] && echo "  LAN:    http://$ip:$PORT"
echo "  Login:  admin / admin   (you'll be asked to change it)"
echo
echo "  Code lives in $DIR — keep it there so in-app updates persist."
