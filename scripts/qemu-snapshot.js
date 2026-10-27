#!/usr/bin/env gjs -m
import Gio from 'gi://Gio'
import GLib from 'gi://GLib'

const [extensionDir, command, ...args] = ARGV
const {captureSnapshot, restoreSnapshot} =
    await import(`file://${extensionDir}/snapshotStore.js`)
const {addSnapshot, parseSnapshots, serializeSnapshots} =
    await import(`file://${extensionDir}/snapshots.js`)

const settings = new Gio.Settings({
    schema_id: 'org.gnome.shell.extensions.appgrid-size',
})
const shellSettings = new Gio.Settings({schema_id: 'org.gnome.shell'})
const folderSettings = new Gio.Settings({
    schema_id: 'org.gnome.desktop.app-folders',
})
const folderSettingsFor = id => new Gio.Settings({
    schema_id: 'org.gnome.desktop.app-folders.folder',
    path: `${folderSettings.path}folders/${id}/`,
})

function applyStoredValue(settings, key, stored) {
    const type = new GLib.VariantType(stored.type)
    const value = GLib.Variant.parse(type, stored.value, null, null)
    settings.set_value(key, value)
    Gio.Settings.sync()
}

function snapshots() {
    return parseSnapshots(settings.get_string('layout-snapshots'))
}

function persist(values) {
    settings.set_string('layout-snapshots', serializeSnapshots(values))
    Gio.Settings.sync()
}

if (command === 'capture') {
    const [name, summaryJSON] = args
    const summary = JSON.parse(summaryJSON)
    const snapshot = captureSnapshot({
        settings,
        shellSettings,
        folderSettings,
        folderSettingsFor,
        name,
        summary,
    })
    persist(addSnapshot(snapshots(), snapshot))
    print(snapshot.id)
} else if (command === 'restore') {
    const [id] = args
    const snapshot = snapshots().find(item => item.id === id)
    if (!snapshot)
        throw new Error(`snapshot not found: ${id}`)
    restoreSnapshot({
        settings,
        shellSettings,
        folderSettings,
        folderSettingsFor,
        snapshot,
        applyStoredValue,
    })
    Gio.Settings.sync()
    print(JSON.stringify({
        id: snapshot.id,
        name: snapshot.name,
        children: snapshot.folders.children,
    }))
} else if (command === 'append') {
    const [snapshotJSON] = args
    const snapshot = JSON.parse(snapshotJSON)
    persist(addSnapshot(snapshots(), snapshot))
    print(snapshot.id)
} else if (command === 'show') {
    const [id] = args
    const snapshot = snapshots().find(item => item.id === id)
    if (!snapshot)
        throw new Error(`snapshot not found: ${id}`)
    const picker = GLib.Variant.parse(
        new GLib.VariantType(snapshot.appPicker.type),
        snapshot.appPicker.value, null, null)
    print(JSON.stringify({
        ...snapshot,
        appPickerPages: picker.deepUnpack().map(page =>
            Object.keys(page)),
    }))
} else if (command === 'list') {
    print(JSON.stringify(snapshots().map(item => ({
        id: item.id,
        name: item.name,
        created: item.created,
        children: item.folders.children,
        folderApps: Object.fromEntries(
            Object.entries(item.folders.items).map(([id, keys]) =>
                [id, keys.apps?.value ?? null])),
        summary: item.summary,
    }))))
} else {
    throw new Error(`unknown command: ${command}`)
}
