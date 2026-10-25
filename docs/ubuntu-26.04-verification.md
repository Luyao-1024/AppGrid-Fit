# Ubuntu 26.04 App Grid compatibility verification

Verified on 2026-10-25 for issue #2.

## Environment

- Ubuntu 26.04.1 LTS, GNOME Shell `50.1-0ubuntu1.2`, Wayland.
- VirtualBox 7.2.22, VMSVGA, 3D acceleration disabled.
- Guest: 4 vCPUs, 6144 MiB RAM, 1280×800 display, 100% scaling.
- Baseline: repository commit `f4ac799`, extension metadata `1.3.1 (5)`.
  This was a repository build, rather than the Extensions website revision mentioned in the issue.
- Page consolidation remained disabled throughout the tests.

## Reproduction

Installed the unmodified repository package in the guest and enabled custom settings:
96 px icons, 4 rows, 6 columns. The extension reported `ACTIVE`, but the Shell kept its
64 px icons and 3×6 automatic grid. Opening the App Grid produced:

```text
[appgrid-size] compatible AppGrid not found
```

Runtime inspection found the grid and layout manager. Both `setGridModes` and `_gridModes`
were undefined. The installed Ubuntu Shell instead implements adaptive dimensions in
`IconGridLayout.adaptToSize()`, with `_fixedRows` and `_fixedCols` selecting fixed dimensions.

## Fix

`gridLayout.js` detects the available layout API. Upstream Shell continues to use grid modes;
the adaptive implementation pins both private dimensions and public row/column properties.
Disabling the extension restores the original mode array or fixed-property presence/values.

The grid resolves its theme style before original values are saved. This avoids capturing
startup spacing of zero and allows disabling the extension to restore the actual theme gaps.
New module packaging is included in the installation instructions and CI.

## Live guest verification

| Check | Result |
| --- | --- |
| Custom 4×6, 96 px | Actual layout properties and screenshot match the settings |
| Custom 3×5, 64 px, gaps 8/16 px | Dimensions, icon size and exact gaps match |
| All four presets | Requested icon sizes and balanced dimensions apply |
| Three overview close/open cycles | Custom grid remains applied |
| Dark/light theme changes | Dimensions, gaps and alignments remain enforced |
| Disable after a fresh login | Removes fixed dimensions; restores automatic icon size, 32 px theme gaps and FILL alignment |
| Re-enable | Restores custom dimensions and gaps |
| Preferences | Opens and displays custom settings and live preview |
| Fixed-session extension log | No `appgrid-size` warnings or apply failures |

## Settings-last persistence across logout/login

Configured a 2×3 grid, 64 px icons, 8 px row gaps and 16 px column gaps. Moved
`org.gnome.Settings.desktop` to the end of the last page and saved through the Shell's
`AppDisplay._moveItem()` and `_savePages()` APIs. This test exercises the live move/save
and login restoration path; it does not assert mouse-drag gesture behavior.

Performed two real GNOME logout/login cycles using the graphical login screen.
Compared every page's ordered application IDs and the stored `app-picker-layout`, as well
as icon size, row/column counts and gaps.

| State | Page counts | Last two items on final page | Result |
| --- | --- | --- | --- |
| Before logout | 6, 5, 2 | `System`, `org.gnome.Settings.desktop` | Saved |
| After login 1 | 6, 5, 2 | `System`, `org.gnome.Settings.desktop` | Exact page/order/settings match |
| After login 2 | 6, 5, 2 | `System`, `org.gnome.Settings.desktop` | Exact page/order/settings match |

The test VM is left with this three-page layout and Settings as the last item.

## Automated checks

- `npm run check`: source syntax/policy validation and 30 tests passed.
- `npm run check:package -- <archive>`: passed with the new module included.
- Strict schema validation and compiled-schema reproducibility: passed.
- Shexli 0.2.1 with tree-sitter 0.25.2: clean, zero findings.

Upstream layout behavior is covered by unit tests. Other GNOME releases were not exercised
in a live desktop during this run. These are local validation results; release CI is reported separately.

Machine-local screenshots, JSON snapshots, logs and the tested extension ZIP are in
`~/下载/AppGrid-Fit-issue-2/`. The before/after login records retain the full page arrays so
the persistence result can be independently compared.
