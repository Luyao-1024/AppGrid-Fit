import assert from 'node:assert/strict'
import test from 'node:test'

import {
    reflowPages,
    restorePersistedPageOrder,
    syncPageManagerPages,
} from '../gridPages.js'

function page(size) {
    return {visibleChildren: Array.from({length: size}, () => ({}))}
}

test('shrinking capacity invokes the Shell overflow reflow', () => {
    let updates = 0
    const layoutManager = {
        rows_per_page: 2,
        columns_per_page: 2,
        _pages: [page(6)],
        _updatePages() {
            updates++
            this._pages = [page(4), page(2)]
        },
    }

    assert.equal(reflowPages(layoutManager), true)
    assert.equal(updates, 1)
    assert.deepEqual(
        layoutManager._pages.map(p => p.visibleChildren.length), [4, 2])
})

test('normal reflow preserves incomplete page boundaries', () => {
    let fills = 0
    const layoutManager = {
        rows_per_page: 2,
        columns_per_page: 2,
        _pages: [page(2), page(2)],
        _fillItemVacancies() {
            fills++
        },
    }

    assert.equal(reflowPages(layoutManager), false)
    assert.equal(fills, 0)
})

test('page manager mirrors reflowed pages in memory', () => {
    const first = [{id: 'a'}, {id: 'b'}]
    const second = [{id: 'c'}, {id: 'd'}]
    const layoutManager = {
        _pages: [
            {visibleChildren: first},
            {visibleChildren: second},
        ],
    }
    const appDisplay = {_pageManager: {_pages: []}}

    assert.equal(syncPageManagerPages(appDisplay, layoutManager), true)
    assert.deepEqual(appDisplay._pageManager._pages, [
        {a: {position: 0}, b: {position: 1}},
        {c: {position: 0}, d: {position: 1}},
    ])
    assert.equal(syncPageManagerPages(appDisplay, layoutManager), false)
    assert.equal(syncPageManagerPages({}, layoutManager), false)
})

test('overflow reflow rebuilds pages in original order', () => {
    const items = Array.from({length: 8}, (_, index) => ({
        id: String.fromCharCode(97 + index),
    }))
    const rebuilt = []
    const layoutManager = {
        rows_per_page: 2,
        columns_per_page: 3,
        _pages: [
            {children: items, visibleChildren: items},
        ],
        _removeItemData(item) {
            assert.equal(this.allowIncompletePages, true)
            assert.ok(items.includes(item))
        },
        _addItemToPage(item, pageIndex, index) {
            assert.equal(this.allowIncompletePages, true)
            assert.equal(index, -1)
            rebuilt[pageIndex] ??= []
            rebuilt[pageIndex].push(item)
        },
        _updatePages() {
            throw new Error('Shell page reflow must not reorder items')
        },
    }

    assert.equal(reflowPages(layoutManager), true)
    assert.deepEqual(rebuilt.map(page => page.map(item => item.id)), [
        ['a', 'b', 'c', 'd', 'e', 'f'],
        ['g', 'h'],
    ])
    assert.equal(Object.hasOwn(layoutManager, 'allowIncompletePages'), false)
})

test('overflow reflow restores prototype allowIncompletePages', () => {
    const items = Array.from({length: 5}, (_, index) => ({
        id: String.fromCharCode(97 + index),
    }))
    let allowIncompletePages = false
    const prototype = {
        get allowIncompletePages() {
            return allowIncompletePages
        },
        set allowIncompletePages(value) {
            allowIncompletePages = value
        },
    }
    const layoutManager = Object.assign(Object.create(prototype), {
        rows_per_page: 2,
        columns_per_page: 2,
        _pages: [{children: items, visibleChildren: items}],
        _removeItemData() {
            assert.equal(this.allowIncompletePages, true)
        },
        _addItemToPage() {
            assert.equal(this.allowIncompletePages, true)
        },
    })

    assert.equal(reflowPages(layoutManager), true)
    assert.equal(allowIncompletePages, false)
    assert.equal(Object.hasOwn(layoutManager, 'allowIncompletePages'), false)
})

test('explicit consolidation fills earlier pages', () => {
    const layoutManager = {
        rows_per_page: 2,
        columns_per_page: 2,
        _pages: [page(2), page(2)],
        _fillItemVacancies(pageIndex) {
            const current = this._pages[pageIndex].visibleChildren
            const next = this._pages[pageIndex + 1].visibleChildren
            current.push(...next.splice(0, 4 - current.length))
            if (next.length === 0)
                this._pages.splice(pageIndex + 1, 1)
        },
    }

    assert.equal(reflowPages(layoutManager, {consolidate: true}), true)
    assert.deepEqual(
        layoutManager._pages.map(p => p.visibleChildren.length), [4])
})

test('missing private reflow APIs fail without claiming a change', () => {
    const warnings = []
    const layoutManager = {
        rows_per_page: 2,
        columns_per_page: 2,
        _pages: [page(6)],
    }

    assert.equal(reflowPages(layoutManager, {
        warn: message => warnings.push(message),
    }), false)
    assert.deepEqual(warnings, ['page overflow cannot be rearranged'])
})

test('consolidation stops when the Shell makes no progress', () => {
    const layoutManager = {
        rows_per_page: 2,
        columns_per_page: 3,
        _pages: [page(3), page(3)],
        _fillItemVacancies() {},
    }

    assert.equal(reflowPages(layoutManager, {consolidate: true}), false)
    assert.deepEqual(
        layoutManager._pages.map(p => p.visibleChildren.length), [3, 3])
})

test('saved order is restored before pages are split to the configured capacity', () => {
    const items = 'abcdef'.split('').map(id => ({id}))
    const layoutManager = {
        rows_per_page: 2,
        columns_per_page: 2,
        _pages: [
            {visibleChildren: items.slice(0, 4)},
            {visibleChildren: [items[5], items[4]]},
        ],
        _updatePages() {
            const ordered = this._pages[0].visibleChildren
            this._pages = [
                {visibleChildren: ordered.slice(0, 4)},
                {visibleChildren: ordered.slice(4)},
            ]
        },
    }
    const appDisplay = {
        _redisplay() {
            assert.equal(layoutManager.rows_per_page, 1)
            assert.equal(layoutManager.columns_per_page, 6)
            layoutManager._pages = [{visibleChildren: items}]
        },
    }

    assert.equal(
        restorePersistedPageOrder(appDisplay, layoutManager), true)
    assert.equal(layoutManager.rows_per_page, 2)
    assert.equal(layoutManager.columns_per_page, 2)
    assert.equal(reflowPages(layoutManager), true)
    assert.deepEqual(
        layoutManager._pages.map(p => p.visibleChildren.map(item => item.id)),
        [['a', 'b', 'c', 'd'], ['e', 'f']])
})

test('adaptive grids keep temporary capacity while restoring saved order', () => {
    const items = 'abcdef'.split('').map(id => ({id}))
    const layoutManager = {
        rows_per_page: 2,
        columns_per_page: 2,
        _fixedRows: 2,
        _fixedCols: 2,
        _pages: [
            {visibleChildren: items.slice(0, 4)},
            {visibleChildren: items.slice(4)},
        ],
        adaptToSize() {
            this.rows_per_page = this._fixedRows
            this.columns_per_page = this._fixedCols
        },
    }
    const appDisplay = {
        _redisplay() {
            assert.equal(layoutManager._fixedRows, 1)
            assert.equal(layoutManager._fixedCols, 6)
            layoutManager.adaptToSize()
            assert.equal(layoutManager.rows_per_page, 1)
            assert.equal(layoutManager.columns_per_page, 6)
            layoutManager._pages = [{visibleChildren: items}]
        },
    }

    assert.equal(
        restorePersistedPageOrder(appDisplay, layoutManager), true)
    assert.equal(layoutManager.rows_per_page, 2)
    assert.equal(layoutManager.columns_per_page, 2)
    assert.equal(layoutManager._fixedRows, 2)
    assert.equal(layoutManager._fixedCols, 2)
})

test('saved order restoration waits until grid items are available', () => {
    const layoutManager = {
        rows_per_page: 2,
        columns_per_page: 2,
        _pages: [],
    }

    assert.equal(restorePersistedPageOrder({
        _redisplay() {
            assert.fail('empty grids must not be redisplayed')
        },
    }, layoutManager), false)
})

test('a 32-item grid keeps all 39 saved items in order across page reflow', () => {
    const items = Array.from({length: 39}, (_, id) => ({id}))
    const layoutManager = {
        rows_per_page: 4,
        columns_per_page: 8,
        _pages: [
            {visibleChildren: items.slice(0, 24)},
            {visibleChildren: items.slice(24).reverse()},
        ],
        _updatePages() {
            const ordered = this._pages[0].visibleChildren
            const capacity = this.rows_per_page * this.columns_per_page
            this._pages = []
            for (let start = 0; start < ordered.length; start += capacity) {
                this._pages.push({
                    visibleChildren: ordered.slice(start, start + capacity),
                })
            }
        },
    }
    const appDisplay = {
        _redisplay() {
            assert.equal(layoutManager.rows_per_page, 1)
            assert.equal(layoutManager.columns_per_page, 39)
            layoutManager._pages = [{visibleChildren: items}]
        },
    }

    assert.equal(
        restorePersistedPageOrder(appDisplay, layoutManager), true)
    assert.equal(reflowPages(layoutManager), true)
    assert.deepEqual(
        layoutManager._pages.map(page => page.visibleChildren.length),
        [32, 7])
    assert.deepEqual(
        layoutManager._pages.flatMap(page =>
            page.visibleChildren.map(item => item.id)),
        items.map(item => item.id))
})
