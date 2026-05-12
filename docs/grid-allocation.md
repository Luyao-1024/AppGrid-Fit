# GNOME Shell 50 — App Grid Layout Allocation Analysis

Source code reference: `gnome-shell-50.1/`

---

## Layout Chain (Actor Hierarchy and Allocation Flow)

```
Stage
  └─ overviewGroup (St.Widget)
       └─ OverviewActor (St.BoxLayout, VERTICAL)                    [overview.js:27]
            │  Constraint: MonitorConstraint({primary: true})        [overview.js:37]
            │  → Gets FULL monitor rect: W × H
            │
            └─ ControlsManager (St.Widget)                          [overviewControls.js:312]
                 │  Layout: ControlsManagerLayout                   [overviewControls.js:38]
                 │  Computes _workAreaBox (work area = monitor - panel)
                 │
                 ├─ searchEntryBin (St.Bin, centered)               [top]
                 ├─ _thumbnailsBox (ThumbnailsBox)                   [visible only in WINDOW_PICKER]
                 ├─ _workspacesDisplay (WorkspacesDisplay)           [middle]
                 ├─ _appDisplay (AppDisplay)                         [main area]
                 ├─ _searchController                                [overlay]
                 └─ dash (Dash)                                      [bottom]
```

---

## Step-by-Step Allocation in APP_GRID State

### Step 0: MonitorConstraint sizes OverviewActor to full monitor

**File:** `js/ui/layout.js`, lines 132-155

```
OverviewActor allocation = full monitor rect (0, 0, W, H)
```

No `workArea: true` on the constraint (`js/ui/overview.js:37`), so the overview gets
the full monitor, not the work area.

### Step 1: ControlsManagerLayout.vfunc_allocate

**File:** `js/ui/overviewControls.js`, lines 155-248

```js
const startY = this._workAreaBox.y1;        // = panelHeight
box.y1 += startY;                            // shift down by panel height
const [width, height] = box.get_size();      // = (W, H - panelHeight)
const spacing = Math.round(height * 0.02);   // = 2% of work area height
```

Key constants (`overviewControls.js:21-25`):

| Constant | Value | Meaning |
|---|---|---|
| `VERTICAL_SPACING_RATIO` | `0.02` | 2% spacing between sections |
| `DASH_MAX_HEIGHT_RATIO` | `0.16` | Dash max = 16% of work area |
| `SMALL_WORKSPACE_RATIO` | `0.15` | Mini workspace thumbnails = 15% of work area |

**Variables computed:**

| Variable | Formula | Example (1920×1080) |
|---|---|---|
| `panelHeight` | `2.2em` (CSS) | ~27px |
| `height` (work area) | `H - panelHeight` | 1053px |
| `spacing` | `round(height × 0.02)` | 21px |
| `searchHeight` | from `get_preferred_height(W)` | ~52px |
| `maxDashHeight` | `round(height × 0.16)` | 168px |
| `dashHeight` | `min(preferred, maxDashHeight)` | ~72px (few icons) |
| `workspacesHeight` | `round(height × 0.15)` | 158px |

**Search entry allocated** (lines 165-168):
- Position: `(0, startY)` = `(0, panelHeight)`
- Size: `(W, searchHeight)`

**Dash allocated** (lines 173-180):
- Position: `(0, startY + height - dashHeight)`
- Size: `(W, dashHeight)`

**Workspaces allocated** for APP_GRID state (lines 101-106 in `_computeWorkspacesBoxForState`):
- Position: `(0, startY + searchHeight + spacing)`
- Size: `(W, round(height × 0.15))`

**AppDisplay allocated** for APP_GRID state (lines 122-134 in `_getAppDisplayBoxForState`):
- Position: `(0, startY + searchHeight + spacing + workspacesHeight + spacing)`
- Size: `(W, height - searchHeight - spacing - workspacesHeight - spacing - dashHeight - spacing)`

Which simplifies to:

```
appDisplayWidth  = W
appDisplayHeight = (H - panelHeight)
                   - searchHeight
                   - dashHeight
                   - 3 × spacing
                   - round((H - panelHeight) × 0.15)
```

### Step 2: AppDisplay → BaseAppView._box (St.BoxLayout VERTICAL)

**File:** `js/ui/appDisplay.js`, lines 594-600

```
_box (St.BoxLayout VERTICAL)
  ├─ scrollContainer (y_expand: true) → gets remaining height
  └─ pageIndicators (horizontal)      → gets natural height (~16px)
```

Page indicators CSS (`_app-grid.scss:121-132`):
- `.page-indicator` padding: `6px 12px 0`
- Icon: `10px × 10px`
- Natural height ≈ **16px**

```
scrollContainerHeight = appDisplayHeight - pageIndicatorsHeight
                      = appDisplayHeight - ~16px
```

### Step 3: BaseAppViewGridLayout.vfunc_allocate

**File:** `js/ui/appDisplay.js`, lines 404-429

```js
const indicatorsWidth = this._getIndicatorsWidth(box);
// = max(W × 0.10, minArrowsWidth)
// Where PAGE_PREVIEW_RATIO = 0.20 → idealIndicatorWidth = (W × 0.20) / 2 = W × 0.10
```

The `.page-navigation-arrow` CSS (`_app-grid.scss:172-184`):
- `width: $medium_icon_size` = 24px
- `padding: $base_padding × 3` = 18px
- Total min arrow width ≈ **60px**

So `indicatorsWidth = max(W × 0.10, ~60px)`.

On a 1920px display: `indicatorsWidth = 192px` (10% per side).

The scroll view gets the **FULL box** allocated (indicators are overlaid on top):
```js
this._scrollView.allocate(box);  // full box
```

### Step 4: AppGrid merges indicatorsPadding + CSS page_padding

**File:** `js/ui/appDisplay.js`, lines 161-170

```js
_updatePadding() {
    const padding = this._indicatorsPadding.copy();  // {left: indicatorsWidth, right: indicatorsWidth, top: 0, bottom: 0}
    ['top', 'right', 'bottom', 'left'].forEach(side => {
        padding[side] += node.get_length(`page-padding-${side}`);
    });
    this.layoutManager.pagePadding = padding;
}
```

CSS page_padding from `_app-grid.scss:7-16`:

```scss
page-padding-top:    $base_padding * 4 = 24px
page-padding-bottom: $base_padding * 4 = 24px
page-padding-left:   $base_padding * 3 = 18px
page-padding-right:  $base_padding * 3 = 18px
```

**Final pagePadding:**

| Side | indicatorsPadding | CSS page_padding | Total |
|---|---|---|---|
| Left | `indicatorsWidth` | 18px | `indicatorsWidth + 18` |
| Right | `indicatorsWidth` | 18px | `indicatorsWidth + 18` |
| Top | 0 | 24px | **24px** |
| Bottom | 0 | 24px | **24px** |

### Step 5: IconGrid.vfunc_allocate → IconGridLayout.adaptToSize

**File:** `js/ui/iconGrid.js`, lines 1251-1256

```js
vfunc_allocate(box) {
    const [width, height] = box.get_size();
    this._findBestModeForSize(width, height);
    this.layout_manager.adaptToSize(width, height);
    super.vfunc_allocate(box);
}
```

`adaptToSize` (`iconGrid.js:991-1018`) stores:
- `_pageWidth = scrollContainerWidth` (= `W`)
- `_pageHeight = scrollContainerHeight`

### Step 6: IconGridLayout._calculateSpacing determines icon placement

**File:** `js/ui/iconGrid.js`, lines 572-647

```js
emptyHSpace = _pageWidth  - childSize×nColumns - columnSpacing×(nColumns-1) - pagePadding.left - pagePadding.right
emptyVSpace = _pageHeight - childSize×nRows    - rowSpacing×(nRows-1)       - pagePadding.top  - pagePadding.bottom
```

With default CSS spacing values:
- `column-spacing: $base_padding * 2` = **12px**
- `row-spacing: $base_padding * 2` = **12px**
- `max-column-spacing: $base_padding * 6` = **36px**
- `max-row-spacing: $base_padding * 6` = **36px**

---

## All Relevant Values Summary

**CSS base values** (`_common.scss:31-33`):

| Variable | Value |
|---|---|
| `$base_padding` | **6px** |
| `$base_margin` | **4px** |
| `$base_font_size` | **11pt** |
| `$panel_height` | **2.2em** (~27px at 1x) |

**JS constants** (`overviewControls.js:21-25`):

| Constant | Value | Purpose |
|---|---|---|
| `SMALL_WORKSPACE_RATIO` | `0.15` | Mini workspace height in APP_GRID |
| `DASH_MAX_HEIGHT_RATIO` | `0.16` | Max dash height |
| `VERTICAL_SPACING_RATIO` | `0.02` | Inter-section spacing |

**App grid CSS** (`_app-grid.scss`):

| Property | Value |
|---|---|
| `row-spacing` | `12px` ($base_padding×2) |
| `column-spacing` | `12px` ($base_padding×2) |
| `max-row-spacing` | `36px` ($base_padding×6) |
| `max-column-spacing` | `36px` ($base_padding×6) |
| `page-padding-top` | `24px` ($base_padding×4) |
| `page-padding-bottom` | `24px` ($base_padding×4) |
| `page-padding-left` | `18px` ($base_padding×3) |
| `page-padding-right` | `18px` ($base_padding×3) |

**Search entry CSS** (`_search-entry.scss`):

| Property | Value |
|---|---|
| `margin-top` | `12px` ($base_padding×2) |
| `margin-bottom` | `6px` ($base_padding) |
| `width` | `24em` (centered) |
| `padding` | `9px 9px` (from `%entry_common`: $base_padding×1.5) |

**Dash CSS** (`_dash.scss`):

| Property | Value |
|---|---|
| `padding-left/right` | `6px` ($base_padding) on `#dash` |
| `dash-background padding-top/bottom` | `12px` ($dash_padding = $base_padding×2) |
| `dash_edge_offset` | `12px` ($base_margin×3) |

---

## Formula: Grid Icon Area vs Monitor Size

Given a monitor of size **W × H**:

```
let panelH      = 2.2 × stageFontSize        // typically ~27-35px
let workH       = H - panelH
let spacing     = round(workH × 0.02)
let searchH     ≈ 52px (at 1x scale, varies with font)
let dashH       = min(dashPreferred, round(workH × 0.16))   // typically 60-100px
let miniWsH     = round(workH × 0.15)
let pageIndH    ≈ 16px

// AppDisplay allocation
let appDspW     = W
let appDspH     = workH - searchH - dashH - 3×spacing - miniWsH

// Scroll container (grid's parent)
let scrollW     = W
let scrollH     = appDspH - pageIndH

// Grid page dimensions (what adaptToSize receives)
let pageW       = scrollW
let pageH       = scrollH

// Indicator width per side
let indW        = max(W × 0.10, ~60px)

// Icon area within a page (after page_padding)
let iconAreaW   = pageW - 2 × (indW + 18)
               = W - 2 × (W × 0.10 + 18)
               = W × 0.80 - 36

let iconAreaH   = pageH - 2 × 24
               = appDspH - pageIndH - 48
```

**Approximate percentages of monitor (for 1920×1080 at 1x):**

| Metric | Pixels | % of Monitor |
|---|---|---|
| Monitor | 1920 × 1080 | 100% × 100% |
| Work area | 1920 × 1053 | 100% × 97.5% |
| AppDisplay allocation | 1920 × 712 | 100% × 65.9% |
| Grid page (adaptToSize) | 1920 × 696 | 100% × 64.4% |
| **Icon area within page** | **1500 × 648** | **78.1% × 60.0%** |

**Quick approximation:**

```
iconAreaWidth  ≈ 78% of monitorWidth   (fixed ~36px reduction)
iconAreaHeight ≈ 58-62% of monitorHeight (varies with dash/search height)
```

---

## Source File Reference

| File | Lines | Purpose |
|---|---|---|
| `js/ui/layout.js` | 41-156 | `MonitorConstraint` — sizes overview to monitor |
| `js/ui/layout.js` | 1002-1008 | `getWorkAreaForMonitor` — work area minus panel |
| `js/ui/overview.js` | 26-41 | `OverviewActor` — constrained to monitor |
| `js/ui/overviewControls.js` | 21-25 | Layout constants (spacing ratios) |
| `js/ui/overviewControls.js` | 38-259 | `ControlsManagerLayout` — the key allocator |
| `js/ui/overviewControls.js` | 80-110 | `_computeWorkspacesBoxForState` — workspace sizing per state |
| `js/ui/overviewControls.js` | 112-135 | `_getAppDisplayBoxForState` — **AppDisplay sizing** |
| `js/ui/overviewControls.js` | 155-248 | `vfunc_allocate` — main allocation logic |
| `js/ui/overviewControls.js` | 312-389 | `ControlsManager._init` — creates all children |
| `js/ui/appDisplay.js` | 147-188 | `AppGrid` — merges indicatorsPadding + CSS page_padding |
| `js/ui/appDisplay.js` | 190-469 | `BaseAppViewGridLayout` — scroll view + indicator overlay |
| `js/ui/appDisplay.js` | 220-236 | `_getIndicatorsWidth` — 10% per side for arrows |
| `js/ui/appDisplay.js` | 404-429 | `BaseAppViewGridLayout.vfunc_allocate` |
| `js/ui/appDisplay.js` | 476-654 | `BaseAppView._init` — creates grid, scroll, indicators |
| `js/ui/appDisplay.js` | 1315-1351 | `AppDisplay` class |
| `js/ui/iconGrid.js` | 572-647 | `_calculateSpacing` — icon placement within page |
| `js/ui/iconGrid.js` | 991-1018 | `adaptToSize` — stores page dimensions |
| `js/ui/iconGrid.js` | 1160-1256 | `IconGrid.vfunc_allocate` — triggers mode selection + adaptToSize |
| `js/ui/iconGrid.js` | 1258-1276 | `IconGrid.vfunc_style_changed` — reads CSS spacing/padding |
| `data/.../widgets/_app-grid.scss` | 7-16 | Grid CSS: spacing, max-spacing, page-padding |
| `data/.../widgets/_app-grid.scss` | 120-132 | Page indicator CSS |
| `data/.../widgets/_app-grid.scss` | 172-185 | Page navigation arrow CSS |
| `data/.../widgets/_search-entry.scss` | 1-15 | Search entry CSS |
| `data/.../widgets/_dash.scss` | 1-106 | Dash CSS |
| `data/.../widgets/_panel.scss` | 10-16 | Panel height: `2.2em` |
| `data/.../_common.scss` | 31-33 | Base values: padding=6px, margin=4px |
| `data/.../widgets/_workspace-thumbnails.scss` | 1-26 | Workspace thumbnail CSS |
