#!/usr/bin/env bash
# Run inside a disposable QEMU guest. The guest must already have gnome-shell,
# dbus-run-session, gnome-extensions, glib-compile-schemas, dconf, unzip and
# python3. All GNOME state is placed in /tmp; the caller discards the VM overlay.
set -euo pipefail

EXT_ZIP=${1:?usage: qemu-guest-probe.sh EXTENSION.zip PROBE.py}
PROBE=${2:?usage: qemu-guest-probe.sh EXTENSION.zip PROBE.py}
UUID=${EXTENSION_UUID:-appgrid-size@luyao}
EXPECTED_LAYOUT_MODE=${EXPECTED_LAYOUT_MODE:-modes}
EXPECTED_SHELL_MAJOR=${EXPECTED_SHELL_MAJOR:-}
MONITOR=${MONITOR:-1920x1080}

WORK=/tmp/appgrid-qemu-probe
rm -rf "$WORK"
mkdir -p "$WORK/home" "$WORK/runtime" "$WORK/config" \
    "$WORK/data" "$WORK/cache"
chmod 700 "$WORK/runtime"

EXT_DIR="$WORK/data/gnome-shell/extensions/$UUID"
SHELL_LOG="$WORK/shell.log"
INNER="$WORK/inner.sh"

for command in gnome-shell dbus-run-session glib-compile-schemas \
    gsettings gdbus dconf unzip python3; do
    command -v "$command" >/dev/null || {
        echo "Missing required guest command: $command"
        exit 1
    }
done

if [ -n "$EXPECTED_SHELL_MAJOR" ]; then
    actual_major=$(gnome-shell --version | grep -oE '[0-9]+' | head -1)
    if [ "$actual_major" != "$EXPECTED_SHELL_MAJOR" ]; then
        echo "Guest runs GNOME Shell $actual_major," \
            "expected $EXPECTED_SHELL_MAJOR: $(gnome-shell --version)"
        exit 1
    fi
    echo "GNOME Shell $(gnome-shell --version | awk '{print $NF}')"
fi

mkdir -p "$EXT_DIR"
unzip -q "$EXT_ZIP" -d "$EXT_DIR"
glib-compile-schemas "$EXT_DIR/schemas"

cat > "$INNER" <<'INNER'
set -e
export EXPECTED_LAYOUT_MODE MONITOR EXTENSION_UUID FORCE_APP_GRID=1 TEST_FOLDER=1
unset WAYLAND_DISPLAY

gsettings set org.gnome.shell enabled-extensions "[]"
# Cloud images ship no desktop apps; provisioning creates dummy entries so the
# grid has multiple pages. Pin nine as favorites so the Dash is measurable.
gsettings set org.gnome.shell favorite-apps \
    "['appgrid-test-01.desktop', 'appgrid-test-02.desktop', 'appgrid-test-03.desktop', 'appgrid-test-04.desktop', 'appgrid-test-05.desktop', 'appgrid-test-06.desktop', 'appgrid-test-07.desktop', 'appgrid-test-08.desktop', 'appgrid-test-09.desktop']"

# Start from a 2x3 grid so the app-picker layout captured by the probe uses
# the same page capacity it is restored with later.
gsettings set org.gnome.shell.extensions.appgrid-size use-presets false
gsettings set org.gnome.shell.extensions.appgrid-size custom-icon-size 64
gsettings set org.gnome.shell.extensions.appgrid-size custom-rows 2
gsettings set org.gnome.shell.extensions.appgrid-size custom-columns 3
gsettings set org.gnome.shell.extensions.appgrid-size custom-row-spacing 8
gsettings set org.gnome.shell.extensions.appgrid-size custom-column-spacing 16

gnome-shell --headless --wayland --no-x11 --unsafe-mode \
    --wayland-display=appgrid-qemu-probe \
    --virtual-monitor "$MONITOR" >"$WORK/shell.log" 2>&1 &
shell_pid=$!
trap 'kill $shell_pid 2>/dev/null || true; wait $shell_pid 2>/dev/null || true' EXIT

for _ in $(seq 1 120); do
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
    tail -80 "$WORK/shell.log" || true
    exit 1
fi
echo 'SHELL_READY'

eval_shell() {
    gdbus call --session --dest org.gnome.Shell \
        --object-path /org/gnome/Shell \
        --method org.gnome.Shell.Eval "$1"
}

eval_ready=0
for _ in $(seq 1 60); do
    if eval_shell '1 + 1' | grep -q '^(true'; then
        eval_ready=1
        break
    fi
    sleep 0.5
done
if [ "$eval_ready" != 1 ]; then
    echo 'Shell Eval did not become available'
    tail -80 "$WORK/shell.log" || true
    exit 1
fi

if ! eval_shell 'global.context.unsafe_mode' | grep -q true; then
    echo 'Shell is not in unsafe mode; the probe cannot use Eval'
    tail -80 "$WORK/shell.log" || true
    exit 1
fi

monitor=$(eval_shell "Main.layoutManager.primaryMonitor.width + 'x' + Main.layoutManager.primaryMonitor.height")
case "$monitor" in
    *"$MONITOR"*) ;;
    *)
        echo "Guest monitor is $monitor, expected $MONITOR"
        exit 1
        ;;
esac
echo "monitor $MONITOR"

if ! eval_shell "Main.extensionManager.enableExtension('$EXTENSION_UUID'); 1" |
    grep -q '^(true'; then
    echo 'Could not request extension enablement through Shell Eval'
    tail -80 "$WORK/shell.log" || true
    exit 1
fi
active=0
for _ in $(seq 1 60); do
    if eval_shell "Main.extensionManager.lookup('$EXTENSION_UUID')?.state === 1" |
        grep -q "(true, 'true')"; then
        active=1
        break
    fi
    sleep 0.5
done
if [ "$active" != 1 ]; then
    echo 'Extension did not become ACTIVE in the isolated Shell'
    eval_shell "JSON.stringify({state: Main.extensionManager.lookup('$EXTENSION_UUID')?.state, error: Main.extensionManager.lookup('$EXTENSION_UUID')?.error})" ||
        true
    tail -100 "$WORK/shell.log" || true
    exit 1
fi
echo 'extension active'

set +e
python3 "$PROBE"
probe_status=$?
set -e

eval_shell "Main.extensionManager.disableExtension('$EXTENSION_UUID'); 1" \
    >/dev/null 2>&1 || true
kill "$shell_pid" 2>/dev/null || true
wait "$shell_pid" 2>/dev/null || true
exit "$probe_status"
INNER

export WORK
export PROBE
export HOME="$WORK/home"
export XDG_RUNTIME_DIR="$WORK/runtime"
export XDG_CONFIG_HOME="$WORK/config"
export XDG_DATA_HOME="$WORK/data"
export XDG_CACHE_HOME="$WORK/cache"
export GSETTINGS_SCHEMA_DIR="$EXT_DIR/schemas"
export DISPLAY=:999
export NO_AT_BRIDGE=1
export EXPECTED_LAYOUT_MODE
export EXPECTED_SHELL_MAJOR
export MONITOR
export EXTENSION_UUID="$UUID"

set +e
dbus-run-session -- bash "$INNER"
status=$?
set -e

if [ "$status" -ne 0 ]; then
    echo '--- isolated Shell log ---'
    tail -120 "$SHELL_LOG" 2>/dev/null || true
    exit "$status"
fi

rm -rf "$WORK" 2>/dev/null || true
echo 'Guest probe completed'
