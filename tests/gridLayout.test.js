import assert from 'node:assert/strict'
import test from 'node:test'
import {
    getFolderGrids,
    getGridLayoutMode,
    readThemeSpacing,
    restoreFolderIconSizes,
    restoreGridLayout,
    saveGridLayout,
    setFolderIconSizes,
    setGridDimensions,
} from '../gridLayout.js'

function adaptiveGrid() {
    return {
        layout_manager: {
            fixed_icon_size: -1,
            rows_per_page: 3,
            columns_per_page: 10,
            _updatePages() {},
            adaptToSize(width, height) {
                this.columns_per_page = this._fixedCols ?? Math.floor(width / 100)
                this.rows_per_page = this._fixedRows ?? Math.floor(height / 100)
            },
        },
    }
}

function modeGrid() {
    return {
        layout_manager: {
            fixed_icon_size: -1,
            rows_per_page: 4,
            columns_per_page: 6,
        },
        _gridModes: [{rows: 4, columns: 6}, {rows: 6, columns: 4}],
        _currentMode: 0,
        setGridModes(modes) {
            this._gridModes = modes
        },
    }
}

test('upstream grid modes can be pinned and restored without aliasing', () => {
    const grid = modeGrid()
    const original = structuredClone(grid._gridModes)
    const saved = saveGridLayout(grid)
    assert.equal(getGridLayoutMode(grid), 'modes')
    grid._gridModes[0].rows = 99

    setGridDimensions(grid, 5, 8)
    assert.deepEqual(grid._gridModes, [{rows: 5, columns: 8}])
    assert.equal(grid._currentMode, -1)
    assert.equal(grid.layout_manager.rows_per_page, 5)
    assert.equal(grid.layout_manager.columns_per_page, 8)
    assert.equal(Object.hasOwn(grid.layout_manager, '_fixedRows'), false)

    restoreGridLayout(grid, saved)
    assert.deepEqual(grid._gridModes, original)
})

test('Ubuntu adaptive grids keep custom dimensions across allocations', () => {
    const grid = adaptiveGrid()
    const lm = grid.layout_manager
    assert.equal(getGridLayoutMode(grid), 'adaptive')
    assert.equal(typeof grid.setGridModes, 'undefined')

    setGridDimensions(grid, 4, 6)
    lm.adaptToSize(1920, 1080)
    assert.equal(lm.rows_per_page, 4)
    assert.equal(lm.columns_per_page, 6)
    lm.adaptToSize(1280, 720)
    assert.equal(lm.rows_per_page, 4)
    assert.equal(lm.columns_per_page, 6)

    setGridDimensions(grid, 3, 9)
    lm.adaptToSize(1600, 900)
    assert.equal(lm.rows_per_page, 3)
    assert.equal(lm.columns_per_page, 9)
    assert.equal(Object.hasOwn(grid, '_gridModes'), false)
    assert.equal(Object.hasOwn(grid, '_currentMode'), false)
})

test('disabling an adaptive override restores automatic fitting', () => {
    const grid = adaptiveGrid()
    const lm = grid.layout_manager
    const saved = saveGridLayout(grid)
    setGridDimensions(grid, 4, 6)
    restoreGridLayout(grid, saved)

    assert.equal(Object.hasOwn(lm, '_fixedRows'), false)
    assert.equal(Object.hasOwn(lm, '_fixedCols'), false)
    lm.adaptToSize(1000, 300)
    assert.equal(lm.rows_per_page, 3)
    assert.equal(lm.columns_per_page, 10)
})

test('existing adaptive constraints survive apply and restore', () => {
    const grid = adaptiveGrid()
    const lm = grid.layout_manager
    lm._fixedRows = 2
    lm._fixedCols = 5
    const saved = saveGridLayout(grid)
    setGridDimensions(grid, 4, 6)
    restoreGridLayout(grid, saved)
    lm.adaptToSize(1920, 1080)
    assert.equal(lm.rows_per_page, 2)
    assert.equal(lm.columns_per_page, 5)
})

test('restoration preserves explicitly undefined adaptive properties', () => {
    const grid = adaptiveGrid()
    const lm = grid.layout_manager
    lm._fixedRows = undefined
    const saved = saveGridLayout(grid)
    setGridDimensions(grid, 4, 6)
    restoreGridLayout(grid, saved)
    assert.equal(Object.hasOwn(lm, '_fixedRows'), true)
    assert.equal(lm._fixedRows, undefined)
    assert.equal(Object.hasOwn(lm, '_fixedCols'), false)
})

test('theme spacing uses CSS values and unconstrained limits', () => {
    const values = {
        'row-spacing': 50,
        'column-spacing': 60,
    }
    const node = {
        get_length: name => values[name] ?? 0,
        lookup_length: name => name === 'max-row-spacing'
            ? [true, 70]
            : [false, 0],
    }
    assert.deepEqual(readThemeSpacing(node), {
        rowSpacing: 50,
        columnSpacing: 60,
        maxRowSpacing: 70,
        maxColumnSpacing: -1,
    })
})

test('theme spacing rejects nodes without style lookups', () => {
    assert.equal(readThemeSpacing(null), null)
    assert.equal(readThemeSpacing({}), null)
})

test('incomplete or broken layout APIs are rejected before applying', () => {
    assert.equal(getGridLayoutMode(null), null)
    assert.equal(getGridLayoutMode({layout_manager: {}}), null)
    const broken = modeGrid()
    delete broken.setGridModes
    broken.layout_manager.adaptToSize = () => {}
    broken.layout_manager._updatePages = () => {}
    assert.equal(getGridLayoutMode(broken), null)
    assert.throws(() => saveGridLayout(broken), /unsupported/)
    assert.throws(() => setGridDimensions(broken, 4, 6), /unsupported/)

    const incomplete = adaptiveGrid()
    delete incomplete.layout_manager._updatePages
    assert.equal(getGridLayoutMode(incomplete), null)
})

function folderGrid(originalSize) {
    return {
        layout_manager: {
            fixed_icon_size: originalSize,
            _iconSize: 64,
            _pageWidth: 548,
            _pageHeight: 476,
        },
        relayouts: 0,
        queue_relayout() {
            this.relayouts += 1
        },
    }
}

test('folder grids follow the configured icon size and restore', () => {
    const first = folderGrid(-1)
    const second = folderGrid(-1)
    const appDisplay = {
        _folderIcons: [
            {view: {_grid: first}},
            {view: {_grid: second}},
            {view: {_grid: first}},
            {view: {}},
            {},
        ],
    }
    const originals = new Map()

    assert.deepEqual(getFolderGrids(appDisplay), [first, second])
    assert.deepEqual(getFolderGrids(null), [])

    setFolderIconSizes(appDisplay, 32, originals)
    for (const grid of [first, second]) {
        assert.equal(grid.layout_manager.fixed_icon_size, 32)
        assert.equal(grid.layout_manager._pageWidth, 0)
        assert.equal(grid.layout_manager._pageHeight, 0)
        assert.equal(grid.relayouts, 1)
    }
    assert.deepEqual([...originals.values()], [-1, -1])

    setFolderIconSizes(appDisplay, 96, originals)
    for (const grid of [first, second])
        assert.equal(grid.layout_manager.fixed_icon_size, 96)
    assert.deepEqual([...originals.values()], [-1, -1])
    assert.equal(first.relayouts, 2)

    restoreFolderIconSizes(appDisplay, originals)
    for (const grid of [first, second]) {
        assert.equal(grid.layout_manager.fixed_icon_size, -1)
        assert.equal(grid.layout_manager._pageWidth, 0)
        assert.equal(grid.layout_manager._pageHeight, 0)
    }
    assert.equal(originals.size, 0)
    assert.equal(first.relayouts, 3)
})

test('folder grids without fixed icon sizing are left alone', () => {
    const grid = {layout_manager: {}, queue_relayout() {}}
    const originals = new Map()
    setFolderIconSizes({_folderIcons: [{view: {_grid: grid}}]}, 32, originals)
    assert.equal(originals.size, 0)
    restoreFolderIconSizes({_folderIcons: [{view: {_grid: grid}}]}, originals)
})
