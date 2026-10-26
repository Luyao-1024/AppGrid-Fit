import assert from 'node:assert/strict'
import test from 'node:test'
import {
    MAX_SNAPSHOTS,
    addSnapshot,
    parseSnapshots,
    removeSnapshot,
    serializeSnapshots,
    snapshotLabel,
} from '../snapshots.js'

function stored(type, value) {
    return {type, value}
}

function snapshot(id, created = '2026-10-26T12:00:00.000Z') {
    return {
        version: 1,
        id,
        name: `Layout ${id}`,
        created,
        settings: {
            'custom-icon-size': stored('i', '64'),
            'show-app-names': stored('b', 'true'),
        },
        appPicker: stored('aa{sv}', '[]'),
        folders: {
            children: [],
            items: {},
        },
        summary: {
            iconSize: 64,
            rows: 6,
            columns: 9,
            folderRows: 3,
            folderColumns: 4,
            showNames: true,
        },
    }
}

test('snapshots round-trip through JSON and validation', () => {
    const values = [snapshot('a'), snapshot('b')]
    const parsed = parseSnapshots(serializeSnapshots(values))
    assert.deepEqual(parsed.map(item => item.id), ['a', 'b'])
    assert.deepEqual(parseSnapshots(''), [])
    assert.deepEqual(parseSnapshots('not json'), [])
    assert.deepEqual(parseSnapshots('{}'), [])
    assert.deepEqual(parseSnapshots(JSON.stringify([{version: 1}])), [])
    assert.deepEqual(parseSnapshots(JSON.stringify([
        {...snapshot('bad'), appPicker: null},
    ])), [])
})

test('snapshots are ordered newest first and capped', () => {
    let values = []
    for (let index = 0; index < MAX_SNAPSHOTS; index++) {
        values = addSnapshot(values, snapshot(String(index),
            `2026-10-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`))
    }
    assert.equal(values.length, MAX_SNAPSHOTS)
    assert.equal(values[0].id, String(MAX_SNAPSHOTS - 1))

    values = addSnapshot(values, snapshot('new',
        '2026-11-01T00:00:00.000Z'))
    assert.equal(values.length, MAX_SNAPSHOTS)
    assert.equal(values[0].id, 'new')
    assert.equal(values.some(item => item.id === '0'), false)

    values = removeSnapshot(values, 'new')
    assert.equal(values.length, MAX_SNAPSHOTS - 1)
    assert.equal(values[0].id, String(MAX_SNAPSHOTS - 1))
})

test('snapshot labels summarise the saved layout', () => {
    assert.equal(snapshotLabel(snapshot('a')),
        '64px · 6×9 · folder 3×4 · names')
    const hidden = snapshot('b')
    hidden.summary.showNames = false
    assert.match(snapshotLabel(hidden), /no names$/)
    assert.equal(snapshotLabel(null), 'no names')
})

test('snapshot labels use the supplied translator', () => {
    const translate = value => ({
        folder: '文件夹', names: '名称', 'no names': '无名称',
    })[value] ?? value
    assert.equal(snapshotLabel(snapshot('a'), translate),
        '64px · 6×9 · 文件夹 3×4 · 名称')
    const hidden = snapshot('b')
    hidden.summary.showNames = false
    assert.equal(snapshotLabel(hidden, translate),
        '64px · 6×9 · 文件夹 3×4 · 无名称')
})
