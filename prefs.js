import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {
    DEFAULT_PAGE_CAPACITY,
    FOLDER_DIALOG_PAGE_PADDING,
    FOLDER_EDGE_PADDING_MAX,
    FOLDER_MAX_DIMENSION,
    FOLDER_MAX_SPACING,
    FOLDER_MAX_TITLE_SIZE,
    FOLDER_MIN_DIMENSION,
    PRESETS,
    PRESET_WIDTH_RATIO,
    PREVIEW_LAYOUT_KEY,
    SETTINGS_KEYS,
    autoFolderEdgePadding,
    computePreviewColorIndex,
    computeGridFit,
    computeGridPixelSize,
    computePreviewTileSize,
    decodePreviewLayout,
    readFolderConfig,
    resolveFolderEdgePadding,
    resolvePreviewPages,
} from './config.js';
import {
    MAX_SNAPSHOTS,
    addSnapshot,
    parseSnapshots,
    removeSnapshot,
    serializeSnapshots,
    snapshotLabel,
} from './snapshots.js';
import {
    captureSnapshot,
    restoreSnapshot,
} from './snapshotStore.js';

const SHELL_PANEL_H = 30;
const SHELL_SEARCH_H = 52;
const SHELL_DASH_H = 72;
const SHELL_MINI_WS_RATIO = 0.15;
const SHELL_SPACING_RATIO = 0.02;
const SHELL_PAGE_IND_H = 16;
const SHELL_IND_W_RATIO = 0.10;
const SHELL_MIN_IND_W = 60;
const SHELL_IND_PADDING = 18;
const SHELL_PAGE_PAD = 24;

const PREVIEW_PADDING = 0;
const DOCK_ICON_COUNT = 9;
const SHELL_PREVIEW_GRID_TOP_INSET = 8;
const CUSTOM_MIN_DIMENSION = 2;
const CUSTOM_MAX_DIMENSION = 20;

const SIZE_NAMES = ['Large', 'Medium', 'Small', 'Tiny'];

function clampCustomDimension(value) {
    return Math.max(CUSTOM_MIN_DIMENSION,
        Math.min(CUSTOM_MAX_DIMENSION, value));
}

function connectSignal(cleanupFns, object, signal, callback) {
    const id = object.connect(signal, callback);
    cleanupFns.push(() => object.disconnect(id));
}

function findDescendant(widget, widgetType) {
    for (let child = widget.get_first_child?.(); child;
        child = child.get_next_sibling()) {
        if (child instanceof widgetType)
            return child;
        const match = findDescendant(child, widgetType);
        if (match)
            return match;
    }
    return null;
}

function escapeCssString(value) {
    return value
        .replaceAll('\\', '\\\\')
        .replaceAll('"', '\\"')
        .replaceAll('\n', '\\a ');
}

function formatMessage(template, params) {
    return template.replace(/\{(\w+)\}/g, (match, key) =>
        params[key] ?? match)
}

function estimateGridArea(monitorW, monitorH) {
    const workH = monitorH - SHELL_PANEL_H;
    const spacing = Math.round(workH * SHELL_SPACING_RATIO);
    const miniWsH = Math.round(workH * SHELL_MINI_WS_RATIO);
    const appDspH = workH - SHELL_SEARCH_H - SHELL_DASH_H - 3 * spacing - miniWsH;
    const pageH = Math.max(100, appDspH - SHELL_PAGE_IND_H);
    const indW = Math.max(Math.round(monitorW * SHELL_IND_W_RATIO), SHELL_MIN_IND_W);
    const iconAreaW = Math.max(100, monitorW - 2 * (indW + SHELL_IND_PADDING));
    const iconAreaH = Math.max(100, pageH - 2 * SHELL_PAGE_PAD);
    const miniWsY = SHELL_PANEL_H + SHELL_SEARCH_H + spacing;
    const appDspY = miniWsY + miniWsH + spacing;
    const dashY = appDspY + appDspH + spacing;
    return {
        iconAreaW, iconAreaH, indW,
        panelH: SHELL_PANEL_H, spacing, searchH: SHELL_SEARCH_H,
        dashH: SHELL_DASH_H, miniWsH, appDspH,
        searchY: SHELL_PANEL_H, appDspY, miniWsY, dashY,
        iconAreaX: indW + SHELL_IND_PADDING,
        iconAreaYPos: appDspY + SHELL_PAGE_PAD,
    };
}

function roundedRect(cr, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    cr.moveTo(x + r, y);
    cr.lineTo(x + w - r, y);
    cr.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
    cr.lineTo(x + w, y + h - r);
    cr.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    cr.lineTo(x + r, y + h);
    cr.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    cr.lineTo(x, y + r);
    cr.arc(x + r, y + r, r, Math.PI, Math.PI * 3 / 2);
    cr.closePath();
}

function drawPanelSection(cr, fx, fy, fW, panelH, sc) {
    const panelHs = panelH * sc;
    cr.rectangle(fx, fy, fW, panelHs);
    cr.setSourceRGBA(0.03, 0.04, 0.07, 0.58);
    cr.fill();

    cr.setSourceRGBA(0.86, 0.89, 0.94, 0.7);
    const actH = Math.max(2, 10 * sc);
    roundedRect(cr, fx + 10 * sc, fy + (panelHs - actH) / 2,
        Math.max(4, 42 * sc), actH, Math.max(1, 5 * sc));
    cr.fill();
    roundedRect(cr, fx + fW / 2 - 24 * sc,
        fy + (panelHs - actH * 0.7) / 2,
        48 * sc, actH * 0.7, Math.max(1, 3 * sc));
    cr.fill();
    const sysW = Math.max(4, 50 * sc);
    roundedRect(cr, fx + fW - sysW - 10 * sc, fy + (panelHs - actH) / 2,
        sysW, actH, Math.max(1, 3 * sc));
    cr.fill();
}

function drawSearchSection(cr, fx, fy, fW, sY, sH, sc, searchRect) {
    const pillH = searchRect?.height * sc ?? Math.max(4, 40 * sc);
    const pillW = searchRect?.width * sc ?? Math.min(370 * sc, fW * 0.35);
    const pillX = searchRect
        ? fx + searchRect.x * sc
        : fx + (fW - pillW) / 2;
    const pillY = searchRect
        ? fy + searchRect.y * sc
        : sY + Math.max(0, Math.min(sH - pillH, 12 * sc));
    cr.setSourceRGBA(0.43, 0.49, 0.62, 0.56);
    roundedRect(cr, pillX, pillY, pillW, pillH, pillH / 2);
    cr.fill();
    cr.setSourceRGBA(0.9, 0.92, 0.96, 0.55);
    cr.arc(pillX + 17 * sc, pillY + pillH / 2,
        Math.max(1, 5 * sc), 0, Math.PI * 2);
    cr.setLineWidth(Math.max(0.7, sc));
    cr.stroke();
}

function drawWorkspaceThumbnail(cr, x, y, width, height, radius, index) {
    cr.setSourceRGBA(0.08, 0.10, 0.16, 0.16);
    roundedRect(cr, x, y, width, height, radius);
    cr.fillPreserve();
    cr.setSourceRGBA(0.82, 0.86, 0.94, 0.2);
    cr.setLineWidth(1);
    cr.stroke();
    if (index === 0) {
        cr.setSourceRGBA(0.03, 0.035, 0.045, 0.72);
        roundedRect(cr,
            x + width * 0.05, y + height * 0.05,
            width * 0.9, height * 0.88, radius * 0.7);
        cr.fill();
    }
}

function drawMiniWsSection(cr, fx, fy, fW, mwY, mwH, sc,
    workspaceRects, workspaceCount, monitorAspect) {
    if (workspaceRects?.length) {
        for (const [index, rect] of workspaceRects.entries()) {
            drawWorkspaceThumbnail(cr,
                fx + rect.x * sc, fy + rect.y * sc,
                rect.width * sc, rect.height * sc,
                Math.max(1, 4 * sc), index);
        }
        return;
    }

    const wsThumbH = mwH;
    const wsThumbW = wsThumbH * monitorAspect;
    const wsGap = Math.max(2, 36 * sc);
    const wsCount = Math.max(1, Math.min(4, workspaceCount));
    const wsTotalW = wsCount * wsThumbW + (wsCount - 1) * wsGap;
    const wsStartX = fx + (fW - wsTotalW) / 2;
    const wsStartY = mwY + 8 * sc;
    for (let i = 0; i < wsCount; i++) {
        drawWorkspaceThumbnail(cr,
            wsStartX + i * (wsThumbW + wsGap), wsStartY,
            wsThumbW, wsThumbH, Math.max(1, 4 * sc), i);
    }
}

const ICON_COLORS = [
    [0.20, 0.52, 0.92], [0.24, 0.72, 0.42], [0.86, 0.32, 0.34],
    [0.62, 0.38, 0.88], [0.95, 0.59, 0.18], [0.16, 0.68, 0.75],
    [0.91, 0.36, 0.64], [0.55, 0.72, 0.20], [0.32, 0.40, 0.86],
    [0.92, 0.45, 0.22], [0.12, 0.62, 0.52], [0.82, 0.68, 0.18],
];

function previewIconColor(key, variation = 0) {
    return ICON_COLORS[computePreviewColorIndex(
        key, ICON_COLORS.length, variation)];
}

function drawAppGlyph(cr, x, y, width, height, index, folder,
    alpha = 0.9, colorKey = index) {
    const [r, g, b] = previewIconColor(colorKey);
    if (folder) {
        cr.setSourceRGBA(0.42, 0.49, 0.64, alpha * 0.72);
        roundedRect(cr, x, y, width, height, Math.max(1, width * 0.16));
        cr.fill();
        const mini = Math.min(width, height) * 0.25;
        const gap = mini * 0.24;
        const sx = x + (width - mini * 2 - gap) / 2;
        const sy = y + (height - mini * 2 - gap) / 2;
        for (let row = 0; row < 2; row++) {
            for (let col = 0; col < 2; col++) {
                const color = previewIconColor(
                    colorKey, row * 2 + col + 1);
                cr.setSourceRGBA(...color, alpha);
                roundedRect(cr, sx + col * (mini + gap), sy + row * (mini + gap),
                    mini, mini, Math.max(1, mini * 0.15));
                cr.fill();
            }
        }
        return;
    }

    cr.setSourceRGBA(r, g, b, alpha);
    if (index % 3 === 1) {
        cr.arc(x + width / 2, y + height / 2,
            Math.min(width, height) / 2, 0, Math.PI * 2);
    } else {
        roundedRect(cr, x, y, width, height,
            Math.max(1, Math.min(width, height) * (index % 3 === 0 ? 0.2 : 0.42)));
    }
    cr.fill();
}

function drawMeasuredGridSection(cr, fx, fy, sc, items, iconSize, showNames) {
    for (const [index, item] of items.entries()) {
        const tile = item.tile;
        const fallbackIconW = Math.min(iconSize, tile.width) * sc;
        const fallbackIconH = Math.min(iconSize, tile.height) * sc;
        const ix = item.folder
            ? fx + tile.x * sc
            : item.icon
            ? fx + item.icon.x * sc
            : fx + (tile.x + (tile.width - iconSize) / 2) * sc;
        const iy = item.folder
            ? fy + tile.y * sc
            : item.icon
            ? fy + item.icon.y * sc
            : fy + (tile.y + Math.max(0, (tile.height - iconSize - 18) / 2)) * sc;
        const iw = item.folder
            ? tile.width * sc : item.icon?.width * sc || fallbackIconW;
        const ih = item.folder
            ? tile.height * sc : item.icon?.height * sc || fallbackIconH;
        drawAppGlyph(cr, ix, iy, iw, ih, index, item.folder,
            0.9, item.id ?? `grid-${index}`);

        if (!showNames)
            continue;
        const labelW = Math.min(tile.width * 0.72, Math.max(20, iconSize * 0.9)) * sc;
        const labelH = Math.max(1, 3 * sc);
        const labelX = fx + (tile.x + (tile.width - labelW / sc) / 2) * sc;
        const labelY = fy + (tile.y + tile.height - 17) * sc;
        cr.setSourceRGBA(0.9, 0.92, 0.96, 0.62);
        roundedRect(cr, labelX, labelY, labelW, labelH, labelH / 2);
        cr.fill();
    }
}

function drawGridSection(cr, iaX, iaY, iaW, iaH,
    drawRows, drawCols, fitRows, fitCols,
    cellW, cellH, iconW, iconH, gapW, gapH,
    sc, usePresets, itemCount, items, showNames) {
    const gridW = drawCols * cellW + Math.max(0, drawCols - 1) * gapW;
    const gx = iaX + (iaW - gridW) / 2;
    const gy = iaY;

    cr.save();
    cr.rectangle(iaX, iaY, iaW, iaH);
    cr.clip();

    for (let row = 0; row < drawRows; row++) {
        for (let col = 0; col < drawCols; col++) {
            const index = row * drawCols + col;
            const occupied = itemCount === null || index < itemCount;
            const overflow = !usePresets && (row >= fitRows || col >= fitCols);
            const iconX = gx + col * (cellW + gapW) + (cellW - iconW) / 2;
            const iconY = gy + row * (cellH + gapH) + (cellH - iconH) / 2;
            if (occupied) {
                const folder = items?.[index]?.folder ?? false;
                const glyphX = folder ? gx + col * (cellW + gapW) : iconX;
                const glyphY = folder ? gy + row * (cellH + gapH) : iconY;
                const glyphW = folder ? cellW : iconW;
                const glyphH = folder ? cellH : iconH;
                drawAppGlyph(cr, glyphX, glyphY, glyphW, glyphH,
                    index, folder, overflow ? 0.48 : 0.86,
                    items?.[index]?.id ?? `grid-${index}`);
                if (showNames) {
                    cr.setSourceRGBA(0.9, 0.92, 0.96, overflow ? 0.3 : 0.52);
                    const labelW = iconW * 0.78;
                    const labelH = Math.max(1, 3 * sc);
                    roundedRect(cr, iconX + (iconW - labelW) / 2,
                        folder ? glyphY + glyphH - 17 * sc : iconY + iconH + 7 * sc,
                        labelW, labelH, labelH / 2);
                    cr.fill();
                }
            } else {
                cr.setSourceRGBA(0.7, 0.75, 0.84, 0.08);
                cr.arc(iconX + iconW / 2, iconY + iconH / 2,
                    Math.max(1, 2 * sc), 0, Math.PI * 2);
                cr.fill();
            }
        }
    }

    if (!usePresets && (fitRows !== drawRows || fitCols !== drawCols)) {
        const afW = fitCols * cellW + Math.max(0, fitCols - 1) * gapW;
        const afH = fitRows * cellH + Math.max(0, fitRows - 1) * gapH;
        cr.setSourceRGBA(0.3, 0.8, 0.4, 0.6);
        cr.setLineWidth(1.5);
        cr.setDash([4, 3], 0);
        cr.rectangle(
            iaX + (iaW - afW) / 2 - 2,
            iaY,
            afW + 4, afH + 4);
        cr.stroke();
    }
    cr.restore();
}

function drawFolderPreviewSection(cr, x, y, w, h, config) {
    const {
        iconSize, folderRows, folderColumns,
        folderRowSpacing, folderColumnSpacing, folderTitleSize, showNames,
    } = config;
    const rows = Math.max(1, folderRows);
    const columns = Math.max(1, folderColumns);
    const panelPad = Number.isFinite(config.folderEdgePadding)
        ? Math.max(0, Math.round(config.folderEdgePadding))
        : FOLDER_DIALOG_PAGE_PADDING;
    const titleH = folderTitleSize > 0
        ? Math.round(folderTitleSize * 1.24 + 18)
        : 51;
    const tile = iconSize + (showNames ? 34 : 12);
    const contentW = columns * tile +
        Math.max(0, columns - 1) * folderColumnSpacing + panelPad * 2;
    const contentH = rows * tile +
        Math.max(0, rows - 1) * folderRowSpacing +
        panelPad * 2 + titleH;
    const panelUnitsW = rows === columns
        ? Math.max(contentW, contentH)
        : contentW;
    const scale = Math.min((w - 12) / panelUnitsW, (h - 12) / contentH);
    const panelW = panelUnitsW * scale;
    const panelH = contentH * scale;
    const px = x + (w - panelW) / 2;
    const py = y + (h - panelH) / 2;

    cr.setSourceRGBA(0.02, 0.03, 0.06, 0.55);
    roundedRect(cr, x, y, w, h, Math.max(2, 8 * scale));
    cr.fill();

    cr.save();
    roundedRect(cr, px, py, panelW, panelH, Math.max(3, 14 * scale));
    cr.clip();
    cr.setSourceRGBA(0.13, 0.14, 0.18, 0.97);
    cr.paint();
    cr.setSourceRGBA(0.75, 0.8, 0.9, 0.13);
    cr.rectangle(px, py, panelW, titleH * scale);
    cr.fill();

    cr.setSourceRGBA(0.9, 0.92, 0.96, 0.5);
    const titleW = Math.min(panelW * 0.3, 120 * scale);
    roundedRect(cr, px + (panelW - titleW) / 2,
        py + titleH * scale * 0.36, titleW,
        Math.max(1, 4 * scale), 2 * scale);
    cr.fill();

    const gridX = px + (panelPad + (panelUnitsW - contentW) / 2) * scale;
    const gridY = py + (panelPad + titleH) * scale;
    const capacity = rows * columns;
    const sampleCount = Math.min(capacity, 12);
    for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
            const index = row * columns + column;
            const cellX = gridX +
                column * (tile + folderColumnSpacing) * scale;
            const cellY = gridY +
                row * (tile + folderRowSpacing) * scale;
            const glyphSize = iconSize * scale;
            const glyphX = cellX + (tile * scale - glyphSize) / 2;
            const glyphY = cellY + Math.max(0,
                (tile * scale - glyphSize) / 2 -
                (showNames ? 5 * scale : 0));
            if (index < sampleCount) {
                drawAppGlyph(cr, glyphX, glyphY, glyphSize, glyphSize,
                    index, false, 0.9, `folder-preview-${index}`);
                if (showNames) {
                    cr.setSourceRGBA(0.9, 0.92, 0.96, 0.58);
                    roundedRect(cr,
                        glyphX + glyphSize * 0.1,
                        glyphY + glyphSize + 6 * scale,
                        glyphSize * 0.8, Math.max(1, 3 * scale),
                        1.5 * scale);
                    cr.fill();
                }
            } else {
                cr.setSourceRGBA(0.7, 0.75, 0.84, 0.08);
                cr.arc(glyphX + glyphSize / 2, glyphY + glyphSize / 2,
                    Math.max(1, 2 * scale), 0, Math.PI * 2);
                cr.fill();
            }
        }
    }

    cr.restore();
}

function drawDashSection(cr, fx, fy, fW, dY, dH, sc,
    dashRect, dashItems, pageCount, currentPage,
    pageIndicatorRect = null, gridBottomY = 0, dashVisible = null) {
    const visiblePageCount = Math.max(1, Math.min(8, pageCount));
    const indicatorGap = 32 * sc;
    const indicatorY = pageIndicatorRect
        ? fy + (pageIndicatorRect.y + pageIndicatorRect.height / 2) * sc
        : fy + (gridBottomY + 8) * sc;
    const indicatorCenterX = pageIndicatorRect
        ? fx + (pageIndicatorRect.x + pageIndicatorRect.width / 2) * sc
        : fx + fW / 2;
    const indicatorStartX = indicatorCenterX -
        (visiblePageCount - 1) * indicatorGap / 2;
    for (let index = 0; index < visiblePageCount; index++) {
        const active = index === currentPage;
        cr.setSourceRGBA(0.9, 0.92, 0.97, active ? 0.95 : 0.48);
        cr.arc(indicatorStartX + index * indicatorGap, indicatorY,
            Math.max(active ? 1 : 0.8, (active ? 4 : 3) * sc),
            0, Math.PI * 2);
        cr.fill();
    }

    if (dashVisible === false)
        return;

    if (dashItems?.length) {
        const bounds = dashRect ?? dashItems.reduce((acc, rect) => ({
            x: Math.min(acc.x, rect.x),
            y: Math.min(acc.y, rect.y),
            width: Math.max(acc.x + acc.width, rect.x + rect.width) -
                Math.min(acc.x, rect.x),
            height: Math.max(acc.y + acc.height, rect.y + rect.height) -
                Math.min(acc.y, rect.y),
        }));
        const bx = fx + bounds.x * sc;
        const by = fy + bounds.y * sc;
        const bw = bounds.width * sc;
        const bh = bounds.height * sc;
        cr.setSourceRGBA(0.12, 0.12, 0.16, 0.25);
        roundedRect(cr, bx, by, bw, bh, Math.max(2, 14 * sc));
        cr.fill();
        for (const [index, rect] of dashItems.entries()) {
            drawAppGlyph(cr,
                fx + rect.x * sc, fy + rect.y * sc,
                rect.width * sc, rect.height * sc,
                index + 2, false, 0.92, `dash-${index}`);
        }
        return;
    }

    const dockIc = Math.max(4, 52 * sc);
    const dockGap = Math.max(2, 8 * sc);
    const dockTW = DOCK_ICON_COUNT * dockIc + (DOCK_ICON_COUNT - 1) * dockGap;
    const dockSX = fx + (fW - dockTW) / 2;
    const dockSY = dY + (dH - dockIc) / 2 - 8 * sc;
    cr.setSourceRGBA(0.12, 0.12, 0.16, 0.25);
    roundedRect(cr, dockSX - 20 * sc, dockSY - 7 * sc,
        dockTW + 40 * sc, dockIc + 14 * sc, Math.max(2, 14 * sc));
    cr.fill();
    for (let i = 0; i < DOCK_ICON_COUNT; i++) {
        drawAppGlyph(cr, dockSX + i * (dockIc + dockGap), dockSY,
            dockIc, dockIc, i + 2, false, 0.92, `dock-${i}`);
    }
}

function createSpinRow(settings, key, title,
    {lower, upper, step, page, subtitle = null}) {
    const row = new Adw.SpinRow({
        title,
        subtitle,
        adjustment: new Gtk.Adjustment({
            lower, upper, step_increment: step, page_increment: page,
        }),
        value: settings.get_int(key),
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function readIconSize(settings) {
    return settings.get_boolean('use-presets')
        ? PRESETS[settings.get_int('preset-level')].iconSize
        : settings.get_int('custom-icon-size');
}

function readGridConfig(settings) {
    const folder = readFolderConfig(settings);
    const iconSize = readIconSize(settings);
    const folderConfig = {
        folderRows: folder.rows,
        folderColumns: folder.columns,
        folderRowSpacing: folder.rowSpacing,
        folderColumnSpacing: folder.columnSpacing,
        folderTitleSize: folder.titleSize,
        folderEdgePaddingAuto: folder.edgePaddingAuto,
        folderEdgePadding: resolveFolderEdgePadding(iconSize,
            folder.edgePaddingAuto, folder.edgePadding),
        showNames: folder.showNames,
    };
    if (settings.get_boolean('use-presets')) {
        const preset = PRESETS[settings.get_int('preset-level')];
        return {
            iconSize,
            rows: preset.rows,
            columns: preset.columns,
            rowGap: preset.gap,
            colGap: preset.gap,
            usePresets: true,
            ...folderConfig,
        };
    }
    return {
        iconSize,
        rows: settings.get_int('custom-rows'),
        columns: settings.get_int('custom-columns'),
        rowGap: settings.get_int('custom-row-spacing'),
        colGap: settings.get_int('custom-column-spacing'),
        usePresets: false,
        ...folderConfig,
    };
}

function applyStoredValue(settings, key, stored) {
    const type = new GLib.VariantType(stored.type);
    const value = GLib.Variant.parse(type, stored.value, null, null);
    settings.set_value(key, value);
}

function folderSettingsFor(folderSettings, id) {
    return new Gio.Settings({
        schema_id: 'org.gnome.desktop.app-folders.folder',
        path: `${folderSettings.path}folders/${id}/`,
    });
}

function readFallbackPages(shellSettings, folderSettings, consolidate) {
    try {
        const pages = shellSettings.get_value('app-picker-layout').deepUnpack();
        const folderIds = new Set(folderSettings.get_strv('folder-children'));
        const pageItems = pages.map(page => {
            const entries = page instanceof Map
                ? [...page.entries()]
                : Object.entries(page ?? {});
            return entries.map(([id, value], order) => {
                const details = value?.deepUnpack?.() ?? value;
                const rawPosition = details instanceof Map
                    ? details.get('position')
                    : details?.position;
                const position = rawPosition?.deepUnpack?.() ??
                    rawPosition ?? order;
                return {id, position, folder: folderIds.has(id)};
            }).sort((a, b) => a.position - b.position);
        });
        return resolvePreviewPages(pageItems, consolidate);
    } catch (_e) {
        try {
            const apps = Gio.AppInfo.get_all()
                .filter(app => app.should_show())
                .map((app, position) => ({
                    id: app.get_id(), position, folder: false,
                }));
            return resolvePreviewPages([apps], consolidate);
        } catch (_error) {
            return [Array.from({length: DEFAULT_PAGE_CAPACITY},
                (_value, position) => ({position, folder: false}))];
        }
    }
}

export default class AppGridSizePrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const cleanupFns = [];
        let cleanedUp = false;

        window.connect('close-request', () => {
            if (cleanedUp)
                return false;
            cleanedUp = true;
            for (const fn of cleanupFns) fn();
            return false;
        });
        const display = Gdk.Display.get_default();
        const monitor = display?.get_monitors()?.get_item(0);
        const monitorWidth = monitor?.get_geometry().width ?? 1280;
        const monitorHeight = monitor?.get_geometry().height ?? 800;
        window.set_default_size(
            Math.max(760, Math.min(1200, monitorWidth - 80)),
            Math.max(420, Math.min(560, monitorHeight - 120)));

        const page = new Adw.PreferencesPage({
            title: _('App Grid'),
            icon_name: 'view-app-grid-symbolic',
        });
        window.add(page);

        const pageClamp = findDescendant(page, Adw.Clamp);
        if (pageClamp) {
            pageClamp.maximum_size = 1400;
            pageClamp.tightening_threshold = 900;
        }

        const rootGroup = new Adw.PreferencesGroup({});
        page.add(rootGroup);

        const rootRow = new Adw.PreferencesRow({
            activatable: false,
            selectable: false,
            focusable: false,
        });

        const paned = new Gtk.Paned({
            orientation: Gtk.Orientation.HORIZONTAL,
            position: 420,
            shrink_start_child: true,
            shrink_end_child: true,
            resize_start_child: false,
            resize_end_child: true,
        });

        const {widget: preview, cleanupFns: prevFns, setPage} =
            this._buildPreviewPane(settings, window);
        cleanupFns.push(...prevFns);

        const {widget: controlsBox, cleanupFns: ctrlFns} =
            this._buildControlsPane(settings, window, setPage);
        cleanupFns.push(...ctrlFns);

        paned.set_start_child(controlsBox);
        paned.set_end_child(preview);
        rootRow.set_child(paned);
        rootGroup.add(rootRow);
    }

    _buildControlsPane(settings, window, onPageChanged = null) {
        const cleanupFns = [];

        const createContentBox = () => new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 4,
            margin_top: 16, margin_bottom: 16,
            margin_start: 24, margin_end: 24,
        });
        const rootBox = createContentBox();
        const gridBox = createContentBox();
        const folderBox = createContentBox();
        const snapshotsBox = createContentBox();
        const advancedBox = createContentBox();

        const stack = new Gtk.Stack({
            transition_type: Gtk.StackTransitionType.SLIDE_LEFT_RIGHT,
            transition_duration: 180,
            hexpand: true,
            vexpand: true,
        });
        const showPage = (name, back = false) => {
            stack.transition_type = back
                ? Gtk.StackTransitionType.SLIDE_RIGHT
                : Gtk.StackTransitionType.SLIDE_LEFT;
            stack.set_visible_child_name(name);
            onPageChanged?.(name);
        };
        const addPage = (name, title, content) => {
            const scroller = new Gtk.ScrolledWindow({
                hscrollbar_policy: Gtk.PolicyType.NEVER,
                vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
                hexpand: true,
                vexpand: true,
            });
            scroller.set_child(content);
            if (!title) {
                stack.add_named(scroller, name);
                return;
            }
            const page = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
            const header = new Gtk.Box({
                orientation: Gtk.Orientation.HORIZONTAL,
                spacing: 6,
                margin_top: 10,
                margin_bottom: 2,
                margin_start: 10,
                margin_end: 24,
            });
            const backButton = new Gtk.Button({
                icon_name: 'go-previous-symbolic',
                tooltip_text: _('Back'),
                valign: Gtk.Align.CENTER,
                css_classes: ['flat'],
            });
            backButton.connect('clicked', () => showPage('root', true));
            header.append(backButton);
            header.append(new Gtk.Label({
                label: title,
                xalign: 0,
                hexpand: true,
                css_classes: ['title-4'],
            }));
            page.append(header);
            page.append(scroller);
            stack.add_named(page, name);
        };

        const gridGroup = new Adw.PreferencesGroup({
            title: _('Grid size'),
            description: _('Preset sizes or a custom icon size, capacity and spacing'),
        });
        const switchRow = new Adw.SwitchRow({
            title: _('Use preset sizes'),
            subtitle: _('Off to customize icon size and grid manually'),
        });
        settings.bind('use-presets', switchRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        gridGroup.add(switchRow);

        const model = new Gtk.StringList();
        PRESETS.forEach((p, i) => model.append(formatMessage(
            _('{size} — {icon} px'), {
                size: _(SIZE_NAMES[i]),
                icon: p.iconSize,
            })));

        const comboRow = new Adw.ComboRow({title: _('Size'), model});
        comboRow.selected = settings.get_int('preset-level');

        const presetInfo = new Gtk.Label({
            label: '',
            halign: Gtk.Align.START,
            margin_top: 4,
            wrap: true,
            xalign: 0,
            css_classes: ['dim-label'],
        });
        const presetInfoRow = new Adw.PreferencesRow({
            activatable: false,
            selectable: false,
        });
        presetInfoRow.set_child(presetInfo);

        const updatePresetInfo = () => {
            const p = PRESETS[comboRow.selected];
            presetInfo.label = formatMessage(
                _('{icon} px icons · {gap} px gap · adaptive balanced grid'), {
                    icon: p.iconSize,
                    gap: p.gap,
                });
        };
        connectSignal(cleanupFns, settings, 'changed::preset-level', () => {
            comboRow.selected = settings.get_int('preset-level');
            updatePresetInfo();
        });
        connectSignal(cleanupFns, comboRow, 'notify::selected', () => {
            settings.set_int('preset-level', comboRow.selected);
            updatePresetInfo();
        });
        updatePresetInfo();
        gridGroup.add(comboRow);
        gridGroup.add(presetInfoRow);

        const iconSizeRow = createSpinRow(settings, 'custom-icon-size',
            _('Icon pixel size'), {lower: 16, upper: 160, step: 8, page: 16});
        gridGroup.add(iconSizeRow);
        const rowsRow = createSpinRow(settings, 'custom-rows',
            _('Rows per page'), {
                lower: CUSTOM_MIN_DIMENSION, upper: CUSTOM_MAX_DIMENSION,
                step: 1, page: 2,
            });
        gridGroup.add(rowsRow);
        const columnsRow = createSpinRow(settings, 'custom-columns',
            _('Columns per page'), {
                lower: CUSTOM_MIN_DIMENSION, upper: CUSTOM_MAX_DIMENSION,
                step: 1, page: 2,
            });
        gridGroup.add(columnsRow);
        const gridSpacingRow = new Adw.ExpanderRow({
            title: _('Spacing'),
            subtitle: _('Row and column gaps in pixels'),
        });
        gridSpacingRow.add_row(createSpinRow(settings, 'custom-row-spacing',
            _('Row gap (px)'), {lower: 0, upper: 200, step: 2, page: 8}));
        gridSpacingRow.add_row(createSpinRow(settings, 'custom-column-spacing',
            _('Column gap (px)'), {lower: 0, upper: 200, step: 2, page: 8}));
        gridGroup.add(gridSpacingRow);

        const infoLabel = new Gtk.Label({
            label: '',
            halign: Gtk.Align.START,
            margin_top: 4,
            wrap: true,
            xalign: 0,
            css_classes: ['dim-label'],
        });
        const infoRow = new Adw.PreferencesRow({
            activatable: false,
            selectable: false,
        });
        infoRow.set_child(infoLabel);
        gridGroup.add(infoRow);
        gridBox.append(gridGroup);

        const folderGroup = new Adw.PreferencesGroup({
            title: _('Folder grid'),
            description: _('Opened folder layout and title'),
        });
        folderGroup.add(createSpinRow(settings, 'folder-rows',
            _('Rows'), {
                lower: FOLDER_MIN_DIMENSION, upper: FOLDER_MAX_DIMENSION,
                step: 1, page: 1,
            }));
        folderGroup.add(createSpinRow(settings, 'folder-columns',
            _('Columns'), {
                lower: FOLDER_MIN_DIMENSION, upper: FOLDER_MAX_DIMENSION,
                step: 1, page: 1,
            }));
        folderGroup.add(createSpinRow(settings, 'folder-title-size',
            _('Title size (px)'), {
                lower: 0, upper: FOLDER_MAX_TITLE_SIZE, step: 1, page: 4,
                subtitle: _('0 follows the system theme; the edit button scales with the title'),
            }));
        const edgeAutoRow = new Adw.SwitchRow({
            title: _('Automatic edge padding'),
            subtitle: '',
        });
        settings.bind('folder-edge-padding-auto', edgeAutoRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        folderGroup.add(edgeAutoRow);
        const edgePaddingRow = createSpinRow(settings, 'folder-edge-padding',
            _('Edge padding (px)'), {
                lower: 0, upper: FOLDER_EDGE_PADDING_MAX, step: 2, page: 8,
                subtitle: _('Used when automatic edge padding is off'),
            });
        folderGroup.add(edgePaddingRow);
        const syncEdgePaddingRows = () => {
            const auto = settings.get_boolean('folder-edge-padding-auto');
            const iconSize = readIconSize(settings);
            const effective = resolveFolderEdgePadding(iconSize, auto,
                settings.get_int('folder-edge-padding'));
            edgePaddingRow.sensitive = !auto;
            edgeAutoRow.subtitle = auto
                ? formatMessage(
                    _('Follows the icon size: {padding} px'),
                    {padding: effective})
                : _('Using the manual edge padding below');
            edgePaddingRow.subtitle = auto
                ? formatMessage(
                    _('Manual value {padding} px; used when automatic is off'),
                    {padding: settings.get_int('folder-edge-padding')})
                : _('Distance from the grid to the panel edge');
        };
        let previousEdgeAuto = settings.get_boolean(
            'folder-edge-padding-auto');
        connectSignal(cleanupFns, settings,
            'changed::folder-edge-padding-auto', () => {
                const auto = settings.get_boolean(
                    'folder-edge-padding-auto');
                if (previousEdgeAuto && !auto) {
                    settings.set_int('folder-edge-padding',
                        autoFolderEdgePadding(readIconSize(settings)));
                }
                previousEdgeAuto = auto;
                syncEdgePaddingRows();
            });
        for (const key of [
            'use-presets',
            'preset-level',
            'custom-icon-size',
        ]) {
            connectSignal(cleanupFns, settings, `changed::${key}`,
                syncEdgePaddingRows);
        }
        connectSignal(cleanupFns, settings, 'changed::folder-edge-padding',
            syncEdgePaddingRows);
        syncEdgePaddingRows();
        const folderSpacingRow = new Adw.ExpanderRow({
            title: _('Spacing'),
            subtitle: _('Row and column gaps in pixels'),
        });
        folderSpacingRow.add_row(createSpinRow(settings, 'folder-row-spacing',
            _('Row gap (px)'), {
                lower: 0, upper: FOLDER_MAX_SPACING, step: 2, page: 8,
            }));
        folderSpacingRow.add_row(createSpinRow(settings, 'folder-column-spacing',
            _('Column gap (px)'), {
                lower: 0, upper: FOLDER_MAX_SPACING, step: 2, page: 8,
            }));
        folderGroup.add(folderSpacingRow);

        const folderInfo = new Gtk.Label({
            label: '',
            halign: Gtk.Align.START,
            margin_top: 4,
            wrap: true,
            xalign: 0,
            css_classes: ['dim-label'],
        });
        const folderInfoRow = new Adw.PreferencesRow({
            activatable: false,
            selectable: false,
        });
        folderInfoRow.set_child(folderInfo);
        folderGroup.add(folderInfoRow);
        folderBox.append(folderGroup);

        const updateFolderInfo = () => {
            const config = readGridConfig(settings);
            const capacity = config.folderRows * config.folderColumns;
            const title = config.folderTitleSize > 0
                ? formatMessage(_('{size} px'), {size: config.folderTitleSize})
                : _('system');
            const edgeMode = config.folderEdgePaddingAuto
                ? _('auto') : _('manual');
            folderInfo.label = formatMessage(
                _('{rows} × {columns} = {capacity} apps per page · gap {rowGap}×{colGap} px · edge {edge} px {edgeMode} · title {title} · {labels} · dialog fits the configured grid'), {
                    rows: config.folderRows,
                    columns: config.folderColumns,
                    capacity,
                    rowGap: config.folderRowSpacing,
                    colGap: config.folderColumnSpacing,
                    edge: config.folderEdgePadding,
                    edgeMode,
                    title,
                    labels: config.showNames
                        ? _('labels shown') : _('labels hidden'),
                });
        };
        for (const key of [
            'folder-rows',
            'folder-columns',
            'folder-row-spacing',
            'folder-column-spacing',
            'folder-title-size',
            'folder-edge-padding-auto',
            'folder-edge-padding',
            'show-app-names',
            'use-presets',
            'preset-level',
            'custom-icon-size',
        ]) {
            connectSignal(cleanupFns, settings, `changed::${key}`,
                updateFolderInfo);
        }
        updateFolderInfo();

        const snapshotsGroup = new Adw.PreferencesGroup({
            title: _('Saved layouts'),
            description: _('Save layout settings, app order and folder contents'),
        });
        const snapshotNameRow = new Adw.EntryRow({
            title: _('Snapshot name'),
        });
        snapshotsGroup.add(snapshotNameRow);

        const saveSnapshotRow = new Adw.ActionRow({
            title: _('Save current layout'),
            subtitle: _('Captures the current grid, labels and app arrangement'),
        });
        const saveSnapshotButton = new Gtk.Button({
            label: _('Save'),
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action'],
        });
        saveSnapshotRow.add_suffix(saveSnapshotButton);
        saveSnapshotRow.activatable_widget = saveSnapshotButton;
        snapshotsGroup.add(saveSnapshotRow);

        const snapshotsCombo = new Adw.ComboRow({
            title: _('Saved layouts'),
        });
        snapshotsGroup.add(snapshotsCombo);

        const snapshotActionRow = new Adw.ActionRow({
            title: _('Selected layout'),
            subtitle: _('Restoring replaces the grid, app order and folders'),
        });
        const restoreSnapshotButton = new Gtk.Button({
            label: _('Restore'),
            valign: Gtk.Align.CENTER,
        });
        const deleteSnapshotButton = new Gtk.Button({
            label: _('Delete'),
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        snapshotActionRow.add_suffix(restoreSnapshotButton);
        snapshotActionRow.add_suffix(deleteSnapshotButton);
        snapshotsGroup.add(snapshotActionRow);

        const snapshotStatus = new Gtk.Label({
            label: '',
            halign: Gtk.Align.START,
            margin_top: 4,
            wrap: true,
            xalign: 0,
            css_classes: ['dim-label'],
        });
        const snapshotStatusRow = new Adw.PreferencesRow({
            activatable: false,
            selectable: false,
        });
        snapshotStatusRow.set_child(snapshotStatus);
        snapshotsGroup.add(snapshotStatusRow);
        snapshotsBox.append(snapshotsGroup);

        const advancedGroup = new Adw.PreferencesGroup({
            title: _('Page consolidation'),
            description: _('Permanently rewrites the saved app order'),
        });
        const consolidateRow = new Adw.SwitchRow({
            title: _('Consolidate app pages'),
            subtitle: _('Fill earlier pages and permanently save the new app order'),
        });
        settings.bind('consolidate-pages', consolidateRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        advancedGroup.add(consolidateRow);
        advancedBox.append(advancedGroup);

        const shellSettings = Gio.Settings.new('org.gnome.shell');
        const folderSettings = Gio.Settings.new(
            'org.gnome.desktop.app-folders');

        const refreshSnapshotRows = selectId => {
            snapshots = parseSnapshots(
                settings.get_string('layout-snapshots'));
            const model = new Gtk.StringList();
            for (const snapshot of snapshots) {
                model.append(formatMessage(_('{name} — {summary}'), {
                    name: snapshot.name,
                    summary: snapshotLabel(snapshot, _),
                }));
            }
            snapshotsCombo.model = model;
            const index = selectId
                ? snapshots.findIndex(snapshot => snapshot.id === selectId)
                : 0;
            snapshotsCombo.selected = snapshots.length
                ? Math.max(0, index)
                : Gtk.INVALID_LIST_POSITION;
            const hasSnapshots = snapshots.length > 0;
            snapshotsCombo.sensitive = hasSnapshots;
            restoreSnapshotButton.sensitive = hasSnapshots;
            deleteSnapshotButton.sensitive = hasSnapshots;
            snapshotStatus.label = hasSnapshots
                ? formatMessage(_('Saved layouts: {count}'), {
                    count: snapshots.length,
                })
                : _('No saved layouts yet');
            snapshotNameRow.text = formatMessage(_('Layout {number}'), {
                number: snapshots.length + 1,
            });
        };

        let snapshots = [];
        refreshSnapshotRows();
        connectSignal(cleanupFns, settings, 'changed::layout-snapshots', () => {
            refreshSnapshotRows();
        });

        saveSnapshotButton.connect('clicked', () => {
            if (snapshots.length >= MAX_SNAPSHOTS) {
                snapshotStatus.label = formatMessage(
                    _('Limit reached ({max}); delete a snapshot first'), {
                        max: MAX_SNAPSHOTS,
                    });
                return;
            }
            const name = snapshotNameRow.text.trim() ||
                formatMessage(_('Layout {number}'), {
                    number: snapshots.length + 1,
                });
            try {
                const config = readGridConfig(settings);
                const pages = shellSettings
                    .get_value('app-picker-layout').deepUnpack();
                const snapshot = captureSnapshot({
                    settings,
                    shellSettings,
                    folderSettings,
                    folderSettingsFor: id =>
                        folderSettingsFor(folderSettings, id),
                    name,
                    summary: {
                        iconSize: config.iconSize,
                        rows: config.rows,
                        columns: config.columns,
                        folderRows: config.folderRows,
                        folderColumns: config.folderColumns,
                        showNames: config.showNames,
                        pages: Array.isArray(pages) ? pages.length : 0,
                    },
                });
                snapshots = addSnapshot(snapshots, snapshot);
                settings.set_string('layout-snapshots',
                    serializeSnapshots(snapshots));
                refreshSnapshotRows(snapshot.id);
                snapshotStatus.label = formatMessage(
                    _('Saved “{name}”'), {name});
            } catch (error) {
                snapshotStatus.label = formatMessage(
                    _('Could not save: {error}'), {error: error.message});
            }
        });

        deleteSnapshotButton.connect('clicked', () => {
            const snapshot = snapshots[snapshotsCombo.selected];
            if (!snapshot)
                return;
            snapshots = removeSnapshot(snapshots, snapshot.id);
            settings.set_string('layout-snapshots',
                serializeSnapshots(snapshots));
            refreshSnapshotRows();
            snapshotStatus.label = formatMessage(
                _('Deleted “{name}”'), {name: snapshot.name});
        });

        restoreSnapshotButton.connect('clicked', () => {
            const snapshot = snapshots[snapshotsCombo.selected];
            if (!snapshot)
                return;
            const dialog = new Gtk.AlertDialog({
                message: formatMessage(_('Restore “{name}”?'), {
                    name: snapshot.name,
                }),
                detail: _('This replaces the current layout settings, app order and folder contents.'),
                buttons: [_('Cancel'), _('Restore')],
                cancel_button: 0,
                default_button: 0,
            });
            dialog.choose(window, null, (source, result) => {
                let response;
                try {
                    response = source.choose_finish(result);
                } catch (_error) {
                    return;
                }
                if (response !== 1)
                    return;
                try {
                    restoreSnapshot({
                        settings,
                        shellSettings,
                        folderSettings,
                        folderSettingsFor: id =>
                            folderSettingsFor(folderSettings, id),
                        snapshot,
                        applyStoredValue,
                    });
                    snapshotStatus.label = formatMessage(
                        _('Restored “{name}”'), {name: snapshot.name});
                } catch (error) {
                    snapshotStatus.label = formatMessage(
                        _('Could not restore: {error}'), {
                            error: error.message,
                        });
                }
            });
        });

        const updateVisibility = () => {
            const preset = settings.get_boolean('use-presets');
            comboRow.visible = preset;
            presetInfoRow.visible = preset;
            iconSizeRow.visible = !preset;
            rowsRow.visible = !preset;
            columnsRow.visible = !preset;
            gridSpacingRow.visible = !preset;
            infoRow.visible = !preset;
        };
        connectSignal(cleanupFns, settings,
            'changed::use-presets', updateVisibility);
        updateVisibility();

        const updateInfo = () => {
            const r = settings.get_int('custom-rows');
            const c = settings.get_int('custom-columns');
            const rsp = settings.get_int('custom-row-spacing');
            const csp = settings.get_int('custom-column-spacing');
            infoLabel.label = formatMessage(
                _('{rows} × {columns} = {capacity} apps per page, gap {rowGap}×{colGap} px'), {
                    rows: r,
                    columns: c,
                    capacity: r * c,
                    rowGap: rsp,
                    colGap: csp,
                });
        };
        for (const key of [
            'custom-rows',
            'custom-columns',
            'custom-row-spacing',
            'custom-column-spacing',
        ]) {
            connectSignal(cleanupFns, settings, `changed::${key}`, updateInfo);
        }
        updateInfo();

        const addNavRow = (group, title, page) => {
            const row = new Adw.ActionRow({title, activatable: true});
            row.add_suffix(new Gtk.Image({
                icon_name: 'go-next-symbolic',
                valign: Gtk.Align.CENTER,
                css_classes: ['dim-label'],
            }));
            row.connect('activated', () => showPage(page));
            group.add(row);
            return row;
        };

        const layoutGroup = new Adw.PreferencesGroup({title: _('Layout')});
        const appGridRow = addNavRow(layoutGroup, _('App grid'), 'grid');
        const folderRow = addNavRow(layoutGroup, _('Folder dialog'), 'folder');

        const optionsGroup = new Adw.PreferencesGroup({title: _('Options')});
        const namesRow = new Adw.SwitchRow({
            title: _('Show application names'),
            subtitle: _('Show labels under app and folder icons'),
        });
        settings.bind('show-app-names', namesRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        optionsGroup.add(namesRow);
        const snapshotsRow = addNavRow(optionsGroup,
            _('Layout snapshots'), 'snapshots');
        const advancedRow = addNavRow(optionsGroup, _('Advanced'), 'advanced');
        rootBox.append(layoutGroup);
        rootBox.append(optionsGroup);

        const updateRootRows = () => {
            const config = readGridConfig(settings);
            const presetName = _(SIZE_NAMES[settings.get_int('preset-level')] ?? '');
            const folderTitle = config.folderTitleSize > 0
                ? formatMessage(_('{size} px'), {
                    size: config.folderTitleSize,
                })
                : _('system');
            appGridRow.subtitle = config.usePresets
                ? formatMessage(_('{preset} · {icon} px'), {
                    preset: presetName,
                    icon: config.iconSize,
                })
                : formatMessage(_('Custom · {icon} px · {rows}×{columns}'), {
                    icon: config.iconSize,
                    rows: config.rows,
                    columns: config.columns,
                });
            folderRow.subtitle = formatMessage(
                _('{rows}×{columns} · title {title} · edge {edge} px'), {
                    rows: config.folderRows,
                    columns: config.folderColumns,
                    title: folderTitle,
                    edge: config.folderEdgePadding,
                });
            const saved = parseSnapshots(
                settings.get_string('layout-snapshots')).length;
            snapshotsRow.subtitle = saved
                ? formatMessage(_('{count} saved'), {count: saved})
                : _('No saved layouts');
            advancedRow.subtitle = _('Page consolidation rewrites the app order');
        };
        for (const key of [
            'use-presets', 'preset-level', 'custom-icon-size',
            'custom-rows', 'custom-columns',
            'folder-rows', 'folder-columns', 'folder-title-size',
            'folder-edge-padding-auto', 'folder-edge-padding',
            'layout-snapshots',
        ]) {
            connectSignal(cleanupFns, settings, `changed::${key}`,
                updateRootRows);
        }
        updateRootRows();

        addPage('root', null, rootBox);
        addPage('grid', _('App grid'), gridBox);
        addPage('folder', _('Folder dialog'), folderBox);
        addPage('snapshots', _('Layout snapshots'), snapshotsBox);
        addPage('advanced', _('Advanced'), advancedBox);
        stack.set_visible_child_name('root');

        return {widget: stack, cleanupFns};
    }

    _buildPreviewPane(settings, window) {
        const cleanupFns = [];

        const previewRoot = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 4,
            margin_top: 16, margin_bottom: 16,
            margin_start: 24, margin_end: 24,
        });
        const overviewPage = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 4,
            hexpand: true,
            vexpand: true,
        });

        const screenLabel = new Gtk.Label({
            label: '',
            halign: Gtk.Align.CENTER,
            wrap: true,
            css_classes: ['dim-label', 'caption'],
        });

        const previewFrame = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            overflow: Gtk.Overflow.HIDDEN,
        });
        previewFrame.add_css_class('card');
        previewFrame.add_css_class('appgrid-fit-wallpaper-preview');

        const da = new Gtk.DrawingArea();
        da.set_content_width(560);
        da.set_content_height(315);
        da.set_hexpand(true);
        da.set_vexpand(true);
        previewFrame.append(da);

        const aspectFrame = new Gtk.AspectFrame({
            ratio: 16 / 9,
            obey_child: false,
            hexpand: true,
        });
        aspectFrame.set_child(previewFrame);

        const previewClamp = new Adw.Clamp({
            maximum_size: 720,
            tightening_threshold: 480,
            hexpand: true,
        });
        previewClamp.set_child(aspectFrame);

        const fitLabel = new Gtk.Label({
            label: '',
            halign: Gtk.Align.CENTER,
            wrap: true,
            css_classes: ['dim-label', 'caption'],
        });

        const fitButton = new Gtk.Button({
            label: '',
            halign: Gtk.Align.CENTER,
            css_classes: ['pill'],
        });
        fitButton.connect('clicked', () => {
            settings.set_int('custom-rows', clampCustomDimension(ps.fitRows));
            settings.set_int('custom-columns',
                clampCustomDimension(ps.fitCols));
        });

        overviewPage.append(screenLabel);
        overviewPage.append(previewClamp);
        overviewPage.append(fitLabel);
        overviewPage.append(fitButton);

        const folderLabel = new Gtk.Label({
            label: '',
            halign: Gtk.Align.CENTER,
            wrap: true,
            css_classes: ['dim-label', 'caption'],
        });

        const folderFrame = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            overflow: Gtk.Overflow.HIDDEN,
        });
        folderFrame.add_css_class('card');
        folderFrame.add_css_class('appgrid-fit-wallpaper-preview');

        const folderDa = new Gtk.DrawingArea();
        folderDa.set_content_width(560);
        folderDa.set_content_height(315);
        folderDa.set_hexpand(true);
        folderDa.set_vexpand(true);
        folderDa.set_draw_func((_area, cr, drawW, drawH) => {
            const config = readGridConfig(settings);
            drawFolderPreviewSection(cr, 0, 0, drawW, drawH, {
                iconSize: config.iconSize,
                folderRows: config.folderRows,
                folderColumns: config.folderColumns,
                folderRowSpacing: config.folderRowSpacing,
                folderColumnSpacing: config.folderColumnSpacing,
                folderTitleSize: config.folderTitleSize,
                folderEdgePadding: config.folderEdgePadding,
                showNames: config.showNames,
            });
        });
        folderFrame.append(folderDa);

        const folderAspect = new Gtk.AspectFrame({
            ratio: 16 / 9,
            obey_child: false,
            hexpand: true,
        });
        folderAspect.set_child(folderFrame);

        const folderClamp = new Adw.Clamp({
            maximum_size: 720,
            tightening_threshold: 480,
            hexpand: true,
        });
        folderClamp.set_child(folderAspect);

        const folderCaption = new Gtk.Label({
            label: '',
            halign: Gtk.Align.CENTER,
            wrap: true,
            css_classes: ['dim-label', 'caption'],
        });

        const folderPage = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 4,
            hexpand: true,
            vexpand: true,
        });
        folderPage.append(folderLabel);
        folderPage.append(folderClamp);
        folderPage.append(folderCaption);

        const previewStack = new Gtk.Stack({
            transition_type: Gtk.StackTransitionType.CROSSFADE,
            transition_duration: 160,
            hexpand: true,
            vexpand: true,
        });
        previewStack.add_named(overviewPage, 'overview');
        previewStack.add_named(folderPage, 'folder');
        previewRoot.append(previewStack);

        const setPage = page => {
            previewStack.set_visible_child_name(
                page === 'folder' ? 'folder' : 'overview');
        };

        const updateFolderPreview = () => {
            const config = readGridConfig(settings);
            const capacity = config.folderRows * config.folderColumns;
            const title = config.folderTitleSize > 0
                ? formatMessage(_('{size} px'), {
                    size: config.folderTitleSize,
                })
                : _('system');
            folderLabel.label = formatMessage(
                _('Folder dialog preview · {rows} × {columns}'), {
                    rows: config.folderRows,
                    columns: config.folderColumns,
                });
            const edgeMode = config.folderEdgePaddingAuto
                ? _('auto') : _('manual');
            folderCaption.label = formatMessage(
                _('{capacity} apps per page · gap {rowGap}×{colGap} px · edge {edge} px {edgeMode} · {icon} px icons · title {title} · {labels}'), {
                    capacity,
                    rowGap: config.folderRowSpacing,
                    colGap: config.folderColumnSpacing,
                    edge: config.folderEdgePadding,
                    edgeMode,
                    icon: config.iconSize,
                    title,
                    labels: config.showNames
                        ? _('labels shown') : _('labels hidden'),
                }) + '\n' + _('Paged folders keep side room for navigation arrows');
            folderDa.queue_draw();
        };
        updateFolderPreview();

        const ps = {monitorW: 1920, monitorH: 1080};
        const shellSettings = Gio.Settings.new('org.gnome.shell');
        const folderSettings = Gio.Settings.new('org.gnome.desktop.app-folders');

        const refreshMonitorSize = () => {
            try {
                const display = Gdk.Display.get_default();
                if (!display)
                    return;
                const surface = window.get_surface();
                const monitor = surface
                    ? display.get_monitor_at_surface(surface)
                    : display.get_monitors()?.get_item(0);
                if (!monitor)
                    return;
                const geom = monitor.get_geometry();
                ps.monitorW = geom.width;
                ps.monitorH = geom.height;
            } catch (_e) {}
        };

        const bgSettings = Gio.Settings.new('org.gnome.desktop.background');
        const wpProvider = new Gtk.CssProvider();
        const display = Gdk.Display.get_default();
        if (display) {
            Gtk.StyleContext.add_provider_for_display(
                display, wpProvider, Gtk.STYLE_PROVIDER_PRIORITY_USER);
        }

        const loadWallpaper = () => {
            try {
                const isDark = Adw.StyleManager.get_default().dark;
                let uri = bgSettings.get_string(
                    isDark ? 'picture-uri-dark' : 'picture-uri');
                if (!uri)
                    uri = bgSettings.get_string('picture-uri');
                if (uri) {
                    const safeUri = escapeCssString(
                        Gio.File.new_for_uri(uri).get_uri());
                    wpProvider.load_from_data(
                        `.appgrid-fit-wallpaper-preview{background-image:url("${safeUri}");background-size:cover;}`, -1);
                    return;
                }
            } catch (_e) {}
            wpProvider.load_from_data(
                '.appgrid-fit-wallpaper-preview{background-image:none;}', -1);
        };

        loadWallpaper();
        connectSignal(cleanupFns, bgSettings,
            'changed::picture-uri', loadWallpaper);
        connectSignal(cleanupFns, bgSettings,
            'changed::picture-uri-dark', loadWallpaper);
        cleanupFns.push(() => {
            if (!display)
                return;
            Gtk.StyleContext.remove_provider_for_display(
                display, wpProvider);
        });

        const sm = Adw.StyleManager.get_default();
        connectSignal(cleanupFns, sm, 'notify::dark', loadWallpaper);

        const updatePreview = () => {
            refreshMonitorSize();

            const config = readGridConfig(settings);
            const {iconSize, rows, columns, rowGap, colGap, usePresets} = config;
            const consolidate = settings.get_boolean('consolidate-pages');
            const runtimeLayout = decodePreviewLayout(
                settings.get_string(PREVIEW_LAYOUT_KEY));
            const mW = runtimeLayout?.monitor.width ?? ps.monitorW;
            const mH = runtimeLayout?.monitor.height ?? ps.monitorH;
            const layout = estimateGridArea(mW, mH);
            if (runtimeLayout) {
                const grid = runtimeLayout.grid;
                if (runtimeLayout.settled) {
                    layout.iconAreaX = grid.x + grid.paddingLeft;
                    layout.iconAreaYPos = grid.y + grid.paddingTop;
                }
                layout.iconAreaW = Math.max(100,
                    grid.width - grid.paddingLeft - grid.paddingRight);
                layout.iconAreaH = Math.max(100,
                    grid.height - grid.paddingTop - grid.paddingBottom);
                if (runtimeLayout.settled && !runtimeLayout.dashRect) {
                    layout.dashY = Math.min(mH - layout.dashH,
                        grid.y + grid.height + layout.spacing);
                }
            }
            const runtimeConfig = runtimeLayout?.config;
            const measuredTileSize = runtimeConfig?.iconSize === iconSize
                ? runtimeConfig.tileSize ?? null
                : null;
            const previewCellSize = computePreviewTileSize(
                iconSize, measuredTileSize);
            const fit = computeGridFit({
                width: layout.iconAreaW,
                height: layout.iconAreaH,
                iconSize,
                tileSize: previewCellSize,
                rowGap,
                columnGap: colGap,
                widthRatio: usePresets ? PRESET_WIDTH_RATIO : 1,
            });
            const {
                rows: fitRows,
                columns: fitCols,
                cellSize,
            } = fit;

            const activeRows = usePresets ? fitRows : rows;
            const activeColumns = usePresets ? fitCols : columns;
            const runtimeConfigMatches = runtimeLayout?.version === 2 &&
                runtimeConfig?.iconSize === iconSize &&
                runtimeConfig?.rows === activeRows &&
                runtimeConfig?.columns === activeColumns &&
                runtimeConfig?.rowGap === rowGap &&
                runtimeConfig?.columnGap === colGap &&
                runtimeConfig?.consolidate === consolidate;
            const measuredItemsMatch = runtimeConfigMatches &&
                runtimeLayout.settled === true;
            const fallbackPages = readFallbackPages(
                shellSettings, folderSettings, consolidate);
            const fallbackPageCounts = fallbackPages.map(page => page.length);
            const runtimePagesMatch = runtimeConfigMatches &&
                Array.isArray(runtimeLayout.pageItemCounts);
            const pageItemCounts = runtimePagesMatch
                ? runtimeLayout.pageItemCounts
                : fallbackPageCounts;
            const currentPage = Math.min(
                runtimePagesMatch ? runtimeLayout.currentPage ?? 0 : 0,
                pageItemCounts.length - 1);
            const itemCount = pageItemCounts[currentPage] ??
                (runtimePagesMatch ? runtimeLayout.itemCount : 0);
            const gridItems = runtimePagesMatch &&
                runtimeLayout.items?.length === itemCount
                ? runtimeLayout.items
                : fallbackPages[currentPage] ?? [];
            Object.assign(ps, layout, {
                iconSize, rows, columns, rowGap, colGap,
                fitRows, fitCols, usePresets, cellSize,
                previewCellSize,
                itemCount,
                gridItems,
                showNames: config.showNames,
                measuredItems: measuredItemsMatch ? runtimeLayout.items : null,
                searchRect: runtimeLayout?.settled
                    ? runtimeLayout.searchRect ?? null : null,
                workspaceRects: runtimeLayout?.settled
                    ? runtimeLayout.workspaceRects ?? null : null,
                workspaceCount: runtimeLayout?.workspaceCount ?? 2,
                pageCount: pageItemCounts.length,
                currentPage,
                gridBottom: runtimeLayout?.settled
                    ? runtimeLayout.grid.y + runtimeLayout.grid.height
                    : layout.iconAreaYPos + layout.iconAreaH,
                pageIndicatorRect:
                    runtimeLayout?.pageIndicatorRect ?? null,
                dashRect: runtimeLayout?.dashRect ?? null,
                dashVisible: runtimeLayout?.dashVisible ?? null,
                dashItems: runtimeLayout?.dashItems ?? null,
                monitorW: mW, monitorH: mH,
            });
            if (runtimeLayout?.panelRect)
                ps.panelH = runtimeLayout.panelRect.height;

            aspectFrame.ratio = mW / mH;
            const areaPrefix = measuredItemsMatch
                ? _('Live Shell geometry')
                : runtimeLayout ? _('Live icon area · open Overview for exact placement')
                    : _('Estimated icon area · open Overview for exact placement');
            screenLabel.label = formatMessage(
                _('Monitor: {width} × {height}  ·  {area}: {iconWidth} × {iconHeight}'), {
                    width: mW,
                    height: mH,
                    area: areaPrefix,
                    iconWidth: layout.iconAreaW,
                    iconHeight: layout.iconAreaH,
                });

            if (usePresets) {
                fitLabel.label = formatMessage(
                    _('Balanced fit: {rows}×{columns} = {capacity} capacity  ·  {count} apps on current page'), {
                        rows: fitRows,
                        columns: fitCols,
                        capacity: fitRows * fitCols,
                        count: itemCount,
                    });
            } else {
                const gridSize = computeGridPixelSize(
                    rows, columns, cellSize, rowGap, colGap);
                const fitSize = computeGridPixelSize(
                    fitRows, fitCols, cellSize, rowGap, colGap);
                let text = formatMessage(
                    _('Grid: {rows}×{columns} = {apps} apps  ·  {width}×{height}px  ·  {percentW}%×{percentH}% of icon area'), {
                        rows,
                        columns,
                        apps: rows * columns,
                        width: gridSize.width,
                        height: gridSize.height,
                        percentW: Math.round(
                            gridSize.width / layout.iconAreaW * 100),
                        percentH: Math.round(
                            gridSize.height / layout.iconAreaH * 100),
                    });
                text += '\n' + formatMessage(
                    _('Capacity estimate: {rows}×{columns} = {apps} apps  ·  {width}×{height}px'), {
                        rows: fitRows,
                        columns: fitCols,
                        apps: fitRows * fitCols,
                        width: fitSize.width,
                        height: fitSize.height,
                    });
                if (rows !== fitRows || columns !== fitCols)
                    text += '\n' + _('Configured grid differs from the capacity estimate');
                fitLabel.label = text;
            }

            const targetRows = clampCustomDimension(fitRows);
            const targetColumns = clampCustomDimension(fitCols);
            fitButton.label = formatMessage(_('Fit {rows}×{columns}'), {
                rows: targetRows,
                columns: targetColumns,
            });
            fitButton.visible = !usePresets &&
                (rows !== targetRows || columns !== targetColumns);

            da.queue_draw();
        };

        for (const key of SETTINGS_KEYS) {
            connectSignal(cleanupFns, settings,
                `changed::${key}`, updatePreview);
            connectSignal(cleanupFns, settings,
                `changed::${key}`, updateFolderPreview);
        }
        connectSignal(cleanupFns, settings,
            `changed::${PREVIEW_LAYOUT_KEY}`, updatePreview);
        connectSignal(cleanupFns, shellSettings,
            'changed::app-picker-layout', updatePreview);
        connectSignal(cleanupFns, folderSettings,
            'changed::folder-children', updatePreview);
        const monitors = display?.get_monitors();
        if (monitors)
            connectSignal(cleanupFns, monitors, 'items-changed', updatePreview);
        connectSignal(cleanupFns, window, 'notify::surface', updatePreview);
        updatePreview();

        da.set_draw_func((_area, cr, drawW, drawH) => {
            const {
                monitorW, monitorH, panelH, searchH, dashH, miniWsH,
                searchY, miniWsY, dashY,
                iconAreaX, iconAreaYPos, iconAreaW, iconAreaH,
                iconSize, rows, columns, rowGap, colGap,
                fitRows, fitCols, usePresets, cellSize, previewCellSize, itemCount,
                gridItems,
                measuredItems, searchRect, workspaceRects, workspaceCount,
                dashRect, dashItems, pageCount, currentPage,
                gridBottom, pageIndicatorRect, dashVisible, showNames,
            } = ps;

            const pad = PREVIEW_PADDING;
            const aW = drawW - pad * 2;
            const aH = drawH - pad * 2;

            const aspect = monitorW / monitorH;
            let fW, fH;
            if (aW / aspect <= aH) {
                fW = aW;
                fH = aW / aspect;
            } else {
                fH = aH;
                fW = aH * aspect;
            }
            const fx = pad + (aW - fW) / 2;
            const fy = pad + (aH - fH) / 2;
            const sc = fW / monitorW;

            cr.setSourceRGBA(0.015, 0.025, 0.07, 0.36);
            cr.rectangle(fx, fy, fW, fH);
            cr.fill();

            drawPanelSection(cr, fx, fy, fW, panelH, sc);
            drawSearchSection(cr, fx, fy, fW,
                fy + searchY * sc, searchH * sc, sc, searchRect);
            drawMiniWsSection(cr, fx, fy, fW,
                fy + miniWsY * sc, miniWsH * sc, sc,
                workspaceRects, workspaceCount, monitorW / monitorH);

            const drawRows = usePresets ? fitRows : rows;
            const drawCols = usePresets ? fitCols : columns;
            if (measuredItems?.length) {
                drawMeasuredGridSection(cr, fx, fy, sc,
                    measuredItems, iconSize, showNames);
            } else {
                drawGridSection(cr,
                    fx + iconAreaX * sc,
                    fy + (iconAreaYPos + SHELL_PREVIEW_GRID_TOP_INSET) * sc,
                    iconAreaW * sc,
                    (iconAreaH - SHELL_PREVIEW_GRID_TOP_INSET) * sc,
                    drawRows, drawCols, fitRows, fitCols,
                    previewCellSize * sc, previewCellSize * sc,
                    iconSize * sc, iconSize * sc,
                    colGap * sc, rowGap * sc,
                    sc, usePresets, itemCount, gridItems, showNames);
            }

            drawDashSection(cr, fx, fy, fW,
                fy + dashY * sc, dashH * sc, sc,
                dashRect, dashItems, pageCount, currentPage,
                pageIndicatorRect, gridBottom, dashVisible);

            cr.setDash([], 0);
        });

        const previewScroller = new Gtk.ScrolledWindow({
            hscrollbar_policy: Gtk.PolicyType.NEVER,
            vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
            min_content_height: 420,
            vexpand: true,
        });
        previewScroller.set_child(previewRoot);

        return {widget: previewScroller, cleanupFns, setPage};
    }
}
