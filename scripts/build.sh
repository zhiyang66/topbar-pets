#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
mkdir -p "$DIST_DIR"

echo "[1/2] Compiling GSettings schemas..."
glib-compile-schemas --strict "$ROOT_DIR/schemas"

echo "[2/2] Packing GNOME Shell extension bundle..."
gnome-extensions pack "$ROOT_DIR" \
  --force \
  --out-dir="$DIST_DIR" \
  --extra-source="$ROOT_DIR/src" \
  --extra-source="$ROOT_DIR/assets"

echo "Done! Bundle created at: $DIST_DIR/topbar-pet@local.gnome-extension.shell-extension.zip"
