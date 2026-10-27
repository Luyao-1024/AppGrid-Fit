import { SNAPSHOT_SETTINGS_KEYS } from './config.js'
import { SNAPSHOT_VERSION } from './snapshots.js'

export function storedValue(settings, key) {
    const value = settings.get_value(key)
    return {
        type: value.get_type_string(),
        value: value.print(true),
    }
}

export function captureFolderSettings(folderSettings, folderSettingsFor) {
    const children = folderSettings.get_strv('folder-children')
    const items = {}
    for (const id of children) {
        const settings = folderSettingsFor(id)
        const keys = {}
        for (const key of settings.list_keys())
            keys[key] = storedValue(settings, key)
        items[id] = keys
    }
    return {children, items}
}

export function captureSnapshot({
    settings,
    shellSettings,
    folderSettings,
    folderSettingsFor,
    name,
    summary,
    settingsKeys = SNAPSHOT_SETTINGS_KEYS,
    now = Date.now(),
    random = Math.random(),
}) {
    const picker = shellSettings.get_value('app-picker-layout')
    return {
        version: SNAPSHOT_VERSION,
        id: `${now}-${random.toString(36).slice(2, 8)}`,
        name,
        created: new Date(now).toISOString(),
        settings: Object.fromEntries(settingsKeys.map(key =>
            [key, storedValue(settings, key)])),
        appPicker: {
            type: picker.get_type_string(),
            value: picker.print(true),
        },
        folders: captureFolderSettings(folderSettings, folderSettingsFor),
        summary,
    }
}

export function restoreSnapshot({
    settings,
    shellSettings,
    folderSettings,
    folderSettingsFor,
    snapshot,
    applyStoredValue,
    settingsKeys = SNAPSHOT_SETTINGS_KEYS,
}) {
    for (const [id, keys] of Object.entries(snapshot.folders.items)) {
        const folder = folderSettingsFor(id)
        for (const [key, stored] of Object.entries(keys))
            applyStoredValue(folder, key, stored)
    }
    folderSettings.set_strv('folder-children',
        snapshot.folders.children)
    applyStoredValue(shellSettings, 'app-picker-layout',
        snapshot.appPicker)
    for (const key of settingsKeys) {
        const stored = snapshot.settings[key]
        if (stored)
            applyStoredValue(settings, key, stored)
    }
}
