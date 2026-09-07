# Changelog

## 1.3.1 — 2026-09-07

- Calculated preset capacity and custom fit estimates from Shell's full preferred app-tile size so every configured row and column remains visible.
- Increased balanced preset width from two thirds to 80% of the icon area, improving space use while retaining centered side margins and the existing icon spacing.
- Kept fallback preview icons visible when Shell publishes an unsettled off-screen overview position.
- Varied preview icon colors deterministically by application or folder ID instead of repeating the same palette by column.
- Restored a numeric extension version for reliable GNOME Shell and Extensions website update comparisons.

## 1.3.0 — 2026-09-07

- Enlarged the preferences preview to make better use of the right pane.
- Matched preview placement, capacity, icon scale, and occupied cells to the live Shell grid allocation.
- Replayed measured Shell tile, icon, search, workspace, and Dash geometry in the preview.
- Calibrated the fallback tile, workspace, and compact Dock proportions against a 2560×1440 overview capture.
- Matched preview icon counts to Shell's real per-page items, including folders and preserved 24-item page boundaries.
- Detected every preview folder from Shell folder IDs instead of assuming fixed grid positions.
- Read Shell's preferred tile size after every icon-size change so all preset and custom sizes use accurate preview spacing; retain an icon-scaled fallback when live measurement is unavailable.
- Refreshed preview page boundaries immediately after consolidation instead of splitting the newly saved Shell layout back into legacy 24-item pages.

## 1.2.0 — 2026-09-07

- Centralized presets, settings keys, and grid-fit calculations in `config.js`.
- Added allocation and monitor-change handling so balanced presets adapt to the active layout.
- Reflowed overflowing pages when grid capacity shrinks.
- Made page consolidation optional and disabled it by default to avoid silently changing app order.
- Restored original rows, columns, alignment, and spacing when the extension is disabled.
- Reworked the preferences window into a compact 1100×500 horizontal layout.
- Improved the preview with active-monitor detection, wallpaper handling, and shared fit calculations.
- Added signal cleanup, capability checks, unit tests, CI validation, and an MIT license file.

## 1.1.0

- Added wallpaper-backed overview previews and adaptive preset fitting.
- Accounted for overview tile padding when calculating grid capacity.

## 1.0.0

- Initial release with preset and custom App Grid sizing controls.
