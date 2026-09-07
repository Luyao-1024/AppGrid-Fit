import assert from 'node:assert/strict'
import test from 'node:test'

import {
    DEFAULT_PAGE_CAPACITY,
    PRESETS,
    PRESET_WIDTH_RATIO,
    SETTINGS_KEYS,
    computePreviewColorIndex,
    computeGridFit,
    computeGridPixelSize,
    computePreviewTileSize,
    decodePreviewLayout,
    resolvePreviewPages,
    splitPageItemCounts,
    splitPageItems,
} from '../config.js'

test('preset values remain stable', () => {
    assert.deepEqual(PRESETS, [
        {iconSize: 96, rows: 4, columns: 6, gap: 24},
        {iconSize: 64, rows: 6, columns: 9, gap: 18},
        {iconSize: 48, rows: 8, columns: 12, gap: 14},
        {iconSize: 32, rows: 12, columns: 16, gap: 10},
    ])
})

test('balanced fit uses four fifths of the available width', () => {
    const fit = computeGridFit({
        width: 1500,
        height: 648,
        iconSize: 64,
        rowGap: 18,
        columnGap: 18,
        widthRatio: PRESET_WIDTH_RATIO,
    })
    assert.deepEqual(fit, {
        rows: 6,
        columns: 11,
        cellSize: 88,
        effectiveWidth: 1200,
    })
})

test('balanced fit uses the measured Shell tile size when available', () => {
    const fit = computeGridFit({
        width: 2012,
        height: 926,
        iconSize: 32,
        tileSize: 85,
        rowGap: 10,
        columnGap: 10,
        widthRatio: PRESET_WIDTH_RATIO,
    })
    assert.deepEqual(fit, {
        rows: 9,
        columns: 17,
        cellSize: 85,
        effectiveWidth: 1610,
    })
})

test('fit never returns less than the supported minimum', () => {
    const fit = computeGridFit({
        width: 0,
        height: 0,
        iconSize: 160,
        rowGap: 200,
        columnGap: 200,
    })
    assert.equal(fit.rows, 2)
    assert.equal(fit.columns, 2)
})

test('pixel size includes cells and only inter-cell gaps', () => {
    assert.deepEqual(computeGridPixelSize(4, 6, 120, 24, 24), {
        width: 840,
        height: 552,
    })
})

test('preview tile size scales with arbitrary icon sizes as a fallback', () => {
    assert.equal(computePreviewTileSize(16), 69)
    assert.equal(computePreviewTileSize(32), 85)
    assert.equal(computePreviewTileSize(47), 100)
    assert.equal(computePreviewTileSize(64), 117)
    assert.equal(computePreviewTileSize(96), 149)
    assert.equal(computePreviewTileSize(160), 213)
})

test('measured Shell tile size overrides the fallback at any icon size', () => {
    assert.equal(computePreviewTileSize(32, 87), 87)
    assert.equal(computePreviewTileSize(73, 128), 128)
    assert.equal(computePreviewTileSize(96, 151.5), 151.5)
    assert.equal(computePreviewTileSize(64, Number.NaN), 117)
})

test('preview colors are stable without repeating by grid column', () => {
    const firstRow = Array.from({length: 12}, (_value, index) =>
        computePreviewColorIndex(`app-${index}`, 12))
    const secondRow = Array.from({length: 12}, (_value, index) =>
        computePreviewColorIndex(`app-${index + 12}`, 12))
    assert.deepEqual(firstRow, Array.from({length: 12}, (_value, index) =>
        computePreviewColorIndex(`app-${index}`, 12)))
    assert.notDeepEqual(secondRow, firstRow)
    assert.ok(new Set([...firstRow, ...secondRow]).size >= 8)
})

test('fallback page counts preserve Shell page boundaries and overflow', () => {
    assert.equal(DEFAULT_PAGE_CAPACITY, 24)
    assert.deepEqual(splitPageItemCounts([38]), [24, 14])
    assert.deepEqual(splitPageItemCounts([18, 30]), [18, 24, 6])
    assert.deepEqual(splitPageItemCounts([]), [0])
})

test('fallback page items preserve automatic folder identities', () => {
    const pages = [[
        {id: 'first.desktop', folder: false},
        {id: 'Utilities', folder: true},
        {id: 'System', folder: true},
    ]]
    assert.deepEqual(splitPageItems(pages, 2), [
        pages[0].slice(0, 2),
        pages[0].slice(2),
    ])
})

test('preview pages follow consolidated Shell boundaries', () => {
    const apps = Array.from({length: 38}, (_value, id) => ({id}))
    assert.deepEqual(
        resolvePreviewPages([apps], false).map(page => page.length),
        [24, 14])
    assert.deepEqual(
        resolvePreviewPages([apps], true).map(page => page.length),
        [38])
})

test('all settings keys are unique', () => {
    assert.equal(new Set(SETTINGS_KEYS).size, SETTINGS_KEYS.length)
})

test('runtime preview layout decoding rejects incomplete state', () => {
    assert.equal(decodePreviewLayout(''), null)
    assert.equal(decodePreviewLayout('{"version":1}'), null)
})

test('runtime preview layout decoding accepts measured geometry', () => {
    const layout = {
        version: 1,
        monitor: {width: 2560, height: 1440},
        grid: {
            x: 0, y: 280, width: 2048, height: 760,
            paddingTop: 24, paddingRight: 18,
            paddingBottom: 24, paddingLeft: 18,
        },
        itemCount: 38,
    }
    assert.deepEqual(decodePreviewLayout(JSON.stringify(layout)), layout)
})

test('runtime preview layout decoding accepts measured Shell actors', () => {
    const layout = {
        version: 2,
        monitor: {width: 2560, height: 1440},
        grid: {
            x: 0, y: 280, width: 2560, height: 760,
            paddingTop: 24, paddingRight: 274,
            paddingBottom: 24, paddingLeft: 274,
        },
        itemCount: 2,
        config: {
            iconSize: 64, rows: 6, columns: 12,
            rowGap: 18, columnGap: 18, tileSize: 117,
            consolidate: true,
        },
        pageItemCounts: [2, 1],
        pageCount: 2,
        currentPage: 0,
        items: [
            {
                tile: {x: 480, y: 380, width: 120, height: 112},
                icon: {x: 508, y: 388, width: 64, height: 64},
                folder: true,
            },
            {
                tile: {x: 615, y: 380, width: 120, height: 112},
                icon: {x: 643, y: 388, width: 64, height: 64},
                folder: false,
            },
        ],
        searchRect: {x: 1095, y: 43, width: 370, height: 41},
        workspaceRects: [
            {x: 884, y: 119, width: 382, height: 210},
            {x: 1303, y: 125, width: 361, height: 204},
        ],
        dashRect: {x: 995, y: 1362, width: 572, height: 64},
        dashItems: [{x: 1004, y: 1368, width: 52, height: 52}],
    }
    assert.deepEqual(decodePreviewLayout(JSON.stringify(layout)), layout)
})

test('runtime preview layout decoding rejects invalid actor rectangles', () => {
    const layout = {
        version: 2,
        monitor: {width: 1920, height: 1080},
        grid: {
            x: 0, y: 200, width: 1920, height: 600,
            paddingTop: 24, paddingRight: 210,
            paddingBottom: 24, paddingLeft: 210,
        },
        itemCount: 1,
        items: [{tile: {x: 10, y: 10, width: -1, height: 100}}],
    }
    assert.equal(decodePreviewLayout(JSON.stringify(layout)), null)
})

test('runtime preview layout decoding rejects an invalid measured tile size', () => {
    const layout = {
        version: 2,
        monitor: {width: 1920, height: 1080},
        grid: {
            x: 0, y: 200, width: 1920, height: 600,
            paddingTop: 24, paddingRight: 210,
            paddingBottom: 24, paddingLeft: 210,
        },
        itemCount: 0,
        config: {tileSize: -10},
    }
    assert.equal(decodePreviewLayout(JSON.stringify(layout)), null)
})
