import Clutter from 'gi://Clutter'
import GLib from 'gi://GLib'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js'

import {
    PRESETS,
    PRESET_WIDTH_RATIO,
    PREVIEW_LAYOUT_KEY,
    SETTINGS_KEYS,
    UNCONSTRAINED_SPACING,
    computeGridFit,
    computePreviewTileSize,
} from './config.js'
import {reflowPages, restorePersistedPageOrder} from './gridPages.js'

const ENFORCED_PROPERTIES = [
    'row-spacing', 'column-spacing',
    'max-row-spacing', 'max-column-spacing',
    'page-valign', 'page-halign',
]

export default class AppGridSizeExtension extends Extension {
    enable() {
        this._resetState()
        this._settings = this.getSettings()
        this._connectSettings()
        this._overviewShowId =
            Main.overview.connect('showing', () => this._apply())
        this._overviewShownId = Main.overview.connect('shown', () => {
            const grid = this._findGrid()
            if (grid)
                this._publishPreviewLayout(grid, true)
        })
        this._monitorsChangedId = Main.layoutManager.connect(
            'monitors-changed', () => this._onMonitorsChanged())
        this._apply()
    }

    disable() {
        this._cancelScheduledApply()
        this._disconnectOverview()
        this._disconnectMonitorsChanged()
        this._disconnectSettings()
        this._disconnectGridBindings()
        this._restoreOriginalLayout()
        this._resetState()
    }

    _resetState() {
        this._settings = null
        this._original = null
        this._activeConfig = null
        this._applied = false
        this._notifyIds = []
        this._sigIds = []
        this._overviewShowId = 0
        this._overviewShownId = 0
        this._monitorsChangedId = 0
        this._allocationId = 0
        this._allocationGrid = null
        this._enforcerLayoutManager = null
        this._restoredOrderLayoutManager = null
        this._lastAllocation = null
        this._scheduledApplyId = 0
    }

    _connectSettings() {
        for (const key of SETTINGS_KEYS) {
            this._sigIds.push(this._settings.connect(
                `changed::${key}`, () => this._apply()))
        }
    }

    _disconnectOverview() {
        if (this._overviewShowId)
            Main.overview.disconnect(this._overviewShowId)
        if (this._overviewShownId)
            Main.overview.disconnect(this._overviewShownId)
        this._overviewShowId = 0
        this._overviewShownId = 0
    }

    _disconnectMonitorsChanged() {
        if (!this._monitorsChangedId)
            return
        Main.layoutManager.disconnect(this._monitorsChangedId)
        this._monitorsChangedId = 0
    }

    _disconnectSettings() {
        if (this._settings) {
            for (const id of this._sigIds)
                this._settings.disconnect(id)
        }
        this._sigIds = []
        this._settings = null
    }

    _disconnectGridBindings() {
        if (this._allocationGrid && this._allocationId)
            this._allocationGrid.disconnect(this._allocationId)
        this._allocationGrid = null
        this._allocationId = 0
        this._lastAllocation = null

        for (const {layoutManager, signal} of this._notifyIds)
            layoutManager.disconnect(signal)
        this._notifyIds = []
        this._enforcerLayoutManager = null
    }

    _cancelScheduledApply() {
        if (!this._scheduledApplyId)
            return
        GLib.source_remove(this._scheduledApplyId)
        this._scheduledApplyId = 0
    }

    _scheduleApply() {
        if (!this._settings || this._scheduledApplyId)
            return
        this._scheduledApplyId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._scheduledApplyId = 0
            this._apply()
            return GLib.SOURCE_REMOVE
        })
    }

    _onMonitorsChanged() {
        this._lastAllocation = null
        this._findGrid()?.queue_relayout()
        this._scheduleApply()
    }

    _getControlsManager() {
        return Main.overview?._overview?._controls ?? null
    }

    _findGrid() {
        return this._getControlsManager()?.appDisplay?._grid ?? null
    }

    _getAppDisplay() {
        return this._getControlsManager()?.appDisplay ?? null
    }

    _getAllocationSize(grid) {
        const box = grid.get_allocation_box()
        return {
            width: box.x2 - box.x1,
            height: box.y2 - box.y1,
        }
    }

    _setupAllocationWatcher(grid) {
        if (this._allocationGrid === grid)
            return

        this._disconnectGridBindings()
        this._allocationGrid = grid
        this._lastAllocation = this._getAllocationSize(grid)
        this._allocationId = grid.connect('notify::allocation', () => {
            const allocation = this._getAllocationSize(grid)
            if (allocation.width <= 0 || allocation.height <= 0)
                return
            if (Main.overview.visible)
                this._publishPreviewLayout(grid, true)
            if (this._lastAllocation?.width === allocation.width &&
                this._lastAllocation?.height === allocation.height)
                return
            this._lastAllocation = allocation
            this._scheduleApply()
        })
    }

    _measureActor(actor, monitor) {
        if (!actor || typeof actor.get_transformed_position !== 'function' ||
            typeof actor.get_transformed_size !== 'function')
            return null
        try {
            const [x, y] = actor.get_transformed_position()
            const [width, height] = actor.get_transformed_size()
            if (![x, y, width, height].every(Number.isFinite) ||
                width <= 0 || height <= 0)
                return null
            return {
                x: Math.round(x - monitor.x),
                y: Math.round(y - monitor.y),
                width: Math.round(width),
                height: Math.round(height),
            }
        } catch (_error) {
            return null
        }
    }

    _firstMeasuredActor(actors, monitor) {
        for (const actor of actors) {
            const rect = this._measureActor(actor, monitor)
            if (rect)
                return rect
        }
        return null
    }

    _getPreviewItemId(actor) {
        const app = actor?.app ?? actor?.icon?.app
        const id = app?.get_id?.() ?? actor?._folderId ??
            actor?.folderId ?? actor?._id ?? actor?.id
        return typeof id === 'string' && id ? id : null
    }

    _measureWorkspaceActors(controls, monitor) {
        const views = controls?._workspacesDisplay?._workspacesViews
        if (!Array.isArray(views))
            return []
        const primaryIndex = Main.layoutManager.primaryIndex ?? 0
        const view = views.find(candidate =>
            candidate?._monitorIndex === primaryIndex) ?? views[primaryIndex] ?? views[0]
        const workspaces = view?._workspaces
        if (!Array.isArray(workspaces))
            return []
        return workspaces
            .map(actor => this._measureActor(actor, monitor))
            .filter(rect => rect && rect.width < monitor.width * 0.8 &&
                rect.height < monitor.height * 0.5)
    }

    _measurePreferredTileSize(lm) {
        let tileSize = 0
        for (const page of lm._pages ?? []) {
            for (const actor of page.visibleChildren ?? []) {
                try {
                    const minWidth = actor.get_preferred_width(-1)[0]
                    const minHeight = actor.get_preferred_height(-1)[0]
                    if (Number.isFinite(minWidth) && Number.isFinite(minHeight))
                        tileSize = Math.max(tileSize, minWidth, minHeight)
                } catch (_error) {}
            }
        }
        return tileSize > 0 ? Math.ceil(tileSize) : null
    }

    _syncIconSize(lm) {
        let iconSize = lm.fixed_icon_size
        if (typeof lm._findBestIconSize === 'function')
            iconSize = lm._findBestIconSize()
        if (!Number.isFinite(iconSize) || iconSize < 0)
            return
        if (lm._iconSize !== iconSize) {
            lm._iconSize = iconSize
            if (lm._container) {
                for (const child of lm._container)
                    child.icon?.setIconSize(iconSize)
            }
        }
        if ('_childrenMaxSize' in lm)
            lm._childrenMaxSize = -1
    }

    _publishPreviewLayout(grid, settled = false) {
        if (!this._settings)
            return

        const lm = grid.layout_manager
        const tileSize = this._measurePreferredTileSize(lm)
        if (this._activeConfig && tileSize &&
            this._activeConfig.tileSize !== tileSize) {
            this._activeConfig.tileSize = tileSize
            this._scheduleApply()
        }
        const monitor = Main.layoutManager.primaryMonitor
        const {width, height} = this._getAllocationSize(grid)
        if (!monitor || width <= 0 || height <= 0)
            return

        let x = 0
        let y = 0
        try {
            [x, y] = grid.get_transformed_position()
            x -= monitor.x
            y -= monitor.y
        } catch (_error) {}

        const pageIndex = Number.isInteger(grid.currentPage)
            ? grid.currentPage
            : 0
        const itemCount = lm._pages?.[pageIndex]?.visibleChildren?.length ?? 0
        const padding = lm.page_padding
        const controls = this._getControlsManager()
        const pageItems = lm._pages?.[pageIndex]?.visibleChildren ?? []
        const items = pageItems.map(actor => ({
            id: this._getPreviewItemId(actor),
            tile: this._measureActor(actor, monitor),
            icon: this._firstMeasuredActor([
                actor?.icon?.icon,
                actor?.icon?._icon,
                actor?.icon,
            ], monitor),
            folder: actor?.constructor?.name?.includes('Folder') ?? false,
        })).filter(item => item.tile)
        const dash = controls?.dash ?? controls?._dash
        const dashBox = dash?._box
        const dashChildren = dashBox?.get_children?.() ?? []
        let dashIconActors = dashChildren.filter(actor =>
            actor?.child?._delegate?.icon && !actor.animatingOut)
        if (!dashIconActors.length)
            dashIconActors = dashChildren
        if (dash?._showAppsIcon && !dashIconActors.includes(dash._showAppsIcon))
            dashIconActors.push(dash._showAppsIcon)
        const dashItems = dashIconActors
            .map(actor => this._firstMeasuredActor([
                actor?.child?._delegate?.icon?.icon,
                actor?.child?._delegate?.icon,
                actor?.icon?.icon,
                actor?.icon,
                actor,
            ], monitor))
            .filter(rect => rect && rect.width > 2 && rect.height > 2) ?? []
        const layout = JSON.stringify({
            version: 2,
            monitor: {width: monitor.width, height: monitor.height},
            grid: {
                x: Math.round(x),
                y: Math.round(y),
                width: Math.round(width),
                height: Math.round(height),
                paddingTop: Math.round(padding.top),
                paddingRight: Math.round(padding.right),
                paddingBottom: Math.round(padding.bottom),
                paddingLeft: Math.round(padding.left),
            },
            itemCount,
            pageItemCounts: lm._pages?.map(page =>
                page.visibleChildren?.length ?? 0) ?? [itemCount],
            pageCount: lm._pages?.length ?? 1,
            currentPage: pageIndex,
            settled,
            config: this._activeConfig ? {
                iconSize: this._activeConfig.iconSize,
                rows: this._activeConfig.rows,
                columns: this._activeConfig.columns,
                rowGap: this._activeConfig.rowGap,
                columnGap: this._activeConfig.columnGap,
                ...(Number.isFinite(this._activeConfig.tileSize)
                    ? {tileSize: this._activeConfig.tileSize}
                    : {}),
                consolidate: this._activeConfig.consolidate,
            } : null,
            items,
            panelRect: this._measureActor(Main.panel, monitor),
            searchRect: this._firstMeasuredActor([
                controls?.searchEntry,
                controls?._searchEntry,
                controls?._searchEntryBin?.child,
            ], monitor),
            workspaceRects: this._measureWorkspaceActors(controls, monitor),
            workspaceCount: global.workspace_manager?.n_workspaces ?? 2,
            dashRect: this._firstMeasuredActor([
                dash?._background,
                dashBox,
                dash,
            ], monitor),
            dashItems,
        })
        if (this._settings.get_string(PREVIEW_LAYOUT_KEY) !== layout)
            this._settings.set_string(PREVIEW_LAYOUT_KEY, layout)
    }

    _saveOriginalValues(lm, grid) {
        if (this._original?.layoutManager === lm)
            return
        if (!Array.isArray(grid._gridModes))
            throw new Error('AppGrid grid modes are unavailable')
        this._original = {
            layoutManager: lm,
            iconSize: lm.fixed_icon_size,
            rows: lm.rows_per_page,
            columns: lm.columns_per_page,
            rowSpacing: lm.row_spacing,
            columnSpacing: lm.column_spacing,
            maxRowSpacing: lm.max_row_spacing,
            maxColumnSpacing: lm.max_column_spacing,
            pageValign: lm.page_valign,
            pageHalign: lm.page_halign,
            modes: grid._gridModes.map(m => ({rows: m.rows, columns: m.columns})),
        }
    }

    _readGridConfig() {
        if (this._settings.get_boolean('use-presets')) {
            const preset = PRESETS[this._settings.get_int('preset-level')]
            return {
                iconSize: preset.iconSize,
                rows: preset.rows,
                columns: preset.columns,
                rowGap: preset.gap,
                columnGap: preset.gap,
                autoFit: true,
            }
        }
        return {
            iconSize: this._settings.get_int('custom-icon-size'),
            rows: this._settings.get_int('custom-rows'),
            columns: this._settings.get_int('custom-columns'),
            rowGap: this._settings.get_int('custom-row-spacing'),
            columnGap: this._settings.get_int('custom-column-spacing'),
            autoFit: false,
        }
    }

    _computeAutoFit(grid, lm, config) {
        const {width, height} = this._getAllocationSize(grid)
        if (width <= 0 || height <= 0)
            return config

        this._lastAllocation = {width, height}
        const padding = lm.page_padding
        const fit = computeGridFit({
            width: width - padding.left - padding.right,
            height: height - padding.top - padding.bottom,
            iconSize: config.iconSize,
            tileSize: config.tileSize,
            rowGap: config.rowGap,
            columnGap: config.columnGap,
            widthRatio: PRESET_WIDTH_RATIO,
        })
        return {...config, rows: fit.rows, columns: fit.columns}
    }

    _applyLayout(grid, lm, config) {
        lm.fixed_icon_size = config.iconSize
        grid._currentMode = -1
        grid.setGridModes([{rows: config.rows, columns: config.columns}])
        lm.rows_per_page = config.rows
        lm.columns_per_page = config.columns
        lm.row_spacing = config.rowGap
        lm.column_spacing = config.columnGap
        lm.max_row_spacing = UNCONSTRAINED_SPACING
        lm.max_column_spacing = UNCONSTRAINED_SPACING
        lm.page_valign = Clutter.ActorAlign.START
        lm.page_halign = Clutter.ActorAlign.CENTER
    }

    _setupEnforcers(lm) {
        if (this._enforcerLayoutManager === lm)
            return

        for (const {layoutManager, signal} of this._notifyIds)
            layoutManager.disconnect(signal)
        this._notifyIds = []
        this._enforcerLayoutManager = lm

        const enforce = () => {
            const curLm = this._findGrid()?.layout_manager
            const config = this._activeConfig
            if (!curLm || !config)
                return
            if (curLm.row_spacing !== config.rowGap)
                curLm.row_spacing = config.rowGap
            if (curLm.column_spacing !== config.columnGap)
                curLm.column_spacing = config.columnGap
            if (curLm.max_row_spacing !== UNCONSTRAINED_SPACING)
                curLm.max_row_spacing = UNCONSTRAINED_SPACING
            if (curLm.max_column_spacing !== UNCONSTRAINED_SPACING)
                curLm.max_column_spacing = UNCONSTRAINED_SPACING
            if (curLm.page_valign !== Clutter.ActorAlign.START)
                curLm.page_valign = Clutter.ActorAlign.START
            if (curLm.page_halign !== Clutter.ActorAlign.CENTER)
                curLm.page_halign = Clutter.ActorAlign.CENTER
        }

        for (const prop of ENFORCED_PROPERTIES) {
            this._notifyIds.push({
                layoutManager: lm,
                signal: lm.connect(`notify::${prop}`, enforce),
            })
        }
    }

    _apply() {
        if (!this._settings)
            return

        const grid = this._findGrid()
        if (!grid?.layout_manager || typeof grid.setGridModes !== 'function') {
            console.warn('[appgrid-size] compatible AppGrid not found')
            return
        }

        const lm = grid.layout_manager
        try {
            this._setupAllocationWatcher(grid)
            this._saveOriginalValues(lm, grid)
            this._applied = true

            let config = this._readGridConfig()
            lm.fixed_icon_size = config.iconSize
            this._syncIconSize(lm)
            config = {
                ...config,
                tileSize: this._measurePreferredTileSize(lm) ??
                    computePreviewTileSize(config.iconSize),
            }
            if (config.autoFit)
                config = this._computeAutoFit(grid, lm, config)

            const consolidate = this._settings.get_boolean('consolidate-pages')
            this._activeConfig = {...config, consolidate}
            this._applyLayout(grid, lm, config)
            this._setupEnforcers(lm)

            if (this._restoredOrderLayoutManager !== lm &&
                restorePersistedPageOrder(this._getAppDisplay(), lm))
                this._restoredOrderLayoutManager = lm

            const pagesChanged = reflowPages(lm, {
                consolidate,
                warn: message => console.warn(`[appgrid-size] ${message}`),
            })
            if (consolidate && pagesChanged)
                this._savePages()

            this._forceRelayout(grid)
            this._publishPreviewLayout(grid)
        } catch (error) {
            this._disconnectGridBindings()
            this._restoreOriginalLayout()
            this._applied = false
            logError(error, '[appgrid-size] failed to apply grid layout')
        }
    }

    _savePages() {
        const appDisplay = this._getAppDisplay()
        if (typeof appDisplay?._savePages !== 'function') {
            console.warn('[appgrid-size] page persistence is unavailable')
            return
        }
        try {
            appDisplay._savePages()
        } catch (error) {
            logError(error, '[appgrid-size] failed to save app pages')
        }
    }

    _restoreOriginalLayout() {
        if (!this._applied || !this._original)
            return

        const grid = this._findGrid()
        if (!grid)
            return

        const lm = grid.layout_manager
        const original = this._original
        if (original.layoutManager !== lm)
            return

        lm.fixed_icon_size = original.iconSize
        grid._currentMode = -1
        grid.setGridModes(original.modes)
        lm.rows_per_page = original.rows
        lm.columns_per_page = original.columns
        lm.row_spacing = original.rowSpacing
        lm.column_spacing = original.columnSpacing
        lm.max_row_spacing = original.maxRowSpacing
        lm.max_column_spacing = original.maxColumnSpacing
        lm.page_valign = original.pageValign
        lm.page_halign = original.pageHalign
        reflowPages(lm, {
            warn: message => console.warn(`[appgrid-size] ${message}`),
        })
        this._forceRelayout(grid)
    }

    _forceRelayout(grid) {
        const lm = grid.layout_manager
        this._syncIconSize(lm)
        lm._pageWidth = 0
        lm._pageHeight = 0
        grid.queue_relayout()
    }
}
