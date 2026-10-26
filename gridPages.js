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
        const pageCount = layoutManager._pages.length
        layoutManager._fillItemVacancies(pageIndex)
        const filledCount =
            layoutManager._pages[pageIndex]?.visibleChildren.length ?? 0
        if (layoutManager._pages.length === pageCount &&
            filledCount <= currentCount)
            break
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
    const fixedRows = Object.hasOwn(layoutManager, '_fixedRows')
    const fixedColumns = Object.hasOwn(layoutManager, '_fixedCols')
    const savedFixedRows = layoutManager._fixedRows
    const savedFixedColumns = layoutManager._fixedCols

    // Shell initially loads saved positions with its default 24-item capacity.
    // Let every saved page fit while _redisplay() restores its original order.
    layoutManager.columns_per_page = itemCount
    layoutManager.rows_per_page = 1
    if (fixedRows)
        layoutManager._fixedRows = 1
    if (fixedColumns)
        layoutManager._fixedCols = itemCount
    try {
        appDisplay._redisplay()
    } finally {
        layoutManager.rows_per_page = rows
        layoutManager.columns_per_page = columns
        if (fixedRows)
            layoutManager._fixedRows = savedFixedRows
        else
            delete layoutManager._fixedRows
        if (fixedColumns)
            layoutManager._fixedCols = savedFixedColumns
        else
            delete layoutManager._fixedCols
    }
    return true
}

function rebuildPagesInOrder(layoutManager, itemsPerPage, visibleItems) {
    if (typeof layoutManager._removeItemData !== 'function' ||
        typeof layoutManager._addItemToPage !== 'function' ||
        !Array.isArray(layoutManager._pages) ||
        !Number.isFinite(itemsPerPage) || itemsPerPage < 1)
        return false

    const items = layoutManager._pages.flatMap(page =>
        Array.isArray(page.children) ? page.children : [])
    if (items.length === 0)
        return false

    const savedAllowIncompletePages = layoutManager.allowIncompletePages
    layoutManager.allowIncompletePages = true
    try {
        for (const item of items)
            layoutManager._removeItemData(item)

        let pageIndex = 0
        let visibleCount = 0
        for (const item of items) {
            const isVisible = visibleItems.has(item)
            if (isVisible && visibleCount >= itemsPerPage) {
                pageIndex++
                visibleCount = 0
            }
            layoutManager._addItemToPage(item, pageIndex, -1)
            if (isVisible)
                visibleCount++
        }
    } finally {
        if (savedAllowIncompletePages === undefined)
            delete layoutManager.allowIncompletePages
        else
            layoutManager.allowIncompletePages = savedAllowIncompletePages
    }
    return true
}

export function syncPageManagerPages(appDisplay, layoutManager) {
    const pageManager = appDisplay?._pageManager
    if (!pageManager || !Array.isArray(layoutManager?._pages))
        return false

    const pages = layoutManager._pages.map(page => {
        const pageData = {}
        ;(page.visibleChildren ?? []).forEach((item, index) => {
            const id = item.id ?? item.app?.get_id?.()
            if (id)
                pageData[id] = {position: index}
        })
        return pageData
    })
    if (JSON.stringify(pageManager._pages) === JSON.stringify(pages))
        return false
    pageManager._pages = pages
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
        const visibleItems = new Set(layoutManager._pages.flatMap(
            page => page.visibleChildren ?? []))
        overflowReflowed = rebuildPagesInOrder(
            layoutManager, itemsPerPage, visibleItems)

        if (!overflowReflowed &&
            typeof layoutManager._updatePages === 'function') {
            layoutManager._updatePages()
            overflowReflowed = true
        } else if (!overflowReflowed &&
            typeof layoutManager._relocateSurplusItems === 'function') {
            for (let i = 0; i < layoutManager._pages.length; i++)
                layoutManager._relocateSurplusItems(i)
            overflowReflowed = true
        } else if (!overflowReflowed) {
            warn?.('page overflow cannot be rearranged')
        }
    }

    const consolidated = consolidate
        ? consolidatePages(layoutManager)
        : false
    return overflowReflowed || consolidated
}
