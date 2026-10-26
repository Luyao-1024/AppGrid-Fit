#!/usr/bin/env bash
# Rebuild AppGrid Fit, install it into the Ubuntu GNOME VM, restart the
# graphical session, and run the compatibility probe.
#
# The VM must provide:
#   - SSH access with VM_SSH_KEY (default ~/.ssh/id_ed25519)
#   - passwordless sudo for VM_USER (used to restart gdm)
#   - GDM automatic login for VM_USER, or an already-running desktop session
#   - VirtualBox installed on the host and the VM registered under VM_NAME
#
# Example:
#   VM_NAME='Ubuntu 26.04.1' scripts/verify-ubuntu-vm.sh
#
# Set SKIP_RESTART=1 to test the already-installed files after a manual
# session restart. Set SCREENSHOT_DIR='' to skip screenshots.
set -euo pipefail

VM_NAME=${VM_NAME:-'Ubuntu 26.04.1'}
VM_HOST=${VM_HOST:-127.0.0.1}
VM_PORT=${VM_PORT:-2222}
VM_USER=${VM_USER:-luyao}
VM_SSH_KEY=${VM_SSH_KEY:-$HOME/.ssh/id_ed25519}
EXTENSION_UUID=${EXTENSION_UUID:-appgrid-size@luyao}
SKIP_RESTART=${SKIP_RESTART:-0}
SCREENSHOT_DIR=${SCREENSHOT_DIR:-/tmp/appgrid-vm}

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
WORK=$(mktemp -d)
REMOTE_ZIP=/tmp/appgrid-verify.zip
REMOTE_PROBE=/tmp/appgrid-probe.py
VERSION=$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "$ROOT/package.json" | head -1)

cleanup() {
    rm -rf "$WORK"
}
trap cleanup EXIT

for command in ssh scp gnome-extensions glib-compile-schemas VBoxManage; do
    command -v "$command" >/dev/null || {
        echo "Missing required command: $command"
        exit 1
    }
done

if [ ! -f "$VM_SSH_KEY" ]; then
    echo "SSH key not found: $VM_SSH_KEY"
    exit 1
fi

SSH=(ssh -i "$VM_SSH_KEY" -p "$VM_PORT" -o BatchMode=yes
    -o ConnectTimeout=8 -o StrictHostKeyChecking=no
    "$VM_USER@$VM_HOST")
SCP=(scp -q -i "$VM_SSH_KEY" -P "$VM_PORT"
    -o StrictHostKeyChecking=no)

remote() {
    "${SSH[@]}" "$@"
}

vm_key() {
    VBoxManage controlvm "$VM_NAME" keyboardputscancode "$@" >/dev/null
}

vm_type() {
    VBoxManage controlvm "$VM_NAME" keyboardputstring "$1" >/dev/null
}

eval_remote() {
    printf '%s' "$1" | remote 'cat > /tmp/appgrid-expr.js'
    remote /tmp/appgrid-eval.sh
}

wait_for_active() {
    local deadline=$((SECONDS + 90))
    while [ "$SECONDS" -lt "$deadline" ]; do
        if remote "export DBUS_SESSION_BUS_ADDRESS=$DBUS_ADDRESS; gnome-extensions info '$EXTENSION_UUID' 2>/dev/null" |
            grep -q 'ACTIVE'; then
            return 0
        fi
        sleep 2
    done
    return 1
}

enable_unsafe_mode() {
    if eval_remote '1 + 1' 2>/dev/null | grep -q '^(true'; then
        return 0
    fi

    remote 'sudo -n loginctl unlock-sessions || true'
    sleep 1
    # Close any overview or preferences window before opening the run dialog.
    vm_key 01 81
    sleep 1
    vm_key 38
    sleep 0.2
    vm_key 3c 3c
    sleep 0.2
    vm_key bc
    sleep 0.2
    vm_key b8
    sleep 2
    vm_type 'lg'
    vm_key 1c 9c
    sleep 3
    vm_type 'global.context.unsafe_mode = true'
    vm_key 1c 9c
    sleep 2
    eval_remote 'Main.lookingGlass.close()' >/dev/null 2>&1 || true

    if ! eval_remote '1 + 1' 2>/dev/null | grep -q '^(true'; then
        echo 'Could not enable Looking Glass unsafe mode.'
        echo 'Make sure the VM desktop is unlocked and automatic login is configured.'
        exit 1
    fi
}

if ! VBoxManage list runningvms | grep -q "\"$VM_NAME\""; then
    echo "Starting VM $VM_NAME"
    VBoxManage startvm "$VM_NAME" --type headless >/dev/null
fi

if ! remote true; then
    echo "Waiting for SSH on $VM_USER@$VM_HOST:$VM_PORT"
    for _ in $(seq 1 60); do
        remote true 2>/dev/null && break
        sleep 2
    done
fi
if ! remote true; then
    echo "Cannot SSH to $VM_USER@$VM_HOST:$VM_PORT with $VM_SSH_KEY"
    exit 1
fi
if ! remote 'sudo -n true'; then
    echo 'The VM user needs passwordless sudo to restart gdm'
    exit 1
fi

REMOTE_UID=$(remote id -u)
DBUS_ADDRESS="unix:path=/run/user/$REMOTE_UID/bus"

remote 'cat > /tmp/appgrid-eval.sh' <<REMOTE
#!/bin/bash
export DBUS_SESSION_BUS_ADDRESS=$DBUS_ADDRESS
exec gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
    --method org.gnome.Shell.Eval "\$(cat /tmp/appgrid-expr.js)"
REMOTE
remote 'chmod +x /tmp/appgrid-eval.sh'

echo "== Build $VERSION =="
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

echo '== Install into VM =='
"${SCP[@]}" "$WORK/$EXTENSION_UUID.shell-extension.zip" \
    "$VM_USER@$VM_HOST:$REMOTE_ZIP"
"${SCP[@]}" "$ROOT/scripts/vm-probe.py" "$VM_USER@$VM_HOST:$REMOTE_PROBE"
remote "gnome-extensions install --force '$REMOTE_ZIP'"

if [ "$SKIP_RESTART" != 1 ]; then
    echo '== Restart graphical session =='
    remote 'sudo -n systemctl restart gdm'
    if ! wait_for_active; then
        echo 'Extension did not become ACTIVE after the session restart'
        exit 1
    fi
    installed_version=$(remote "export DBUS_SESSION_BUS_ADDRESS=$DBUS_ADDRESS; \
        gnome-extensions info '$EXTENSION_UUID'" |
        sed -n 's/^  Version: //p' | head -1)
    case "$installed_version" in
        "$VERSION ("*) ;;
        *)
            echo "VM reports version '$installed_version', expected $VERSION"
            exit 1
            ;;
    esac
fi

enable_unsafe_mode

echo '== Run Ubuntu compatibility probe =='
probe_status=0
remote "export GSETTINGS_SCHEMA_DIR=\$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID/schemas; \
    export DBUS_SESSION_BUS_ADDRESS=$DBUS_ADDRESS; \
    python3 '$REMOTE_PROBE'" || probe_status=$?

if [ -n "$SCREENSHOT_DIR" ]; then
    mkdir -p "$SCREENSHOT_DIR"
    echo "== Screenshots: $SCREENSHOT_DIR =="
    eval_remote 'Main.overview.showApps()' >/dev/null 2>&1 || true
    sleep 3
    VBoxManage controlvm "$VM_NAME" screenshotpng \
        "$SCREENSHOT_DIR/app-grid.png" >/dev/null
    remote "export DBUS_SESSION_BUS_ADDRESS=$DBUS_ADDRESS DISPLAY=:0; \
        nohup gnome-extensions prefs '$EXTENSION_UUID' >/tmp/appgrid-prefs.log 2>&1 &" || true
    sleep 4
    eval_remote 'Main.overview.hide()' >/dev/null 2>&1 || true
    sleep 2
    VBoxManage controlvm "$VM_NAME" screenshotpng \
        "$SCREENSHOT_DIR/prefs.png" >/dev/null
    vm_key 01 81
    sleep 1
fi

eval_remote 'global.context.unsafe_mode = false' >/dev/null 2>&1 || true

if [ "$probe_status" -ne 0 ]; then
    echo "Ubuntu VM probe failed with status $probe_status"
    exit "$probe_status"
fi

echo 'Ubuntu VM verification completed'
