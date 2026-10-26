#!/usr/bin/env bash
# Run the AppGrid Fit compatibility probe inside disposable QEMU guests.
#
# Base images, one-time provisioning and the test-only SSH key are cached under
# ~/.cache/appgrid-qemu. Each run boots a fresh qcow2 overlay backed by the
# provisioned golden image and discards it afterwards, so the guest desktop and
# extension state are reset every time.
#
# Requirements (host): qemu-system-x86_64, qemu-img, ssh, scp, ssh-keygen,
# curl, python3, timeout, and cloud-localds, genisoimage, mkisofs or xorriso.
# KVM is used when available and falls back to TCG.
#
# Examples:
#   scripts/verify-qemu.sh
#   scripts/verify-qemu.sh --case ubuntu-26.04
#   scripts/verify-qemu.sh --rebuild-golden --case fedora-44
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
UUID=${EXTENSION_UUID:-appgrid-size@luyao}
MONITOR=${MONITOR:-1920x1080}
CACHE=${APPGRID_QEMU_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/appgrid-qemu}
IMAGES="$CACHE/images"
GOLDEN_DIR="$CACHE/golden"
KEYS="$CACHE/keys"
RUNS="$CACHE/runs"
LOGS="$CACHE/logs"
KEY="$KEYS/appgrid-test"
PROVISION_REV=1
QEMU_MEM=${QEMU_MEM:-4096}
QEMU_CPUS=${QEMU_CPUS:-2}
PROVISION_TIMEOUT=${PROVISION_TIMEOUT:-2400}
RUN_TIMEOUT=${RUN_TIMEOUT:-900}
KEEP_OVERLAY=${KEEP_OVERLAY:-0}
SSH_PORT=${SSH_PORT:-}

ALL_CASES=(ubuntu-24.04 ubuntu-26.04 fedora-44)
CASES=()
REBUILD_GOLDEN=0
CURRENT_QEMU_PID=
RUN_OVERLAY=

usage() {
    cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --case NAME        Run one case (repeatable). Cases: ${ALL_CASES[*]}
  --rebuild-golden   Re-provision the golden image for the selected cases
  --keep-overlay     Keep the per-run qcow2 overlay for inspection
  --list             List cases and exit
  -h, --help         Show this help

Environment:
  APPGRID_QEMU_CACHE  Cache directory (default: \${XDG_CACHE_HOME:-~/.cache}/appgrid-qemu)
  MONITOR             Virtual monitor size (default: 1920x1080)
  QEMU_MEM            Guest memory in MiB (default: 4096)
  QEMU_CPUS           Guest vCPUs (default: 2)
  KVM=0               Force TCG even when /dev/kvm is usable
  PROVISION_TIMEOUT   Golden provisioning timeout in seconds (default: 2400)
  RUN_TIMEOUT         Probe timeout in seconds (default: 900)
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --case)
            [ $# -ge 2 ] || { echo "--case needs a value" >&2; exit 2; }
            CASES+=("$2")
            shift 2
            ;;
        --rebuild-golden)
            REBUILD_GOLDEN=1
            shift
            ;;
        --keep-overlay)
            KEEP_OVERLAY=1
            shift
            ;;
        --list)
            printf '%s\n' "${ALL_CASES[@]}"
            exit 0
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            usage >&2
            exit 2
            ;;
    esac
done

if [ ${#CASES[@]} -eq 0 ]; then
    CASES=("${ALL_CASES[@]}")
fi
for candidate in "${CASES[@]}"; do
    found=0
    for known in "${ALL_CASES[@]}"; do
        [ "$candidate" = "$known" ] && found=1
    done
    [ "$found" = 1 ] || { echo "Unknown case: $candidate" >&2; exit 2; }
done

[ "$(uname -m)" = x86_64 ] || {
    echo "These images target x86_64; host is $(uname -m)" >&2
    exit 1
}

missing=()
for command in qemu-system-x86_64 qemu-img ssh scp ssh-keygen curl \
    python3 timeout tar; do
    command -v "$command" >/dev/null || missing+=("$command")
done
if command -v cloud-localds >/dev/null; then
    SEED_TOOL=cloud-localds
elif command -v genisoimage >/dev/null; then
    SEED_TOOL=genisoimage
elif command -v mkisofs >/dev/null; then
    SEED_TOOL=mkisofs
elif command -v xorriso >/dev/null; then
    SEED_TOOL=xorriso
else
    missing+=("cloud-localds/genisoimage/mkisofs/xorriso")
fi
if [ ${#missing[@]} -gt 0 ]; then
    echo "Missing host dependencies: ${missing[*]}" >&2
    cat >&2 <<'EOF'

Install hints:
  Debian/Ubuntu: sudo apt-get install qemu-system-x86 qemu-utils \
      openssh-client curl genisoimage cloud-image-utils
  Fedora/RHEL:   sudo dnf install qemu-system-x86 qemu-img \
      openssh-clients curl genisoimage cloud-utils
  Arch:          sudo pacman -S qemu-full openssh curl cdrtools cloud-image-utils
EOF
    exit 1
fi

if [ "${KVM:-1}" != 0 ] && [ -r /dev/kvm ] && [ -w /dev/kvm ]; then
    ACCEL=kvm
    CPU_MODEL=host
else
    ACCEL=tcg
    CPU_MODEL=max
fi

mkdir -p "$IMAGES" "$GOLDEN_DIR" "$KEYS" "$RUNS" "$LOGS"
chmod 700 "$CACHE" "$KEYS"
if [ ! -s "$KEY" ]; then
    ssh-keygen -q -t ed25519 -N '' -f "$KEY" -C appgrid-qemu
fi
chmod 600 "$KEY"
KEY_FP=$(ssh-keygen -lf "$KEY.pub" | awk '{print $2}')

cleanup() {
    status=$?
    if [ -n "${CURRENT_QEMU_PID:-}" ] && kill -0 "$CURRENT_QEMU_PID" 2>/dev/null; then
        kill "$CURRENT_QEMU_PID" 2>/dev/null || true
        wait "$CURRENT_QEMU_PID" 2>/dev/null || true
    fi
    if [ -n "${RUN_OVERLAY:-}" ] && [ "$KEEP_OVERLAY" != 1 ]; then
        rm -f "$RUN_OVERLAY"
    fi
    exit "$status"
}
trap cleanup EXIT INT TERM

configure_case() {
    CASE=$1
    case "$CASE" in
        ubuntu-24.04)
            FAMILY=ubuntu
            IMAGE_NAME=noble-server-cloudimg-amd64.img
            IMAGE_URL=https://mirrors.tuna.tsinghua.edu.cn/ubuntu-cloud-images/noble/current/noble-server-cloudimg-amd64.img
            EXPECTED_LAYOUT_MODE=modes
            SUDO_GROUP=sudo
            PACKAGES='gnome-shell gjs dbus dbus-user-session dconf-cli dconf-gsettings-backend libglib2.0-bin unzip python3 fonts-dejavu-core adwaita-icon-theme libgl1-mesa-dri libegl-mesa0 libgles2'
            ;;
        ubuntu-26.04)
            FAMILY=ubuntu
            IMAGE_NAME=resolute-server-cloudimg-amd64.img
            IMAGE_URL=https://mirrors.tuna.tsinghua.edu.cn/ubuntu-cloud-images/resolute/current/resolute-server-cloudimg-amd64.img
            EXPECTED_LAYOUT_MODE=adaptive
            SUDO_GROUP=sudo
            PACKAGES='gnome-shell dbus dbus-user-session dconf-cli dconf-gsettings-backend libglib2.0-bin unzip python3 fonts-dejavu-core adwaita-icon-theme libgl1-mesa-dri libegl-mesa0 libgles2'
            ;;
        fedora-44)
            FAMILY=fedora
            FEDORA_IMAGE_DIR=https://mirrors.tuna.tsinghua.edu.cn/fedora/releases/44/Cloud/x86_64/images
            IMAGE_NAME=$(fedora_image_name)
            IMAGE_URL="$FEDORA_IMAGE_DIR/$IMAGE_NAME"
            EXPECTED_LAYOUT_MODE=modes
            SUDO_GROUP=wheel
            PACKAGES='gnome-shell dbus-daemon dbus-tools dconf glib2 unzip python3 sudo adwaita-icon-theme dejavu-sans-fonts mesa-dri-drivers mesa-libEGL'
            ;;
        *)
            echo "Unknown case: $CASE" >&2
            return 1
            ;;
    esac
    BASE_IMAGE="$IMAGES/$IMAGE_NAME"
    GOLDEN="$GOLDEN_DIR/$CASE.qcow2"
    STAMP="$GOLDEN_DIR/$CASE.stamp"
}

fedora_image_name() {
    local cached name
    cached=$(ls -1 "$IMAGES"/Fedora-Cloud-Base-Generic-44-*.x86_64.qcow2 \
        2>/dev/null | sort -V | tail -1 || true)
    if [ -n "$cached" ]; then
        basename "$cached"
        return
    fi
    name=$(curl -fsSL --max-time 30 "$FEDORA_IMAGE_DIR" 2>/dev/null |
        grep -oE 'Fedora-Cloud-Base-Generic-44-[^"<]*x86_64\.qcow2' |
        sort -uV | tail -1 || true)
    printf '%s\n' "${name:-Fedora-Cloud-Base-Generic-44-1.7.x86_64.qcow2}"
}

download_base() {
    [ -s "$BASE_IMAGE" ] && return 0
    echo "Downloading $IMAGE_URL"
    if ! curl -fL --retry 3 --retry-delay 2 --continue-at - \
        -o "$BASE_IMAGE.part" "$IMAGE_URL"; then
        echo "Download failed: $IMAGE_URL" >&2
        return 1
    fi
    mv "$BASE_IMAGE.part" "$BASE_IMAGE"
}

check_base_format() {
    local format
    format=$(qemu-img info --output=json "$BASE_IMAGE" |
        python3 -c 'import json,sys; print(json.load(sys.stdin).get("format", ""))')
    if [ "$format" != qcow2 ]; then
        echo "$BASE_IMAGE is $format, expected qcow2" >&2
        return 1
    fi
}

pick_port() {
    if [ -n "$SSH_PORT" ]; then
        echo "$SSH_PORT"
        return 0
    fi
    python3 - <<'PY'
import socket
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    print(sock.getsockname()[1])
PY
}

ssh_opts() {
    local port=$1
    printf '%s\n' \
        -i "$KEY" -p "$port" \
        -o BatchMode=yes \
        -o ConnectTimeout=5 \
        -o StrictHostKeyChecking=no \
        -o UserKnownHostsFile=/dev/null \
        -o LogLevel=ERROR
}

remote() {
    local port=$1
    shift
    local opts=()
    mapfile -t opts < <(ssh_opts "$port")
    ssh "${opts[@]}" tester@127.0.0.1 "$@"
}

start_qemu() {
    local overlay=$1 seed=$2 serial=$3 port=$4
    local args=(
        -machine "q35,accel=$ACCEL"
        -cpu "$CPU_MODEL"
        -smp "$QEMU_CPUS"
        -m "$QEMU_MEM"
        -drive "file=$overlay,if=virtio,format=qcow2,discard=unmap"
        -netdev "user,id=net0,hostfwd=tcp:127.0.0.1:$port-:22"
        -device virtio-net-pci,netdev=net0
        -display none
        -monitor none
        -serial "file:$serial"
        -no-reboot
    )
    if [ -n "$seed" ]; then
        args+=(-drive "file=$seed,format=raw,media=cdrom,readonly=on")
    fi
    qemu-system-x86_64 "${args[@]}" &
    CURRENT_QEMU_PID=$!
}

qemu_alive() {
    [ -n "${CURRENT_QEMU_PID:-}" ] || return 1
    kill -0 "$CURRENT_QEMU_PID" 2>/dev/null || return 1
    local state
    state=$(awk '{print $3}' "/proc/$CURRENT_QEMU_PID/stat" 2>/dev/null) ||
        return 1
    [ "$state" != Z ]
}

wait_for_ssh() {
    local port=$1 timeout=$2
    local deadline=$((SECONDS + timeout))
    while [ "$SECONDS" -lt "$deadline" ]; do
        if remote "$port" true 2>/dev/null; then
            return 0
        fi
        qemu_alive || return 1
        sleep 2
    done
    return 1
}

wait_for_exit() {
    local timeout=$1
    local deadline=$((SECONDS + timeout))
    while qemu_alive; do
        [ "$SECONDS" -lt "$deadline" ] || return 1
        sleep 2
    done
    wait "$CURRENT_QEMU_PID" 2>/dev/null || true
    CURRENT_QEMU_PID=
    return 0
}

stop_vm() {
    local port=$1
    if qemu_alive; then
        remote "$port" 'sudo -n poweroff' >/dev/null 2>&1 || true
        wait_for_exit 90 || {
            kill "$CURRENT_QEMU_PID" 2>/dev/null || true
            wait "$CURRENT_QEMU_PID" 2>/dev/null || true
            CURRENT_QEMU_PID=
        }
    elif [ -n "${CURRENT_QEMU_PID:-}" ]; then
        wait "$CURRENT_QEMU_PID" 2>/dev/null || true
        CURRENT_QEMU_PID=
    fi
}

make_seed() {
    local iso=$1 user_data=$2 meta_data=$3
    case "$SEED_TOOL" in
        cloud-localds)
            cloud-localds "$iso" "$user_data" "$meta_data"
            ;;
        genisoimage)
            genisoimage -quiet -output "$iso" -volid cidata -joliet -rock \
                "$user_data" "$meta_data"
            ;;
        mkisofs)
            mkisofs -quiet -output "$iso" -volid cidata -joliet -rock \
                "$user_data" "$meta_data"
            ;;
        xorriso)
            xorriso -as mkisofs -quiet -output "$iso" -volid cidata \
                -joliet -rock "$user_data" "$meta_data"
            ;;
    esac
}

provision_script() {
    cat <<'EOF'
#!/bin/bash
set -e
mkdir -p /usr/share/applications
for i in $(seq -w 1 48); do
    printf '%s\n' \
        '[Desktop Entry]' \
        'Type=Application' \
        "Name=AppGrid Test $i" \
        'Comment=AppGrid Fit probe item' \
        'Exec=/bin/true' \
        'Icon=application-x-executable' \
        'Terminal=false' \
        'Categories=Utility;' \
        'StartupNotify=false' \
        > "/usr/share/applications/appgrid-test-$i.desktop"
done
EOF
}

finalize_script() {
    cat <<'EOF'
#!/bin/bash
set -e
for command in gnome-shell dbus-run-session glib-compile-schemas \
    gsettings gdbus dconf gnome-extensions unzip python3; do
    command -v "$command" >/dev/null
done
test -f /usr/share/applications/appgrid-test-48.desktop
if [ -d /etc/apt/sources.list.d ]; then
    sources=$(grep -hE '^(deb |URIs:)' \
        /etc/apt/sources.list /etc/apt/sources.list.d/*.list \
        /etc/apt/sources.list.d/*.sources 2>/dev/null || true)
    if [ -z "$sources" ]; then
        echo 'No active APT sources found' >&2
        exit 1
    fi
    if printf '%s\n' "$sources" | grep -vq 'mirrors.tuna.tsinghua.edu.cn'; then
        echo 'APT sources are not all using the Tsinghua mirror:' >&2
        printf '%s\n' "$sources" | grep -v 'mirrors.tuna.tsinghua.edu.cn' >&2
        exit 1
    fi
fi
if [ -d /etc/yum.repos.d ]; then
    for repo in fedora fedora-updates fedora-updates-testing; do
        file="/etc/yum.repos.d/$repo.repo"
        if [ ! -f "$file" ]; then
            echo "Missing Fedora repository file: $file" >&2
            exit 1
        fi
        if grep -q '^metalink=' "$file"; then
            echo "Active metalink in $file; the Tsinghua mirror is not pinned" >&2
            exit 1
        fi
        if ! grep -q '^baseurl=https://mirrors.tuna.tsinghua.edu.cn/fedora' "$file"; then
            echo "$file does not use the Tsinghua mirror" >&2
            exit 1
        fi
    done
fi
systemctl disable cloud-init.service cloud-config.service cloud-final.service cloud-init-local.service || true
{
    date -u
    gnome-shell --version
} > /var/lib/appgrid-provisioned
EOF
}

write_user_data() {
    local file=$1
    local packages
    packages=$(for package in $PACKAGES; do printf '  - %s\n' "$package"; done)
    local apt_section=
    local bootcmd_section=
    if [ "$FAMILY" = ubuntu ]; then
        apt_section=$(cat <<'EOF'
apt:
  primary:
    - arches: [default]
      uri: https://mirrors.tuna.tsinghua.edu.cn/ubuntu
  security:
    - arches: [default]
      uri: https://mirrors.tuna.tsinghua.edu.cn/ubuntu
EOF
)
    else
        bootcmd_section=$(cat <<'EOF'
bootcmd:
  - sh -c 'sed -i -e "s|^metalink=|#metalink=|" -e "s|^#baseurl=http://download.example/pub/fedora/linux|baseurl=https://mirrors.tuna.tsinghua.edu.cn/fedora|" /etc/yum.repos.d/fedora.repo /etc/yum.repos.d/fedora-updates.repo /etc/yum.repos.d/fedora-updates-testing.repo || true; sed -i "s/^enabled=1/enabled=0/" /etc/yum.repos.d/fedora-cisco-openh264.repo 2>/dev/null || true'
EOF
)
    fi
    cat > "$file" <<EOF
#cloud-config
hostname: appgrid-golden
manage_etc_hosts: true
ssh_pwauth: false
users:
  - name: tester
    gecos: AppGrid Test
    groups: [adm, $SUDO_GROUP]
    shell: /bin/bash
    sudo: "ALL=(ALL) NOPASSWD:ALL"
    lock_passwd: true
    ssh_authorized_keys:
      - $(cat "$KEY.pub")
$apt_section
$bootcmd_section
package_update: true
packages:
$packages
write_files:
  - path: /usr/local/sbin/appgrid-write-test-apps
    permissions: '0755'
    content: |
$(provision_script | sed 's/^/      /')
  - path: /usr/local/sbin/appgrid-finalize
    permissions: '0755'
    content: |
$(finalize_script | sed 's/^/      /')
runcmd:
  - [bash, /usr/local/sbin/appgrid-write-test-apps]
  - [bash, /usr/local/sbin/appgrid-finalize]
EOF
}

write_meta_data() {
    cat > "$1" <<EOF
instance-id: $CASE-golden-v$PROVISION_REV
local-hostname: appgrid-golden
EOF
}

provision_sha() {
    local user_data=$1
    python3 - "$user_data" "$PROVISION_REV" <<'PY'
import hashlib
import sys
from pathlib import Path
value = hashlib.sha256(Path(sys.argv[1]).read_bytes())
value.update(sys.argv[2].encode())
print(value.hexdigest())
PY
}

golden_is_current() {
    local expected=$1
    [ -s "$GOLDEN" ] && [ -s "$STAMP" ] || return 1
    python3 - "$STAMP" "$CASE" "$expected" "$KEY_FP" "$BASE_IMAGE" <<'PY'
import json
import os
import sys
from pathlib import Path
stamp, case, provision, key_fp, base = sys.argv[1:]
try:
    data = json.loads(Path(stamp).read_text())
    info = os.stat(base)
except (OSError, ValueError):
    sys.exit(1)
ok = (
    data.get('case') == case and
    data.get('provision_sha') == provision and
    data.get('key_fingerprint') == key_fp and
    data.get('base_size') == info.st_size and
    data.get('base_mtime') == int(info.st_mtime)
)
sys.exit(0 if ok else 1)
PY
}

write_stamp() {
    local provision=$1
    python3 - "$STAMP" "$CASE" "$provision" "$KEY_FP" "$BASE_IMAGE" <<'PY'
import datetime
import json
import os
import sys
from pathlib import Path
stamp, case, provision, key_fp, base = sys.argv[1:]
info = os.stat(base)
Path(stamp).write_text(json.dumps({
    'case': case,
    'provision_sha': provision,
    'key_fingerprint': key_fp,
    'base_size': info.st_size,
    'base_mtime': int(info.st_mtime),
    'created': datetime.datetime.now(datetime.timezone.utc).isoformat(),
}, indent=2) + '\n')
PY
}

build_golden() {
    local provision=$1
    local work="$GOLDEN_DIR/work-$CASE"
    local port serial overlay seed
    rm -rf "$work"
    mkdir -p "$work"
    serial="$work/serial.log"
    overlay="$work/build.qcow2"
    seed="$work/seed.iso"

    write_user_data "$work/user-data"
    write_meta_data "$work/meta-data"
    make_seed "$seed" "$work/user-data" "$work/meta-data" || {
        echo "Could not create cloud-init seed" >&2
        return 1
    }
    qemu-img create -f qcow2 -F qcow2 -b "$BASE_IMAGE" "$overlay" 20G \
        >/dev/null || return 1
    port=$(pick_port)
    echo "Provisioning $CASE (SSH port $port); logs: $work"
    start_qemu "$overlay" "$seed" "$serial" "$port"

    if ! wait_for_ssh "$port" 600; then
        echo "Guest did not accept SSH during provisioning" >&2
        tail -80 "$serial" 2>/dev/null || true
        stop_vm "$port"
        return 1
    fi

    local deadline=$((SECONDS + PROVISION_TIMEOUT))
    local provisioned=0
    while [ "$SECONDS" -lt "$deadline" ]; do
        if remote "$port" 'test -f /var/lib/appgrid-provisioned'; then
            provisioned=1
            break
        fi
        qemu_alive || break
        sleep 5
    done
    if [ "$provisioned" != 1 ]; then
        echo "Provisioning did not finish within ${PROVISION_TIMEOUT}s" >&2
        remote "$port" 'cloud-init status --long' 2>&1 || true
        remote "$port" 'tail -60 /var/log/cloud-init-output.log' 2>&1 || true
        tail -80 "$serial" 2>/dev/null || true
        stop_vm "$port"
        echo "Provisioning artifacts kept in $work" >&2
        return 1
    fi

    remote "$port" 'sudo -n true' || {
        echo "tester lacks passwordless sudo in the guest" >&2
        stop_vm "$port"
        return 1
    }
    # The guest stays up until the host sees the completion marker, so the
    # marker cannot disappear behind a 5-second poll before poweroff.
    remote "$port" 'sudo -n poweroff' >/dev/null 2>&1 || true
    if ! wait_for_exit 180; then
        echo "Guest did not power off after provisioning" >&2
        stop_vm "$port"
        tail -80 "$serial" 2>/dev/null || true
        echo "Provisioning artifacts kept in $work" >&2
        return 1
    fi

    qemu-img convert -O qcow2 -c "$overlay" "$GOLDEN.tmp" || {
        echo "Could not convert the provisioned image" >&2
        return 1
    }
    mv "$GOLDEN.tmp" "$GOLDEN" || return 1
    chmod 444 "$GOLDEN"
    write_stamp "$provision" || return 1
    rm -rf "$work"
    echo "Golden image ready: $GOLDEN"
}

build_extension_zip() {
    local output=$1
    python3 - "$ROOT" "$output" <<'PY'
import sys
import zipfile
from pathlib import Path
root, output = map(Path, sys.argv[1:])
required = ['metadata.json', 'extension.js', 'prefs.js', 'config.js',
            'gridPages.js', 'gridLayout.js', 'LICENSE']
schema = root / 'schemas/org.gnome.shell.extensions.appgrid-size.gschema.xml'
missing = [name for name in required if not (root / name).is_file()]
if not schema.is_file():
    missing.append(str(schema))
if missing:
    raise SystemExit(f'missing packaging input: {missing}')
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in required:
        archive.write(root / name, name)
    archive.write(schema, f'schemas/{schema.name}')
    compiled = root / 'schemas/gschemas.compiled'
    if compiled.is_file():
        archive.write(compiled, 'schemas/gschemas.compiled')
PY
}

run_case() {
    local case_name=$1
    configure_case "$case_name" || return 1
    download_base || return 1
    check_base_format || return 1

    local work="$GOLDEN_DIR/work-$case_name"
    local provision
    mkdir -p "$work"
    write_user_data "$work/user-data" || return 1
    provision=$(provision_sha "$work/user-data") || return 1
    rm -f "$work/user-data" "$work/meta-data"

    if [ "$REBUILD_GOLDEN" = 1 ]; then
        rm -f "$GOLDEN" "$STAMP"
        rm -rf "$GOLDEN_DIR/work-$case_name"
    fi
    if ! golden_is_current "$provision"; then
        build_golden "$provision" || return 1
    fi

    local run_id run_dir zip remote_zip port
    run_id="$(date +%Y%m%d-%H%M%S)-$case_name"
    run_dir="$LOGS/$run_id"
    mkdir -p "$run_dir"
    zip="$run_dir/$UUID.shell-extension.zip"
    remote_zip="/tmp/appgrid-probe/$UUID.shell-extension.zip"
    build_extension_zip "$zip" || return 1

    RUN_OVERLAY="$RUNS/$run_id.qcow2"
    qemu-img create -f qcow2 -F qcow2 -b "$GOLDEN" "$RUN_OVERLAY" >/dev/null || {
        RUN_OVERLAY=
        return 1
    }
    port=$(pick_port)
    echo "== Running $case_name (layout=$EXPECTED_LAYOUT_MODE, monitor=$MONITOR, port=$port) =="
    start_qemu "$RUN_OVERLAY" '' "$run_dir/serial.log" "$port"

    if ! wait_for_ssh "$port" 300; then
        echo "Guest did not accept SSH" >&2
        tail -80 "$run_dir/serial.log" 2>/dev/null || true
        stop_vm "$port"
        return 1
    fi

    remote "$port" 'rm -rf /tmp/appgrid-probe && mkdir -p /tmp/appgrid-probe' ||
        { stop_vm "$port"; return 1; }
    local scp_opts=()
    mapfile -t scp_opts < <(
        printf '%s\n' -q -i "$KEY" -P "$port" \
            -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
            -o LogLevel=ERROR
    )
    scp "${scp_opts[@]}" "$zip" "$ROOT/scripts/vm-probe.py" \
        "$ROOT/scripts/qemu-guest-probe.sh" \
        "tester@127.0.0.1:/tmp/appgrid-probe/" || {
        echo "Could not copy probe files into the guest" >&2
        stop_vm "$port"
        return 1
    }

    local status ssh_args=()
    mapfile -t ssh_args < <(ssh_opts "$port")
    set +e
    timeout "$RUN_TIMEOUT" ssh "${ssh_args[@]}" tester@127.0.0.1 \
        "cd /tmp/appgrid-probe && EXPECTED_LAYOUT_MODE='$EXPECTED_LAYOUT_MODE' MONITOR='$MONITOR' EXTENSION_UUID='$UUID' bash qemu-guest-probe.sh '$remote_zip' vm-probe.py" \
        2>&1 | tee "$run_dir/probe.log"
    status=${PIPESTATUS[0]}
    set -e

    if [ "$status" -ne 0 ]; then
        scp -q -r -i "$KEY" -P "$port" \
            -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
            -o LogLevel=ERROR \
            "tester@127.0.0.1:/tmp/appgrid-qemu-probe" "$run_dir/guest" \
            2>/dev/null || true
        echo "$case_name failed (status $status); logs: $run_dir" >&2
    fi

    stop_vm "$port"
    if [ "$KEEP_OVERLAY" = 1 ]; then
        echo "Overlay kept: $RUN_OVERLAY"
    else
        rm -f "$RUN_OVERLAY"
    fi
    RUN_OVERLAY=
    return "$status"
}

FAILED=()
PASSED=()
cleanup_case_artifacts() {
    if qemu_alive; then
        kill "$CURRENT_QEMU_PID" 2>/dev/null || true
        wait "$CURRENT_QEMU_PID" 2>/dev/null || true
        CURRENT_QEMU_PID=
    fi
    if [ -n "${RUN_OVERLAY:-}" ] && [ "$KEEP_OVERLAY" != 1 ]; then
        rm -f "$RUN_OVERLAY"
    fi
    RUN_OVERLAY=
}
for case_name in "${CASES[@]}"; do
    if run_case "$case_name"; then
        PASSED+=("$case_name")
    else
        cleanup_case_artifacts
        FAILED+=("$case_name")
    fi
done

echo
echo "== QEMU verification summary =="
if [ ${#PASSED[@]} -gt 0 ]; then
    echo "PASS: ${PASSED[*]}"
fi
if [ ${#FAILED[@]} -gt 0 ]; then
    echo "FAIL: ${FAILED[*]}"
    exit 1
fi
echo "All QEMU cases passed"
