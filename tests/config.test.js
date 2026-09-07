import assert from 'node:assert/strict'
import test from 'node:test'

import {
    DEFAULT_PAGE_CAPACITY,
    PRESETS,
    PRESET_WIDTH_RATIO,
    SETTINGS_KEYS,
    computeGridFit,
    computeGridPixelSize,
    decodePreviewLayout,
    splitPageItemCounts,
} from '../config.js'

test('preset values remain stable', () => {
    assert.deepEqual(PRESETS, [
        {iconSize: 96, rows: 4, columns: 6, gap: 24},
        {iconSize: 64, rows: 6, columns: 9, gap: 18},
        {iconSize: 48, rows: 8, columns: 12, gap: 14},
        {iconSize: 32, rows: 12, columns: 16, gap: 10},
    ])
})

test('balanced fit uses two thirds of the available width', () => {
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
        columns: 9,
        cellSize: 88,
        effectiveWidth: 1000,
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

test('fallback page counts preserve Shell page boundaries and overflow', () => {
    assert.equal(DEFAULT_PAGE_CAPACITY, 24)
    assert.deepEqual(splitPageItemCounts([38]), [24, 14])
    assert.deepEqual(splitPageItemCounts([18, 30]), [18, 24, 6])
    assert.deepEqual(splitPageItemCounts([]), [0])
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
