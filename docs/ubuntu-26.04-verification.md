# Ubuntu 26.04 App Grid compatibility verification

Verified on 2026-10-26 for AppGrid Fit 1.3.4.

## Environment

- Ubuntu 26.04.1 LTS, GNOME Shell `50.1-0ubuntu1.2`, Wayland session.
- VirtualBox 7.2.22, VMSVGA, 3D acceleration disabled.
- Guest: 4 vCPUs, 6144 MiB RAM, 1280×800 display, 100% scaling.
- Build: this repository at version 1.3.4 (metadata version 12).
- Baseline layout: three pages with 13 apps, page consolidation disabled.

## Automated harness

`scripts/verify-ubuntu-vm.sh` performs the whole verification cycle:

1. Compiles schemas, builds the extension ZIP, and copies it plus the probe to the VM.
2. Installs the package with `gnome-extensions install --force`.
3. Restarts GDM and waits for the extension to report `State: ACTIVE`.
4. Enables Looking Glass unsafe mode so the probe can call `org.gnome.Shell.Eval`.
5. Runs `scripts/vm-probe.py`, restores the previous extension settings and app-picker
   layout, and captures overview and preferences screenshots.

The VM needs SSH key access, passwordless sudo for GDM restarts, GDM automatic login for the
test user, and VirtualBox on the host. Defaults target `Ubuntu 26.04.1` at
`127.0.0.1:2222`; override them with `VM_NAME`, `VM_HOST`, `VM_PORT`, `VM_USER`, and
`VM_SSH_KEY`.

```bash
scripts/verify-ubuntu-vm.sh
SKIP_RESTART=1 scripts/verify-ubuntu-vm.sh   # test already-installed files
SCREENSHOT_DIR='' scripts/verify-ubuntu-vm.sh # skip screenshots
```

The probe backs up `dconf` settings for `org.gnome.shell.extensions.appgrid-size` and
`org.gnome.shell app-picker-layout`, then restores them in a `finally` block. It also
disables the temporary theme stylesheet, turns unsafe mode off, and re-enables the extension.

## Live guest results

64 checks passed on repeated end-to-end runs, including a fresh package build plus GDM
restart and subsequent `SKIP_RESTART=1` runs against the installed package. The extension
publishes its settled preview snapshot 600 ms after the overview's `shown` signal, so
page-indicator animation frames no longer leak transient coordinates into the preview. The
probe also requires that settled snapshot to have the page indicator centered under the grid
before any assertion runs. One earlier run hit a Shell apply stall longer than the probe's
original 10-second wait during the consolidation step; the wait is now 20 seconds and timeout
errors include the last snapshot, extension state, and overview visibility.

## Acceptance contract

Acceptance is the probe's exit status: any failed assertion makes the harness exit non-zero.
Screenshots are diagnostic artifacts, not an acceptance gate, and do not need review on
subsequent runs. Review the overview/preferences screenshots once when adding or changing a
visual test case; after that, the geometry assertions below catch layout regressions without
human inspection.

| Area | Verified behavior |
| --- | --- |
| Capability detection | Ubuntu's adaptive layout is recognized without `setGridModes`/`_gridModes`; `_fixedRows` and `_fixedCols` are present |
| Live preview snapshot | Settled snapshot published; measured page indicator rectangle is non-empty |
| Preview geometry | Page indicator centered under the measured grid and below it; current-page item list matches `itemCount` |
| Dock geometry | Ubuntu's dock is vertical and left-anchored, spans the grid height, contains its items, and lists them top-to-bottom |
| Presets 0–3 | Requested icon size, exact gaps, fixed rows/columns, and page capacity |
| Custom grid | 64 px icons, 3×5 rows/columns, 8 px row gap, 16 px column gap |
| Reflow | Shrinking to 2×3 and growing back to 3×5 preserves flattened app order and respects capacity |
| Disable | Restores `fixed_icon_size=-1`, removes fixed dimensions, resets alignment to FILL, and restores native spacing/dimensions |
| Re-enable | Live properties return to 64 px, 3×5, gaps 8/16 |
| Theme CSS | Loaded `row-spacing: 50px`, `column-spacing: 60px`, limits 70/80; extension keeps configured gaps |
| Themed disable | Restores adaptive spacing at half the effective icon size and CSS limits 70/80 |
| Theme unload | Default CSS limits are restored after disabling |
| Consolidation | Enabling consolidation with 2×3 capacity fills pages to `[6, 6, 1]` without changing flattened order |
| Saved order | Restoring `app-picker-layout` rebuilds `[6, 5, 2]` in the original order |

Screenshots from the harness are stored in `/tmp/appgrid-vm/` by default
(`app-grid.png`, `prefs.png`). The final overview shows Ubuntu's left dock, centered page
dots, and the restored three-page order; the preferences preview shows the same measured
page-indicator and dock positions instead of a horizontal fallback Dash.

## Fedora headless verification

`scripts/verify-fedora-headless.sh` runs the same probe against upstream GNOME Shell without
touching the live desktop session:

1. Builds the extension ZIP and unpacks it into a temporary `XDG_DATA_HOME`.
2. Compiles the installed schema and installs a helper extension that enables Looking Glass
   unsafe mode after AppGrid Fit is enabled.
3. Starts `gnome-shell --headless --wayland` under `dbus-run-session` with isolated `HOME` and
   XDG directories, then runs `scripts/vm-probe.py` with `EXPECTED_LAYOUT_MODE=modes` and
   `FORCE_APP_GRID=1`.
4. Compares live-session `org.gnome.shell enabled-extensions` and `app-picker-layout` before
   and after the run, restoring them and failing if the isolated session leaked into them.

63 checks pass on Fedora 44 with GNOME Shell 50.6. Headless Shell does not advance the overview
animation, so the probe forces the app-grid adjustment after `showApps()`. The shrink-reflow
test covers the order-preserving page rebuild and in-memory `PageManager` sync; without them,
Shell inserts overflow at the start of the next page and a later redisplay scrambles app order.

## Known coverage limits

- Ubuntu (adaptive `IconGridLayout`) and upstream Fedora (mode-based layout) are covered by the
  live probes. Other distributions still need a smoke test because private Shell members vary.
- Theme verification loads a small custom stylesheet through `St.Theme`. Switching the whole
  system theme through GNOME Settings is still a manual check.
- Mouse-drag ordering is not synthesized. Saved-order restoration is verified through Shell's
  `_savePages()` output and `app-picker-layout`, not by generating drag gestures.

## Historical issue #2 reproduction (1.3.1)

Installed the unmodified 1.3.1 repository package in the same guest with custom settings:
96 px icons, 4 rows, 6 columns. The extension reported `ACTIVE`, but the Shell kept its
64 px icons and 3×6 automatic grid. Opening the App Grid logged:

```text
[appgrid-size] compatible AppGrid not found
```

Runtime inspection found the grid and layout manager, but both `setGridModes` and
`_gridModes` were undefined. Ubuntu's Shell implements adaptive dimensions in
`IconGridLayout.adaptToSize()`, with `_fixedRows` and `_fixedCols` selecting fixed sizes.
The 1.3.2 fix detects the available API, pins both private dimensions and public row/column
properties, and restores the original mode array or fixed-property presence/values on disable.

## Automated checks

- `npm run check`: source syntax/policy validation and 38 unit tests.
- Strict schema validation and compiled-schema reproducibility.
- Package validation with `npm run check:package -- <archive>`.
- Shexli was previously run clean on 0.2.1/tree-sitter 0.25.2; CI continues to run it on the
  packaged artifact.
