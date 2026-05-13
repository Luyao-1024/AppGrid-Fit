import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const DEFAULT_ICON_SIZE = 96;

function recommendGrid(iconSize) {
    const scale = DEFAULT_ICON_SIZE / iconSize;
    const spacing = Math.round(12 / scale);
    return {
        rows: Math.max(2, Math.floor(6 * scale)),
        columns: Math.max(2, Math.floor(9 * scale)),
        gap: spacing,
    };
}

const PRESETS = [96, 64, 48, 32].map(iconSize => ({
    iconSize,
    ...recommendGrid(iconSize),
}));

export default class AppGridSizeExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._originalIconSize = -1;
        this._originalModes = null;
        this._originalRowSpacing = -1;
        this._originalColumnSpacing = -1;
        this._originalMaxRowSpacing = -1;
        this._originalMaxColumnSpacing = -1;
        this._originalPageValign = -1;
        this._originalPageHalign = -1;
        this._applied = false;
        this._rowGap = 0;
        this._colGap = 0;
        this._notifyIds = [];
        this._sigIds = [];
        const cb = this._apply.bind(this);
        for (const key of ['use-presets', 'preset-level',
            'custom-icon-size', 'custom-rows', 'custom-columns',
            'custom-row-spacing', 'custom-column-spacing'])
            this._sigIds.push(this._settings.connect(`changed::${key}`, cb));
        this._apply();
        this._overviewShowId =
            Main.overview.connect('showing', () => this._apply());
    }

    disable() {
        if (this._overviewShowId) {
            Main.overview.disconnect(this._overviewShowId);
            this._overviewShowId = 0;
        }
        if (this._sigIds) {
            for (const id of this._sigIds)
                this._settings.disconnect(id);
            this._sigIds = null;
        }
        this._settings = null;

        if (this._notifyIds.length > 0) {
            this._notifyIds.forEach(id => id.layoutManager.disconnect(id.signal));
            this._notifyIds = [];
        }

        if (this._applied) {
            const grid = this._findGrid();
            if (grid) {
                grid.layout_manager.fixed_icon_size = this._originalIconSize;
                if (this._originalModes)
                    grid.setGridModes(this._originalModes);
                grid.layout_manager.row_spacing = this._originalRowSpacing;
                grid.layout_manager.column_spacing = this._originalColumnSpacing;
                grid.layout_manager.max_row_spacing = this._originalMaxRowSpacing;
                grid.layout_manager.max_column_spacing = this._originalMaxColumnSpacing;
                grid.layout_manager.page_valign = this._originalPageValign;
                grid.layout_manager.page_halign = this._originalPageHalign;
                this._forceRelayout(grid);
            }
        }
        this._originalIconSize = -1;
        this._originalModes = null;
        this._originalRowSpacing = -1;
        this._originalColumnSpacing = -1;
        this._originalMaxRowSpacing = -1;
        this._originalMaxColumnSpacing = -1;
        this._originalPageValign = -1;
        this._originalPageHalign = -1;
        this._rowGap = 0;
        this._colGap = 0;
        this._applied = false;
    }

    _apply() {
        const grid = this._findGrid();
        if (!grid) {
            log('[appgrid-size] _findGrid returned null');
            return;
        }

        const lm = grid.layout_manager;

        if (this._originalIconSize === -1) {
            this._originalIconSize = lm.fixed_icon_size;
            this._originalRowSpacing = lm.row_spacing;
            this._originalColumnSpacing = lm.column_spacing;
            this._originalMaxRowSpacing = lm.max_row_spacing;
            this._originalMaxColumnSpacing = lm.max_column_spacing;
            this._originalPageValign = lm.page_valign;
            this._originalPageHalign = lm.page_halign;
        }
        if (!this._originalModes)
            this._originalModes = grid._gridModes.map(
                m => ({rows: m.rows, columns: m.columns}));

        let iconSize, rows, columns, rowGap, colGap;

        if (this._settings.get_boolean('use-presets')) {
            const level = this._settings.get_int('preset-level');
            const preset = PRESETS[level];
            iconSize = preset.iconSize;
            rows = preset.rows;
            columns = preset.columns;
            rowGap = preset.gap;
            colGap = preset.gap;
        } else {
            iconSize = this._settings.get_int('custom-icon-size');
            rows = this._settings.get_int('custom-rows');
            columns = this._settings.get_int('custom-columns');
            rowGap = this._settings.get_int('custom-row-spacing');
            colGap = this._settings.get_int('custom-column-spacing');
        }

        log('[appgrid-size] applying: iconSize=%d rows=%d cols=%d rowGap=%d colGap=%d',
            iconSize, rows, columns, rowGap, colGap);

        if (this._settings.get_boolean('use-presets')) {
            const alloc = grid.get_allocation_box();
            const boxW = alloc.x2 - alloc.x1;
            const boxH = alloc.y2 - alloc.y1;
            if (boxW > 0 && boxH > 0) {
                const p = lm.page_padding;
                const availW = boxW - p.left - p.right;
                const availH = boxH - p.top - p.bottom;
                const cellSize = iconSize + 24;
                const effectiveW = Math.round(availW * 2 / 3);
                const maxCols = Math.max(2, Math.floor((effectiveW + colGap) / (cellSize + colGap)));
                const maxRows = Math.max(2, Math.floor((availH + rowGap) / (cellSize + rowGap)));
                columns = maxCols;
                rows = maxRows;
                log('[appgrid-size] auto-fit preset: %dx%d (avail %dx%d, cellSize=%d)',
                    columns, rows, availW, availH, cellSize);
            }
        }

        lm.fixed_icon_size = iconSize;
        grid._currentMode = -1;
        grid.setGridModes([{rows, columns}]);
        lm.rows_per_page = rows;
        lm.columns_per_page = columns;
        lm.row_spacing = rowGap;
        lm.column_spacing = colGap;
        lm.max_row_spacing = -1;
        lm.max_column_spacing = -1;
        lm.page_valign = Clutter.ActorAlign.START;
        lm.page_halign = Clutter.ActorAlign.CENTER;

        this._rowGap = rowGap;
        this._colGap = colGap;

        if (this._notifyIds.length === 0) {
            const self = this;
            const enforcer = () => {
                const curLm = self._findGrid()?.layout_manager;
                if (!curLm)
                    return;
                if (curLm.row_spacing !== self._rowGap)
                    curLm.row_spacing = self._rowGap;
                if (curLm.column_spacing !== self._colGap)
                    curLm.column_spacing = self._colGap;
                if (curLm.max_row_spacing !== -1)
                    curLm.max_row_spacing = -1;
                if (curLm.max_column_spacing !== -1)
                    curLm.max_column_spacing = -1;
                if (curLm.page_valign !== Clutter.ActorAlign.START)
                    curLm.page_valign = Clutter.ActorAlign.START;
                if (curLm.page_halign !== Clutter.ActorAlign.CENTER)
                    curLm.page_halign = Clutter.ActorAlign.CENTER;
            };

            for (const prop of ['row-spacing', 'column-spacing',
                'max-row-spacing', 'max-column-spacing',
                'page-valign', 'page-halign'])
                this._notifyIds.push({
                    layoutManager: lm,
                    signal: lm.connect(`notify::${prop}`, enforcer),
                });
        }

        log('[appgrid-size] verify: rowSp=%d colSp=%d maxRow=%d maxCol=%d vAlign=%d hAlign=%d',
            lm.row_spacing, lm.column_spacing,
            lm.max_row_spacing, lm.max_column_spacing,
            lm.page_valign, lm.page_halign);

        if (this._consolidatePages(lm)) {
            const appDisplay = this._getAppDisplay();
            if (appDisplay)
                try { appDisplay._savePages(); } catch (_e) {}
        }

        this._applied = true;
        this._forceRelayout(grid);
    }

    _findGrid() {
        const overview = Main.overview;
        if (!overview || !overview._overview)
            return null;
        const controls = overview._overview._controls;
        if (!controls || !controls.appDisplay)
            return null;
        const appDisplay = controls.appDisplay;
        return appDisplay._grid ?? null;
    }

    _getAppDisplay() {
        const overview = Main.overview;
        if (!overview || !overview._overview)
            return null;
        const controls = overview._overview._controls;
        if (!controls || !controls.appDisplay)
            return null;
        return controls.appDisplay;
    }

    _consolidatePages(lm) {
        let modified = false;
        let i = 0;
        while (i + 1 < lm._pages.length) {
            const itemsPerPage = lm.columns_per_page * lm.rows_per_page;
            const nCurrent = lm._pages[i].visibleChildren.length;

            if (nCurrent >= itemsPerPage) {
                i++;
                continue;
            }

            const nNext = lm._pages[i + 1]?.visibleChildren.length ?? 0;
            if (nNext === 0) {
                i++;
                continue;
            }

            lm._fillItemVacancies(i);
            modified = true;
        }
        return modified;
    }

    /* Reset cached page size so that adaptToSize() re-runs
     * _findBestIconSize() even if the allocation box didn't change. */
    _forceRelayout(grid) {
        const lm = grid.layout_manager;
        const iconSize = lm._findBestIconSize();
        if (lm._iconSize !== iconSize) {
            lm._iconSize = iconSize;
            if (lm._container) {
                for (const child of lm._container)
                    child.icon?.setIconSize(iconSize);
            }
        }
        lm._pageWidth = 0;
        lm._pageHeight = 0;
        grid.queue_relayout();
    }
}
