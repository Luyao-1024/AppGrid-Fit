import Clutter from 'gi://Clutter'
import GLib from 'gi://GLib'
import St from 'gi://St'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js'

import {
    FOLDER_DIALOG_PAGE_PADDING,
    PRESETS,
    PRESET_WIDTH_RATIO,
    PREVIEW_LAYOUT_KEY,
    SETTINGS_KEYS,
    UNCONSTRAINED_SPACING,
    computeGridFit,
    computePreviewTileSize,
    readFolderConfig,
} from './config.js'
import {
    reflowPages,
    restorePersistedPageOrder,
    syncPageManagerPages,
} from './gridPages.js'
import {
    applyAppNameVisibility,
    applyFolderDialogSize,
    applyFolderDialogSizes,
    applyFolderLayouts,
    enforceFolderPagePadding,
    getFolderGrids,
    getGridLayoutMode,
    readThemeSpacing,
    restoreAppNameVisibility,
    restoreFolderLayouts,
    restoreGridLayout,
    saveGridLayout,
    setGridDimensions,
} from './gridLayout.js'

const ENFORCED_PROPERTIES = [
    'row-spacing', 'column-spacing',
    'max-row-spacing', 'max-column-spacing',
    'page-valign', 'page-halign',
]

const SETTLE_PUBLISH_DELAY_MS = 600

export default class AppGridSizeExtension extends Extension {
    enable() {
        this._resetState()
        this._settings = this.getSettings()
        this._connectSettings()
        this._connectTheme()
        this._overviewShowId =
            Main.overview.connect('showing', () => {
                this._overviewShowing = true
                this._cancelSettledPublish()
                this._overviewShown = false
                this._apply()
            })
        this._overviewShownId = Main.overview.connect('shown', () => {
            this._overviewShowing = false
            this._applyFolderLayouts()
            this._applyAppNameVisibility()
            this._scheduleSettledPublish()
        })
        this._overviewHidingId =
            Main.overview.connect('hiding', () => {
                this._overviewShowing = false
                this._cancelSettledPublish()
                this._overviewShown = false
            })
        this._monitorsChangedId = Main.layoutManager.connect(
            'monitors-changed', () => this._onMonitorsChanged())
        this._apply()
    }

    disable() {
        this._cancelScheduledApply()
        this._cancelFolderDialogSize()
        this._disconnectOverview()
        this._disconnectMonitorsChanged()
        this._disconnectTheme()
        this._disconnectSettings()
        this._disconnectGridBindings()
        this._restoreOriginalLayout()
        this._resetState()
    }

    _resetState() {
        this._settings = null
        this._original = null
        this._originalFolders = new Map()
        this._originalFolderDialogs = new WeakMap()
        this._originalLabels = new Map()
        this._folderPagePadding = null
        this._folderEnforcerIds = new Map()
        this._folderSignalIds = new Map()
        this._folderOpenOriginals = new Map()
        this._activeConfig = null
        this._applied = false
        this._notifyIds = []
        this._sigIds = []
        this._overviewShowId = 0
        this._overviewShownId = 0
        this._overviewHidingId = 0
        this._overviewShown = false
        this._overviewShowing = false
        this._settlePublishId = 0
        this._monitorsChangedId = 0
        this._allocationId = 0
        this._allocationGrid = null
        this._enforcerLayoutManager = null
        this._restoredOrderLayoutManager = null
        this._lastAllocation = null
        this._scheduledApplyId = 0
        this._dialogSizeId = 0
        this._themeContext = null
        this._themeChangedId = 0
        this._themeChanged = false
        this._warnedMessages = new Set()
    }

    _connectSettings() {
        for (const key of SETTINGS_KEYS) {
            this._sigIds.push(this._settings.connect(
                `changed::${key}`, () => this._scheduleApply()))
        }
    }

    _connectTheme() {
        this._themeContext = St.ThemeContext.get_for_stage(global.stage)
        this._themeChangedId = this._themeContext.connect('changed', () => {
            this._themeChanged = true
            this._scheduleApply()
        })
    }

    _disconnectTheme() {
        if (this._themeContext && this._themeChangedId)
            this._themeContext.disconnect(this._themeChangedId)
        this._themeContext = null
        this._themeChangedId = 0
    }

    _warnOnce(message) {
        if (this._warnedMessages.has(message))
            return
        this._warnedMessages.add(message)
        console.warn(`[appgrid-size] ${message}`)
    }

    _disconnectOverview() {
        this._cancelSettledPublish()
        if (this._overviewShowId)
            Main.overview.disconnect(this._overviewShowId)
        if (this._overviewShownId)
            Main.overview.disconnect(this._overviewShownId)
        if (this._overviewHidingId)
            Main.overview.disconnect(this._overviewHidingId)
        this._overviewShowId = 0
        this._overviewShownId = 0
        this._overviewHidingId = 0
        this._overviewShown = false
        this._overviewShowing = false
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
        this._disconnectFolderSignals()
        this._disconnectFolderEnforcers()
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

    _cancelFolderDialogSize() {
        if (!this._dialogSizeId)
            return
        GLib.source_remove(this._dialogSizeId)
        this._dialogSizeId = 0
    }

    _scheduleFolderDialogSize() {
        if (!this._settings || this._dialogSizeId)
            return
        this._dialogSizeId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._dialogSizeId = 0
            if (this._applied && this._activeConfig) {
                applyFolderDialogSizes(this._getAppDisplay(),
                    this._folderDialogConfig(), this._originalFolderDialogs,
                    this._originalFolders)
            }
            return GLib.SOURCE_REMOVE
        })
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

    _cancelSettledPublish() {
        if (!this._settlePublishId)
            return
        GLib.source_remove(this._settlePublishId)
        this._settlePublishId = 0
    }

    _scheduleSettledPublish() {
        this._cancelSettledPublish()
        this._settlePublishId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, SETTLE_PUBLISH_DELAY_MS, () => {
                this._settlePublishId = 0
                if (!this._settings || !Main.overview.visible) {
                    this._overviewShown = false
                    return GLib.SOURCE_REMOVE
                }
                const grid = this._findGrid()
                if (!grid?.layout_manager)
                    return GLib.SOURCE_REMOVE
                this._overviewShown = true
                this._publishPreviewLayout(grid, true)
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
                this._publishPreviewLayout(grid, this._overviewShown)
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

    _syncIconSize(lm, fallbackSize = null) {
        let iconSize = lm.fixed_icon_size
        if (typeof lm._findBestIconSize === 'function')
            iconSize = lm._findBestIconSize()
        else if ((!Number.isFinite(iconSize) || iconSize < 0) &&
            Number.isFinite(fallbackSize) && fallbackSize > 0)
            iconSize = fallbackSize
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

        const isSettled = settled || this._overviewShown
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
        const appDisplay = this._getAppDisplay()
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
            settled: isSettled,
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
            pageIndicatorRect: this._measureActor(
                appDisplay?._pageIndicators, monitor),
            dashRect: this._firstMeasuredActor([
                dash?._background,
                dashBox,
                dash,
            ], monitor),
            dashVisible: dash?.visible ?? false,
            dashItems,
            diagnostics: {
                mode: getGridLayoutMode(grid),
                hasSetGridModes: typeof grid.setGridModes === 'function',
                hasGridModes: Array.isArray(grid._gridModes),
                hasAdaptToSize: typeof lm.adaptToSize === 'function',
                hasFixedRows: Object.hasOwn(lm, '_fixedRows'),
                hasFixedColumns: Object.hasOwn(lm, '_fixedCols'),
                rows: lm.rows_per_page ?? null,
                columns: lm.columns_per_page ?? null,
                fixedIconSize: lm.fixed_icon_size ?? null,
                iconSize: lm._iconSize ?? null,
                rowSpacing: lm.row_spacing ?? null,
                columnSpacing: lm.column_spacing ?? null,
                maxRowSpacing: lm.max_row_spacing ?? null,
                maxColumnSpacing: lm.max_column_spacing ?? null,
                pageValign: lm.page_valign ?? null,
                pageHalign: lm.page_halign ?? null,
            },
        })
        if (this._settings.get_string(PREVIEW_LAYOUT_KEY) !== layout)
            this._settings.set_string(PREVIEW_LAYOUT_KEY, layout)
    }

    _saveOriginalValues(lm, grid) {
        if (this._original?.layoutManager === lm)
            return
        grid.ensure_style()
        this._original = {
            layoutManager: lm,
            iconSize: lm.fixed_icon_size,
            effectiveIconSize: lm._iconSize,
            rows: lm.rows_per_page,
            columns: lm.columns_per_page,
            rowSpacing: lm.row_spacing,
            columnSpacing: lm.column_spacing,
            maxRowSpacing: lm.max_row_spacing,
            maxColumnSpacing: lm.max_column_spacing,
            pageValign: lm.page_valign,
            pageHalign: lm.page_halign,
            layout: saveGridLayout(grid),
        }
    }

    _captureThemeDefaults(grid) {
        const original = this._original
        if (!original || original.layoutManager !== grid.layout_manager)
            return

        grid.ensure_style()
        const spacing = readThemeSpacing(grid.get_theme_node())
        if (!spacing)
            return

        // Ubuntu's adaptive layout derives row/column spacing from the
        // effective icon size instead of CSS; only its limits are themed.
        if (getGridLayoutMode(grid) !== 'adaptive') {
            original.rowSpacing = spacing.rowSpacing
            original.columnSpacing = spacing.columnSpacing
        }
        original.maxRowSpacing = spacing.maxRowSpacing
        original.maxColumnSpacing = spacing.maxColumnSpacing
    }

    _readGridConfig() {
        const folder = readFolderConfig(this._settings)
        const folderConfig = {
            folderRows: folder.rows,
            folderColumns: folder.columns,
            folderRowSpacing: folder.rowSpacing,
            folderColumnSpacing: folder.columnSpacing,
            showNames: folder.showNames,
        }
        if (this._settings.get_boolean('use-presets')) {
            const preset = PRESETS[this._settings.get_int('preset-level')]
            return {
                iconSize: preset.iconSize,
                rows: preset.rows,
                columns: preset.columns,
                rowGap: preset.gap,
                columnGap: preset.gap,
                autoFit: true,
                ...folderConfig,
            }
        }
        return {
            iconSize: this._settings.get_int('custom-icon-size'),
            rows: this._settings.get_int('custom-rows'),
            columns: this._settings.get_int('custom-columns'),
            rowGap: this._settings.get_int('custom-row-spacing'),
            columnGap: this._settings.get_int('custom-column-spacing'),
            autoFit: false,
            ...folderConfig,
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
        setGridDimensions(grid, config.rows, config.columns)
        lm.row_spacing = config.rowGap
        lm.column_spacing = config.columnGap
        lm.max_row_spacing = UNCONSTRAINED_SPACING
        lm.max_column_spacing = UNCONSTRAINED_SPACING
        lm.page_valign = Clutter.ActorAlign.START
        lm.page_halign = Clutter.ActorAlign.CENTER
    }

    _folderDialogConfig() {
        const config = this._activeConfig
        if (!this._folderPagePadding) {
            const padding = FOLDER_DIALOG_PAGE_PADDING
            this._folderPagePadding = new Clutter.Margin({
                top: padding,
                right: padding,
                bottom: padding,
                left: padding,
            })
        }
        return {
            iconSize: config.iconSize,
            rows: config.folderRows,
            columns: config.folderColumns,
            rowSpacing: config.folderRowSpacing,
            columnSpacing: config.folderColumnSpacing,
            pagePadding: this._folderPagePadding,
        }
    }

    _applyFolderLayouts() {
        if (!this._applied || !this._activeConfig)
            return
        applyFolderLayouts(this._getAppDisplay(),
            this._folderDialogConfig(), this._originalFolders,
            this._originalFolderDialogs)
    }

    _applyAppNameVisibility() {
        if (!this._applied || !this._activeConfig)
            return
        applyAppNameVisibility(this._getAppDisplay(),
            this._activeConfig.showNames, this._originalLabels)
    }

    _restoreFolderLayouts() {
        this._disconnectFolderEnforcers()
        restoreFolderLayouts(this._getAppDisplay(), this._originalFolders,
            this._originalFolderDialogs)
    }

    _restoreAppNameVisibility() {
        restoreAppNameVisibility(this._getAppDisplay(), this._originalLabels)
    }

    _setupFolderEnforcers() {
        const grids = getFolderGrids(this._getAppDisplay())
        const active = new Set(grids.map(grid => grid.layout_manager))
        for (const [lm, ids] of this._folderEnforcerIds) {
            if (active.has(lm))
                continue
            for (const id of ids) {
                try {
                    lm.disconnect(id)
                } catch (_error) {}
            }
            this._folderEnforcerIds.delete(lm)
        }

        for (const lm of active) {
            if (this._folderEnforcerIds.has(lm))
                continue
            const ids = []
            for (const [property, key, desired] of [
                ['row-spacing', 'row_spacing',
                    () => this._activeConfig.folderRowSpacing],
                ['column-spacing', 'column_spacing',
                    () => this._activeConfig.folderColumnSpacing],
                ['max-row-spacing', 'max_row_spacing',
                    () => UNCONSTRAINED_SPACING],
                ['max-column-spacing', 'max_column_spacing',
                    () => UNCONSTRAINED_SPACING],
            ]) {
                if (!(property in lm))
                    continue
                ids.push(lm.connect(`notify::${property}`, () => {
                    if (!this._applied || !this._activeConfig)
                        return
                    const value = desired()
                    if (lm[key] !== value)
                        lm[key] = value
                }))
            }
            if ('page-padding' in lm || 'page_padding' in lm) {
                ids.push(lm.connect('notify::page-padding', () => {
                    if (!this._applied || !this._activeConfig)
                        return
                    enforceFolderPagePadding(lm,
                        this._folderDialogConfig().pagePadding)
                }))
            }
            this._folderEnforcerIds.set(lm, ids)
        }
    }

    _disconnectFolderEnforcers() {
        for (const [lm, ids] of this._folderEnforcerIds) {
            for (const id of ids) {
                try {
                    lm.disconnect(id)
                } catch (_error) {}
            }
        }
        this._folderEnforcerIds.clear()
    }

    _connectFolderSignals() {
        const icons = this._getAppDisplay()?._folderIcons
        if (!Array.isArray(icons))
            return
        for (const [icon, ids] of this._folderSignalIds) {
            if (icons.includes(icon))
                continue
            for (const id of ids) {
                try {
                    icon.disconnect(id)
                } catch (_error) {}
            }
            this._folderSignalIds.delete(icon)
            this._restoreFolderOpen(icon)
        }
        for (const icon of icons) {
            if (!icon || this._folderSignalIds.has(icon) ||
                typeof icon.connect !== 'function')
                continue
            const ids = []
            const extension = this
            try {
                ids.push(icon.connect('apps-changed',
                    () => this._scheduleApply()))
                ids.push(icon.connect('destroy', () => {
                    extension._folderSignalIds.delete(icon)
                    extension._folderOpenOriginals.delete(icon)
                }))
                this._patchFolderOpen(icon)
                const grid = icon.view?._grid
                if (grid && typeof grid.connect === 'function') {
                    ids.push(grid.connect('notify::allocation', () => {
                        if (icon._dialog?.visible)
                            extension._scheduleFolderDialogSize()
                    }))
                }
            } catch (_error) {}
            this._folderSignalIds.set(icon, ids)
        }
    }

    _patchFolderOpen(icon) {
        const open = icon.open
        if (typeof open !== 'function' ||
            this._folderOpenOriginals.has(icon))
            return
        const extension = this
        this._folderOpenOriginals.set(icon, open)
        icon.open = function (...args) {
            try {
                icon._ensureFolderDialog?.()
                applyFolderDialogSize(icon,
                    extension._folderDialogConfig(),
                    extension._originalFolderDialogs,
                    extension._originalFolders)
            } catch (_error) {}
            return open.apply(this, args)
        }
    }

    _restoreFolderOpen(icon) {
        const open = this._folderOpenOriginals.get(icon)
        if (!open)
            return
        this._folderOpenOriginals.delete(icon)
        try {
            if (icon.open !== open)
                icon.open = open
        } catch (_error) {}
    }

    _disconnectFolderSignals() {
        for (const [icon, ids] of this._folderSignalIds) {
            for (const id of ids) {
                try {
                    icon.disconnect(id)
                } catch (_error) {}
            }
        }
        for (const icon of this._folderOpenOriginals.keys())
            this._restoreFolderOpen(icon)
        this._folderSignalIds.clear()
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
        if (!grid?.layout_manager) {
            this._warnOnce('AppGrid not found')
            return
        }
        if (!getGridLayoutMode(grid)) {
            this._warnOnce('AppGrid layout API is unsupported')
            return
        }
        this._warnedMessages.clear()

        const lm = grid.layout_manager
        if (Main.overview.visible) {
            this._cancelSettledPublish()
            this._overviewShown = false
        }
        try {
            this._setupAllocationWatcher(grid)
            this._saveOriginalValues(lm, grid)
            if (this._themeChanged) {
                this._captureThemeDefaults(grid)
                this._themeChanged = false
            }
            this._applied = true

            let config = this._readGridConfig()
            lm.fixed_icon_size = config.iconSize
            applyAppNameVisibility(this._getAppDisplay(), config.showNames,
                this._originalLabels)
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
            this._applyFolderLayouts()
            this._setupFolderEnforcers()
            this._connectFolderSignals()
            this._setupEnforcers(lm)

            if (this._restoredOrderLayoutManager !== lm &&
                restorePersistedPageOrder(this._getAppDisplay(), lm))
                this._restoredOrderLayoutManager = lm

            const pagesChanged = reflowPages(lm, {
                consolidate,
                warn: message => console.warn(`[appgrid-size] ${message}`),
            })
            if (pagesChanged)
                syncPageManagerPages(this._getAppDisplay(), lm)
            if (consolidate && pagesChanged)
                this._savePages()

            this._forceRelayout(grid)
            this._publishPreviewLayout(grid)
            if (Main.overview.visible && !this._overviewShowing)
                this._scheduleSettledPublish()
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
        this._restoreFolderLayouts()
        this._restoreAppNameVisibility()
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
        restoreGridLayout(grid, original.layout)
        lm.rows_per_page = original.rows
        lm.columns_per_page = original.columns
        lm.row_spacing = original.rowSpacing
        lm.column_spacing = original.columnSpacing
        lm.max_row_spacing = original.maxRowSpacing
        lm.max_column_spacing = original.maxColumnSpacing
        lm.page_valign = original.pageValign
        lm.page_halign = original.pageHalign
        this._syncIconSize(lm, original.effectiveIconSize)
        reflowPages(lm, {
            warn: message => console.warn(`[appgrid-size] ${message}`),
        })
        syncPageManagerPages(this._getAppDisplay(), lm)
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
