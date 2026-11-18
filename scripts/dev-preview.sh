#!/usr/bin/env bash
set -euo pipefail

UUID="topbar-pet@local.gnome-extension"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$ROOT_DIR/scripts/install.sh"

if ! command -v mutter-devkit >/dev/null 2>&1 && [ ! -x /usr/libexec/mutter-devkit ]; then
  echo ""
  echo "提示：当前系统尚未安装 mutter-dev-bin（GNOME 50 嵌套窗口预览组件）。"
  echo "请先执行：sudo apt install mutter-dev-bin"
  exit 1
fi

# Clean up stale 60s GNOME Shell startup crash-guard marker if an earlier preview closed early
rm -f "${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/gnome-shell-disable-extensions"

# Preserve host Wayland/X11 socket names so standalone GTK4 Preferences window opens cleanly on host desktop!
HOST_WAYLAND="${WAYLAND_DISPLAY:-wayland-0}"
HOST_DISPLAY="${DISPLAY:-:0}"

# Isolated dconf keyfile profile so we NEVER touch the host desktop's enabled-extensions!
PREVIEW_DIR="/tmp/topbar-pet-devkit-dconf"
mkdir -p "$PREVIEW_DIR/dconf"
printf "service-db:keyfile/user\n" > "$PREVIEW_DIR/profile"
if [ ! -f "$PREVIEW_DIR/dconf/user" ] || ! grep -q "enabled-extensions" "$PREVIEW_DIR/dconf/user" 2>/dev/null; then
  cat << EOF > "$PREVIEW_DIR/dconf/user"
[org/gnome/shell]
disable-user-extensions=false
welcome-dialog-last-shown-version='99.0'
enabled-extensions=['$UUID']
EOF
fi

echo "Launching fast nested GNOME Shell (--devkit) preview window for $UUID..."
exec env \
  XDG_CONFIG_HOME="$PREVIEW_DIR" \
  DCONF_PROFILE="$PREVIEW_DIR/profile" \
  GTK_USE_PORTAL=0 \
  GDK_DEBUG=no-portals \
  TOPBAR_PET_PREVIEW=1 \
  TOPBAR_PET_HOST_WAYLAND="$HOST_WAYLAND" \
  TOPBAR_PET_HOST_DISPLAY="$HOST_DISPLAY" \
  dbus-run-session -- bash -c "
    (
      for i in \$(seq 1 40); do
        if gdbus call --session --dest org.gnome.Shell.Extensions --object-path /org/gnome/Shell.Extensions --method org.gnome.Shell.Extensions.ListExtensions >/dev/null 2>&1; then
          gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.freedesktop.DBus.Properties.Set org.gnome.Shell.Extensions UserExtensionsEnabled '<true>' >/dev/null 2>&1 || true
          gdbus call --session --dest org.gnome.Shell.Extensions --object-path /org/gnome/Shell/Extensions --method org.gnome.Shell.Extensions.EnableExtension '$UUID' >/dev/null 2>&1 || true
          INFO=\$(gdbus call --session --dest org.gnome.Shell.Extensions --object-path /org/gnome/Shell/Extensions --method org.gnome.Shell.Extensions.GetExtensionInfo '$UUID' 2>/dev/null || true)
          echo \">>> EXTENSION_STATUS: \$INFO\"
          break
        fi
        sleep 0.3
      done
    ) &
    exec gnome-shell --devkit
  "
