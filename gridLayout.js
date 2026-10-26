import {FOLDER_DIALOG_PAGE_PADDING} from './config.js'

const FIXED_DIMENSIONS = ['_fixedRows', '_fixedCols']
const UNCONSTRAINED_SPACING = -1
const ALIGN_START = 1
const ALIGN_CENTER = 2
const FOLDER_DIALOG_BORDER_FALLBACK = 1
const FOLDER_DIALOG_TITLE_FALLBACK = 60
const FOLDER_TITLE_SIDE_INSET_FALLBACK = 36
const FOLDER_TITLE_BUTTON_FALLBACK = 40
const FOLDER_TITLE_FONT_FALLBACK = 26.666
const FOLDER_TITLE_BUTTON_FONT_FALLBACK = 14.666
const PANGO_SCALE = 1024
const FOLDER_PAGE_PADDING_FALLBACK = {
    top: FOLDER_DIALOG_PAGE_PADDING,
    right: FOLDER_DIALOG_PAGE_PADDING,
    bottom: FOLDER_DIALOG_PAGE_PADDING,
    left: FOLDER_DIALOG_PAGE_PADDING,
}

export function readThemeSpacing(node) {
    if (!node || typeof node.get_length !== 'function' ||
        typeof node.lookup_length !== 'function')
        return null

    const [hasMaxRowSpacing, maxRowSpacing] =
        node.lookup_length('max-row-spacing', false)
    const [hasMaxColumnSpacing, maxColumnSpacing] =
        node.lookup_length('max-column-spacing', false)

    return {
        rowSpacing: node.get_length('row-spacing'),
        columnSpacing: node.get_length('column-spacing'),
        maxRowSpacing: hasMaxRowSpacing ? maxRowSpacing : -1,
        maxColumnSpacing: hasMaxColumnSpacing ? maxColumnSpacing : -1,
    }
}

export function getGridLayoutMode(grid) {
    const lm = grid?.layout_manager
    if (!lm || !['fixed_icon_size', 'rows_per_page', 'columns_per_page']
        .every(property => property in lm))
        return null

    if (typeof grid.setGridModes === 'function' && Array.isArray(grid._gridModes))
        return 'modes'

    if (!('_gridModes' in grid) && typeof lm.adaptToSize === 'function' &&
        typeof lm._updatePages === 'function')
        return 'adaptive'

    return null
}

export function saveGridLayout(grid) {
    const mode = getGridLayoutMode(grid)
    if (mode === 'modes') {
        return {
            mode,
            modes: grid._gridModes.map(({rows, columns}) => ({rows, columns})),
        }
    }
    if (mode === 'adaptive') {
        const lm = grid.layout_manager
        return {
            mode,
            fixed: FIXED_DIMENSIONS.map(name => ({
                name,
                present: Object.hasOwn(lm, name),
                value: lm[name],
            })),
        }
    }
    throw new Error('AppGrid layout API is unsupported')
}

export function setGridDimensions(grid, rows, columns) {
    const mode = getGridLayoutMode(grid)
    const lm = grid.layout_manager
    if (mode === 'modes') {
        grid._currentMode = -1
        grid.setGridModes([{rows, columns}])
    } else if (mode === 'adaptive') {
        // Ubuntu's adaptToSize() recomputes dimensions unless both are pinned.
        lm._fixedRows = rows
        lm._fixedCols = columns
    } else {
        throw new Error('AppGrid layout API is unsupported')
    }
    lm.rows_per_page = rows
    lm.columns_per_page = columns
}

export function restoreGridLayout(grid, saved) {
    if (saved.mode === 'modes') {
        grid._currentMode = -1
        grid.setGridModes(saved.modes)
    } else {
        const lm = grid.layout_manager
        for (const {name, present, value} of saved.fixed) {
            if (present)
                lm[name] = value
            else
                delete lm[name]
        }
    }
}

function getFolderEntries(appDisplay) {
    const icons = appDisplay?._folderIcons
    if (!Array.isArray(icons))
        return []
    const entries = []
    const grids = new Set()
    for (const icon of icons) {
        const grid = icon?.view?._grid
        if (grid?.layout_manager && !grids.has(grid)) {
            grids.add(grid)
            entries.push({icon, grid})
        }
    }
    return entries
}

export function getFolderGrids(appDisplay) {
    return getFolderEntries(appDisplay).map(entry => entry.grid)
}

export function computeFolderGridDimensions(itemCount, rows, columns) {
    const gridRows = Math.max(1, Math.trunc(rows) || 1)
    const gridColumns = Math.max(1, Math.trunc(columns) || 1)
    return {
        rows: gridRows,
        columns: gridColumns,
        paged: Number.isInteger(itemCount) &&
            itemCount > gridRows * gridColumns,
    }
}

export function computeFolderDialogSize({
    rows,
    columns,
    cellSize,
    rowSpacing,
    columnSpacing,
    pagePadding = FOLDER_PAGE_PADDING_FALLBACK,
    titleHeight = FOLDER_DIALOG_TITLE_FALLBACK,
    border = {
        top: 0,
        right: FOLDER_DIALOG_BORDER_FALLBACK,
        bottom: 0,
        left: FOLDER_DIALOG_BORDER_FALLBACK,
    },
}) {
    const spacing = value => Math.max(0, Number(value) || 0)
    return {
        width: Math.ceil(columns * cellSize +
            Math.max(0, columns - 1) * spacing(columnSpacing) +
            pagePadding.left + pagePadding.right +
            border.left + border.right),
        height: Math.ceil(titleHeight +
            rows * cellSize +
            Math.max(0, rows - 1) * spacing(rowSpacing) +
            pagePadding.top + pagePadding.bottom +
            border.top + border.bottom),
    }
}

function countFolderItems(grid) {
    const pages = grid?.layout_manager?._pages
    if (Array.isArray(pages))
        return pages.reduce((count, page) =>
            count + (page?.visibleChildren?.length ?? 0), 0)
    let count = 0
    try {
        for (const item of grid) {
            if (item?.visible)
                count++
        }
    } catch (_error) {
        return null
    }
    return count
}

function syncFolderIconSize(grid, lm, iconSize) {
    if (!Number.isFinite(iconSize) || iconSize < 0)
        return
    lm._iconSize = iconSize
    if (lm._container) {
        for (const child of lm._container)
            child?.icon?.setIconSize?.(iconSize)
    }
    if ('_childrenMaxSize' in lm)
        lm._childrenMaxSize = -1
}

function measureFolderCellSize(grid, lm) {
    let size = 0
    const measure = actor => {
        try {
            const [width, height] = actor.get_preferred_size()
            if (Number.isFinite(width) && Number.isFinite(height))
                size = Math.max(size, width, height)
        } catch (_error) {}
    }
    if (Array.isArray(lm._pages)) {
        for (const page of lm._pages) {
            for (const actor of page.visibleChildren ?? [])
                measure(actor)
        }
    }
    if (size <= 0) {
        try {
            for (const actor of grid) {
                if (actor?.visible)
                    measure(actor)
            }
        } catch (_error) {}
    }
    return size > 0 ? Math.ceil(size) : null
}

function folderPagePadding(grid, lm) {
    const padding = lm?.page_padding
    const sides = ['top', 'right', 'bottom', 'left']
    const values = sides.map(side => padding?.[side])
    if (values.every(Number.isFinite) && values.some(value => value > 0))
        return padding
    try {
        if (grid?.get_stage?.()) {
            const node = grid.get_theme_node()
            return {
                top: node.get_length('page-padding-top'),
                right: node.get_length('page-padding-right'),
                bottom: node.get_length('page-padding-bottom'),
                left: node.get_length('page-padding-left'),
            }
        }
    } catch (_error) {}
    return FOLDER_PAGE_PADDING_FALLBACK
}

function hasPagePadding(lm) {
    return 'page-padding' in lm || 'page_padding' in lm
}

function sameMargin(first, second) {
    if (!first || !second)
        return false
    return ['top', 'right', 'bottom', 'left'].every(side =>
        Number(first[side]) === Number(second[side]))
}

function applyFolderPagePadding(lm, paged, config) {
    if (paged || !hasPagePadding(lm))
        return false
    const desired = config.pagePadding
    if (!desired || sameMargin(lm.page_padding, desired))
        return false
    lm.page_padding = desired
    return true
}

// Shell recomputes folder page padding from the navigation-arrow width on
// every allocation, which leaves wide side margins on single-page folders.
export function enforceFolderPagePadding(lm, padding) {
    if (!lm || !padding || !hasPagePadding(lm) ||
        !Array.isArray(lm._pages))
        return false
    const itemCount = lm._pages.reduce((count, page) =>
        count + (page?.visibleChildren?.length ?? 0), 0)
    const capacity = (lm.rows_per_page ?? 0) * (lm.columns_per_page ?? 0)
    if (capacity <= 0 || itemCount > capacity ||
        sameMargin(lm.page_padding, padding))
        return false
    lm.page_padding = padding
    return true
}

function folderDialogBorder(dialog) {
    const fallback = {
        top: 0,
        right: FOLDER_DIALOG_BORDER_FALLBACK,
        bottom: 0,
        left: FOLDER_DIALOG_BORDER_FALLBACK,
    }
    try {
        dialog?.ensure_style?.()
        const node = dialog?._viewBox?.get_theme_node?.()
        if (!node)
            return fallback
        const length = name => {
            const value = node.get_length(name)
            return Number.isFinite(value) ? value : FOLDER_DIALOG_BORDER_FALLBACK
        }
        return {
            top: length('padding-top'),
            right: length('padding-right'),
            bottom: length('padding-bottom'),
            left: length('padding-left'),
        }
    } catch (_error) {
        return fallback
    }
}

function measureFolderTitleHeight(dialog) {
    try {
        dialog?.ensure_style?.()
        dialog?._entryBox?.ensure_style?.()
        const [height] = dialog?._entryBox?.get_preferred_height(-1) ?? []
        if (Number.isFinite(height) && height > 0)
            return Math.ceil(height)
    } catch (_error) {}
    return FOLDER_DIALOG_TITLE_FALLBACK
}

function readActorFontSize(actor) {
    try {
        actor?.ensure_style?.()
        const size = actor?.get_theme_node?.()?.get_font?.()?.get_size?.()
        if (Number.isFinite(size) && size > 0)
            return size / PANGO_SCALE
    } catch (_error) {}
    return null
}

function folderDialogTitleState(dialog) {
    const label = dialog?._folderNameLabel ?? null
    const edit = dialog?._editButton ?? null
    return {
        label,
        edit,
        labelStyle: label?.get_style?.() ?? '',
        entryStyle: dialog?._entry?.get_style?.() ?? '',
        editStyle: edit?.get_style?.() ?? '',
        labelFont: readActorFontSize(label),
        editFont: readActorFontSize(edit),
    }
}

function setActorStyle(actor, style) {
    if (!actor?.set_style)
        return false
    const next = style ?? ''
    if ((actor.get_style?.() ?? '') === next)
        return false
    actor.set_style(next)
    actor.ensure_style?.()
    return true
}

function titleFontStyle(baseStyle, size) {
    const base = (baseStyle ?? '').trim()
    return `${base ? `${base} ` : ''}font-size: ${size}px;`
}

function restoreFolderDialogTitle(original) {
    const title = original?.title
    if (!title)
        return false
    let changed = setActorStyle(title.label, title.labelStyle)
    changed = setActorStyle(original?.entry, title.entryStyle) || changed
    changed = setActorStyle(title.edit, title.editStyle) || changed
    return changed
}

function applyFolderDialogTitle(original, titleSize) {
    const title = original?.title
    if (!title)
        return false
    const size = Number(titleSize)
    if (!Number.isFinite(size) || size <= 0)
        return restoreFolderDialogTitle(original)
    const pixels = Math.max(1, Math.round(size))
    const baseTitle = title.labelFont ?? FOLDER_TITLE_FONT_FALLBACK
    const baseButton = title.editFont ??
        FOLDER_TITLE_BUTTON_FONT_FALLBACK
    const buttonPixels = Math.max(1,
        Math.round(baseButton * pixels / baseTitle))
    let changed = setActorStyle(title.label,
        titleFontStyle(title.labelStyle, pixels))
    changed = setActorStyle(original?.entry,
        titleFontStyle(title.entryStyle, pixels)) || changed
    changed = setActorStyle(title.edit,
        titleFontStyle(title.editStyle, buttonPixels)) || changed
    return changed
}

function reflowFolderPages(grid) {
    const lm = grid?.layout_manager
    if (!lm || typeof lm._updatePages !== 'function')
        return false
    try {
        lm._updatePages()
        if (!lm.allowIncompletePages &&
            typeof lm._fillItemVacancies === 'function' &&
            Array.isArray(lm._pages)) {
            for (let index = 0; index < lm._pages.length; index++)
                lm._fillItemVacancies(index)
        }
        return true
    } catch (_error) {
        return false
    }
}

function applyFolderDimensions(grid, dims) {
    const lm = grid?.layout_manager
    if (!lm || !getGridLayoutMode(grid))
        return false
    if (lm.rows_per_page === dims.rows &&
        lm.columns_per_page === dims.columns)
        return false
    setGridDimensions(grid, dims.rows, dims.columns)
    reflowFolderPages(grid)
    return true
}

function folderDialogContentSize(dialog, grid, lm, dims, config) {
    const cellSize = measureFolderCellSize(grid, lm)
    if (!cellSize)
        return null
    const border = folderDialogBorder(dialog)
    const size = computeFolderDialogSize({
        rows: dims.rows,
        columns: dims.columns,
        cellSize,
        rowSpacing: config.rowSpacing,
        columnSpacing: config.columnSpacing,
        pagePadding: config.pagePadding ?? folderPagePadding(grid, lm),
        titleHeight: measureFolderTitleHeight(dialog),
        border,
    })
    // The title bar only adds height, so square grids would otherwise get a
    // taller-than-wide panel. Match the width to make the background square.
    if (dims.rows === dims.columns && size.width < size.height)
        size.width = size.height
    return {...size, border}
}

function fitFolderDialogTitle(dialog, size) {
    const entry = dialog?._entry
    const edit = dialog?._editButton
    if (!entry || !edit)
        return false
    const ghost = dialog?._entryBox?.get_first_child?.()
    const inset = Number.isFinite(ghost?.x) && ghost.x > 0
        ? ghost.x
        : FOLDER_TITLE_SIDE_INSET_FALLBACK
    const editWidth = Number.isFinite(edit.width) && edit.width > 0
        ? edit.width
        : FOLDER_TITLE_BUTTON_FALLBACK
    const ghostWidth = Number.isFinite(ghost?.width) && ghost.width > 0
        ? ghost.width
        : editWidth
    const contentWidth = size.width - size.border.left - size.border.right
    const width = Math.max(1, Math.round(contentWidth - inset * 2 -
        editWidth - ghostWidth))
    if (entry.width === width)
        return false
    entry.width = width
    return true
}

function restoreFolderDialogSize(box, originals) {
    if (!box || !originals?.has(box))
        return false
    const original = originals.get(box)
    originals.delete(box)
    restoreFolderDialogTitle(original)
    box.set_style?.(original?.style ?? '')
    if (Number.isFinite(original?.width) && Number.isFinite(original?.height)) {
        box.width = original.width
        box.height = original.height
    }
    if (original?.entry)
        original.entry.width = -1
    box.queue_relayout?.()
    return true
}

export function applyFolderDialogSize(icon, config, originals = null,
    folderOriginals = null) {
    const grid = icon?.view?._grid
    const lm = grid?.layout_manager
    if (!lm || !('fixed_icon_size' in lm))
        return null

    ensureFolderState(grid, folderOriginals)
    const itemCount = countFolderItems(grid)
    const dims = computeFolderGridDimensions(itemCount, config.rows,
        config.columns)
    let changed = applyFolderDimensions(grid, dims)
    if (applyFolderPagePadding(lm, dims.paged, config))
        changed = true
    syncFolderIconSize(grid, lm, config.iconSize)

    const dialog = icon?._dialog
    const box = dialog?._viewBox
    if (box) {
        let size = null
        if (!dims.paged) {
            if (originals && !originals.has(box)) {
                // Ubuntu's adaptive layout pins the panel to a fixed size,
                // which only the actor dimensions can override.
                const fixed = getGridLayoutMode(grid) === 'adaptive' &&
                    box.width > 0 && box.height > 0
                originals.set(box, {
                    style: box.get_style?.() ?? '',
                    width: fixed ? box.width : null,
                    height: fixed ? box.height : null,
                    entry: dialog?._entry ?? null,
                    title: folderDialogTitleState(dialog),
                })
            }
            const titleOriginal = originals?.get(box)
            if (titleOriginal &&
                applyFolderDialogTitle(titleOriginal, config.titleSize))
                changed = true
            size = folderDialogContentSize(dialog, grid, lm, dims, config)
        }
        if (size) {
            const original = originals?.get(box)
            const baseStyle = (original?.style ?? '').trim()
            const style = `${baseStyle ? `${baseStyle} ` : ''}` +
                `width: ${size.width}px; height: ${size.height}px;`
            const fixed = Number.isFinite(original?.width) &&
                Number.isFinite(original?.height)
            if (box.get_style?.() !== style ||
                (fixed && (box.width !== size.width ||
                    box.height !== size.height))) {
                box.set_style(style)
                if (fixed) {
                    box.width = size.width
                    box.height = size.height
                }
                box.queue_relayout?.()
                changed = true
            }
            if (originals?.has(box) && fitFolderDialogTitle(dialog, size)) {
                box.queue_relayout?.()
                changed = true
            }
        } else if (restoreFolderDialogSize(box, originals)) {
            changed = true
        }
    }

    if (changed) {
        lm._pageWidth = 0
        lm._pageHeight = 0
        grid.queue_relayout()
    }
    return dims
}

export function applyFolderDialogSizes(appDisplay, config, originals = null,
    folderOriginals = null) {
    for (const {icon} of getFolderEntries(appDisplay)) {
        if (icon?._dialog)
            applyFolderDialogSize(icon, config, originals, folderOriginals)
    }
}

export function getIconLabels(appDisplay) {
    const grids = [appDisplay?._grid, ...getFolderGrids(appDisplay)]
    const labels = []
    for (const grid of grids) {
        if (!grid)
            continue
        for (const item of grid) {
            const label = item?.icon?.label
            if (label && !labels.includes(label))
                labels.push(label)
        }
    }
    return labels
}

export function applyAppNameVisibility(appDisplay, showNames, originals) {
    for (const label of getIconLabels(appDisplay)) {
        if (!originals.has(label))
            originals.set(label, label.visible)
        if (label.visible !== showNames)
            label.visible = showNames
    }
}

export function restoreAppNameVisibility(appDisplay, originals) {
    for (const label of getIconLabels(appDisplay)) {
        if (originals.has(label))
            label.visible = originals.get(label)
    }
    originals.clear()
}

function themeFolderSpacing(grid) {
    try {
        if (!grid.get_stage?.())
            return null
        grid.ensure_style()
        return readThemeSpacing(grid.get_theme_node())
    } catch (_error) {
        return null
    }
}

function saveFolderState(grid) {
    const lm = grid.layout_manager
    let layout = null
    try {
        layout = saveGridLayout(grid)
    } catch (_error) {}
    const theme = themeFolderSpacing(grid)
    const optional = {}
    for (const property of ['max_row_spacing', 'max_column_spacing',
        'page_valign', 'page_halign']) {
        if (property in lm)
            optional[property] = lm[property]
    }
    return {
        iconSize: lm.fixed_icon_size,
        rowSpacing: lm.row_spacing || theme?.rowSpacing || 0,
        columnSpacing: lm.column_spacing || theme?.columnSpacing || 0,
        pagePadding: hasPagePadding(lm) ? lm.page_padding : null,
        optional,
        layout,
    }
}

function ensureFolderState(grid, originals) {
    if (!originals)
        return null
    const lm = grid.layout_manager
    if (!originals.has(lm))
        originals.set(lm, saveFolderState(grid))
    return originals.get(lm)
}

function applyFolderAlignment(lm) {
    if ('max_row_spacing' in lm)
        lm.max_row_spacing = UNCONSTRAINED_SPACING
    if ('max_column_spacing' in lm)
        lm.max_column_spacing = UNCONSTRAINED_SPACING
    if ('page_valign' in lm)
        lm.page_valign = ALIGN_START
    if ('page_halign' in lm)
        lm.page_halign = ALIGN_CENTER
}

export function applyFolderLayouts(appDisplay, config, originals,
    dialogOriginals = null) {
    for (const {icon, grid} of getFolderEntries(appDisplay)) {
        const lm = grid.layout_manager
        if (!('fixed_icon_size' in lm))
            continue
        ensureFolderState(grid, originals)
        const dims = computeFolderGridDimensions(countFolderItems(grid),
            config.rows, config.columns)
        applyFolderDimensions(grid, dims)
        applyFolderPagePadding(lm, dims.paged, config)
        lm.fixed_icon_size = config.iconSize
        lm.row_spacing = config.rowSpacing
        lm.column_spacing = config.columnSpacing
        applyFolderAlignment(lm)
        syncFolderIconSize(grid, lm, config.iconSize)
        if (icon?._dialog)
            applyFolderDialogSize(icon, config, dialogOriginals, originals)
        lm._pageWidth = 0
        lm._pageHeight = 0
        grid.queue_relayout()
    }
}

export function restoreFolderLayouts(appDisplay, originals,
    dialogOriginals = null) {
    for (const {icon, grid} of getFolderEntries(appDisplay)) {
        const lm = grid.layout_manager
        const original = originals.get(lm)
        if (!original)
            continue
        const theme = themeFolderSpacing(grid)
        lm.fixed_icon_size = original.iconSize
        lm.row_spacing = original.rowSpacing || theme?.rowSpacing || 0
        lm.column_spacing = original.columnSpacing ||
            theme?.columnSpacing || 0
        if (original.pagePadding && hasPagePadding(lm))
            lm.page_padding = original.pagePadding
        for (const [property, value] of Object.entries(original.optional ?? {})) {
            if (property in lm)
                lm[property] = value
        }
        if (original.layout)
            restoreGridLayout(grid, original.layout)
        restoreFolderDialogSize(icon?._dialog?._viewBox, dialogOriginals)
        lm._pageWidth = 0
        lm._pageHeight = 0
        grid.queue_relayout()
    }
    originals.clear()
}
