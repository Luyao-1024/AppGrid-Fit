import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {
    DEFAULT_PAGE_CAPACITY,
    PRESETS,
    PRESET_WIDTH_RATIO,
    PREVIEW_LAYOUT_KEY,
    SETTINGS_KEYS,
    computeGridFit,
    computeGridPixelSize,
    decodePreviewLayout,
    splitPageItems,
} from './config.js';

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
const SHELL_MIN_PREVIEW_TILE_SIZE = 117;
const SHELL_PREVIEW_GRID_TOP_INSET = 8;

const SIZE_NAMES = ['Large', 'Medium', 'Small', 'Tiny'];

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
];

function drawAppGlyph(cr, x, y, width, height, index, folder, alpha = 0.9) {
    const [r, g, b] = ICON_COLORS[index % ICON_COLORS.length];
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
                const color = ICON_COLORS[(index + row * 2 + col) % ICON_COLORS.length];
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

function drawMeasuredGridSection(cr, fx, fy, sc, items, iconSize) {
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
        drawAppGlyph(cr, ix, iy, iw, ih, index, item.folder);

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
    sc, usePresets, itemCount, items) {
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
                    index, folder, overflow ? 0.48 : 0.86);
                cr.setSourceRGBA(0.9, 0.92, 0.96, overflow ? 0.3 : 0.52);
                const labelW = iconW * 0.78;
                const labelH = Math.max(1, 3 * sc);
                roundedRect(cr, iconX + (iconW - labelW) / 2,
                    folder ? glyphY + glyphH - 17 * sc : iconY + iconH + 7 * sc,
                    labelW, labelH, labelH / 2);
                cr.fill();
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

function drawDashSection(cr, fx, fy, fW, dY, dH, sc,
    dashRect, dashItems, pageCount, currentPage) {
    const indicatorY = (dashRect ? fy + dashRect.y * sc : dY) - 50 * sc;
    const visiblePageCount = Math.max(1, Math.min(8, pageCount));
    const indicatorGap = 32 * sc;
    const indicatorStartX = fx + fW / 2 -
        (visiblePageCount - 1) * indicatorGap / 2;
    for (let index = 0; index < visiblePageCount; index++) {
        const active = index === currentPage;
        cr.setSourceRGBA(0.9, 0.92, 0.97, active ? 0.95 : 0.48);
        cr.arc(indicatorStartX + index * indicatorGap, indicatorY,
            Math.max(active ? 1 : 0.8, (active ? 4 : 3) * sc),
            0, Math.PI * 2);
        cr.fill();
    }

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
                index + 2, false, 0.92);
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
            dockIc, dockIc, i + 2, false, 0.92);
    }
}

function createSpinRow(settings, key, title, {lower, upper, step, page}) {
    const row = new Adw.SpinRow({
        title,
        adjustment: new Gtk.Adjustment({
            lower, upper, step_increment: step, page_increment: page,
        }),
        value: settings.get_int(key),
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function readGridConfig(settings) {
    if (settings.get_boolean('use-presets')) {
        const preset = PRESETS[settings.get_int('preset-level')];
        return {
            iconSize: preset.iconSize,
            rows: preset.rows,
            columns: preset.columns,
            rowGap: preset.gap,
            colGap: preset.gap,
            usePresets: true,
        };
    }
    return {
        iconSize: settings.get_int('custom-icon-size'),
        rows: settings.get_int('custom-rows'),
        columns: settings.get_int('custom-columns'),
        rowGap: settings.get_int('custom-row-spacing'),
        colGap: settings.get_int('custom-column-spacing'),
        usePresets: false,
    };
}

function readFallbackPages(shellSettings, folderSettings) {
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
        return splitPageItems(pageItems);
    } catch (_e) {
        try {
            const apps = Gio.AppInfo.get_all()
                .filter(app => app.should_show())
                .map((app, position) => ({
                    id: app.get_id(), position, folder: false,
                }));
            return splitPageItems([apps]);
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
        window.set_default_size(1200, 560);

        const page = new Adw.PreferencesPage({
            title: 'App Grid',
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
        });

        const paned = new Gtk.Paned({
            orientation: Gtk.Orientation.HORIZONTAL,
            position: 420,
            shrink_start_child: true,
            shrink_end_child: true,
            resize_start_child: false,
            resize_end_child: true,
        });

        const {widget: controlsBox, cleanupFns: ctrlFns} =
            this._buildControlsPane(settings);
        cleanupFns.push(...ctrlFns);

        const {widget: rightBox, cleanupFns: prevFns} =
            this._buildPreviewPane(settings, window);
        cleanupFns.push(...prevFns);

        paned.set_start_child(controlsBox);
        paned.set_end_child(rightBox);
        rootRow.set_child(paned);
        rootGroup.add(rootRow);
    }

    _buildControlsPane(settings) {
        const cleanupFns = [];

        const leftBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 4,
            margin_top: 16, margin_bottom: 16,
            margin_start: 24, margin_end: 24,
        });

        const modeGroup = new Adw.PreferencesGroup({title: 'Mode'});
        const switchRow = new Adw.SwitchRow({
            title: 'Use preset sizes',
            subtitle: 'Off to customize icon size and grid manually',
        });
        settings.bind('use-presets', switchRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        modeGroup.add(switchRow);
        leftBox.append(modeGroup);

        const presetsGroup = new Adw.PreferencesGroup({
            title: 'Presets',
            description: 'Pick a ready-made combination',
        });

        const model = new Gtk.StringList();
        PRESETS.forEach((p, i) =>
            model.append(`${SIZE_NAMES[i]} — ${p.iconSize}px`));

        const comboRow = new Adw.ComboRow({title: 'Size', model});
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
            presetInfo.label =
                `${p.iconSize}px icons · ${p.rows}×${p.columns} grid · ${p.gap}px gap · ${p.rows * p.columns} apps/page`;
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
        presetsGroup.add(comboRow);
        presetsGroup.add(presetInfoRow);
        leftBox.append(presetsGroup);

        const customGroup = new Adw.PreferencesGroup({
            title: 'Custom',
            description: 'Adjust icon size, capacity and spacing independently',
        });

        customGroup.add(createSpinRow(settings, 'custom-icon-size',
            'Icon pixel size', {lower: 16, upper: 160, step: 8, page: 16}));
        customGroup.add(createSpinRow(settings, 'custom-rows',
            'Rows per page', {lower: 2, upper: 20, step: 1, page: 2}));
        customGroup.add(createSpinRow(settings, 'custom-columns',
            'Columns per page', {lower: 2, upper: 20, step: 1, page: 2}));
        customGroup.add(createSpinRow(settings, 'custom-row-spacing',
            'Row spacing (px)', {lower: 0, upper: 200, step: 2, page: 8}));
        customGroup.add(createSpinRow(settings, 'custom-column-spacing',
            'Column spacing (px)', {lower: 0, upper: 200, step: 2, page: 8}));

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
        customGroup.add(infoRow);
        leftBox.append(customGroup);

        const behaviorGroup = new Adw.PreferencesGroup({
            title: 'Page layout',
        });
        const consolidateRow = new Adw.SwitchRow({
            title: 'Consolidate app pages',
            subtitle: 'Fill earlier pages and permanently save the new app order',
        });
        settings.bind('consolidate-pages', consolidateRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        behaviorGroup.add(consolidateRow);
        leftBox.append(behaviorGroup);

        const updateVisibility = () => {
            const preset = settings.get_boolean('use-presets');
            presetsGroup.visible = preset;
            customGroup.visible = !preset;
        };
        connectSignal(cleanupFns, settings,
            'changed::use-presets', updateVisibility);
        updateVisibility();

        const updateInfo = () => {
            const r = settings.get_int('custom-rows');
            const c = settings.get_int('custom-columns');
            const rsp = settings.get_int('custom-row-spacing');
            const csp = settings.get_int('custom-column-spacing');
            infoLabel.label =
                `${r} × ${c} = ${r * c} apps per page, gap ${rsp}×${csp} px`;
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

        return {widget: leftBox, cleanupFns};
    }

    _buildPreviewPane(settings, window) {
        const cleanupFns = [];

        const rightBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 4,
            margin_top: 16, margin_bottom: 16,
            margin_start: 24, margin_end: 24,
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

        rightBox.append(screenLabel);
        rightBox.append(previewClamp);
        rightBox.append(fitLabel);

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
            const runtimeLayout = decodePreviewLayout(
                settings.get_string(PREVIEW_LAYOUT_KEY));
            const mW = runtimeLayout?.monitor.width ?? ps.monitorW;
            const mH = runtimeLayout?.monitor.height ?? ps.monitorH;
            const layout = estimateGridArea(mW, mH);
            if (runtimeLayout) {
                const grid = runtimeLayout.grid;
                layout.iconAreaX = grid.x + grid.paddingLeft;
                layout.iconAreaYPos = grid.y + grid.paddingTop;
                layout.iconAreaW = Math.max(100,
                    grid.width - grid.paddingLeft - grid.paddingRight);
                layout.iconAreaH = Math.max(100,
                    grid.height - grid.paddingTop - grid.paddingBottom);
                if (!runtimeLayout.dashRect) {
                    layout.dashY = Math.min(mH - layout.dashH,
                        grid.y + grid.height + layout.spacing);
                }
            }
            const fit = computeGridFit({
                width: layout.iconAreaW,
                height: layout.iconAreaH,
                iconSize,
                rowGap,
                columnGap: colGap,
                widthRatio: usePresets ? PRESET_WIDTH_RATIO : 1,
            });
            const {
                rows: fitRows,
                columns: fitCols,
                cellSize,
            } = fit;

            const runtimeConfig = runtimeLayout?.config;
            const activeRows = usePresets ? fitRows : rows;
            const activeColumns = usePresets ? fitCols : columns;
            const measuredItemsMatch = runtimeLayout?.version === 2 &&
                runtimeLayout.settled === true &&
                runtimeConfig?.iconSize === iconSize &&
                runtimeConfig?.rows === activeRows &&
                runtimeConfig?.columns === activeColumns &&
                runtimeConfig?.rowGap === rowGap &&
                runtimeConfig?.columnGap === colGap;
            const fallbackPages = readFallbackPages(shellSettings, folderSettings);
            const fallbackPageCounts = fallbackPages.map(page => page.length);
            const pageItemCounts = runtimeLayout?.pageItemCounts ??
                fallbackPageCounts;
            const currentPage = Math.min(
                runtimeLayout?.currentPage ?? 0, pageItemCounts.length - 1);
            const itemCount = pageItemCounts[currentPage] ??
                runtimeLayout?.itemCount ?? 0;
            const gridItems = runtimeLayout?.items?.length === itemCount
                ? runtimeLayout.items
                : fallbackPages[currentPage] ?? [];
            Object.assign(ps, layout, {
                iconSize, rows, columns, rowGap, colGap,
                fitRows, fitCols, usePresets, cellSize,
                previewCellSize: Math.max(cellSize, SHELL_MIN_PREVIEW_TILE_SIZE),
                itemCount,
                gridItems,
                measuredItems: measuredItemsMatch ? runtimeLayout.items : null,
                searchRect: runtimeLayout?.settled
                    ? runtimeLayout.searchRect ?? null : null,
                workspaceRects: runtimeLayout?.settled
                    ? runtimeLayout.workspaceRects ?? null : null,
                workspaceCount: runtimeLayout?.workspaceCount ?? 2,
                pageCount: pageItemCounts.length,
                currentPage,
                dashRect: runtimeLayout?.settled
                    ? runtimeLayout.dashRect ?? null : null,
                dashItems: runtimeLayout?.settled
                    ? runtimeLayout.dashItems ?? null : null,
                monitorW: mW, monitorH: mH,
            });
            if (runtimeLayout?.panelRect)
                ps.panelH = runtimeLayout.panelRect.height;

            aspectFrame.ratio = mW / mH;
            const areaPrefix = measuredItemsMatch
                ? 'Live Shell geometry'
                : runtimeLayout ? 'Live icon area · open Overview for exact placement'
                    : 'Estimated icon area · open Overview for exact placement';
            screenLabel.label =
                `Monitor: ${mW} × ${mH}  ·  ${areaPrefix}: ${layout.iconAreaW} × ${layout.iconAreaH}`;

            if (usePresets) {
                fitLabel.label =
                    `Balanced fit: ${fitRows}×${fitCols} = ${fitRows * fitCols} apps/page`;
            } else {
                const gridSize = computeGridPixelSize(
                    rows, columns, cellSize, rowGap, colGap);
                const fitSize = computeGridPixelSize(
                    fitRows, fitCols, cellSize, rowGap, colGap);
                let text =
                    `Grid: ${rows}×${columns} = ${rows * columns} apps  ·  ` +
                    `${gridSize.width}×${gridSize.height}px  ·  ` +
                    `${Math.round(gridSize.width / layout.iconAreaW * 100)}%×` +
                    `${Math.round(gridSize.height / layout.iconAreaH * 100)}% of icon area\n` +
                    `Capacity estimate: ${fitRows}×${fitCols} = ${fitRows * fitCols} apps  ·  ` +
                    `${fitSize.width}×${fitSize.height}px`;
                if (rows !== fitRows || columns !== fitCols)
                    text += '\nConfigured grid differs from the capacity estimate';
                fitLabel.label = text;
            }

            da.queue_draw();
        };

        for (const key of SETTINGS_KEYS) {
            connectSignal(cleanupFns, settings,
                `changed::${key}`, updatePreview);
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
                    measuredItems, iconSize);
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
                    sc, usePresets, itemCount, gridItems);
            }

            drawDashSection(cr, fx, fy, fW,
                fy + dashY * sc, dashH * sc, sc,
                dashRect, dashItems, pageCount, currentPage);

            cr.setDash([], 0);
        });

        return {widget: rightBox, cleanupFns};
    }
}
