import assert from 'node:assert/strict'
import test from 'node:test'

import {
    PRESETS,
    PRESET_WIDTH_RATIO,
    SETTINGS_KEYS,
    computeGridFit,
    computeGridPixelSize,
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

test('all settings keys are unique', () => {
    assert.equal(new Set(SETTINGS_KEYS).size, SETTINGS_KEYS.length)
})
