export const TILE_PADDING = 24
export const UNCONSTRAINED_SPACING = -1
export const MIN_GRID_DIMENSION = 2
export const PRESET_WIDTH_RATIO = 2 / 3
export const PREVIEW_LAYOUT_KEY = 'runtime-preview-layout'
export const DEFAULT_PAGE_CAPACITY = 24

export const SETTINGS_KEYS = [
    'use-presets', 'preset-level', 'consolidate-pages',
    'custom-icon-size', 'custom-rows', 'custom-columns',
    'custom-row-spacing', 'custom-column-spacing',
]

export const PRESETS = [
    {iconSize: 96, rows: 4, columns: 6, gap: 24},
    {iconSize: 64, rows: 6, columns: 9, gap: 18},
    {iconSize: 48, rows: 8, columns: 12, gap: 14},
    {iconSize: 32, rows: 12, columns: 16, gap: 10},
]

export function computeGridFit({
    width,
    height,
    iconSize,
    rowGap,
    columnGap,
    widthRatio = 1,
}) {
    const cellSize = iconSize + TILE_PADDING
    const effectiveWidth = Math.round(Math.max(0, width) * widthRatio)
    return {
        rows: Math.max(MIN_GRID_DIMENSION,
            Math.floor((Math.max(0, height) + rowGap) / (cellSize + rowGap))),
        columns: Math.max(MIN_GRID_DIMENSION,
            Math.floor((effectiveWidth + columnGap) / (cellSize + columnGap))),
        cellSize,
        effectiveWidth,
    }
}

export function computeGridPixelSize(rows, columns, cellSize, rowGap, columnGap) {
    return {
        width: columns * cellSize + Math.max(0, columns - 1) * columnGap,
        height: rows * cellSize + Math.max(0, rows - 1) * rowGap,
    }
}

export function splitPageItemCounts(pageItemCounts,
    capacity = DEFAULT_PAGE_CAPACITY) {
    if (!Array.isArray(pageItemCounts) ||
        !Number.isInteger(capacity) || capacity < 1 ||
        pageItemCounts.some(count => !Number.isInteger(count) || count < 0))
        return []

    const result = []
    for (const count of pageItemCounts) {
        let remaining = count
        while (remaining > capacity) {
            result.push(capacity)
            remaining -= capacity
        }
        if (remaining > 0)
            result.push(remaining)
    }
    return result.length ? result : [0]
}

export function splitPageItems(pages, capacity = DEFAULT_PAGE_CAPACITY) {
    if (!Array.isArray(pages) || pages.some(page => !Array.isArray(page)) ||
        !Number.isInteger(capacity) || capacity < 1)
        return []

    const result = []
    for (const page of pages) {
        for (let start = 0; start < page.length; start += capacity)
            result.push(page.slice(start, start + capacity))
    }
    return result.length ? result : [[]]
}

export function decodePreviewLayout(value) {
    try {
        const layout = JSON.parse(value)
        const values = [
            layout?.monitor?.width,
            layout?.monitor?.height,
            layout?.grid?.x,
            layout?.grid?.y,
            layout?.grid?.width,
            layout?.grid?.height,
            layout?.grid?.paddingTop,
            layout?.grid?.paddingRight,
            layout?.grid?.paddingBottom,
            layout?.grid?.paddingLeft,
            layout?.itemCount,
        ]
        if (![1, 2].includes(layout?.version) ||
            values.some(v => !Number.isFinite(v)) ||
            layout.monitor.width <= 0 || layout.monitor.height <= 0 ||
            layout.grid.width <= 0 || layout.grid.height <= 0 ||
            layout.itemCount < 0)
            return null
        if (layout.version === 2) {
            const validRect = rect => rect === null || rect === undefined ||
                ['x', 'y', 'width', 'height'].every(key =>
                    Number.isFinite(rect?.[key])) &&
                rect.width >= 0 && rect.height >= 0
            const rectLists = [layout.items, layout.workspaceRects, layout.dashItems]
            const hasInvalidRectList = rectLists.some(list => {
                if (list === undefined)
                    return false
                return !Array.isArray(list) ||
                    list.some(item => !validRect(item?.tile ?? item))
            })
            if (!validRect(layout.searchRect) || !validRect(layout.dashRect) ||
                !validRect(layout.panelRect) || hasInvalidRectList ||
                layout.items?.some(item => !validRect(item.icon)) ||
                layout.pageItemCounts !== undefined &&
                    (!Array.isArray(layout.pageItemCounts) ||
                        layout.pageItemCounts.some(count =>
                            !Number.isInteger(count) || count < 0)) ||
                layout.pageCount !== undefined &&
                    (!Number.isInteger(layout.pageCount) || layout.pageCount < 1) ||
                layout.currentPage !== undefined &&
                    (!Number.isInteger(layout.currentPage) ||
                        layout.currentPage < 0 ||
                        layout.currentPage >= (layout.pageCount ?? 1)))
                return null
        }
        return layout
    } catch (_error) {
        return null
    }
}
