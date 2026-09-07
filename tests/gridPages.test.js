import assert from 'node:assert/strict'
import test from 'node:test'

import {
    reflowPages,
    restorePersistedPageOrder,
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
