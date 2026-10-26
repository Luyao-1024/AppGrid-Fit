const FIXED_DIMENSIONS = ['_fixedRows', '_fixedCols']

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
