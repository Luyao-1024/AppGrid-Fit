export const TILE_PADDING = 24
export const UNCONSTRAINED_SPACING = -1
export const MIN_GRID_DIMENSION = 2
export const PRESET_WIDTH_RATIO = 2 / 3

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
