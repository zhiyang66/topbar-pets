#!/usr/bin/env bash
set -euo pipefail

UUID="topbar-pet@local.gnome-extension"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$ROOT_DIR/scripts/build.sh"

ZIP_FILE="$ROOT_DIR/dist/${UUID}.shell-extension.zip"
echo "Installing $UUID..."
gnome-extensions install --force "$ZIP_FILE"

# Add UUID to enabled-extensions in dconf/gsettings so it activates automatically
python3 - "$UUID" << 'PY'
import ast, subprocess, sys
uuid = sys.argv[1]
raw = subprocess.check_output(
    ["gsettings", "get", "org.gnome.shell", "enabled-extensions"], text=True
).strip()
cur = [] if raw.startswith("@as") else list(ast.literal_eval(raw))
if uuid not in cur:
    cur.append(uuid)
    subprocess.check_call(
        ["gsettings", "set", "org.gnome.shell", "enabled-extensions", repr(cur)]
    )
print("Registered in enabled-extensions:", uuid)
PY

# Try enabling or reloading live via GNOME Shell D-Bus
if gdbus call --session \
  --dest org.gnome.Shell.Extensions \
  --object-path /org/gnome/Shell/Extensions \
  --method org.gnome.Shell.Extensions.GetExtensionInfo "$UUID" 2>/dev/null | grep -q "'uuid'"; then
  gdbus call --session \
    --dest org.gnome.Shell.Extensions \
    --object-path /org/gnome/Shell/Extensions \
    --method org.gnome.Shell.Extensions.ReloadExtension "$UUID" >/dev/null 2>&1 || true
  gdbus call --session \
    --dest org.gnome.Shell.Extensions \
    --object-path /org/gnome/Shell/Extensions \
    --method org.gnome.Shell.Extensions.EnableExtension "$UUID" >/dev/null 2>&1 || true
  echo "Extension hot-loaded in current GNOME session!"
else
  echo "Installed to ~/.local/share/gnome-shell/extensions/$UUID"
  echo "Note: On Wayland, first-time local extension installation requires logging out & back in once (or run ./scripts/dev-preview.sh to preview immediately in a window!)."
fi
