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

### CSS override defense

`IconGrid.vfunc_style_changed()` resets spacing properties from CSS on theme switches.
`_setupEnforcers()` connects `notify::*` handlers on all six properties listed in
`ENFORCED_PROPERTIES`. When any property changes (including from CSS), the enforcer closure
immediately restores the extension's value.

### Page consolidation

`consolidatePages()` walks `lm._pages` and calls `_fillItemVacancies()` to pull items from
subsequent pages into earlier unfilled pages. This reduces empty pages when grid density
increases. It only runs when `consolidate-pages` is enabled; the setting defaults to false
because `_savePages()` permanently changes the user's application order.

`reflowPages()` always detects pages above the configured capacity and calls `_updatePages()`
to move surplus items forward before allocation. This prevents overflow when capacity shrinks.

### Overview re-apply

Connected to `Main.overview` `'showing'` signal so layout is re-applied each time the
overview opens — handles cases where GNOME Shell resets layout between shows.

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
  ├─ _apply()
  │   ├─ _saveOriginalValues(lm, grid)   — first-run: snapshot defaults into _original
  │   ├─ _readGridConfig()               — read settings → config object {iconSize, rows, columns, rowGap, colGap, autoFit}
  │   ├─ _computeAutoFit(grid, lm, config) — if autoFit, override rows/columns from allocation
  │   ├─ _applyLayout(grid, lm, config)  — set all layout_manager properties
  │   ├─ _setupEnforcers(lm)             — connect notify handlers to defend against CSS resets
  │   ├─ reflowPages(lm, {consolidate})  — move overflow; optionally fill vacancies
  │   └─ _forceRelayout(grid)            — reset cached page size, trigger re-allocation
  ├─ Main.overview.connect('showing')
  ├─ Main.overview.connect('shown')       — publish settled preview geometry
  └─ Main.layoutManager.connect('monitors-changed')

disable()
  ├─ _cancelScheduledApply()
  ├─ _disconnectOverview()
  ├─ _disconnectMonitorsChanged()
  ├─ _disconnectSettings()  — disconnect + null _settings
  ├─ _disconnectGridBindings() — disconnect allocation + notify handlers
  ├─ _restoreOriginalLayout() — restore saved _original values, then _forceRelayout
  └─ _resetState()

_getControlsManager()  — Main.overview?._overview?._controls ?? null
_findGrid()            — _getControlsManager()?.appDisplay?._grid ?? null
_getAppDisplay()       — _getControlsManager()?.appDisplay ?? null
```

Original layout values are stored in `this._original` for the current layout manager and
restored on disable or after a partial apply failure.

---

## Preferences Window (`prefs.js`)

### Layout

The prefs window uses a horizontal `Gtk.Paned` inside a single `Adw.PreferencesRow`.
`findDescendant()` raises the page's internal `Adw.Clamp` maximum to 1400 so both panes
receive their natural width. Default window size: 1200×560.

```
fillPreferencesWindow(window)
  └─ paned (Gtk.Paned, horizontal, position 420)
       ├─ _buildControlsPane(settings) → {widget: controlsBox, cleanupFns[]}
       │    └─ controlsBox (Gtk.Box, vertical, margin 24/16)
       │         ├─ modeGroup    — "Use preset sizes" SwitchRow
       │         ├─ presetsGroup — ComboRow + info label  (visible when preset=true)
       │         ├─ customGroup  — 5 SpinRows + info label (visible when preset=false)
       │         └─ behaviorGroup — optional page consolidation switch
       └─ _buildPreviewPane(settings) → {widget: rightBox, cleanupFns[]}
            └─ rightBox (Gtk.Box, vertical, margin 24/16)
                 ├─ screenLabel — "Monitor: W×H · Icon area: ~aw×ah"
                 ├─ Adw.Clamp → AspectFrame → previewFrame (Cairo grid preview, css 'card')
                 │    └─ DrawingArea — draws overview preview via section functions
                 └─ fitLabel   — grid/balanced-fit stats
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
| `drawDashSection(...)` | Compact Dash, measured items, and page indicators |

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
rectangles for every visible app tile and icon, the search entry, workspace thumbnails, and
Dash items. Settled actor geometry is captured while the overview is visible, so opening the
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
the same measured or fallback tile size used by runtime fitting.

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
  --extra-source=LICENSE \
  "$(pwd)"
gnome-extensions install --force appgrid-size@luyao.shell-extension.zip
# Xorg: Alt+F2 → "r" → Enter; Wayland: log out/in
gnome-extensions enable appgrid-size@luyao
```

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
| `gridPages.js` | Testable page overflow and optional consolidation adapter |
| `extension.js` | Enable/disable, find grid, override layout, balanced fit, persist pages |
| `prefs.js` | Adw prefs window: `_buildControlsPane` (left) + `_buildPreviewPane` with Cairo drawing (right) |
| `tests/*.test.js` | Node unit tests for shared calculations and page reflow |
| `.github/workflows/ci.yml` | Source, schema, Shexli, package-policy validation, and artifact build |
| `scripts/validate-extension.mjs` | Local metadata, runtime API, import, and ZIP review checks used by CI |
| `LICENSE` | MIT license text |
| `metadata.json` | UUID, name, description, shell-version, settings-schema |
| `schemas/…gschema.xml` | GSettings key definitions |
| `schemas/gschemas.compiled` | Compiled schema (generated, do not edit) |
| `docs/grid-allocation.md` | GNOME Shell 50 app grid layout allocation analysis (source code reference) |
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
   private GNOME Shell members. Capability checks prevent common partial failures, but every
   supported Shell release still requires a smoke test.
2. **Fixed icon size clips labels**: Icons smaller than the chosen size still render at the
   fixed size; very small icons may clip labels.
3. **Persisted consolidation is irreversible**: Enabling `consolidate-pages` writes the new
   order through Shell's page manager. Disabling the extension restores grid properties but
   cannot reconstruct the previous application order.
4. **Fallback preview estimates fixed pixel values**: Before the overview has published a
   settled actor snapshot, `estimateGridArea()` uses the `SHELL_*` constants derived from
   GNOME Shell 50 source. These may differ across themes, font sizes, or display scaling.
