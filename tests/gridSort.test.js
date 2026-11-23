import assert from 'node:assert/strict'
import test from 'node:test'

import {restoreGridPages, sameGridPages, sortGridPages} from '../gridSort.js'

const appApple = {id: 'last.desktop', name: 'Apple'}
const appGrape = {id: 'first.desktop', name: 'Grape'}
const appPear = {id: 'pear.desktop', name: 'Pear'}
const folderBanana = {id: 'folder1', name: 'Banana'}
const folderOrange = {id: 'folder2', name: 'Orange'}
const folders = new Set([folderBanana, folderOrange])
const pages = [[folderOrange, appPear], [appGrape, folderBanana, appApple]]
const collator = new Intl.Collator('en')

test('sorts across pages in both directions with all three folder positions', () => {
    for (const [descending, folderPosition, expected] of [
        [false, 'mixed', [appApple, folderBanana, appGrape, folderOrange, appPear]],
        [true, 'mixed', [appPear, folderOrange, appGrape, folderBanana, appApple]],
        [false, 'first', [folderBanana, folderOrange, appApple, appGrape, appPear]],
        [true, 'first', [folderOrange, folderBanana, appPear, appGrape, appApple]],
        [false, 'last', [appApple, appGrape, appPear, folderBanana, folderOrange]],
        [true, 'last', [appPear, appGrape, appApple, folderOrange, folderBanana]],
    ]) {
        const sorted = sortGridPages(pages, 2, {
            descending, folderPosition, folders, collator,
        })
        assert.deepEqual(sorted, [expected.slice(0, 2), expected.slice(2, 4), expected.slice(4)])
    }
    assert.deepEqual(pages, [[folderOrange, appPear], [appGrape, folderBanana, appApple]])
})

test('uses the selected locale and preserves ties when reversing', () => {
    const firstZebra = {id: 'z1', name: 'Zebra'}
    const secondZebra = {id: 'z2', name: 'Zebra'}
    const appApple = {id: 'o1', name: 'Äpple'}
    const sorted = sortGridPages([[firstZebra], [secondZebra, appApple]], 2, {
        descending: true, folderPosition: 'mixed', folders,
        collator: new Intl.Collator('sv'),
    })
    assert.deepEqual(sorted, [[appApple, firstZebra], [secondZebra]])
    assert.ok(sameGridPages(sorted, [[appApple, firstZebra], [secondZebra]]))
    assert.equal(sameGridPages(sorted, [[appApple], [firstZebra, secondZebra]]), false)
})

test('restores saved positions and page boundaries from different live pages', () => {
    const newApp = {id: 'new.desktop', name: 'New'}
    const saved = [
        {[appApple.id]: {position: 2}, missing: {position: 1}, [appPear.id]: {position: 0}},
        {[folderBanana.id]: {position: 0}},
    ]
    const live = [[newApp, folderBanana], [appApple, appPear]]
    assert.deepEqual(restoreGridPages(saved, live, 2),
        [[appPear, appApple], [folderBanana], [newApp]])
    assert.deepEqual(restoreGridPages(saved, live, 1),
        [[appPear], [appApple], [folderBanana], [newApp]])
})
