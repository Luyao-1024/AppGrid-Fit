# AGENTS — AppGrid Fit

GNOME Shell 50 extension that customizes App Grid layout: icon size, rows/columns per page,
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
| `max_row_spacing` / `max_column_spacing` | `36` (`$base_padding*6`) | `-1` (unconstrained) |
| `page_valign` | `FILL` (0) | `START` (1) — exact row gap |
| `page_halign` | `FILL` (0) | `CENTER` (2) — centered horizontally |

---

## Key Mechanisms

### Auto-fit presets

When preset mode is active, `_apply()` reads the grid's allocation box and computes the
maximum rows/columns that physically fit. The cell size accounts for `.overview-tile`
CSS padding (`padding: 12px` per side → `cellSize = iconSize + 24`):

```
cellSize = iconSize + 24
maxCols = floor((availW + colGap) / (cellSize + colGap))
maxRows = floor((availH + rowGap) / (cellSize + rowGap))
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
The extension connects `notify::*` handlers on all six layout properties. When any property
changes (including from CSS), the enforcer immediately restores the extension's value.

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

Generated from `recommendGrid()` formula: `scale = 96/iconSize`, `rows = floor(6×scale)`,
`cols = floor(9×scale)`, `gap = round(12/scale)`.

| Level | Icon | Rows × Cols | Apps/Page | Gap |
|-------|------|-------------|-----------|-----|
| 0 (Large) | 96 px | 4 × 6 | 24 | 24 px |
| 1 (Medium) | 64 px | 6 × 9 | 54 | 18 px |
| 2 (Small) | 48 px | 8 × 12 | 96 | 14 px |
| 3 (Tiny) | 32 px | 12 × 16 | 192 | 10 px |

In extension.js, presets are defined as:

```js
const PRESETS = [96, 64, 48, 32].map(iconSize => ({
    iconSize,
    ...recommendGrid(iconSize),
}));
```

---

## Preferences Window (prefs.js)

### Layout

The prefs window uses a horizontal `Gtk.Paned` (position 300) inside a single
`Adw.PreferencesRow`. Default window size: 960×640.

```
Adw.PreferencesPage
  └─ rootGroup (Adw.PreferencesGroup, no title)
       └─ rootRow (Adw.PreferencesRow, non-activatable)
            └─ Gtk.Paned (horizontal)
                 ├─ leftScroll (Gtk.ScrolledWindow)
                 │    └─ leftBox (Gtk.Box, vertical, margin 24/16)
                 │         ├─ modeGroup   — "Use preset sizes" SwitchRow
                 │         ├─ presetsGroup — ComboRow + info label  (visible when preset=true)
                 │         └─ customGroup  — 5 SpinRows + info label (visible when preset=false)
                 └─ rightBox (Gtk.Box, vertical, margin 24/16)
                      ├─ screenLabel — "Monitor: W×H · Icon area: ~aw×ah"
                      ├─ DrawingArea (Cairo grid preview, vexpand, css class 'card')
                      └─ fitLabel   — grid/auto-fit stats
```

### Grid preview (DrawingArea)

The right pane draws a scaled preview of the icon grid using Cairo (`set_draw_func`).

**Icon area estimation** uses `estimateGridArea(monitorW, monitorH)`, which applies the
GNOME Shell 50 layout formula from `docs/grid-allocation.md`:

```
panelH = 30,  workH = H - panelH
spacing = round(workH × 0.02)
searchH = 52,  dashH = 72,  miniWsH = round(workH × 0.15)
appDspH = workH - searchH - dashH - 3×spacing - miniWsH
pageH = appDspH - 16  (page indicators)
indW = max(round(W × 0.10), 60)  (navigation arrows per side)
iconAreaW = W - 2×(indW + 18)    (indicators + CSS page-padding)
iconAreaH = pageH - 2×24         (CSS page-padding top/bottom)
```

**Visual elements:**
- Dark background rectangle represents the estimated icon area
- Blue rounded-rect cells for each icon (rows×columns)
- Red cells for overflow (row >= fitRows || col >= fitCols)
- Green dashed rectangle for auto-fit boundary (when different from configured grid)

**Auto-fit** uses the same formula as `extension.js`, including tile padding:
```
cellSize = iconSize + 24  (.overview-tile padding: 12px per side)
fitCols = floor((iconAreaW + colGap) / (cellSize + colGap))
fitRows = floor((iconAreaH + rowGap) / (cellSize + rowGap))
```

In preset mode, the preview draws cells using auto-fit values (`fitRows×fitCols`),
matching the extension's runtime behavior. In custom mode, it draws the user's
configured `rows×columns` with overflow cells in red.

**Monitor detection** reads `Gdk.Display.get_default().get_monitors().get_item(0).get_geometry()`
with a fallback to 1920×1080.

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
- Signal IDs collected in `this._sigIds[]` and `this._notifyIds[]`, disconnected in `disable()`
  - `_sigIds`: raw signal IDs from `settings.connect()`
  - `_notifyIds`: objects `{layoutManager, signal}` from `lm.connect()`
- Original layout values saved on first `_apply()`, restored in `disable()`
- No comments unless logic is non-obvious

---

## Files

| File | Purpose |
|------|---------|
| `extension.js` | Enable/disable, find grid, override layout, auto-fit, consolidate pages |
| `prefs.js` | Adw prefs window: Paned layout with controls (left) + Cairo grid preview (right) |
| `metadata.json` | UUID, name, description, shell-version, settings-schema |
| `schemas/…gschema.xml` | GSettings key definitions |
| `schemas/gschemas.compiled` | Compiled schema (generated, do not edit) |
| `docs/grid-allocation.md` | GNOME Shell 50 app grid layout allocation analysis (source code reference) |
| `README.md` | User-facing documentation |

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
4. **Preview estimates fixed pixel values**: `estimateGridArea()` in `prefs.js` uses
   hardcoded values for panel height (~30px), search bar (~52px), dash (~72px) etc. derived
   from the source code analysis in `docs/grid-allocation.md`. These may differ across
   themes, font sizes, or display scaling.
