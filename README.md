# AppGrid Fit

A GNOME Shell extension (46–50) that lets you customize the App Grid layout — icon size, rows/columns per page, and spacing — so you can fit more apps on each page.

Current version: **1.3.4**

## Features

- **4 preset levels**: Large (96px), Medium (64px), Small (48px), Tiny (32px)
- **Balanced fit**: Presets calculate rows/columns from your screen and Shell's full app-tile size while using 80% of the available width for a centered layout
- **Custom mode**: Fine-tune icon size, rows, columns, row/column spacing independently
- **Optional page consolidation**: Fills pages to capacity and saves the resulting app order only when explicitly enabled
- **Persistent app order**: Keeps drag-and-drop positions stable across login even when a page contains more than Shell's default 24 apps
- **Order-preserving reflow**: Shrinking the grid rebuilds overflow pages in their original order instead of letting Shell move items to the front of the next page
- **Responsive layout**: Recalculates preset capacity when the overview allocation or monitor configuration changes
- **Live settings**: Preference changes apply immediately after the extension has been loaded
- **Theme-aware restoration**: Spacing and CSS limits are re-read after theme changes and restored exactly when the extension is disabled
- **Ubuntu-aware preview**: Uses the measured page indicators and dock position on Ubuntu's adaptive layout instead of assuming a centered horizontal Dash
- **Small-screen friendly preferences**: Controls scroll when needed, the window sizes to the monitor, and a Fit button suggests the largest grid that fits

## Screenshots

**App Grid — Large Icons**

![Large Icons](images/large_icon.png)

**App Grid — Medium**

![Medium](images/medium.png)

**Preferences — Preset Mode**

![Preset mode with a live App Grid preview](images/preset-mode-preview.png)

**Preferences — Custom Mode**

![Custom mode with independent grid controls and a live preview](images/custom-mode-preview.png)

## Presets

Presets use balanced fitting — the rows/columns below are base recommendations, while the actual grid is calculated from the current allocation at runtime. Balanced fitting uses 80% of the available icon-area width, leaving roughly 10% breathing room on each side without wasting a large central workspace.

| Level | Icon Size | Base Grid | Gap |
|-------|-----------|-----------|-----|
| Large | 96 px | 4×6 | 24 px |
| Medium | 64 px | 6×9 | 18 px |
| Small | 48 px | 8×12 | 14 px |
| Tiny | 32 px | 12×16 | 10 px |

## Installation

```bash
# Compile schema
glib-compile-schemas schemas/

# Package
gnome-extensions pack --force \
  --extra-source=config.js \
  --extra-source=gridPages.js \
  --extra-source=gridLayout.js \
  --extra-source=LICENSE \
  "$(pwd)"

# Install
gnome-extensions install --force appgrid-size@luyao.shell-extension.zip

# Reload GNOME Shell (required for first install or schema changes)
# Xorg: press Alt+F2, type "r", press Enter
# Wayland: log out and log back in

# Enable
gnome-extensions enable appgrid-size@luyao
```

## Usage

Open the extension preferences via:

- **Extensions** app → AppGrid Fit → Settings
- Or run: `gnome-extensions prefs appgrid-size@luyao`

Switch between presets or disable **Use preset sizes** for granular control. Custom values are independent: changing the icon size does not overwrite the configured rows, columns, or spacing.

**Consolidate app pages** is disabled by default. Enabling it fills earlier pages and permanently saves the resulting application order.

The preferences window uses a horizontal layout with scrollable controls on the left and a large monitor preview on the right. While the extension is active, the preview uses measured App Grid tiles, icons, per-page item counts, page indicators, dock visibility and position, search entry, workspace thumbnails, and Dash geometry from GNOME Shell instead of relying solely on a generic monitor estimate. Before live geometry is available, it reads Shell's top-level app-picker layout and folder IDs so folders and page boundaries still produce the correct visible icons. Preview colors are varied deterministically from each application or folder ID, avoiding row or column color bands without flickering between redraws. Folder detection follows system settings automatically and is not tied to fixed positions. Open the overview once after changing the layout to publish settled positions. The window defaults to a monitor-aware size within 760–1200 × 420–560, and the controls pane scrolls on smaller displays. When a custom grid exceeds the estimated screen capacity, the preview reports the mismatch and offers a Fit button that applies the suggested rows and columns.

## Requirements

- GNOME Shell 46, 47, 48, 49, or 50
- Supports both upstream grid modes and Ubuntu 26.04's adaptive App Grid layout.

## License

MIT

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release details.

## Development checks

```bash
npm run check
glib-compile-schemas --strict --dry-run schemas/
```

CI additionally builds the final ZIP, verifies its GNOME metadata, schema declaration,
local imports, review-sensitive APIs, archive paths and contents, runs Shexli, and uploads
the validated package as a workflow artifact.

For live Ubuntu 26.04 verification, run the harness from a machine with the VM registered in
VirtualBox, SSH key access, passwordless sudo, and GDM automatic login:

```bash
scripts/verify-ubuntu-vm.sh
SKIP_RESTART=1 scripts/verify-ubuntu-vm.sh   # test already-installed files
```

The harness builds and installs the package, restarts the graphical session, enables Looking
Glass unsafe mode, runs `scripts/vm-probe.py`, and saves overview/preferences screenshots to
`/tmp/appgrid-vm`. Acceptance is the probe exit status; screenshots are diagnostic artifacts
and do not need review on subsequent runs. Review them once when adding or changing a visual
test case. See [docs/ubuntu-26.04-verification.md](docs/ubuntu-26.04-verification.md)
for the covered checks and environment details.

For upstream GNOME Shell on Fedora, the headless harness needs no VM and does not touch the
live desktop session:

```bash
scripts/verify-fedora-headless.sh
```

It runs the same probe against an isolated headless Shell and guards the live
`enabled-extensions` and `app-picker-layout` settings against leakage. See the verification
document for the isolation details and covered checks.
