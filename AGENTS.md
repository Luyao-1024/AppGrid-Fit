# AGENTS — appgrid-size@luyao

## What This Extension Does

A GNOME Shell 50 extension that lets users resize the App Grid icons, change the row/column
count per page, and set the pixel gap (spacing) between icons. Without the extension, the
overview App Grid uses a 4×6 layout at 96 px icons with 12 px gaps — these values come from
CSS (`_app-grid.scss`) and are loaded at runtime into `IconGridLayout` properties. This
extension intercepts those properties and injects user-controlled values.

---

## High-Level Architecture

```
GNOME Shell overview
  Main.overview                                    (Overview, overview.js:108)
    └─ ._overview / .overview                      (OverviewActor, overview.js:27)
         └─ ._controls                             (ControlsManager, overviewControls.js:313)
              └─ .appDisplay                       (AppDisplay instance, overviewControls.js:372)
                   └─ ._grid                       (AppGrid, appDisplay.js:154)
                        └─ .layout_manager          (IconGridLayout, iconGrid.js:311)
```

### Class hierarchy

```
Clutter.Actor
  └─ St.Viewport
       └─ IconGrid          (iconGrid.js:1164)
            └─ AppGrid      (appDisplay.js:154)      ← the instance we override
```

### How the extension hooks in

`extension.js:_findGrid()` walks the chain above at runtime to get the `AppGrid` instance.
`_apply()` then directly sets **GObject properties** on `grid.layout_manager` (the
`IconGridLayout` instance):

| Property set | Default (CSS) | Extension behaviour |
|---|---|---|
| `fixed_icon_size` | `-1` (auto-size) | Set to user-chosen px value |
| `setGridModes([{rows, cols}])` | `[8×3, 6×4, 4×6, 3×8]` | Single-element array → pins layout |
| `row_spacing` | `12` (CSS `$base_padding*2`) | Set to user-chosen gap px |
| `column_spacing` | `12` (CSS `$base_padding*2`) | Set to user-chosen gap px |
| `max_row_spacing` | `36` (CSS `$base_padding*6`) | Set to `-1` (unconstrained) |
| `max_column_spacing` | `36` (CSS `$base_padding*6`) | Set to `-1` (unconstrained) |
| `page_valign` | `FILL` (0) | Set to `START` (1) — row spacing directly controls gap |
| `page_halign` | `FILL` (0) | Set to `CENTER` (2) — icons centered horizontally |

### How spacing is calculated (iconGrid.js:_calculateSpacing)

1. Compute `usedWidth = childSize × columns`, `usedHeight = childSize × rows`
2. Baseline spacing: `columnSpacing × (cols-1)`, `rowSpacing × (rows-1)`
3. Empty space = page dimensions − used space − baseline spacing − page padding
4. Alignment determines final spacing:

| Alignment | hSpacing / vSpacing |
|---|---|
| `START` | `column_spacing` / `row_spacing` (exact user value) |
| `CENTER` | `column_spacing` / `row_spacing` (icons centered) |
| `END` | `column_spacing` / `row_spacing` (icons at bottom/right) |
| `FILL` | `column_spacing + emptyHSpace/(cols-1)` / `row_spacing + emptyVSpace/(rows-1)` |

#### Why FILL alignment fails for spacing control

In FILL alignment, the spacing formula expands:

```
vSpacing = rowSpacing + (pageHeight - usedHeight - rowSpacing×(nRows-1) - paddingTop - paddingBottom) / (nRows-1)
         = rowSpacing + (pageHeight - usedHeight - padding) / (nRows-1) - rowSpacing
         = (pageHeight - usedHeight - padding) / (nRows-1)
```

**`row_spacing` cancels out entirely.** Visual gap depends only on page height, icon size,
row count and page padding — capped by `max_row_spacing`. Setting `row_spacing` alone has
zero visual effect. Same for `column_spacing` horizontally.

#### The fix: START valign + CENTER halign

- **`page_valign = START`**: `vSpacing = row_spacing` (exact). Icons start at
  `pagePadding.top = 24px` from the top — no cut-off risk.
- **`page_halign = CENTER`**: `hSpacing = column_spacing` (exact). Icons centered
  horizontally with equal side margins.

This combination guarantees exact user spacing in both directions, centers the grid
left-to-right, and never clips the first row.

### Defending against CSS overrides

`IconGrid.vfunc_style_changed()` (`iconGrid.js:1258`) resets `row_spacing`,
`column_spacing`, `max_row_spacing`, and `max_column_spacing` from CSS each time it fires
(theme switch, style change, etc.). The extension connects `notify::*` signal handlers on
all six layout-manager properties. Whenever any property changes (including from CSS), the
handler immediately restores the extension's value. This makes the extension resistant to
style-change overrides.

### Force-relayout trick

1. Immediately set icon sizes on all children via `lm._container` (so `_getChildrenMaxSize`
   returns new values before the next allocation — prevents CENTER alignment from
   computing wrong offsets with old icon sizes).
2. Reset `_pageWidth / _pageHeight` to 0 so `adaptToSize()` re-runs even if the allocation
   box hasn't changed size.

---

## Presets

Four preset levels. The `gap` value controls both `row_spacing` and `column_spacing`:

| Level | Icon | Rows × Cols | Apps/page | Gap |
|-------|------|-------------|-----------|-----|
| 0 (Large)  | 96 px | 4 × 6  | 24 | 24 px |
| 1 (Medium) | 64 px | 6 × 9  | 54 | 18 px |
| 2 (Small)  | 48 px | 8 × 12 | 96 | 14 px |
| 3 (Tiny)   | 32 px | 12 × 16| 192| 10 px |

Custom mode auto-recommends rows/columns/spacing from: `scale = 96/iconSize`,
`rows = floor(6×scale)`, `cols = floor(9×scale)`, `gap = round(12/scale)`.

---

## GSettings Schema

8 keys in `schemas/org.gnome.shell.extensions.appgrid-size.gschema.xml`:

| Key | Type | Default | Range |
|-----|------|---------|-------|
| `use-presets` | bool | `true` | — |
| `preset-level` | int | `1` | 0–3 |
| `custom-icon-size` | int | `64` | 16–160 |
| `custom-rows` | int | `6` | 2–20 |
| `custom-columns` | int | `9` | 2–20 |
| `custom-row-spacing` | int | `12` | 0–200 |
| `custom-column-spacing` | int | `12` | 0–200 |

When modifying the schema XML, **recompile before packaging**:
```bash
glib-compile-schemas schemas/
```

---

## Build / Install / Reload

### The golden rule

**Never copy files directly to `~/.local/share/gnome-shell/extensions/`.** Always use
`gnome-extensions` tooling. A new install is not recognised until the shell restarts.

### Step-by-step

```bash
# 1. Compile schema (if changed)
cd /path/to/appgrid-size@luyao
glib-compile-schemas schemas/

# 2. Package
gnome-extensions pack --force /path/to/appgrid-size@luyao/

# 3. Install (overwrites existing)
gnome-extensions install --force appgrid-size@luyao.shell-extension.zip

# 4. Reload GNOME Shell (required for new installs / schema changes)
#    Alt+F2 → type "r" → Enter
#    or log out / log in
```

After reload, enable:
```bash
gnome-extensions enable appgrid-size@luyao
```

---

## Code Conventions

- Indent: 4 spaces
- GNOME Shell imports: `resource:///org/gnome/shell/…` URIs
- GTK imports: `gi://Gtk`, `gi://Gio`, `gi://Adw`, `gi://Clutter`
- GSettings bindings: `Gio.SettingsBindFlags.DEFAULT`
- Extension class extends `Extension` (from `extensions/extension.js`)
- Prefs class extends `ExtensionPreferences` (from `extensions/js/extensions/prefs.js`)
- Signal cleanup: collect IDs in `this._sigIds[]` and `this._notifyIds[]`, disconnect in
  `disable()`
- Original values saved first in `enable()`, restored in `disable()` — makes enable/disable
  idempotent
- No comments unless the logic is non-obvious

---

## Files

| File | Purpose |
|------|---------|
| `extension.js` | Enable/disable lifecycle, find the grid, override layout properties |
| `prefs.js` | Adw preferences window: preset/custom mode, spin rows, auto-recommend |
| `metadata.json` | UUID, name, description, shell-version, settings-schema |
| `schemas/org.gnome.shell.extensions.appgrid-size.gschema.xml` | GSettings key definitions |
| `schemas/gschemas.compiled` | Compiled binary schema (generated, do not edit) |

---

## Key Source References (GNOME Shell 50.1)

- `js/ui/iconGrid.js` — `IconGridLayout` (GObject props, `_calculateSpacing`, `adaptToSize`,
  `vfunc_allocate`), `IconGrid` (`vfunc_style_changed`, `setGridModes`,
  `_findBestModeForSize`)
- `js/ui/appDisplay.js` — `AppGrid` subclass, `BaseAppView._createGrid()`
- `js/ui/overviewControls.js` — `ControlsManager` with `appDisplay` getter
- `js/ui/overview.js` — `Overview` / `OverviewActor`
- `data/theme/gnome-shell-sass/widgets/_app-grid.scss` — CSS spacing/padding defaults
- `data/theme/gnome-shell-sass/_common.scss` — `$base_padding` (6 px)

---

## Known Limitations

1. **vfunc_style_changed resets spacing properties**: `IconGrid.vfunc_style_changed()`
   resets `row_spacing`, `column_spacing`, `max_row_spacing`, `max_column_spacing` from
   CSS. The extension's `notify` signal handlers guard against this, but `page_valign` and
   `page_halign` are not reset by CSS — the hybrid START/CENTER alignment is persistent.

2. **Fixed icon size bypasses fallback**: When `fixed_icon_size` is set, icons smaller than
   the user's choice still render at the fixed size (no down-scaling), which may produce
   clipped labels on very small rows.

3. **GSettings changes during prefs open**: The auto-recommend callback fires on every
   `changed::custom-icon-size`, which overwrites any manual row/col/spacing adjustments the
   user may have made in the same prefs session.
