# Ubuntu 26.04 App Grid compatibility verification

Verified on 2026-10-26 for AppGrid Fit 1.3.4.

## Automated QEMU acceptance (default)

`scripts/verify-qemu.sh` runs the same probe inside disposable QEMU guests, so the host
desktop is never the test target. The first run downloads cloud images from the Tsinghua
mirror (the upstream Fedora directory for `fedora-51`) and provisions one golden image per
case; later runs boot a fresh qcow2 overlay
backed by the golden image and delete it afterwards, so extension settings and app order
always start clean. The cache is `${XDG_CACHE_HOME:-~/.cache}/appgrid-qemu`.

Guest package installation is pinned to a Chinese mirror. Ubuntu's cloud-init `apt` section
sets the primary and security URIs before `package_update`; Fedora's boot command replaces
the `fedora`, `fedora-updates` and `fedora-updates-testing` metalinks with Tsinghua base URLs
and disables the unmirrored Cisco OpenH264 repository. Provisioning then verifies all active
apt sources and those three Fedora repositories, failing instead of proceeding from an
upstream mirror. The `fedora-51` case is the documented exception: Tsinghua does not mirror
rawhide, so it uses Fedora's upstream rawhide image and the NJU Fedora mirror for package
downloads (`MIRROR_MODE=nju`).

| Case | Guest | Layout |
| --- | --- | --- |
| `ubuntu-24.04` | Ubuntu 24.04 cloud image, GNOME Shell 46 | upstream mode-based `IconGridLayout` |
| `ubuntu-26.04` | Ubuntu 26.04 cloud image, GNOME Shell 50.1 | Ubuntu adaptive `IconGridLayout` |
| `fedora-44` | Fedora 44 Cloud, GNOME Shell 50 | upstream mode-based `IconGridLayout` |
| `fedora-51` | Fedora rawhide, GNOME Shell 51 | upstream mode-based `IconGridLayout` |

The guest runs `gnome-shell --headless --wayland --no-x11 --unsafe-mode` under its own
`dbus-run-session` and XDG tree. `--no-x11` is required: otherwise libgvc synchronously
connects to Xwayland before the compositor can service it and wedges the Shell main loop.
Unsafe mode lets the probe use `org.gnome.Shell.Eval`; extension enable/disable checks also
go through `Main.extensionManager`, avoiding the external `gnome-extensions` D-Bus service.
Before enabling the extension, the guest verifies that
`Main.layoutManager.primaryMonitor` matches the requested `MONITOR`. `HOME`, `XDG_*`,
`GSETTINGS_SCHEMA_DIR` and `DISPLAY=:999` are exported before `dbus-run-session` so dconf
and other activated services use the isolated configuration.

The guest preconfigures a 2×3 custom grid before enabling the extension. The app-picker
layout captured at probe start therefore uses the same 6-item page capacity it is restored
with later; restoring a larger-capacity layout at 2×3 lets Shell's `_redisplay()` scramble
positions that overflow the page.

Cloud images have no desktop applications, so provisioning creates 48 dummy entries and
pins nine as favorites. The app grid starts with 39 non-favorite items at 2×3, i.e. seven
pages. The cloud image uses the standard horizontal Dash; Ubuntu Dock is not installed.

Results on 2026-10-26 with QEMU 10.2.2/KVM, 2 vCPU, 4096 MiB, 1920×1080 virtual monitor and
the extension built from this repository:

- `ubuntu-24.04`: 97 checks passed.
- `ubuntu-26.04`: 97 checks passed.
- `fedora-44`: 97 checks passed.
- `fedora-51`: 97 checks passed.

The QEMU guest sets `TEST_FOLDER=1`. The probe creates a temporary folder from four dummy
apps, opens it at 32 px and 96 px, and asserts that the folder dialog's child icons follow
the configured size. It also verifies that the dialog keeps the configured 3×4 grid even
though only four apps are present, that the panel width/height match the tile size, gaps and
uniform 24 px page padding, that measured side margins are symmetric instead of using
Shell's wide navigation-arrow padding, that the folder name and edit button stay inside the
centered title bar, that the panel shrinks when labels are hidden and grows back when they
are shown, and that disabling the extension restores Shell's default panel size and padding.
A 14 px configured title is checked against the label and entry fonts, the edit button must
scale with it, and setting 0 or disabling must restore the system title. A 3×3 configuration
must produce a square panel. Folder settings are backed up and restored.

The headless runs have 97 checks: the standard horizontal Dash emits two geometry checks,
and the QEMU guest adds folder/title/square/name/dialog-fit checks plus four localization
checks (declared gettext domain, packaged Chinese catalog, translated UI lookup, and
placeholder preservation).

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
| Folder layout | Folder dialog child icons follow 32 px and 96 px; a four-app folder keeps the configured 3×4 grid; gaps 8/14 px |
| Folder dialog fit | Panel width/height match tiles, gaps and 24 px page padding at both icon sizes, shrink when labels are hidden and return when shown |
| Folder margins | Folder page padding is 24 px on every side and the measured left/right icon margins are balanced |
| Folder title | The folder name and edit button stay inside the panel, and the name is centered |
| Folder paging | Six apps keep the 3×4 grid on one page, and a 2×2 grid reflows them into two pages; the panel returns to Shell's default size and padding while paged |
| App names | `show-app-names=false` hides labels in the main grid and folder dialog, and restores them when re-enabled |
| Folder disable | Restores adaptive icon size, 3×3 dimensions, Shell's native symmetric spacing, page padding and the default panel size |

Screenshots are not an acceptance artifact. Acceptance is the probe exit status; a failing
QEMU run copies the guest work directory and Shell log into `<cache>/logs/`.

## Known coverage limits

- Ubuntu (adaptive `IconGridLayout`) and upstream Fedora (mode-based layout) are covered by the
  QEMU probes. Other distributions still need a smoke test because private Shell members vary.
- Theme verification loads a small custom stylesheet through `St.Theme`. Switching the whole
  system theme through GNOME Settings is still a manual check.
- Mouse-drag ordering is not synthesized. Saved-order restoration is verified through Shell's
  `_savePages()` output and `app-picker-layout`, not by generating drag gestures.
- The preferences window is not part of QEMU acceptance. Its construction, previews and
  localization catalog are covered by unit tests and the packaged-catalog check; Cairo pixels
  are not asserted automatically.
- The `fedora-51` case uses Fedora's upstream rawhide image and the NJU package mirror because
  Tsinghua does not mirror rawhide. It verifies GNOME Shell 51.1 rather than a released
  Fedora 45 image.

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

- `npm run check`: source syntax/policy validation and 56 unit tests, including full Chinese
  catalog coverage and placeholder checks.
- Strict schema validation and compiled-schema reproducibility.
- Package validation with `npm run check:package -- <archive>`; the package must contain
  `locale/zh_CN/LC_MESSAGES/appgrid-size@luyao.mo`.
- `scripts/verify-qemu.sh`: cached QEMU acceptance across Ubuntu 24.04, Ubuntu 26.04,
  Fedora 44 and Fedora rawhide (GNOME 51), with disposable per-run overlays.
- Shexli runs on the packaged artifact; CI applies a GNOME 51 version-cutoff patch to
  Shexli 0.2.1 and still checks every other rule.
