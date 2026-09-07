export function consolidatePages(layoutManager) {
    if (!Array.isArray(layoutManager._pages) ||
        typeof layoutManager._fillItemVacancies !== 'function')
        return false

    let modified = false
    let pageIndex = 0
    while (pageIndex + 1 < layoutManager._pages.length) {
        const itemsPerPage =
            layoutManager.columns_per_page * layoutManager.rows_per_page
        const currentCount =
            layoutManager._pages[pageIndex].visibleChildren.length
        if (currentCount >= itemsPerPage) {
            pageIndex++
            continue
        }
        const nextCount =
            layoutManager._pages[pageIndex + 1]?.visibleChildren.length ?? 0
        if (nextCount === 0) {
            pageIndex++
            continue
        }
        layoutManager._fillItemVacancies(pageIndex)
        modified = true
    }
    return modified
}

export function reflowPages(layoutManager, {consolidate = false, warn} = {}) {
    if (!Array.isArray(layoutManager._pages))
        return false

    const itemsPerPage =
        layoutManager.columns_per_page * layoutManager.rows_per_page
    const hasOverflow = layoutManager._pages.some(
        page => page.visibleChildren.length > itemsPerPage)
    let overflowReflowed = false

    if (hasOverflow) {
        if (typeof layoutManager._updatePages === 'function') {
            layoutManager._updatePages()
            overflowReflowed = true
        } else if (typeof layoutManager._relocateSurplusItems === 'function') {
            for (let i = 0; i < layoutManager._pages.length; i++)
                layoutManager._relocateSurplusItems(i)
            overflowReflowed = true
        } else {
            warn?.('page overflow cannot be rearranged')
        }
    }

    const consolidated = consolidate
        ? consolidatePages(layoutManager)
        : false
    return overflowReflowed || consolidated
}
