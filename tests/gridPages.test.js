import assert from 'node:assert/strict'
import test from 'node:test'

import {reflowPages} from '../gridPages.js'

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
