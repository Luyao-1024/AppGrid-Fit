import assert from 'node:assert/strict'
import test from 'node:test'
import {
    applyAppNameVisibility,
    applyFolderLayouts,
    computeFolderDialogSize,
    computeFolderGridDimensions,
    enforceFolderPagePadding,
    getFolderGrids,
    getGridLayoutMode,
    getIconLabels,
    readThemeSpacing,
    restoreAppNameVisibility,
    restoreFolderLayouts,
    restoreGridLayout,
    saveGridLayout,
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
            const mode = modes?.[0]
            if (mode) {
                this.layout_manager.rows_per_page = mode.rows
                this.layout_manager.columns_per_page = mode.columns
            }
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

function folderGrid(originalSize = -1) {
    return {
        layout_manager: {
            fixed_icon_size: originalSize,
            _iconSize: 64,
            _pageWidth: 548,
            _pageHeight: 476,
            rows_per_page: 3,
            columns_per_page: 3,
            row_spacing: 12,
            column_spacing: 12,
            max_row_spacing: 36,
            max_column_spacing: 36,
            page_valign: 0,
            page_halign: 0,
            page_padding: {top: 24, right: 78, bottom: 24, left: 78},
        },
        _gridModes: [{rows: 3, columns: 3}],
        _currentMode: 0,
        relayouts: 0,
        setGridModes(modes) {
            this._gridModes = modes
            const mode = modes?.[0]
            if (mode) {
                this.layout_manager.rows_per_page = mode.rows
                this.layout_manager.columns_per_page = mode.columns
            }
        },
        queue_relayout() {
            this.relayouts += 1
        },
    }
}

test('folder grids follow the configured layout and restore', () => {
    const first = folderGrid()
    const second = folderGrid()
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
    const config = {
        iconSize: 48,
        rows: 4,
        columns: 5,
        rowSpacing: 8,
        columnSpacing: 14,
        pagePadding: {top: 24, right: 24, bottom: 24, left: 24},
    }

    assert.deepEqual(getFolderGrids(appDisplay), [first, second])
    assert.deepEqual(getFolderGrids(null), [])

    applyFolderLayouts(appDisplay, config, originals)
    for (const grid of [first, second]) {
        assert.equal(grid.layout_manager.fixed_icon_size, 48)
        assert.equal(grid.layout_manager.rows_per_page, 4)
        assert.equal(grid.layout_manager.columns_per_page, 5)
        assert.equal(grid.layout_manager.row_spacing, 8)
        assert.equal(grid.layout_manager.column_spacing, 14)
        assert.equal(grid.layout_manager.max_row_spacing, -1)
        assert.equal(grid.layout_manager.max_column_spacing, -1)
        assert.equal(grid.layout_manager.page_valign, 1)
        assert.equal(grid.layout_manager.page_halign, 2)
        assert.deepEqual(grid.layout_manager.page_padding,
            {top: 24, right: 24, bottom: 24, left: 24})
        assert.equal(grid.layout_manager._pageWidth, 0)
        assert.equal(grid.layout_manager._pageHeight, 0)
        assert.deepEqual(grid._gridModes, [{rows: 4, columns: 5}])
        assert.equal(grid.relayouts, 1)
    }
    assert.deepEqual([...originals.values()].map(item => item.iconSize),
        [-1, -1])
    assert.deepEqual([...originals.values()].map(item => item.pagePadding),
        [
            {top: 24, right: 78, bottom: 24, left: 78},
            {top: 24, right: 78, bottom: 24, left: 78},
        ])

    applyFolderLayouts(appDisplay, {...config, iconSize: 96}, originals)
    for (const grid of [first, second])
        assert.equal(grid.layout_manager.fixed_icon_size, 96)
    assert.deepEqual([...originals.values()].map(item => item.iconSize),
        [-1, -1])

    restoreFolderLayouts(appDisplay, originals)
    for (const grid of [first, second]) {
        assert.equal(grid.layout_manager.fixed_icon_size, -1)
        assert.equal(grid.layout_manager.rows_per_page, 3)
        assert.equal(grid.layout_manager.columns_per_page, 3)
        assert.equal(grid.layout_manager.row_spacing, 12)
        assert.equal(grid.layout_manager.column_spacing, 12)
        assert.equal(grid.layout_manager.max_row_spacing, 36)
        assert.equal(grid.layout_manager.max_column_spacing, 36)
        assert.equal(grid.layout_manager.page_valign, 0)
        assert.equal(grid.layout_manager.page_halign, 0)
        assert.deepEqual(grid.layout_manager.page_padding,
            {top: 24, right: 78, bottom: 24, left: 78})
        assert.deepEqual(grid._gridModes, [{rows: 3, columns: 3}])
    }
    assert.equal(originals.size, 0)
})

test('folder grids without fixed icon sizing are left alone', () => {
    const grid = {layout_manager: {}, queue_relayout() {}}
    const originals = new Map()
    applyFolderLayouts(
        {_folderIcons: [{view: {_grid: grid}}]},
        {iconSize: 32, rows: 3, columns: 3, rowSpacing: 8, columnSpacing: 8},
        originals)
    assert.equal(originals.size, 0)
    restoreFolderLayouts({_folderIcons: [{view: {_grid: grid}}]}, originals)
})

function iconWithLabel(visible = true) {
    return {icon: {label: {visible}}}
}

test('app name visibility covers the grid and folder dialogs', () => {
    const mainLabel = {visible: true}
    const folderLabel = {visible: true}
    const hiddenLabel = {visible: false}
    const mainGrid = [
        {icon: {label: mainLabel}},
        {icon: {label: folderLabel}},
        {},
    ]
    const folderGrid = [{icon: {label: hiddenLabel}}]
    folderGrid.layout_manager = {}
    const appDisplay = {
        _grid: mainGrid,
        _folderIcons: [{view: {_grid: folderGrid}}],
    }
    const originals = new Map()

    assert.deepEqual(getIconLabels(appDisplay),
        [mainLabel, folderLabel, hiddenLabel])
    applyAppNameVisibility(appDisplay, false, originals)
    assert.equal(mainLabel.visible, false)
    assert.equal(folderLabel.visible, false)
    assert.equal(hiddenLabel.visible, false)
    assert.deepEqual([...originals.values()], [true, true, false])

    applyAppNameVisibility(appDisplay, true, originals)
    assert.equal(mainLabel.visible, true)
    assert.equal(folderLabel.visible, true)
    assert.equal(hiddenLabel.visible, true)

    restoreAppNameVisibility(appDisplay, originals)
    assert.equal(mainLabel.visible, true)
    assert.equal(folderLabel.visible, true)
    assert.equal(hiddenLabel.visible, false)
    assert.equal(originals.size, 0)
})

function contentFolderGrid(count = 4, cellSize = 100) {
    const grid = folderGrid()
    grid.layout_manager._pages = [{
        visibleChildren: Array.from({length: count}, () => ({
            visible: true,
            get_preferred_size: () =>
                [cellSize, cellSize, cellSize, cellSize],
        })),
    }]
    return grid
}

function contentFolderDialog(titleHeight = 80) {
    const box = {
        style: '',
        width: -1,
        height: -1,
        get_style() {
            return this.style
        },
        set_style(value) {
            this.style = value
        },
        queue_relayout() {},
    }
    return {
        _viewBox: box,
        _entryBox: {
            get_preferred_height: () => [titleHeight, titleHeight],
        },
        ensure_style() {},
    }
}

const PAGE_PADDING = {top: 24, right: 24, bottom: 24, left: 24}
const ORIGINAL_PAGE_PADDING = {top: 24, right: 78, bottom: 24, left: 78}

test('folder dimensions always keep the configured rows and columns', () => {
    assert.deepEqual(computeFolderGridDimensions(4, 3, 3),
        {rows: 3, columns: 3, paged: false})
    assert.deepEqual(computeFolderGridDimensions(2, 3, 3),
        {rows: 3, columns: 3, paged: false})
    assert.deepEqual(computeFolderGridDimensions(1, 3, 3),
        {rows: 3, columns: 3, paged: false})
    assert.deepEqual(computeFolderGridDimensions(9, 3, 3),
        {rows: 3, columns: 3, paged: false})
    assert.deepEqual(computeFolderGridDimensions(10, 3, 3),
        {rows: 3, columns: 3, paged: true})
    assert.deepEqual(computeFolderGridDimensions(null, 3, 3),
        {rows: 3, columns: 3, paged: false})
    assert.deepEqual(computeFolderGridDimensions(0, 0, 0),
        {rows: 1, columns: 1, paged: false})
})

test('folder dialog size follows cells, gaps, title and page padding', () => {
    assert.deepEqual(computeFolderDialogSize({
        rows: 2,
        columns: 3,
        cellSize: 100,
        rowSpacing: 8,
        columnSpacing: 14,
        pagePadding: PAGE_PADDING,
        titleHeight: 80,
        border: {top: 0, right: 1, bottom: 0, left: 1},
    }), {
        width: 3 * 100 + 2 * 14 + 48 + 2,
        height: 80 + 2 * 100 + 8 + 48,
    })
})

test('folder dialogs fit the configured grid and restore', () => {
    const grid = contentFolderGrid(4, 100)
    const dialog = contentFolderDialog(80)
    const icon = {view: {_grid: grid}, _dialog: dialog}
    const appDisplay = {_folderIcons: [icon]}
    const originals = new Map()
    const dialogOriginals = new Map()
    const config = {
        iconSize: 48,
        rows: 3,
        columns: 3,
        rowSpacing: 8,
        columnSpacing: 14,
        pagePadding: PAGE_PADDING,
    }

    applyFolderLayouts(appDisplay, config, originals, dialogOriginals)
    const lm = grid.layout_manager
    assert.deepEqual(grid._gridModes, [{rows: 3, columns: 3}])
    assert.equal(lm.rows_per_page, 3)
    assert.equal(lm.columns_per_page, 3)
    assert.deepEqual(lm.page_padding, PAGE_PADDING)
    assert.equal(dialog._viewBox.style,
        'width: 378px; height: 444px;')
    assert.deepEqual(dialogOriginals.get(dialog._viewBox), {
        style: '',
        width: null,
        height: null,
    })

    restoreFolderLayouts(appDisplay, originals, dialogOriginals)
    assert.equal(dialog._viewBox.style, '')
    assert.equal(dialog._viewBox.width, -1)
    assert.equal(dialog._viewBox.height, -1)
    assert.equal(lm.rows_per_page, 3)
    assert.equal(lm.columns_per_page, 3)
    assert.deepEqual(lm.page_padding, ORIGINAL_PAGE_PADDING)
    assert.equal(dialogOriginals.size, 0)
})

test('paged folders keep the configured dialog grid and Shell padding', () => {
    const grid = contentFolderGrid(10, 100)
    const dialog = contentFolderDialog(80)
    const icon = {view: {_grid: grid}, _dialog: dialog}
    const appDisplay = {_folderIcons: [icon]}
    const originals = new Map()
    const dialogOriginals = new Map()
    const config = {
        iconSize: 48,
        rows: 3,
        columns: 3,
        rowSpacing: 8,
        columnSpacing: 14,
        pagePadding: PAGE_PADDING,
    }

    applyFolderLayouts(appDisplay, config, originals, dialogOriginals)
    assert.deepEqual(grid._gridModes, [{rows: 3, columns: 3}])
    assert.deepEqual(grid.layout_manager.page_padding,
        ORIGINAL_PAGE_PADDING)
    assert.equal(dialog._viewBox.style, '')
    assert.equal(dialogOriginals.size, 0)

    restoreFolderLayouts(appDisplay, originals, dialogOriginals)
})

test('folder dimension changes reflow stale pages', () => {
    const item = () => ({
        visible: true,
        get_preferred_size: () => [100, 100, 100, 100],
    })
    const grid = folderGrid()
    grid.layout_manager.allowIncompletePages = false
    grid.layout_manager._pages = [
        {visibleChildren: Array.from({length: 4}, item)},
        {visibleChildren: Array.from({length: 2}, item)},
    ]
    let updated = 0
    const filled = []
    grid.layout_manager._updatePages = () => {
        updated += 1
    }
    grid.layout_manager._fillItemVacancies = index => {
        filled.push(index)
    }
    const dialog = contentFolderDialog(80)
    const icon = {view: {_grid: grid}, _dialog: dialog}
    const appDisplay = {_folderIcons: [icon]}
    const originals = new Map()
    const dialogOriginals = new Map()
    const config = {
        iconSize: 48,
        rows: 3,
        columns: 4,
        rowSpacing: 8,
        columnSpacing: 14,
        pagePadding: PAGE_PADDING,
    }

    applyFolderLayouts(appDisplay, config, originals, dialogOriginals)
    assert.deepEqual(grid._gridModes, [{rows: 3, columns: 4}])
    assert.equal(updated, 1)
    assert.deepEqual(filled, [0, 1])
    assert.deepEqual(grid.layout_manager.page_padding, PAGE_PADDING)

    restoreFolderLayouts(appDisplay, originals, dialogOriginals)
})

test('folder page padding is only forced while one page is enough', () => {
    const grid = folderGrid()
    const lm = grid.layout_manager
    const items = count => Array.from({length: count}, () => ({visible: true}))

    lm._pages = [{visibleChildren: items(4)}]
    assert.equal(enforceFolderPagePadding(lm, PAGE_PADDING), true)
    assert.deepEqual(lm.page_padding, PAGE_PADDING)
    assert.equal(enforceFolderPagePadding(lm, PAGE_PADDING), false)

    lm.page_padding = {...ORIGINAL_PAGE_PADDING}
    lm._pages = [
        {visibleChildren: items(9)},
        {visibleChildren: items(1)},
    ]
    assert.equal(enforceFolderPagePadding(lm, PAGE_PADDING), false)
    assert.deepEqual(lm.page_padding, ORIGINAL_PAGE_PADDING)

    lm._pages = null
    assert.equal(enforceFolderPagePadding(lm, PAGE_PADDING), false)
})

test('fixed-size adaptive folder dialogs fit the configured grid and restore', () => {
    const grid = contentFolderGrid(4, 100)
    delete grid._gridModes
    delete grid.setGridModes
    grid.layout_manager._updatePages = () => {}
    grid.layout_manager.adaptToSize = () => {}
    const dialog = contentFolderDialog(80)
    dialog._viewBox.width = 550
    dialog._viewBox.height = 550
    const icon = {view: {_grid: grid}, _dialog: dialog}
    const appDisplay = {_folderIcons: [icon]}
    const originals = new Map()
    const dialogOriginals = new Map()
    const config = {
        iconSize: 48,
        rows: 3,
        columns: 3,
        rowSpacing: 8,
        columnSpacing: 14,
        pagePadding: PAGE_PADDING,
    }

    applyFolderLayouts(appDisplay, config, originals, dialogOriginals)
    assert.equal(dialog._viewBox.style,
        'width: 378px; height: 444px;')
    assert.equal(dialog._viewBox.width, 378)
    assert.equal(dialog._viewBox.height, 444)
    assert.deepEqual(dialogOriginals.get(dialog._viewBox), {
        style: '',
        width: 550,
        height: 550,
    })

    restoreFolderLayouts(appDisplay, originals, dialogOriginals)
    assert.equal(dialog._viewBox.style, '')
    assert.equal(dialog._viewBox.width, 550)
    assert.equal(dialog._viewBox.height, 550)
    assert.equal(dialogOriginals.size, 0)
})
