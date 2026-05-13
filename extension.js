import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const DEFAULT_ICON_SIZE = 96;
const DEFAULT_GRID_ROWS = 6;
const DEFAULT_GRID_COLUMNS = 9;
const DEFAULT_GAP = 12;
const TILE_PADDING = 24;
const UNCONSTRAINED_SPACING = -1;
const MIN_GRID_DIMENSION = 2;
const EFFECTIVE_WIDTH_RATIO = 2 / 3;

const SETTINGS_KEYS = [
    'use-presets', 'preset-level',
    'custom-icon-size', 'custom-rows', 'custom-columns',
    'custom-row-spacing', 'custom-column-spacing',
];

const ENFORCED_PROPERTIES = [
    'row-spacing', 'column-spacing',
    'max-row-spacing', 'max-column-spacing',
    'page-valign', 'page-halign',
];

function recommendGrid(iconSize) {
    const scale = DEFAULT_ICON_SIZE / iconSize;
    const gap = Math.round(DEFAULT_GAP / scale);
    return {
        rows: Math.max(MIN_GRID_DIMENSION, Math.floor(DEFAULT_GRID_ROWS * scale)),
        columns: Math.max(MIN_GRID_DIMENSION, Math.floor(DEFAULT_GRID_COLUMNS * scale)),
        gap,
    };
}

const PRESETS = [96, 64, 48, 32].map(iconSize => ({
    iconSize,
    ...recommendGrid(iconSize),
}));

export default class AppGridSizeExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._resetState();
        this._connectSettings();
        this._apply();
        this._overviewShowId =
            Main.overview.connect('showing', () => this._apply());
    }

    disable() {
        this._disconnectOverview();
        this._disconnectSettings();
        this._disconnectEnforcers();
        this._restoreOriginalLayout();
        this._resetState();
    }

    _resetState() {
        this._original = null;
        this._applied = false;
        this._rowGap = 0;
        this._colGap = 0;
        this._notifyIds = [];
        this._sigIds = [];
    }

    _connectSettings() {
        const cb = this._apply.bind(this);
        for (const key of SETTINGS_KEYS)
            this._sigIds.push(this._settings.connect(`changed::${key}`, cb));
    }

    _disconnectOverview() {
        if (this._overviewShowId) {
            Main.overview.disconnect(this._overviewShowId);
            this._overviewShowId = 0;
        }
    }

    _disconnectSettings() {
        if (this._sigIds) {
            for (const id of this._sigIds)
                this._settings.disconnect(id);
        }
        this._sigIds = [];
        this._settings = null;
    }

    _disconnectEnforcers() {
        for (const entry of this._notifyIds)
            entry.layoutManager.disconnect(entry.signal);
        this._notifyIds = [];
    }

    _getControlsManager() {
        return Main.overview?._overview?._controls ?? null;
    }

    _findGrid() {
        return this._getControlsManager()?.appDisplay?._grid ?? null;
    }

    _getAppDisplay() {
        return this._getControlsManager()?.appDisplay ?? null;
    }

    _saveOriginalValues(lm, grid) {
        if (this._original)
            return;
        this._original = {
            iconSize: lm.fixed_icon_size,
            rowSpacing: lm.row_spacing,
            columnSpacing: lm.column_spacing,
            maxRowSpacing: lm.max_row_spacing,
            maxColumnSpacing: lm.max_column_spacing,
            pageValign: lm.page_valign,
            pageHalign: lm.page_halign,
            modes: grid._gridModes.map(m => ({rows: m.rows, columns: m.columns})),
        };
    }

    _readGridConfig() {
        if (this._settings.get_boolean('use-presets')) {
            const preset = PRESETS[this._settings.get_int('preset-level')];
            return {
                iconSize: preset.iconSize,
                rows: preset.rows,
                columns: preset.columns,
                rowGap: preset.gap,
                colGap: preset.gap,
                autoFit: true,
            };
        }
        return {
            iconSize: this._settings.get_int('custom-icon-size'),
            rows: this._settings.get_int('custom-rows'),
            columns: this._settings.get_int('custom-columns'),
            rowGap: this._settings.get_int('custom-row-spacing'),
            colGap: this._settings.get_int('custom-column-spacing'),
            autoFit: false,
        };
    }

    _computeAutoFit(grid, lm, config) {
        const alloc = grid.get_allocation_box();
        const boxW = alloc.x2 - alloc.x1;
        const boxH = alloc.y2 - alloc.y1;
        if (boxW <= 0 || boxH <= 0)
            return config;

        const {rowGap, colGap, iconSize} = config;
        const p = lm.page_padding;
        const availW = boxW - p.left - p.right;
        const availH = boxH - p.top - p.bottom;
        const cellSize = iconSize + TILE_PADDING;
        const effectiveW = Math.round(availW * EFFECTIVE_WIDTH_RATIO);

        return {
            ...config,
            columns: Math.max(MIN_GRID_DIMENSION,
                Math.floor((effectiveW + colGap) / (cellSize + colGap))),
            rows: Math.max(MIN_GRID_DIMENSION,
                Math.floor((availH + rowGap) / (cellSize + rowGap))),
        };
    }

    _applyLayout(grid, lm, config) {
        lm.fixed_icon_size = config.iconSize;
        grid._currentMode = -1;
        grid.setGridModes([{rows: config.rows, columns: config.columns}]);
        lm.rows_per_page = config.rows;
        lm.columns_per_page = config.columns;
        lm.row_spacing = config.rowGap;
        lm.column_spacing = config.colGap;
        lm.max_row_spacing = UNCONSTRAINED_SPACING;
        lm.max_column_spacing = UNCONSTRAINED_SPACING;
        lm.page_valign = Clutter.ActorAlign.START;
        lm.page_halign = Clutter.ActorAlign.CENTER;
    }

    _setupEnforcers(lm) {
        if (this._notifyIds.length > 0)
            return;

        const enforce = () => {
            const curLm = this._findGrid()?.layout_manager;
            if (!curLm)
                return;
            if (curLm.row_spacing !== this._rowGap)
                curLm.row_spacing = this._rowGap;
            if (curLm.column_spacing !== this._colGap)
                curLm.column_spacing = this._colGap;
            if (curLm.max_row_spacing !== UNCONSTRAINED_SPACING)
                curLm.max_row_spacing = UNCONSTRAINED_SPACING;
            if (curLm.max_column_spacing !== UNCONSTRAINED_SPACING)
                curLm.max_column_spacing = UNCONSTRAINED_SPACING;
            if (curLm.page_valign !== Clutter.ActorAlign.START)
                curLm.page_valign = Clutter.ActorAlign.START;
            if (curLm.page_halign !== Clutter.ActorAlign.CENTER)
                curLm.page_halign = Clutter.ActorAlign.CENTER;
        };

        for (const prop of ENFORCED_PROPERTIES)
            this._notifyIds.push({
                layoutManager: lm,
                signal: lm.connect(`notify::${prop}`, enforce),
            });
    }

    _apply() {
        const grid = this._findGrid();
        if (!grid) {
            log('[appgrid-size] grid not found');
            return;
        }

        const lm = grid.layout_manager;
        this._saveOriginalValues(lm, grid);

        let config = this._readGridConfig();
        if (config.autoFit)
            config = this._computeAutoFit(grid, lm, config);

        this._applyLayout(grid, lm, config);

        this._rowGap = config.rowGap;
        this._colGap = config.colGap;

        this._setupEnforcers(lm);

        if (this._consolidatePages(lm)) {
            const appDisplay = this._getAppDisplay();
            if (appDisplay)
                try { appDisplay._savePages(); } catch (_e) {}
        }

        this._applied = true;
        this._forceRelayout(grid);
    }

    _restoreOriginalLayout() {
        if (!this._applied || !this._original)
            return;

        const grid = this._findGrid();
        if (!grid)
            return;

        const lm = grid.layout_manager;
        const o = this._original;
        lm.fixed_icon_size = o.iconSize;
        grid.setGridModes(o.modes);
        lm.row_spacing = o.rowSpacing;
        lm.column_spacing = o.columnSpacing;
        lm.max_row_spacing = o.maxRowSpacing;
        lm.max_column_spacing = o.maxColumnSpacing;
        lm.page_valign = o.pageValign;
        lm.page_halign = o.pageHalign;
        this._forceRelayout(grid);
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
