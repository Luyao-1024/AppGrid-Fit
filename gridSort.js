export const SORT_INTERFACE = 'org.gnome.Shell.Extensions.AppGridFit'
export const SORT_PATH = '/org/gnome/Shell/Extensions/AppGridFit'
export const SORT_XML = `<node><interface name="${SORT_INTERFACE}">
    <method name="SortGrid">
        <arg type="b" name="descending" direction="in"/>
        <arg type="s" name="folderPosition" direction="in"/>
        <arg type="s" name="backupName" direction="in"/>
        <arg type="s" name="status" direction="out"/>
        <arg type="s" name="snapshotId" direction="out"/>
    </method>
    <method name="RestoreLayout">
        <arg type="s" name="snapshotId" direction="in"/>
        <arg type="b" name="restored" direction="out"/>
    </method>
</interface></node>`

export const FOLDER_POSITIONS = ['mixed', 'first', 'last']
export const SORT_ORDERS = ['manual', 'ascending', 'descending']

export function sortGridPages(pages, capacity, {
    descending, folderPosition, folders, collator = new Intl.Collator(),
}) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 ||
        !FOLDER_POSITIONS.includes(folderPosition))
        throw new RangeError('Invalid app grid sort options')

    const sorted = pages.flat().sort((left, right) => {
        if (folderPosition !== 'mixed') {
            const folderOrder = Number(folders.has(left)) -
                Number(folders.has(right))
            if (folderOrder)
                return folderPosition === 'first' ? -folderOrder : folderOrder
        }
        const order = collator.compare(left.name ?? left.id, right.name ?? right.id)
        return descending ? -order : order
    })
    return paginate(sorted, capacity)
}

function paginate(items, capacity) {
    const pages = []
    for (let index = 0; index < items.length; index += capacity)
        pages.push(items.slice(index, index + capacity))
    return pages
}

export function restoreGridPages(savedPages, livePages, capacity) {
    if (!Number.isSafeInteger(capacity) || capacity < 1)
        throw new RangeError('Invalid app grid capacity')
    const remaining = new Map(livePages.flat().map(item => [item.id, item]))
    const restored = savedPages.flatMap(page => {
        const items = Object.entries(page)
            .sort(([, left], [, right]) => left.position - right.position)
            .flatMap(([id]) => {
                const item = remaining.get(id)
                remaining.delete(id)
                return item ? [item] : []
            })
        return paginate(items, capacity)
    })
    return restored.concat(paginate([...remaining.values()], capacity))
}

export function sameGridPages(left, right) {
    return left.length === right.length && left.every((page, index) =>
        page.length === right[index].length &&
        page.every((item, position) => item === right[index][position]))
}
