# AGENTS — AppGrid Fit

GNOME Shell extension that customizes App Grid layout: icon size, rows/columns per page,
and spacing. The default overview uses a 4×6 grid at 96 px icons with 12 px gaps (from CSS
`_app-grid.scss` → `IconGridLayout` properties). This extension overrides those properties
with user-controlled values.

---

## Architecture

### Object chain (how the extension finds the grid)

```
Main.overview                          (Overview)
  └─ ._overview                        (OverviewActor)
       └─ ._controls                   (ControlsManager)
            └─ .appDisplay             (AppDisplay)
                 └─ ._grid             (AppGrid)
                      └─ .layout_manager   (IconGridLayout)
```

`_getControlsManager()` uses optional chaining (`?.`) to traverse this chain; `_findGrid()`
and `_getAppDisplay()` build on it.

### Class hierarchy

```
Clutter.Actor → St.Viewport → IconGrid → AppGrid   ← instance we override
```

### What the extension sets on `IconGridLayout`

| Property | CSS Default | Extension Value |
|---|---|---|
| `fixed_icon_size` | `-1` (auto) | User-chosen px |
| `setGridModes()` | `[8×3, 6×4, 4×6, 3×8]` | Single-element array → pins layout |
| `rows_per_page` | from grid mode | Same as `rows` |
| `columns_per_page` | from grid mode | Same as `columns` |
| `row_spacing` / `column_spacing` | `12` (`$base_padding*2`) | User gap |
| `max_row_spacing` / `max_column_spacing` | `36` (`$base_padding*6`) | `UNCONSTRAINED_SPACING` (-1) |
| `page_valign` | `FILL` (0) | `START` (1) — exact row gap |
| `page_halign` | `FILL` (0) | `CENTER` (2) — centered horizontally |

---

## Constants

`config.js` is the single source of truth for presets, settings keys, and grid-fit
calculations used by both runtime and preferences code.

### Grid formula constants

| Constant | Value | Meaning |
|---|---|---|
| `TILE_PADDING` | `24` | `.overview-tile` CSS padding (12px per side) |
| `MIN_GRID_DIMENSION` | `2` | Minimum rows/columns |
| `PRESET_WIDTH_RATIO` | `4/5` | Portion of available width used for balanced-fit columns |
| `UNCONSTRAINED_SPACING` | `-1` | max_row/column_spacing value to disable limit |
| `DEFAULT_PAGE_CAPACITY` | `24` | Shell's default 4×6 boundary used to split fallback page counts |
| `FALLBACK_PREVIEW_TILE_OVERHEAD` | `53` | Fallback Shell tile overhead when no live preferred size exists |

### Shell layout estimation constants (prefs.js only)

Used by `estimateGridArea()` to approximate the GNOME Shell overview layout:

| Constant | Value | Source |
|---|---|---|
| `SHELL_PANEL_H` | `30` | Top panel height |
| `SHELL_SEARCH_H` | `52` | Search entry height |
| `SHELL_DASH_H` | `72` | Bottom dash height |
| `SHELL_MINI_WS_RATIO` | `0.15` | Mini workspaces as fraction of work area |
| `SHELL_SPACING_RATIO` | `0.02` | Inter-section spacing as fraction of work area |
| `SHELL_PAGE_IND_H` | `16` | Page indicator height |
| `SHELL_IND_W_RATIO` | `0.10` | Navigation arrow width as fraction of monitor |
| `SHELL_MIN_IND_W` | `60` | Minimum navigation arrow width |
| `SHELL_IND_PADDING` | `18` | Indicator + CSS page-padding |
| `SHELL_PAGE_PAD` | `24` | CSS page-padding top/bottom |

### Preview drawing constants (prefs.js only)

| Constant | Value | Meaning |
|---|---|---|
| `PREVIEW_PADDING` | `0` | Monitor content fills the preview frame edge to edge |
| `DOCK_ICON_COUNT` | `9` | Fallback number of dock icons drawn in preview |
| `SHELL_PREVIEW_GRID_TOP_INSET` | `8` | Fallback inset matching the first visible tile row |

### Iterated arrays

| Constant | Used by |
|---|---|
| `SETTINGS_KEYS` | `_connectSettings()` / `_buildPreviewPane()` — connect to all setting changes |
| `ENFORCED_PROPERTIES` | `_setupEnforcers()` — connect `notify::*` on layout manager |
| `SIZE_NAMES` | `['Large', 'Medium', 'Small', 'Tiny']` — preset display labels |
| `PRESETS` | `config.js` — explicit, stable preset definitions |

---

## Key Mechanisms

### Balanced-fit presets

When preset mode is active, `_apply()` → `_readGridConfig()` → `_computeAutoFit()` reads
the grid's allocation box and computes rows/columns using four fifths of available width.
The runtime first applies the requested icon size and measures Shell's preferred square tile,
which includes the icon, label, label spacing, and `.overview-tile` CSS padding:

```
cellSize = measuredTileSize ?? iconSize + FALLBACK_PREVIEW_TILE_OVERHEAD
effectiveW = round(availW × PRESET_WIDTH_RATIO)
maxCols = max(MIN_GRID_DIMENSION, floor((effectiveW + colGap) / (cellSize + colGap)))
maxRows = max(MIN_GRID_DIMENSION, floor((availH + rowGap) / (cellSize + rowGap)))
```

This overrides the preset's default rows/columns with screen-adaptive values.

### Why START valign + CENTER halign

In FILL alignment, `_calculateSpacing` expands to:

```
vSpacing = rowSpacing + (pageHeight - usedHeight - rowSpacing×(rows-1) - padding) / (rows-1)
         = (pageHeight - usedHeight - padding) / (rows-1)
```

`row_spacing` cancels out — visual gap depends only on page dimensions. Setting `page_valign
= START` makes `vSpacing = row_spacing` (exact). `page_halign = CENTER` centers icons
horizontally with exact `column_spacing`.

### Upstream and Ubuntu layout compatibility

`gridLayout.js` detects capabilities rather than distribution names. Upstream grids use
`setGridModes()` and `_gridModes`; Ubuntu 26.04 removes both and computes dimensions in
`IconGridLayout.adaptToSize()`. On that implementation, set `_fixedRows` and `_fixedCols`
alongside `rows_per_page` and `columns_per_page` so allocation preserves the requested grid.
Original mode arrays or fixed-dimension property presence/values are saved on first apply
and restored on disable or partial failure. Resolve the grid's theme style before capturing
defaults because spacing may still be zero during Shell startup. Do not require grid modes
to find a compatible grid.

### Folder dialog icon sizing

GNOME Shell creates a separate 3×3 `FolderGrid` for folder dialogs; it is not part of
`appDisplay._grid`, so it keeps its adaptive icon size by default. `_apply()` and the
overview `shown` handler call `setFolderIconSizes()` for every
`appDisplay._folderIcons[*].view._grid` and store the previous `fixed_icon_size` in
`_originalFolders`. `IconGridLayout.adaptToSize()` only re-evaluates the icon size after the
page dimensions change, so the helper also clears `_pageWidth`/`_pageHeight` and queues a
relayout. Disable and partial-failure restoration put Shell's original adaptive value back.

### CSS override defense

`IconGrid.vfunc_style_changed()` resets spacing properties from CSS on theme switches.
`_setupEnforcers()` connects `notify::*` handlers on all six properties listed in
`ENFORCED_PROPERTIES`. When any property changes (including from CSS), the enforcer closure
immediately restores the extension's value. `_captureThemeDefaults()` refreshes the values
used for restoration after each `St.ThemeContext` change.

### Page consolidation

`consolidatePages()` walks `lm._pages` and calls `_fillItemVacancies()` to pull items from
subsequent pages into earlier unfilled pages. This reduces empty pages when grid density
increases. It stops when the Shell reports no progress (same page count and no added items),
so an unsupported `_fillItemVacancies()` cannot loop or claim a change. It only runs when
`consolidate-pages` is enabled; the setting defaults to false because `_savePages()`
permanently changes the user's application order.

`reflowPages()` always detects pages above the configured capacity. It first calls
`rebuildPagesInOrder()`, which temporarily enables `allowIncompletePages`, removes every item,
and re-adds them page by page in their existing order. Shell's `_updatePages()` fallback is used
only when the private add/remove APIs are unavailable, because Shell's `_relocateSurplusItems()`
inserts overflow at the start of the next page and scrambles the order. `reflowPages()` returns
whether pages changed; `syncPageManagerPages()` then mirrors the rebuilt pages into
`AppDisplay._pageManager._pages` so a later `_redisplay()` cannot reintroduce Shell's saved
boundaries. `rebuildPagesInOrder()` restores the previous `allowIncompletePages` value, including
GObject prototype properties, after the rebuild.

On first apply for a layout manager, `restorePersistedPageOrder()` temporarily gives each page
enough capacity for all visible items and calls `AppDisplay._redisplay()`. Shell initially loads
saved layouts with its default 24-item capacity, which can reverse the overflow tail by inserting
each extra item at the start of the next page. Restoring from `PageManager` before reflow keeps
drag-and-drop order stable across login when the extension uses a larger capacity. When the
adaptive layout exposes `_fixedRows`/`_fixedCols`, the temporary capacity pins them too and
restores their original presence and values afterward.

### Overview re-apply

Connected to `Main.overview` `'showing'` signal so layout is re-applied each time the
overview opens — handles cases where GNOME Shell resets layout between shows. `'shown'`
schedules a settled publish after `SETTLE_PUBLISH_DELAY_MS` (600 ms) so page-indicator and
other actor animations have finished. The timer sets `_overviewShown = true` only when the
grid exists and publishes with `settled: true`. `'hiding'` cancels the timer and clears the
flag. While the overview is visible, every apply marks geometry unsettled and reschedules the
timer, so the snapshot only becomes settled after layout changes stop. The allocation watcher
publishes with `_overviewShown` instead of unconditionally marking geometry settled.

### Theme-aware restoration

`St.ThemeContext` `'changed'` marks `_themeChanged` and schedules an apply. On the next apply,
`_captureThemeDefaults()` re-reads `row-spacing`, `column-spacing`, `max-row-spacing`, and
`max-column-spacing` from the grid theme node via `readThemeSpacing()`. Upstream layouts restore
all four values on disable; Ubuntu's adaptive layout derives spacing from `_iconSize`, so only
its CSS limits are captured there. Restoration also calls `_syncIconSize(lm,
original.effectiveIconSize)` so adaptive spacing is derived from the original icon size rather
than the last fixed size used by the extension.

### Settings coalescing

Settings, allocation, monitor, and theme changes all use `_scheduleApply()`, a single
`GLib.idle_add` slot. Rapid changes therefore produce one apply. Missing grids and unsupported
layout APIs warn once per failure streak via `_warnOnce()`.

### Force-relayout

1. Set icon sizes on all children via `lm._container` so `_getChildrenMaxSize` returns
   correct values before next allocation.
2. Reset `_pageWidth / _pageHeight` to 0 so `adaptToSize()` re-runs.

---

## Presets

Presets are explicit values in `config.js`. Runtime balanced fitting replaces their base
rows/columns with allocation-dependent values while keeping the preset icon size and gap.

| Level | Icon | Rows × Cols | Apps/Page | Gap |
|-------|------|-------------|-----------|-----|
| 0 (Large) | 96 px | 4 × 6 | 24 | 24 px |
| 1 (Medium) | 64 px | 6 × 9 | 54 | 18 px |
| 2 (Small) | 48 px | 8 × 12 | 96 | 14 px |
| 3 (Tiny) | 32 px | 12 × 16 | 192 | 10 px |

Presets are defined once as:

```js
export const PRESETS = [
    {iconSize: 96, rows: 4, columns: 6, gap: 24},
    {iconSize: 64, rows: 6, columns: 9, gap: 18},
    {iconSize: 48, rows: 8, columns: 12, gap: 14},
    {iconSize: 32, rows: 12, columns: 16, gap: 10},
]
```

---

## Extension class method decomposition (`extension.js`)

```
enable()
  ├─ _resetState()          — initialize original values, signal IDs, allocation state
  ├─ _connectSettings()     — connect changed:: for each SETTINGS_KEYS
  ├─ _connectTheme()        — re-read theme spacing on St.ThemeContext changes
  ├─ _apply()
  │   ├─ _saveOriginalValues(lm, grid)   — first-run: snapshot defaults + effective icon size
  │   ├─ _captureThemeDefaults(grid)     — after a theme change: refresh spacing/limits
  │   ├─ _readGridConfig()               — read settings → config object {iconSize, rows, columns, rowGap, colGap, autoFit}
  │   ├─ _computeAutoFit(grid, lm, config) — if autoFit, override rows/columns from allocation
  │   ├─ _applyLayout(grid, lm, config)  — set all layout_manager properties
  │   ├─ _applyFolderIconSizes()         — apply icon size to every folder dialog grid
  │   ├─ _setupEnforcers(lm)             — connect notify handlers to defend against CSS resets
  │   ├─ restorePersistedPageOrder(...)   — first-run: rebuild order saved before Shell's 24-item split
  │   ├─ reflowPages(lm, {consolidate})  — rebuild overflow in order; optionally fill vacancies
  │   ├─ syncPageManagerPages(...)       — mirror rebuilt page boundaries in memory
  │   └─ _forceRelayout(grid)            — reset cached page size, trigger re-allocation
  ├─ Main.overview.connect('showing')     — cancel settle timer, mark unsettled, apply
  ├─ Main.overview.connect('shown')       — re-apply folder icon sizes, schedule settled publish (600 ms)
  ├─ Main.overview.connect('hiding')      — cancel settle timer, clear settled state
  └─ Main.layoutManager.connect('monitors-changed')

disable()
  ├─ _cancelScheduledApply()
  ├─ _disconnectOverview()
  ├─ _disconnectMonitorsChanged()
  ├─ _disconnectTheme()
  ├─ _disconnectSettings()  — disconnect + null _settings
  ├─ _disconnectGridBindings() — disconnect allocation + notify handlers
  ├─ _restoreOriginalLayout() — restore saved _original values, folder icon sizes, sync icon size, reflow, relayout
  └─ _resetState()

_scheduleApply()       — coalesce settings/theme/allocation changes into one idle apply
_scheduleSettledPublish() / _cancelSettledPublish() — debounce the settled preview snapshot
_warnOnce(message)     — log each missing/unsupported-grid message until the next success
_getControlsManager()  — Main.overview?._overview?._controls ?? null
_findGrid()            — _getControlsManager()?.appDisplay?._grid ?? null
_getAppDisplay()       — _getControlsManager()?.appDisplay ?? null
_applyFolderIconSizes() / _restoreFolderIconSizes() — apply or restore icon sizes on folder dialog grids
```

Original layout values are stored in `this._original` for the current layout manager and
restored on disable or after a partial apply failure. The snapshot includes
`effectiveIconSize` (`lm._iconSize`) for adaptive layouts without `_findBestIconSize()`.
Folder grid originals are stored separately in `this._originalFolders`, keyed by layout
manager.

---

## Preferences Window (`prefs.js`)

### Layout

The prefs window uses a horizontal `Gtk.Paned` inside a single `Adw.PreferencesRow`.
`findDescendant()` raises the page's internal `Adw.Clamp` maximum to 1400 so both panes
receive their natural width. The default window size is monitor-aware: 760–1200 wide and
420–560 tall. The controls pane is wrapped in a `Gtk.ScrolledWindow` with automatic vertical
scrolling so short displays can still reach every row.

```
fillPreferencesWindow(window)
  └─ paned (Gtk.Paned, horizontal, position 420)
       ├─ _buildControlsPane(settings) → {widget: controlsScroller, cleanupFns[]}
       │    └─ controlsScroller (Gtk.ScrolledWindow) → controlsBox (Gtk.Box, vertical, margin 24/16)
       │         ├─ modeGroup    — "Use preset sizes" SwitchRow
       │         ├─ presetsGroup — ComboRow + info label  (visible when preset=true)
       │         ├─ customGroup  — 5 SpinRows + info label (visible when preset=false)
       │         └─ behaviorGroup — optional page consolidation switch
       └─ _buildPreviewPane(settings) → {widget: rightBox, cleanupFns[]}
            └─ rightBox (Gtk.Box, vertical, margin 24/16)
                 ├─ screenLabel — "Monitor: W×H · Icon area: ~aw×ah"
                 ├─ Adw.Clamp → AspectFrame → previewFrame (Cairo grid preview, css 'card')
                 │    └─ DrawingArea — draws overview preview via section functions
                 ├─ fitLabel   — grid/balanced-fit stats
                 └─ fitButton  — applies the clamped balanced-fit rows/columns
```

`fillPreferencesWindow` collects cleanup functions from both panes and invokes them once
from the window's `close-request` signal. Every signal is disconnected from its owner.

### Shared helpers

| Function | Purpose |
|---|---|
| `createSpinRow(settings, key, title, {lower, upper, step, page})` | Creates an `Adw.SpinRow` with `Gtk.Adjustment`, binds to GSettings key |
| `readGridConfig(settings)` | Reads preset or custom settings → `{iconSize, rows, columns, rowGap, colGap, usePresets}` |

### Grid preview (DrawingArea)

The right pane draws a scaled preview of the overview using Cairo (`set_draw_func`).

**Icon area estimation** uses `estimateGridArea(monitorW, monitorH)`, which applies the
GNOME Shell layout formula using the `SHELL_*` constants:

```
workH = H - SHELL_PANEL_H
spacing = round(workH × SHELL_SPACING_RATIO)
appDspH = workH - SHELL_SEARCH_H - SHELL_DASH_H - 3×spacing - round(workH × SHELL_MINI_WS_RATIO)
pageH = appDspH - SHELL_PAGE_IND_H
indW = max(round(W × SHELL_IND_W_RATIO), SHELL_MIN_IND_W)
iconAreaW = W - 2×(indW + SHELL_IND_PADDING)
iconAreaH = pageH - 2×SHELL_PAGE_PAD
```

**Drawing is decomposed into five section functions:**

| Function | Draws |
|---|---|
| `drawPanelSection(...)` | Top panel with Activities, clock, system indicators |
| `drawSearchSection(...)` | Search entry at its measured or estimated rectangle |
| `drawMiniWsSection(...)` | Measured or calibrated workspace thumbnails |
| `drawGridSection(...)` | Estimated icon grid with occupied, overflow, and empty states |
| `drawMeasuredGridSection(...)` | Live app tiles, inner icon rectangles, and labels |
| `drawDashSection(...)` | Page indicators plus measured Dash items; vertical/side docks follow measured item rectangles and `dashVisible` |

All section functions receive scaled coordinates from the main draw callback.

**Grid fit** uses `computeGridFit()` from `config.js`:

```
cellSize = measuredTileSize ?? iconSize + FALLBACK_PREVIEW_TILE_OVERHEAD
effectiveW = usePresets ? round(iconAreaW × PRESET_WIDTH_RATIO) : iconAreaW
fitCols = max(MIN_GRID_DIMENSION, floor((effectiveW + colGap) / (cellSize + colGap)))
fitRows = max(MIN_GRID_DIMENSION, floor((iconAreaH + rowGap) / (cellSize + rowGap)))
```

When available, the preview uses `runtime-preview-layout`, which the extension updates with
the live monitor, grid allocation, page padding, current-page item count, item IDs, and measured actor
rectangles for every visible app tile and icon, the search entry, workspace thumbnails,
page indicators, Dash items, and Dash visibility. `dashVisible` and `pageIndicatorRect` are
consumed even when `settled` is false so Ubuntu's left-side dock and vertical layout show
correctly before the overview settles. The version-2 snapshot also carries a `diagnostics`
object (`mode`, API capabilities, dimensions, icon size, spacing, limits, alignment) used by
the VM probe. Settled actor geometry is captured while the overview is visible, so opening the
overview once after changing the layout gives the preferences preview exact Shell positions.
The runtime snapshot includes Shell's preferred tile size after every icon-size change, so
fallback placement remains accurate for presets, arbitrary custom sizes, themes, and font
scaling even before settled actor positions are available. If the extension cannot provide
that measurement, the preview uses `iconSize + 53`. Its fallback item count
comes from `org.gnome.shell`'s `app-picker-layout`, where folders are already single top-level
items. With consolidation disabled, oversized stored pages are split at the default 24-item
boundary; with consolidation enabled, the preview preserves Shell's newly saved boundaries.
Folder styling is never inferred from an item's position. The fallback joins each
`app-picker-layout` item ID with `org.gnome.desktop.app-folders`'s `folder-children`; the live
snapshot identifies folder actors directly. Both settings sources trigger preview redraws.
Preview icon colors are selected deterministically from application or folder IDs, so they
remain stable across redraws without repeating in row or column bands.

In preset mode, the preview draws cells using balanced-fit values (`fitRows×fitCols`). In
custom mode, it draws the user's configured `rows×columns` with overflow cells in red. Empty
capacity is dimmed, and the visible icon uses `iconSize` while cell placement continues to use
the same measured or fallback tile size used by runtime fitting. A `Fit R×C` button appears
when the custom grid differs from the clamped estimate; pressing it writes the suggested rows
and columns back to GSettings.

**Monitor detection** prefers the monitor containing the preferences window, falls back to
the first display monitor, and finally to 1920×1080.

**Wallpaper** loads the user's desktop background via `org.gnome.desktop.background` GSettings,
updating on `picture-uri`/`picture-uri-dark` changes and dark mode toggles.

---

## GSettings Schema

9 keys in `schemas/org.gnome.shell.extensions.appgrid-size.gschema.xml`:

| Key | Type | Default | Range |
|-----|------|---------|-------|
| `use-presets` | bool | `true` | — |
| `preset-level` | int | `1` | 0–3 |
| `consolidate-pages` | bool | `false` | — |
| `custom-icon-size` | int | `64` | 16–160 |
| `custom-rows` | int | `6` | 2–20 |
| `custom-columns` | int | `9` | 2–20 |
| `custom-row-spacing` | int | `12` | 0–200 |
| `custom-column-spacing` | int | `12` | 0–200 |
| `runtime-preview-layout` | string | `''` | Internal live Shell layout snapshot for the preview |

After modifying the schema XML, recompile: `glib-compile-schemas schemas/`

---

## Build / Install / Reload

```bash
glib-compile-schemas schemas/
gnome-extensions pack --force \
  --extra-source=config.js \
  --extra-source=gridPages.js \
  --extra-source=gridLayout.js \
  --extra-source=LICENSE \
  "$(pwd)"
gnome-extensions install --force appgrid-size@luyao.shell-extension.zip
# Xorg: Alt+F2 → "r" → Enter; Wayland: log out/in
gnome-extensions enable appgrid-size@luyao
```

### QEMU compatibility verification (default acceptance)

```bash
scripts/verify-qemu.sh                        # ubuntu-24.04, ubuntu-26.04, fedora-44
scripts/verify-qemu.sh --case ubuntu-26.04
scripts/verify-qemu.sh --rebuild-golden --case fedora-44
```

Base images come from the Tsinghua mirror. The first run provisions a golden qcow2 per case
once; every later run boots a fresh overlay backed by the golden image and deletes the overlay
afterwards, so extension settings, page order and the guest desktop always start clean. The
cache is `${XDG_CACHE_HOME:-~/.cache}/appgrid-qemu` (`images/`, `golden/`, `keys/`, `runs/`,
`logs/`). A stamp records the provisioning hash, base-image size/mtime and SSH-key
fingerprint; changing any of them rebuilds the golden image.

Guest packages install from the Tsinghua mirror as well. Ubuntu's cloud-init `apt` section
rewrites primary and security URIs before `package_update`; Fedora's boot command comments
out `metalink=` in `fedora.repo`, `fedora-updates.repo` and `fedora-updates-testing.repo` and
replaces the placeholder base URL, and disables the Cisco OpenH264 repository that Tsinghua
does not mirror. The finalize step then rejects any active apt source or Fedora repository
that does not point at `mirrors.tuna.tsinghua.edu.cn`, so provisioning fails instead of
silently falling back to upstream mirrors.

`scripts/qemu-guest-probe.sh` unpacks the extension and schema into an isolated XDG tree,
starts `gnome-shell --headless --wayland --no-x11 --unsafe-mode` under `dbus-run-session`,
verifies `Main.layoutManager.primaryMonitor` matches `MONITOR`, enables the extension, and
runs `scripts/vm-probe.py`. `--no-x11` is required: without it, libgvc synchronously connects
to Xwayland before the compositor can service it, wedging the Shell main loop.
`--unsafe-mode` replaces the old helper extension. `HOME`, `XDG_*`, `GSETTINGS_SCHEMA_DIR`
and `DISPLAY=:999` must be exported **before** `dbus-run-session` so activated services such
as dconf use the isolated config instead of `/home/tester`.

The guest script preconfigures a 2×3 custom grid before enabling the extension, so the
`app-picker-layout` captured at probe start uses the same 6-item page capacity it is restored
with later. Without that, Shell's `_redisplay()` can scramble positions that exceed the
restore capacity.

The probe backs up and restores extension settings, `org.gnome.shell app-picker-layout`, and
(when `TEST_FOLDER=1`) the temporary folder settings used for the 32 px/96 px folder-dialog
checks and the disable-restoration check. Acceptance is the probe exit status; a failing run
copies the guest work directory and Shell log into `<cache>/logs/`, and the run overlay is
still discarded unless `--keep-overlay` is used.

Host requirements: x86_64 Linux, QEMU, OpenSSH client, curl, python3, `timeout`, and one of
`cloud-localds`/`genisoimage`/`mkisofs`/`xorriso`. KVM is used when usable, TCG otherwise.
The virtual monitor defaults to 1920×1080 for every case; `MONITOR=WxH` overrides it.

### Legacy live-session harnesses

These are for manual debugging on a disposable VM or host and are not part of the default
acceptance path:

```bash
scripts/verify-ubuntu-vm.sh
SKIP_RESTART=1 scripts/verify-ubuntu-vm.sh   # already-installed files
SCREENSHOT_DIR='' scripts/verify-ubuntu-vm.sh # no screenshots
scripts/verify-fedora-headless.sh
```

The Ubuntu script builds/installs the package, restarts GDM, enables Looking Glass unsafe
mode through VirtualBox keyboard automation, runs the probe, and captures diagnostic
screenshots. The Fedora script runs the probe against the host's isolated headless Shell and
guards live `enabled-extensions` and `app-picker-layout` settings against leakage.

GNOME Shell caches extension ESM modules: disabling/enabling does not load changed files.
Restart the graphical session after installing a new build.

---

## Code Conventions

- 4-space indent, no semicolons
- GNOME Shell imports: `resource:///org/gnome/shell/…`
- GI imports: `gi://Clutter`, `gi://Gtk`, `gi://Adw`, `gi://Gio`, `gi://Gdk`
- Extension class extends `Extension`; prefs extends `ExtensionPreferences`
- Optional chaining (`?.`) and nullish coalescing (`??`) for null-safe property access
- Signal lifecycle:
  - `_sigIds[]`: raw signal IDs from `settings.connect()`, disconnected in `_disconnectSettings()`
  - `_notifyIds[]`: objects `{layoutManager, signal}` from `lm.connect()`, disconnected with grid bindings
  - In prefs: both pane builders return owner-specific `cleanupFns[]`
- Original layout values saved in `this._original` object on first `_apply()`, restored in `_restoreOriginalLayout()`
- State reset centralized in `_resetState()`, called by both `enable()` and `disable()`
- No comments unless logic is non-obvious

---

## Files

| File | Purpose |
|------|---------|
| `config.js` | Shared presets, setting keys, fit and pixel-size calculations |
| `gridPages.js` | Testable saved-order restoration, page overflow, and optional consolidation adapter |
| `gridLayout.js` | Capability detection, dimension overrides, and restoration for upstream and Ubuntu layouts |
| `extension.js` | Enable/disable, find grid, override layout, balanced fit, persist pages |
| `prefs.js` | Adw prefs window: `_buildControlsPane` (left) + `_buildPreviewPane` with Cairo drawing (right) |
| `tests/*.test.js` | Node unit tests for shared calculations and page reflow |
| `.github/workflows/ci.yml` | Source, schema, Shexli, package-policy validation, and artifact build |
| `scripts/validate-extension.mjs` | Local metadata, runtime API, import, and ZIP review checks used by CI |
| `scripts/vm-probe.py` | Guest-side layout/theme/reflow/consolidation assertions for both layouts |
| `scripts/verify-qemu.sh` | Host orchestrator: cached cloud images, golden provisioning, disposable per-run overlays |
| `scripts/qemu-guest-probe.sh` | In-guest isolated headless-Shell runner used by `verify-qemu.sh` |
| `scripts/verify-ubuntu-vm.sh` | Legacy VirtualBox/GDM live-session harness |
| `scripts/verify-fedora-headless.sh` | Legacy isolated headless upstream probe on the live host |
| `LICENSE` | MIT license text |
| `metadata.json` | UUID, name, description, shell-version, settings-schema |
| `schemas/…gschema.xml` | GSettings key definitions |
| `schemas/gschemas.compiled` | Compiled schema (generated, do not edit) |
| `docs/grid-allocation.md` | GNOME Shell 50 app grid layout allocation analysis (source code reference) |
| `docs/ubuntu-26.04-verification.md` | Ubuntu adaptive-layout verification results and harness usage |
| `README.md` | User-facing documentation |
| `CHANGELOG.md` | Release history |
| `AGENTS.md` | Developer / AI agent reference (this file) |

---

## GNOME Shell 50 Source References

- `js/ui/iconGrid.js` — `IconGridLayout` (GObject props, `_calculateSpacing`, `adaptToSize`,
  `vfunc_allocate`), `IconGrid` (`vfunc_style_changed`, `setGridModes`,
  `_findBestModeForSize`, `_updatePages`, `_fillItemVacancies`)
- `js/ui/appDisplay.js` — `AppGrid`, `BaseAppView._createGrid()`, `_savePages()`
- `js/ui/overviewControls.js` — `ControlsManager` with `appDisplay` getter
- `js/ui/overview.js` — `Overview` / `OverviewActor`
- `data/theme/gnome-shell-sass/widgets/_app-grid.scss` — CSS defaults

---

## Known Limitations

1. **Private Shell APIs**: Grid discovery, reflow, icon updates, and persistence depend on
   private GNOME Shell members. Capability checks prevent common partial failures. Automated
   QEMU acceptance covers Ubuntu 24.04 (GNOME 46), Ubuntu 26.04 (adaptive layout), and Fedora
   44 (GNOME 50) headless; other Shell releases still require a smoke test.
2. **Fixed icon size clips labels**: Icons smaller than the chosen size still render at the
   fixed size; very small icons may clip labels.
3. **Persisted consolidation is irreversible**: Enabling `consolidate-pages` writes the new
   order through Shell's page manager. Disabling the extension restores grid properties but
   cannot reconstruct the previous application order.
4. **Fallback preview estimates fixed pixel values**: Before the overview has published a
   settled actor snapshot, `estimateGridArea()` uses the `SHELL_*` constants derived from
   GNOME Shell 50 source. These may differ across themes, font sizes, or display scaling.
