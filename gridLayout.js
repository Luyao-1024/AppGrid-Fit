const FIXED_DIMENSIONS = ['_fixedRows', '_fixedCols']
const UNCONSTRAINED_SPACING = -1
const ALIGN_START = 1
const ALIGN_CENTER = 2

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

export function getFolderGrids(appDisplay) {
    const icons = appDisplay?._folderIcons
    if (!Array.isArray(icons))
        return []
    const grids = []
    for (const icon of icons) {
        const grid = icon?.view?._grid
        if (grid?.layout_manager && !grids.includes(grid))
            grids.push(grid)
    }
    return grids
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
        optional,
        layout,
    }
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

export function applyFolderLayouts(appDisplay, config, originals) {
    for (const grid of getFolderGrids(appDisplay)) {
        const lm = grid.layout_manager
        if (!('fixed_icon_size' in lm))
            continue
        if (!originals.has(lm))
            originals.set(lm, saveFolderState(grid))
        if (getGridLayoutMode(grid))
            setGridDimensions(grid, config.rows, config.columns)
        lm.fixed_icon_size = config.iconSize
        lm.row_spacing = config.rowSpacing
        lm.column_spacing = config.columnSpacing
        applyFolderAlignment(lm)
        lm._pageWidth = 0
        lm._pageHeight = 0
        grid.queue_relayout()
    }
}

export function restoreFolderLayouts(appDisplay, originals) {
    for (const grid of getFolderGrids(appDisplay)) {
        const lm = grid.layout_manager
        const original = originals.get(lm)
        if (!original)
            continue
        const theme = themeFolderSpacing(grid)
        lm.fixed_icon_size = original.iconSize
        lm.row_spacing = original.rowSpacing || theme?.rowSpacing || 0
        lm.column_spacing = original.columnSpacing ||
            theme?.columnSpacing || 0
        for (const [property, value] of Object.entries(original.optional ?? {})) {
            if (property in lm)
                lm[property] = value
        }
        if (original.layout)
            restoreGridLayout(grid, original.layout)
        lm._pageWidth = 0
        lm._pageHeight = 0
        grid.queue_relayout()
    }
    originals.clear()
}
