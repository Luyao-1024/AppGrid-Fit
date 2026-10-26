#!/usr/bin/env bash
# Run the upstream-layout probe in an isolated headless GNOME Shell on the
# current Fedora session. The user's desktop, settings and app order are not
# touched: the Shell gets its own D-Bus bus, XDG directories and virtual
# monitor.
#
# Example:
#   scripts/verify-fedora-headless.sh
#
# Requirements: gnome-shell, dbus-run-session, gsettings, gnome-extensions,
# unzip, python3 and a working Wayland session. Set TIMEOUT or MONITOR to
# override the defaults.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
UUID=${EXTENSION_UUID:-appgrid-size@luyao}
MONITOR=${MONITOR:-1920x1080}
TIMEOUT=${TIMEOUT:-300}
WORK=$(mktemp -d /tmp/appgrid-fedora-headless.XXXXXX)
EXT_DIR="$WORK/data/gnome-shell/extensions/$UUID"
HELPER_DIR="$WORK/data/gnome-shell/extensions/appgrid-test-helper@local"
HELPER_STATE="$WORK/helper-state.json"
SHELL_LOG="$WORK/shell.log"

cleanup() {
    rm -rf "$WORK"
}
trap cleanup EXIT

for command in gnome-shell dbus-run-session glib-compile-schemas \
    gnome-extensions unzip python3; do
    command -v "$command" >/dev/null || {
        echo "Missing required command: $command"
        exit 1
    }
done

echo '== Build =='
(
    cd "$ROOT"
    glib-compile-schemas --strict schemas/
    gnome-extensions pack --force \
        --extra-source=config.js \
        --extra-source=gridPages.js \
        --extra-source=gridLayout.js \
        --extra-source=LICENSE \
        . --out-dir="$WORK" >/dev/null
)

echo '== Prepare isolated Shell =='
mkdir -p "$WORK/home" "$WORK/runtime" "$WORK/config" \
    "$WORK/data" "$WORK/cache"
chmod 700 "$WORK/runtime"
mkdir -p "$EXT_DIR"
unzip -q "$WORK/$UUID.shell-extension.zip" -d "$EXT_DIR"
glib-compile-schemas "$EXT_DIR/schemas"

mkdir -p "$HELPER_DIR"
cat > "$HELPER_DIR/metadata.json" <<'EOF'
{"uuid":"appgrid-test-helper@local","name":"AppGrid Test Helper","description":"Sets Looking Glass unsafe mode for automated probes","shell-version":["46","47","48","49","50"],"version":1}
EOF
cat > "$HELPER_DIR/extension.js" <<'EOF'
import GLib from 'gi://GLib'
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js'

export default class TestHelperExtension extends Extension {
    enable() {
        global.context.unsafe_mode = true
        const path = GLib.getenv('APPGRID_HELPER_STATE')
        if (path) {
            GLib.file_set_contents(path, JSON.stringify({
                enabled: true,
                unsafe: global.context.unsafe_mode,
            }))
        }
    }

    disable() {
        global.context.unsafe_mode = false
    }
}
EOF

cat > "$WORK/inner.sh" <<'INNER'
set -e
export HOME="$TEST_ROOT/home"
export XDG_RUNTIME_DIR="$TEST_ROOT/runtime"
export XDG_CONFIG_HOME="$TEST_ROOT/config"
export XDG_DATA_HOME="$TEST_ROOT/data"
export XDG_CACHE_HOME="$TEST_ROOT/cache"
export GSETTINGS_SCHEMA_DIR="$TEST_EXT_DIR/schemas"
export EXPECTED_LAYOUT_MODE=modes
export FORCE_APP_GRID=1
export APPGRID_HELPER_STATE="$TEST_HELPER_STATE"

gnome-shell --headless --wayland --wayland-display="$TEST_WAYLAND" \
    --virtual-monitor "$TEST_MONITOR" >"$TEST_LOG" 2>&1 &
shell_pid=$!
trap 'kill $shell_pid 2>/dev/null || true; wait $shell_pid 2>/dev/null || true' EXIT

for _ in $(seq 1 30); do
    sleep 1
    if gdbus call --session --dest org.gnome.Shell \
        --object-path /org/gnome/Shell \
        --method org.freedesktop.DBus.Peer.Ping >/dev/null 2>&1; then
        break
    fi
done
if ! gdbus call --session --dest org.gnome.Shell \
    --object-path /org/gnome/Shell \
    --method org.freedesktop.DBus.Peer.Ping >/dev/null 2>&1; then
    echo 'Isolated GNOME Shell did not start'
    tail -40 "$TEST_LOG"
    exit 1
fi
echo 'SHELL_READY'

gnome-extensions enable "$TEST_UUID"
for _ in $(seq 1 30); do
    gnome-extensions info "$TEST_UUID" 2>/dev/null | grep -q ACTIVE && break
    sleep 0.5
done
gnome-extensions info "$TEST_UUID" | sed -n '1,12p'
if ! gnome-extensions info "$TEST_UUID" | grep -q ACTIVE; then
    echo 'Extension did not become ACTIVE in the isolated Shell'
    tail -60 "$TEST_LOG"
    exit 1
fi

# Enable the helper last: extension-manager changes reset unsafe mode.
gnome-extensions enable appgrid-test-helper@local
for _ in $(seq 1 20); do
    [ -s "$TEST_HELPER_STATE" ] && break
    sleep 0.5
done
if [ ! -s "$TEST_HELPER_STATE" ]; then
    echo 'Test helper did not enable Looking Glass unsafe mode'
    tail -40 "$TEST_LOG"
    exit 1
fi
cat "$TEST_HELPER_STATE"
echo

set +e
python3 "$TEST_PROBE"
probe_status=$?
set -e
kill "$shell_pid" 2>/dev/null || true
wait "$shell_pid" 2>/dev/null || true
exit "$probe_status"
INNER

export TEST_ROOT="$WORK"
export TEST_EXT_DIR="$EXT_DIR"
export TEST_HELPER_STATE="$HELPER_STATE"
export TEST_PROBE="$ROOT/scripts/vm-probe.py"
export TEST_MONITOR="$MONITOR"
export TEST_WAYLAND="wayland-appgrid-fedora-$$"
export TEST_LOG="$SHELL_LOG"
export TEST_UUID="$UUID"

HOST_ENABLED=$(gsettings get org.gnome.shell enabled-extensions)
HOST_PICKER=$(gsettings get org.gnome.shell app-picker-layout)

echo '== Start isolated headless Shell =='
set +e
# Set the isolated XDG environment before starting dbus-run-session so
# activated services such as dconf inherit it instead of the live session's.
HOME="$WORK/home" \
XDG_RUNTIME_DIR="$WORK/runtime" \
XDG_CONFIG_HOME="$WORK/config" \
XDG_DATA_HOME="$WORK/data" \
XDG_CACHE_HOME="$WORK/cache" \
timeout "$TIMEOUT" dbus-run-session -- bash "$WORK/inner.sh"
status=$?
set -e

host_enabled_after=$(gsettings get org.gnome.shell enabled-extensions)
host_picker_after=$(gsettings get org.gnome.shell app-picker-layout)
if [ "$host_enabled_after" != "$HOST_ENABLED" ] ||
    [ "$host_picker_after" != "$HOST_PICKER" ]; then
    echo 'ERROR: the isolated test changed the live session settings'
    echo "enabled-extensions before: $HOST_ENABLED"
    echo "enabled-extensions after:  $host_enabled_after"
    gsettings set org.gnome.shell enabled-extensions "$HOST_ENABLED"
    gsettings set org.gnome.shell app-picker-layout "$HOST_PICKER"
    trap - EXIT
    echo "Artifacts kept in $WORK"
    exit 1
fi

if [ "$status" -ne 0 ]; then
    echo "Isolated Fedora probe failed with status $status"
    echo "Shell log: $SHELL_LOG"
    tail -80 "$SHELL_LOG" 2>/dev/null || true
    trap - EXIT
    echo "Artifacts kept in $WORK"
    exit "$status"
fi

rm -f "$HELPER_STATE"
echo 'Fedora headless verification completed'
