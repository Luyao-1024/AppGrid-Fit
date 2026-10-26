export const MAX_SNAPSHOTS = 20
export const SNAPSHOT_VERSION = 1

function isObject(value) {
    return value !== null && typeof value === 'object' &&
        !Array.isArray(value)
}

function isStoredValue(value) {
    return isObject(value) &&
        typeof value.type === 'string' && value.type.length > 0 &&
        typeof value.value === 'string'
}

function isSnapshot(value) {
    return isObject(value) &&
        value.version === SNAPSHOT_VERSION &&
        typeof value.id === 'string' && value.id.length > 0 &&
        typeof value.name === 'string' && value.name.length > 0 &&
        typeof value.created === 'string' &&
        isObject(value.settings) &&
        Object.values(value.settings).every(isStoredValue) &&
        isStoredValue(value.appPicker) &&
        isObject(value.folders) &&
        Array.isArray(value.folders.children) &&
        isObject(value.folders.items) &&
        Object.values(value.folders.items).every(folder =>
            isObject(folder) &&
            Object.values(folder).every(isStoredValue)) &&
        isObject(value.summary)
}

export function parseSnapshots(raw) {
    if (typeof raw !== 'string' || !raw)
        return []
    try {
        const data = JSON.parse(raw)
        if (!Array.isArray(data))
            return []
        return data.filter(isSnapshot)
            .sort((a, b) => b.created.localeCompare(a.created))
    } catch (_error) {
        return []
    }
}

export function serializeSnapshots(snapshots) {
    return JSON.stringify(snapshots.filter(isSnapshot))
}

export function addSnapshot(snapshots, snapshot) {
    return [snapshot, ...snapshots.filter(item => item.id !== snapshot.id)]
        .sort((a, b) => b.created.localeCompare(a.created))
        .slice(0, MAX_SNAPSHOTS)
}

export function removeSnapshot(snapshots, id) {
    return snapshots.filter(snapshot => snapshot.id !== id)
}

export function snapshotLabel(snapshot, gettext = value => value) {
    const summary = snapshot?.summary ?? {}
    const parts = []
    if (Number.isFinite(summary.iconSize))
        parts.push(`${summary.iconSize}px`)
    if (Number.isFinite(summary.rows) && Number.isFinite(summary.columns))
        parts.push(`${summary.rows}×${summary.columns}`)
    if (Number.isFinite(summary.folderRows) &&
        Number.isFinite(summary.folderColumns))
        parts.push(`${gettext('folder')} ${summary.folderRows}×${summary.folderColumns}`)
    parts.push(summary.showNames ? gettext('names') : gettext('no names'))
    return parts.join(' · ')
}
