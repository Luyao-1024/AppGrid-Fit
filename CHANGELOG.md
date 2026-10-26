# Changelog

## Unreleased

- Added GNOME Shell 51 support and a Fedora rawhide QEMU case that verifies the extension against GNOME Shell 51.1 without touching the host desktop.
- Folder dialogs are now fully configurable: icon size follows the main grid, with independent rows, columns, row/column spacing, exact-gap alignment and CSS limit removal. The preferences window draws a dedicated folder-dialog preview and the probe checks 32 px/96 px child icons, configured dimensions/gaps and restoration on disable.
- Folder dialogs now always show the configured rows × columns, even when a folder holds fewer apps, so a 3×3 folder keeps a 3×3 grid area. The panel fits that configured grid and uses uniform 24 px page padding on single-page folders, balancing icon margins instead of Shell's wide navigation-arrow side padding. Paged folders keep Shell's default panel and padding, and disabling the extension restores both.
- Added a **Show application names** switch that hides labels under apps, folders and folder-dialog children; the main and folder previews omit label bars when disabled.
- Added named layout snapshots: up to 20 saves of the grid settings, `app-picker-layout`, folder definitions and visibility settings, with a combo selector, confirmation before restore, and delete support.
- Added an isolated QEMU acceptance harness with cached golden images and disposable per-run overlays, covering Ubuntu 24.04, Ubuntu 26.04, Fedora 44 and Fedora rawhide (GNOME 51) without touching the host desktop.
- Pinned guest package installation to Chinese mirrors: Tsinghua for Ubuntu and Fedora 44, NJU for rawhide, with provisioning-time checks that fail if an active remaining source points elsewhere.
- Defaulted the QEMU acceptance guest to a 1920×1080 virtual monitor, with `MONITOR` still available as an override.
- Enabled/disabled the extension through `Main.extensionManager` in the probe so headless runs no longer depend on the `gnome-extensions` D-Bus service.
- Documented the golden-image cache, reset semantics and host dependencies, and added shell/Python syntax checks to CI.

## 1.3.4 — 2026-10-26

- Rebuilt overflowing pages in their original order and mirrored the result into Shell's in-memory `PageManager`, so shrinking the grid no longer scrambles drag-and-drop app order on upstream GNOME Shell.
- Delayed the settled preview snapshot until overview animations finish, and made the probes wait for a centered page indicator before checking geometry.
- Fixed the overflow rebuild leaving Shell's `allowIncompletePages` property enabled after restoring the page order.
- Added an isolated headless Fedora verification harness, made extension-state checks locale-independent, and documented the acceptance contract for both Ubuntu (64 checks) and upstream GNOME Shell (63 checks).

## 1.3.3 — 2026-10-25

- Restored native spacing and CSS spacing limits correctly after theme changes and when disabling the extension, including Ubuntu 26.04's adaptive icon-grid layout.
- Synced the effective icon size during restoration so Ubuntu no longer leaves spacing derived from the previous fixed icon size.
- Showed Ubuntu's measured page indicators and left-side dock in the preferences preview instead of a centered horizontal fallback Dock.
- Coalesced rapid settings and allocation changes into a single apply, and warned only once for missing or unsupported grids.
- Made the preferences controls scrollable on small displays, sized the window to the monitor, and added a Fit button when the custom grid exceeds the estimated capacity.
- Added a repeatable Ubuntu VM probe and host verification script covering presets, custom grids, reflow, disable/re-enable, theme changes, consolidation, and page-order restoration.

## 1.3.2 — 2026-10-25

- Fixed App Grid customization on Ubuntu 26.04, where Shell no longer provides `setGridModes()`.
- Restored theme spacing and automatic fitting when the extension is disabled.

## 1.3.1 — 2026-09-07

- Preserved drag-and-drop app order across login when a configured page holds more than Shell's default 24 items.
- Calculated preset capacity and custom fit estimates from Shell's full preferred app-tile size so every configured row and column remains visible.
- Increased balanced preset width from two thirds to 80% of the icon area, improving space use while retaining centered side margins and the existing icon spacing.
- Kept fallback preview icons visible when Shell publishes an unsettled off-screen overview position.
- Varied preview icon colors deterministically by application or folder ID instead of repeating the same palette by column.
- Added blocking CI checks for GNOME metadata, ESM imports, review-sensitive APIs, reproducible schemas, package contents, and Shexli findings, with validated ZIP artifacts uploaded from each run.
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
