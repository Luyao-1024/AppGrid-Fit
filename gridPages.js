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

export function restorePersistedPageOrder(appDisplay, layoutManager) {
    if (typeof appDisplay?._redisplay !== 'function' ||
        !Array.isArray(layoutManager?._pages))
        return false

    const itemCount = layoutManager._pages.reduce((count, page) =>
        count + (page.visibleChildren?.length ?? 0), 0)
    if (itemCount === 0)
        return false

    const rows = layoutManager.rows_per_page
    const columns = layoutManager.columns_per_page

    // Shell initially loads saved positions with its default 24-item capacity.
    // Let every saved page fit while _redisplay() restores its original order.
    layoutManager.columns_per_page = itemCount
    layoutManager.rows_per_page = 1
    try {
        appDisplay._redisplay()
    } finally {
        layoutManager.rows_per_page = rows
        layoutManager.columns_per_page = columns
    }
    return true
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
