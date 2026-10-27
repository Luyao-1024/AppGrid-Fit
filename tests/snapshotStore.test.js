import assert from 'node:assert/strict'
import test from 'node:test'
import { SNAPSHOT_SETTINGS_KEYS } from '../config.js'
import {
    captureSnapshot,
    restoreSnapshot,
} from '../snapshotStore.js'

function variant(type, text) {
    return {
        get_type_string: () => type,
        print: () => text,
    }
}

function stored(type, value) {
    return {type, value}
}

class FakeSettings {
    constructor(name, entries = {}, log = []) {
        this.name = name
        this.values = new Map(Object.entries(entries))
        this.log = log
    }

    get_value(key) {
        return this.values.get(key)
    }

    set_value(key, value) {
        this.log.push([this.name, 'set', key, value])
        this.values.set(key, value)
    }

    get_strv(key) {
        return this.values.get(key) ?? []
    }

    set_strv(key, value) {
        this.log.push([this.name, 'set_strv', key, [...value]])
        this.values.set(key, [...value])
    }

    list_keys() {
        return [...this.values.keys()]
    }
}

function applyStored(settings, key, value) {
    settings.set_value(key, variant(value.type, value.value))
}

function restoreArgs(settings, shellSettings, folderSettings, folderMap,
    snapshot, log) {
    return {
        settings,
        shellSettings,
        folderSettings,
        folderSettingsFor: id => folderMap.get(id),
        snapshot,
        applyStoredValue: applyStored,
        settingsKeys: Object.keys(snapshot.settings),
        log,
    }
}

test('capture stores settings, app picker and every folder key', () => {
    const extEntries = Object.fromEntries(SNAPSHOT_SETTINGS_KEYS.map(
        (key, index) => [key, variant('i', String(index))]))
    extEntries['layout-snapshots'] = variant('s', "'self'")
    extEntries['runtime-preview-layout'] = variant('s', "'preview'")
    const settings = new FakeSettings('ext', extEntries)
    const shellSettings = new FakeSettings('shell', {
        'app-picker-layout': variant('aa{sv}',
            "[{'work': <{'position': <0>}>}]"),
    })
    const folderSettings = new FakeSettings('folders', {
        'folder-children': ['work', 'games'],
    })
    const work = new FakeSettings('work', {
        name: variant('s', "'Work'"),
        apps: variant('as', "['a.desktop', 'b.desktop']"),
    })
    const games = new FakeSettings('games', {
        name: variant('s', "'Games'"),
        apps: variant('as', "['c.desktop']"),
    })
    const folderMap = new Map([['work', work], ['games', games]])
    const summary = {
        iconSize: 32,
        rows: 8,
        columns: 12,
        folderRows: 3,
        folderColumns: 4,
        showNames: true,
        pages: 2,
    }

    const snapshot = captureSnapshot({
        settings,
        shellSettings,
        folderSettings,
        folderSettingsFor: id => folderMap.get(id),
        name: 'Work layout',
        summary,
        now: 1700000000000,
        random: 0.123456789,
    })

    assert.match(snapshot.id, /^1700000000000-/)
    assert.equal(snapshot.created, new Date(1700000000000).toISOString())
    assert.equal(snapshot.name, 'Work layout')
    assert.deepEqual(snapshot.summary, summary)
    assert.deepEqual(Object.keys(snapshot.settings), SNAPSHOT_SETTINGS_KEYS)
    assert.equal(snapshot.settings['layout-snapshots'], undefined)
    assert.equal(snapshot.settings['runtime-preview-layout'], undefined)
    assert.deepEqual(snapshot.appPicker, {
        type: 'aa{sv}',
        value: "[{'work': <{'position': <0>}>}]",
    })
    assert.deepEqual(snapshot.folders.children, ['work', 'games'])
    assert.deepEqual(snapshot.folders.items.work.apps,
        stored('as', "['a.desktop', 'b.desktop']"))
    assert.deepEqual(snapshot.folders.items.games.name,
        stored('s', "'Games'"))
})

test('restore rewrites folder keys, folder list, picker and settings in order', () => {
    const log = []
    const settings = new FakeSettings('ext', {}, log)
    const shellSettings = new FakeSettings('shell', {}, log)
    const folderSettings = new FakeSettings('folders', {}, log)
    const folder = new FakeSettings('folder:work', {}, log)
    const folderMap = new Map([['work', folder]])
    const snapshot = {
        version: 1,
        id: 'layout-a',
        name: 'Layout A',
        created: '2026-10-27T00:00:00.000Z',
        settings: {
            'custom-icon-size': stored('i', '32'),
            'show-app-names': stored('b', 'false'),
        },
        appPicker: stored('aa{sv}',
            "[{'work': <{'position': <0>}>}]"),
        folders: {
            children: ['work'],
            items: {
                work: {
                    name: stored('s', "'Work'"),
                    apps: stored('as',
                        "['a.desktop', 'b.desktop']"),
                },
            },
        },
        summary: {},
    }

    restoreSnapshot(restoreArgs(settings, shellSettings, folderSettings,
        folderMap, snapshot, log))

    assert.deepEqual(log.map(entry => entry.slice(0, 3)), [
        ['folder:work', 'set', 'name'],
        ['folder:work', 'set', 'apps'],
        ['folders', 'set_strv', 'folder-children'],
        ['shell', 'set', 'app-picker-layout'],
        ['ext', 'set', 'custom-icon-size'],
        ['ext', 'set', 'show-app-names'],
    ])
    assert.deepEqual(folderSettings.values.get('folder-children'), ['work'])
    assert.equal(folder.values.get('apps').print(),
        "['a.desktop', 'b.desktop']")
    assert.equal(shellSettings.values.get('app-picker-layout').print(),
        "[{'work': <{'position': <0>}>}]")
    assert.equal(settings.values.get('custom-icon-size').print(), '32')
    assert.equal(settings.values.get('show-app-names').print(), 'false')
})

test('two layouts restore their own folder children and grid settings', () => {
    const settings = new FakeSettings('ext', {})
    const shellSettings = new FakeSettings('shell', {
        'app-picker-layout': variant('aa{sv}', '[]'),
    })
    const folderSettings = new FakeSettings('folders', {
        'folder-children': ['work'],
    })
    const folder = new FakeSettings('folder:work', {
        apps: variant('as', "['a.desktop', 'b.desktop']"),
    })
    const folderMap = new Map([['work', folder]])

    function capture(name, apps, iconSize) {
        folder.values.set('apps', variant('as', apps))
        settings.values.set('custom-icon-size', variant('i', String(iconSize)))
        shellSettings.values.set('app-picker-layout',
            variant('aa{sv}', `[{'work': <{'position': <0>}>}, ` +
                `{'apps': <{'position': <1>}>}]`))
        return captureSnapshot({
            settings,
            shellSettings,
            folderSettings,
            folderSettingsFor: id => folderMap.get(id),
            name,
            summary: {iconSize},
            settingsKeys: ['custom-icon-size'],
            now: 1700000000000 + iconSize,
            random: 0.5,
        })
    }

    const layoutA = capture('Layout A',
        "['a.desktop', 'b.desktop']", 32)
    const layoutB = capture('Layout B', "['c.desktop']", 64)
    const frozenA = JSON.stringify(layoutA)
    const frozenB = JSON.stringify(layoutB)

    restoreSnapshot(restoreArgs(settings, shellSettings, folderSettings,
        folderMap, layoutA))
    assert.equal(folder.values.get('apps').print(),
        "['a.desktop', 'b.desktop']")
    assert.equal(settings.values.get('custom-icon-size').print(), '32')

    restoreSnapshot(restoreArgs(settings, shellSettings, folderSettings,
        folderMap, layoutB))
    assert.equal(folder.values.get('apps').print(), "['c.desktop']")
    assert.equal(settings.values.get('custom-icon-size').print(), '64')

    assert.equal(JSON.stringify(layoutA), frozenA)
    assert.equal(JSON.stringify(layoutB), frozenB)
    assert.notEqual(JSON.stringify(layoutA.folders.items),
        JSON.stringify(layoutB.folders.items))
})

test('restore keeps removed app ids and does not invent newly added apps', () => {
    const settings = new FakeSettings('ext', {})
    const shellSettings = new FakeSettings('shell', {})
    const folderSettings = new FakeSettings('folders', {})
    const folder = new FakeSettings('folder:work', {})
    const folderMap = new Map([['work', folder]])
    const missingFolderApp = 'removed.desktop'
    const newApp = 'installed-after-snapshot.desktop'
    const savedPicker = "[{'a.desktop': <{'position': <0>}>}, " +
        `{'${missingFolderApp}': <{'position': <1>}>}]`
    const snapshot = {
        version: 1,
        id: 'layout-a',
        name: 'Layout A',
        created: '2026-10-27T00:00:00.000Z',
        settings: {},
        appPicker: stored('aa{sv}', savedPicker),
        folders: {
            children: ['work'],
            items: {
                work: {
                    apps: stored('as',
                        `['a.desktop', '${missingFolderApp}']`),
                },
            },
        },
        summary: {},
    }

    restoreSnapshot(restoreArgs(settings, shellSettings, folderSettings,
        folderMap, snapshot))

    const restoredFolderApps = folder.values.get('apps').print()
    const restoredPicker = shellSettings
        .values.get('app-picker-layout').print()
    assert.match(restoredFolderApps, new RegExp(missingFolderApp))
    assert.match(restoredPicker, new RegExp(missingFolderApp))
    assert.doesNotMatch(restoredPicker, new RegExp(newApp))
})

test('restore drops later folders from children without deleting settings', () => {
    const settings = new FakeSettings('ext', {})
    const shellSettings = new FakeSettings('shell', {})
    const folderSettings = new FakeSettings('folders', {
        'folder-children': ['snapshot', 'later'],
    })
    const snapshotFolder = new FakeSettings('folder:snapshot', {
        name: variant('s', "'Snapshot'"),
    })
    const laterFolder = new FakeSettings('folder:later', {
        name: variant('s', "'Later'"),
        apps: variant('as', "['later.desktop']"),
    })
    const folderMap = new Map([
        ['snapshot', snapshotFolder],
        ['later', laterFolder],
    ])
    const requested = []
    const snapshot = {
        version: 1,
        id: 'layout-a',
        name: 'Layout A',
        created: '2026-10-27T00:00:00.000Z',
        settings: {},
        appPicker: stored('aa{sv}', '[]'),
        folders: {
            children: ['snapshot'],
            items: {
                snapshot: {
                    name: stored('s', "'Snapshot'"),
                },
            },
        },
        summary: {},
    }

    restoreSnapshot({
        settings,
        shellSettings,
        folderSettings,
        folderSettingsFor: id => {
            requested.push(id)
            return folderMap.get(id)
        },
        snapshot,
        applyStoredValue: applyStored,
        settingsKeys: [],
    })

    assert.deepEqual(requested, ['snapshot'])
    assert.deepEqual(folderSettings.values.get('folder-children'),
        ['snapshot'])
    assert.equal(laterFolder.values.get('name').print(), "'Later'")
    assert.equal(laterFolder.values.get('apps').print(),
        "['later.desktop']")
})

test('renamed desktop ids are not migrated', () => {
    const settings = new FakeSettings('ext', {})
    const shellSettings = new FakeSettings('shell', {})
    const folderSettings = new FakeSettings('folders', {})
    const folder = new FakeSettings('folder:work', {})
    const folderMap = new Map([['work', folder]])
    const snapshot = {
        version: 1,
        id: 'layout-a',
        name: 'Layout A',
        created: '2026-10-27T00:00:00.000Z',
        settings: {},
        appPicker: stored('aa{sv}',
            "[{'old.desktop': <{'position': <0>}>}]"),
        folders: {
            children: ['work'],
            items: {
                work: {
                    apps: stored('as', "['old.desktop']"),
                },
            },
        },
        summary: {},
    }

    restoreSnapshot(restoreArgs(settings, shellSettings, folderSettings,
        folderMap, snapshot))

    assert.equal(folder.values.get('apps').print(), "['old.desktop']")
    const picker = shellSettings.values.get('app-picker-layout').print()
    assert.match(picker, /old\.desktop/)
    assert.doesNotMatch(picker, /new\.desktop/)
})

test('restore replaces the current picker instead of merging it', () => {
    const settings = new FakeSettings('ext', {})
    const shellSettings = new FakeSettings('shell', {
        'app-picker-layout': variant('aa{sv}',
            "[{'current.desktop': <{'position': <0>}>}]"),
    })
    const folderSettings = new FakeSettings('folders', {})
    const snapshot = {
        version: 1,
        id: 'layout-a',
        name: 'Layout A',
        created: '2026-10-27T00:00:00.000Z',
        settings: {},
        appPicker: stored('aa{sv}',
            "[{'saved.desktop': <{'position': <0>}>}]"),
        folders: {
            children: [],
            items: {},
        },
        summary: {},
    }

    restoreSnapshot(restoreArgs(settings, shellSettings, folderSettings,
        new Map(), snapshot))

    assert.equal(shellSettings.values.get('app-picker-layout').print(),
        "[{'saved.desktop': <{'position': <0>}>}]")
    assert.doesNotMatch(
        shellSettings.values.get('app-picker-layout').print(),
        /current\.desktop/)
})

test('restore writes folders that no longer exist on disk', () => {
    const settings = new FakeSettings('ext', {})
    const shellSettings = new FakeSettings('shell', {})
    const folderSettings = new FakeSettings('folders', {})
    const folderMap = new Map()
    const created = []
    const snapshot = {
        version: 1,
        id: 'layout-a',
        name: 'Layout A',
        created: '2026-10-27T00:00:00.000Z',
        settings: {},
        appPicker: stored('aa{sv}', '[]'),
        folders: {
            children: ['restored'],
            items: {
                restored: {
                    name: stored('s', "'Restored'"),
                    apps: stored('as', "['a.desktop']"),
                },
            },
        },
        summary: {},
    }

    restoreSnapshot({
        settings,
        shellSettings,
        folderSettings,
        folderSettingsFor: id => {
            created.push(id)
            const folder = new FakeSettings(`folder:${id}`)
            folderMap.set(id, folder)
            return folder
        },
        snapshot,
        applyStoredValue: applyStored,
        settingsKeys: [],
    })

    assert.deepEqual(created, ['restored'])
    assert.equal(folderMap.get('restored').values.get('name').print(),
        "'Restored'")
    assert.deepEqual(folderSettings.values.get('folder-children'),
        ['restored'])
})
