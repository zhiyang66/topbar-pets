#!/usr/bin/env bash
set -euo pipefail

UUID="topbar-pet@local.gnome-extension"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PREVIEW_RES="${PREVIEW_RES:-1440x810}"
VNC_DISPLAY=":99"
VNC_PORT="5999"
NOVNC_PORT="${NOVNC_PORT:-6080}"

USER_BUS="/run/user/$(id -u)/bus"
if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ] && [ -S "$USER_BUS" ]; then
  export DBUS_SESSION_BUS_ADDRESS="unix:path=$USER_BUS"
fi

echo "[1/4] Compiling GSettings schemas..."
glib-compile-schemas --strict "$ROOT_DIR/schemas"

if [ "${1:-}" = "--prefs" ]; then
  echo "Opening GTK4 Preferences window inside preview display ($VNC_DISPLAY)..."
  exec env -u WAYLAND_DISPLAY DISPLAY="$VNC_DISPLAY" GDK_BACKEND=x11 GSK_RENDERER=cairo GTK_USE_PORTAL=0 GDK_DEBUG=no-portals \
    gjs -m "$ROOT_DIR/assets/tools/open_prefs_standalone.js" "$ROOT_DIR"
fi

# Clean up any previous preview processes
killall -q gnome-shell Xtigervnc websockify 2>/dev/null || true
sleep 0.3
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
rm -f "${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/gnome-shell-disable-extensions"

echo "[2/4] Linking live workspace & enabling extension in dconf..."
EXT_DIR="$HOME/.local/share/gnome-shell/extensions"
mkdir -p "$EXT_DIR"
rm -rf "$EXT_DIR/$UUID"
ln -s "$ROOT_DIR" "$EXT_DIR/$UUID"

gsettings set org.gnome.shell disable-user-extensions false 2>/dev/null || true
gsettings set org.gnome.shell welcome-dialog-last-shown-version '99.0' 2>/dev/null || true
gsettings set org.gnome.shell enabled-extensions "['$UUID']" 2>/dev/null || true

echo "[3/4] Starting TigerVNC ($VNC_DISPLAY @ $PREVIEW_RES) & noVNC Web Server (port $NOVNC_PORT)..."
Xtigervnc "$VNC_DISPLAY" \
  -geometry "$PREVIEW_RES" \
  -depth 24 \
  -SecurityTypes None \
  -AlwaysShared=1 \
  -AcceptSetDesktopSize=1 \
  -rfbport "$VNC_PORT" >/tmp/topbar-pet-xvnc.log 2>&1 &
XVNC_PID=$!

websockify --web=/usr/share/novnc "0.0.0.0:$NOVNC_PORT" "127.0.0.1:$VNC_PORT" >/tmp/topbar-pet-novnc.log 2>&1 &
NOVNC_PID=$!

cleanup() {
  kill "$NOVNC_PID" "$XVNC_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for _ in $(seq 1 20); do
  if [ -S /tmp/.X11-unix/X99 ]; then
    break
  fi
  sleep 0.1
done

WSL_IP=$(hostname -I | awk '{print $1}')
echo "=================================================================="
echo "  Preview Ready! Open in Windows Browser (Chrome / Edge):"
echo "  -> http://127.0.0.1:${NOVNC_PORT}/vnc.html?autoconnect=true&resize=scale"
echo "  -> http://${WSL_IP}:${NOVNC_PORT}/vnc.html?autoconnect=true&resize=scale"
echo "=================================================================="

echo "[4/4] Launching GNOME Shell X11 session on $VNC_DISPLAY..."
RUN_PREFIX=()
if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
  RUN_PREFIX=(dbus-run-session --)
fi

env -u WAYLAND_DISPLAY \
  DISPLAY="$VNC_DISPLAY" \
  LIBGL_ALWAYS_SOFTWARE=1 \
  GTK_USE_PORTAL=0 \
  GDK_DEBUG=no-portals \
  TOPBAR_PET_PREVIEW=1 \
  TOPBAR_PET_HOST_WAYLAND="" \
  TOPBAR_PET_HOST_DISPLAY="$VNC_DISPLAY" \
  "${RUN_PREFIX[@]}" bash -c "
    (
      for i in \$(seq 1 40); do
        if gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.freedesktop.DBus.Peer.Ping >/dev/null 2>&1; then
          gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.freedesktop.DBus.Properties.Set org.gnome.Shell.Extensions UserExtensionsEnabled '<true>' >/dev/null 2>&1 || true
          gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Extensions.EnableExtension '$UUID' >/dev/null 2>&1 || true
          sleep 0.6
          INFO=\$(gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Extensions.GetExtensionInfo '$UUID' 2>/dev/null || true)
          echo \">>> EXTENSION_STATUS: \$INFO\"
          break
        fi
        sleep 0.3
      done
    ) &
    exec gnome-shell --x11
  "
