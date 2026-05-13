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

Both files share the same set of named constants for the grid recommendation formula and
auto-fit calculations:

### Grid formula constants

| Constant | Value | Meaning |
|---|---|---|
| `DEFAULT_ICON_SIZE` | `96` | GNOME Shell default icon size |
| `DEFAULT_GRID_ROWS` | `6` | Default rows at 96px |
| `DEFAULT_GRID_COLUMNS` | `9` | Default columns at 96px |
| `DEFAULT_GAP` | `12` | Default spacing at 96px (`$base_padding*2`) |
| `TILE_PADDING` | `24` | `.overview-tile` CSS padding (12px per side) |
| `MIN_GRID_DIMENSION` | `2` | Minimum rows/columns |
| `EFFECTIVE_WIDTH_RATIO` | `2/3` | Portion of available width used for auto-fit columns |
| `UNCONSTRAINED_SPACING` | `-1` | max_row/column_spacing value to disable limit |

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
| `PREVIEW_PADDING` | `8` | Padding around the preview frame |
| `DOCK_ICON_COUNT` | `5` | Number of dock icons drawn in preview |

### Iterated arrays

| Constant | Used by |
|---|---|
| `SETTINGS_KEYS` | `_connectSettings()` / `_buildPreviewPane()` — connect to all setting changes |
| `ENFORCED_PROPERTIES` | `_setupEnforcers()` — connect `notify::*` on layout manager |
| `SIZE_NAMES` | `['Large', 'Medium', 'Small', 'Tiny']` — preset display labels |
| `PRESETS` | Both files — computed from `recommendGrid()` |

---

## Key Mechanisms

### Auto-fit presets

When preset mode is active, `_apply()` → `_readGridConfig()` → `_computeAutoFit()` reads
the grid's allocation box and computes the maximum rows/columns that physically fit.
The cell size accounts for `.overview-tile` CSS padding:

```
cellSize = iconSize + TILE_PADDING
effectiveW = round(availW × EFFECTIVE_WIDTH_RATIO)
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

`_consolidatePages()` walks `lm._pages` and calls `_fillItemVacancies()` to pull items from
subsequent pages into earlier unfilled pages. This reduces empty pages when grid density
increases. After consolidation, `appDisplay._savePages()` is called to persist the result.

### Overview re-apply

Connected to `Main.overview` `'showing'` signal so layout is re-applied each time the
overview opens — handles cases where GNOME Shell resets layout between shows.

### Force-relayout

1. Set icon sizes on all children via `lm._container` so `_getChildrenMaxSize` returns
   correct values before next allocation.
2. Reset `_pageWidth / _pageHeight` to 0 so `adaptToSize()` re-runs.

---

## Presets

Generated from `recommendGrid()` formula: `scale = DEFAULT_ICON_SIZE/iconSize`,
`rows = max(2, floor(DEFAULT_GRID_ROWS × scale))`, `cols = max(2, floor(DEFAULT_GRID_COLUMNS × scale))`,
`gap = round(DEFAULT_GAP / scale)`.

| Level | Icon | Rows × Cols | Apps/Page | Gap |
|-------|------|-------------|-----------|-----|
| 0 (Large) | 96 px | 4 × 6 | 24 | 24 px |
| 1 (Medium) | 64 px | 6 × 9 | 54 | 18 px |
| 2 (Small) | 48 px | 8 × 12 | 96 | 14 px |
| 3 (Tiny) | 32 px | 12 × 16 | 192 | 10 px |

In both files, presets are defined as:

```js
const PRESETS = [96, 64, 48, 32].map(iconSize => ({
    iconSize,
    ...recommendGrid(iconSize),
}));
```

---

## Extension class method decomposition (`extension.js`)

```
enable()
  ├─ _resetState()          — initialize _original, _notifyIds, _sigIds, etc.
  ├─ _connectSettings()     — connect changed:: for each SETTINGS_KEYS
  ├─ _apply()
  │   ├─ _saveOriginalValues(lm, grid)   — first-run: snapshot defaults into _original
  │   ├─ _readGridConfig()               — read settings → config object {iconSize, rows, columns, rowGap, colGap, autoFit}
  │   ├─ _computeAutoFit(grid, lm, config) — if autoFit, override rows/columns from allocation
  │   ├─ _applyLayout(grid, lm, config)  — set all layout_manager properties
  │   ├─ _setupEnforcers(lm)             — connect notify handlers to defend against CSS resets
  │   ├─ _consolidatePages(lm)           — fill page vacancies
  │   └─ _forceRelayout(grid)            — reset cached page size, trigger re-allocation
  └─ Main.overview.connect('showing')

disable()
  ├─ _disconnectOverview()
  ├─ _disconnectSettings()  — disconnect + null _settings
  ├─ _disconnectEnforcers() — disconnect all notify handlers
  ├─ _restoreOriginalLayout() — restore saved _original values, then _forceRelayout
  └─ _resetState()

_getControlsManager()  — Main.overview?._overview?._controls ?? null
_findGrid()            — _getControlsManager()?.appDisplay?._grid ?? null
_getAppDisplay()       — _getControlsManager()?.appDisplay ?? null
```

Original layout values are stored in a single `this._original` object (set once on first
`_apply()`, restored in `disable()`).

---

## Preferences Window (`prefs.js`)

### Layout

The prefs window uses a horizontal `Gtk.Paned` (position 300) inside a single
`Adw.PreferencesRow`. Default window size: 1200×600.

```
fillPreferencesWindow(window)
  ├─ _buildControlsPane(settings) → {widget: leftScroll, disconnectIds[]}
  │    └─ leftScroll (Gtk.ScrolledWindow)
  │         └─ leftBox (Gtk.Box, vertical, margin 24/16)
  │              ├─ modeGroup    — "Use preset sizes" SwitchRow
  │              ├─ presetsGroup — ComboRow + info label  (visible when preset=true)
  │              └─ customGroup  — 5 SpinRows + info label (visible when preset=false)
  └─ _buildPreviewPane(settings) → {widget: rightBox, cleanupFns[]}
       └─ rightBox (Gtk.Box, vertical, margin 24/16)
            ├─ screenLabel — "Monitor: W×H · Icon area: ~aw×ah"
            ├─ AspectFrame → previewFrame (Cairo grid preview, vexpand, css 'card')
            │    └─ DrawingArea — draws overview preview via section functions
            └─ fitLabel   — grid/auto-fit stats
```

`fillPreferencesWindow` collects `disconnectIds` from the controls pane and `cleanupFns`
from the preview pane, wiring both to the window's `close-request` signal.

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
| `drawPanelSection(cr, fx, fy, fW, panelH, sc)` | Top panel with Activities, clock, system indicators |
| `drawSearchSection(cr, fx, fW, sY, sH, sc)` | Search bar with pill-shaped entry |
| `drawMiniWsSection(cr, fx, fW, mwY, mwH, sc)` | Mini workspace thumbnails |
| `drawGridSection(cr, iaX, iaY, iaW, iaH, drawRows, drawCols, fitRows, fitCols, cellW, cellH, gapW, gapH, sc, usePresets)` | Icon grid cells (blue normal, red overflow, green auto-fit border) |
| `drawDashSection(cr, fx, fW, dY, dH, sc)` | Bottom dash with `DOCK_ICON_COUNT` dock icons |

All section functions receive scaled coordinates from the main draw callback.

**Auto-fit** uses the same formula as `extension.js` via `readGridConfig()`:

```
cellSize = iconSize + TILE_PADDING
effectiveW = usePresets ? round(iconAreaW × EFFECTIVE_WIDTH_RATIO) : iconAreaW
fitCols = max(MIN_GRID_DIMENSION, floor((effectiveW + colGap) / (cellSize + colGap)))
fitRows = max(MIN_GRID_DIMENSION, floor((iconAreaH + rowGap) / (cellSize + rowGap)))
```

In preset mode, the preview draws cells using auto-fit values (`fitRows×fitCols`),
matching the extension's runtime behavior. In custom mode, it draws the user's
configured `rows×columns` with overflow cells in red.

**Monitor detection** reads `Gdk.Display.get_default().get_monitors().get_item(0).get_geometry()`
with a fallback to 1920×1080.

**Wallpaper** loads the user's desktop background via `org.gnome.desktop.background` GSettings,
updating on `picture-uri`/`picture-uri-dark` changes and dark mode toggles.

---

## GSettings Schema

7 keys in `schemas/org.gnome.shell.extensions.appgrid-size.gschema.xml`:

| Key | Type | Default | Range |
|-----|------|---------|-------|
| `use-presets` | bool | `true` | — |
| `preset-level` | int | `1` | 0–3 |
| `custom-icon-size` | int | `64` | 16–160 |
| `custom-rows` | int | `6` | 2–20 |
| `custom-columns` | int | `9` | 2–20 |
| `custom-row-spacing` | int | `12` | 0–200 |
| `custom-column-spacing` | int | `12` | 0–200 |

After modifying the schema XML, recompile: `glib-compile-schemas schemas/`

---

## Build / Install / Reload

```bash
glib-compile-schemas schemas/
gnome-extensions pack --force "$(pwd)"
gnome-extensions install --force appgrid-size@luyao.shell-extension.zip
# Alt+F2 → "r" → Enter (first install or schema changes)
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
  - `_notifyIds[]`: objects `{layoutManager, signal}` from `lm.connect()`, disconnected in `_disconnectEnforcers()`
  - In prefs: `_buildControlsPane` returns `disconnectIds[]`, `_buildPreviewPane` returns `cleanupFns[]`
- Original layout values saved in `this._original` object on first `_apply()`, restored in `_restoreOriginalLayout()`
- State reset centralized in `_resetState()`, called by both `enable()` and `disable()`
- No comments unless logic is non-obvious

---

## Files

| File | Purpose |
|------|---------|
| `extension.js` | Enable/disable, find grid, override layout, auto-fit, consolidate pages |
| `prefs.js` | Adw prefs window: `_buildControlsPane` (left) + `_buildPreviewPane` with Cairo drawing (right) |
| `metadata.json` | UUID, name, description, shell-version, settings-schema |
| `schemas/…gschema.xml` | GSettings key definitions |
| `schemas/gschemas.compiled` | Compiled schema (generated, do not edit) |
| `docs/grid-allocation.md` | GNOME Shell 50 app grid layout allocation analysis (source code reference) |
| `README.md` | User-facing documentation |
| `AGENTS.md` | Developer / AI agent reference (this file) |

---

## GNOME Shell 50 Source References

- `js/ui/iconGrid.js` — `IconGridLayout` (GObject props, `_calculateSpacing`, `adaptToSize`,
  `vfunc_allocate`), `IconGrid` (`vfunc_style_changed`, `setGridModes`,
  `_findBestModeForSize`, `_fillItemVacancies`)
- `js/ui/appDisplay.js` — `AppGrid`, `BaseAppView._createGrid()`, `_savePages()`
- `js/ui/overviewControls.js` — `ControlsManager` with `appDisplay` getter
- `js/ui/overview.js` — `Overview` / `OverviewActor`
- `data/theme/gnome-shell-sass/widgets/_app-grid.scss` — CSS defaults

---

## Known Limitations

1. **`vfunc_style_changed` resets spacing**: Guarded by `notify` signal enforcers, but
   `page_valign` / `page_halign` are not reset by CSS — START/CENTER persists after disable.
2. **Fixed icon size clips labels**: Icons smaller than the chosen size still render at the
   fixed size; very small icons may clip labels.
3. **Auto-recommend overwrites manual edits**: The `changed::custom-icon-size` callback
   overwrites manual row/col/spacing adjustments in the same prefs session.
4. **Preview estimates fixed pixel values**: `estimateGridArea()` uses the `SHELL_*` constants
   derived from GNOME Shell 50 source. These may differ across themes, font sizes, or
   display scaling.
