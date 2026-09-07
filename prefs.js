import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {
    PRESETS,
    PRESET_WIDTH_RATIO,
    SETTINGS_KEYS,
    computeGridFit,
    computeGridPixelSize,
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

const PREVIEW_PADDING = 8;
const DOCK_ICON_COUNT = 5;

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
    cr.setDash([3, 2], 0);
    cr.setLineWidth(1);
    cr.rectangle(fx, fy, fW, panelHs);
    cr.setSourceRGBA(0, 0, 0, 0.4);
    cr.fillPreserve();
    cr.setSourceRGBA(0.6, 0.75, 0.9, 0.5);
    cr.stroke();

    cr.setSourceRGBA(0.5, 0.6, 0.7, 0.4);
    const actH = Math.max(2, 10 * sc);
    roundedRect(cr, fx + 10 * sc, fy + (panelHs - actH) / 2,
        Math.max(4, 70 * sc), actH, Math.max(1, 3 * sc));
    cr.fill();
    cr.arc(fx + fW / 2, fy + panelHs / 2, Math.max(2, 4 * sc), 0, Math.PI * 2);
    cr.fill();
    const sysW = Math.max(4, 50 * sc);
    roundedRect(cr, fx + fW - sysW - 10 * sc, fy + (panelHs - actH) / 2,
        sysW, actH, Math.max(1, 3 * sc));
    cr.fill();
}

function drawSearchSection(cr, fx, fW, sY, sH, sc) {
    cr.setDash([3, 2], 0);
    cr.setLineWidth(1);
    cr.setSourceRGBA(0.6, 0.75, 0.9, 0.4);
    cr.rectangle(fx, sY, fW, sH);
    cr.stroke();
    const pillH = Math.max(4, 30 * sc);
    const pillW = Math.min(360 * sc, fW * 0.35);
    cr.setSourceRGBA(0.5, 0.5, 0.55, 0.3);
    roundedRect(cr, fx + (fW - pillW) / 2, sY + (sH - pillH) / 2,
        pillW, pillH, pillH / 2);
    cr.fill();
}

function drawMiniWsSection(cr, fx, fW, mwY, mwH, sc) {
    cr.setDash([3, 2], 0);
    cr.setLineWidth(1);
    cr.setSourceRGBA(0.6, 0.75, 0.9, 0.4);
    cr.rectangle(fx, mwY, fW, mwH);
    cr.stroke();

    const wsThumbW = Math.max(8, 120 * sc);
    const wsThumbH = mwH * 0.6;
    const wsGap = Math.max(2, 10 * sc);
    const wsCount = Math.max(2, Math.min(4,
        Math.floor((fW - 40 * sc) / (wsThumbW + wsGap))));
    const wsTotalW = wsCount * wsThumbW + (wsCount - 1) * wsGap;
    const wsStartX = fx + (fW - wsTotalW) / 2;
    const wsStartY = mwY + (mwH - wsThumbH) / 2;
    cr.setSourceRGBA(0.5, 0.5, 0.55, 0.25);
    for (let i = 0; i < wsCount; i++) {
        roundedRect(cr, wsStartX + i * (wsThumbW + wsGap), wsStartY,
            wsThumbW, wsThumbH, Math.max(1, 3 * sc));
        cr.fill();
    }
}

function drawGridSection(cr, iaX, iaY, iaW, iaH,
    drawRows, drawCols, fitRows, fitCols,
    cellW, cellH, gapW, gapH, sc, usePresets) {
    const gridW = drawCols * cellW + Math.max(0, drawCols - 1) * gapW;
    const gridH = drawRows * cellH + Math.max(0, drawRows - 1) * gapH;
    const gx = iaX + (iaW - gridW) / 2;
    const gy = iaY + (iaH - gridH) / 2;

    for (let row = 0; row < drawRows; row++) {
        for (let col = 0; col < drawCols; col++) {
            const overflow = !usePresets && (row >= fitRows || col >= fitCols);
            cr.setSourceRGBA(
                overflow ? 0.85 : 0.35,
                overflow ? 0.30 : 0.55,
                overflow ? 0.30 : 0.85,
                overflow ? 0.45 : 0.65);
            roundedRect(cr,
                gx + col * (cellW + gapW),
                gy + row * (cellH + gapH),
                cellW, cellH, Math.max(1, 3 * sc));
            cr.fill();
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
            iaY + (iaH - afH) / 2 - 2,
            afW + 4, afH + 4);
        cr.stroke();
    }
}

function drawDashSection(cr, fx, fW, dY, dH, sc) {
    cr.setDash([3, 2], 0);
    cr.setLineWidth(1);
    cr.rectangle(fx, dY, fW, dH);
    cr.setSourceRGBA(0, 0, 0, 0.35);
    cr.fillPreserve();
    cr.setSourceRGBA(0.6, 0.75, 0.9, 0.5);
    cr.stroke();

    const dockIc = Math.max(4, 46 * sc);
    const dockGap = Math.max(2, 8 * sc);
    const dockTW = DOCK_ICON_COUNT * dockIc + (DOCK_ICON_COUNT - 1) * dockGap;
    const dockSX = fx + (fW - dockTW) / 2;
    const dockSY = dY + (dH - dockIc) / 2;
    cr.setSourceRGBA(0.45, 0.55, 0.65, 0.35);
    for (let i = 0; i < DOCK_ICON_COUNT; i++) {
        roundedRect(cr, dockSX + i * (dockIc + dockGap), dockSY,
            dockIc, dockIc, Math.max(1, 6 * sc));
        cr.fill();
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
        window.set_default_size(1100, 500);

        const page = new Adw.PreferencesPage({
            title: 'App Grid',
            icon_name: 'view-app-grid-symbolic',
        });
        window.add(page);

        const pageClamp = findDescendant(page, Adw.Clamp);
        if (pageClamp) {
            pageClamp.maximum_size = 1200;
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
        da.set_content_width(320);
        da.set_content_height(180);
        previewFrame.append(da);

        const aspectFrame = new Gtk.AspectFrame({
            ratio: 16 / 9,
            obey_child: false,
        });
        aspectFrame.set_child(previewFrame);

        const previewClamp = new Adw.Clamp({
            maximum_size: 440,
            tightening_threshold: 320,
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
            const mW = ps.monitorW;
            const mH = ps.monitorH;
            const layout = estimateGridArea(mW, mH);
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

            Object.assign(ps, layout, {
                iconSize, rows, columns, rowGap, colGap,
                fitRows, fitCols, usePresets, cellSize,
                monitorW: mW, monitorH: mH,
            });

            aspectFrame.ratio = mW / mH;
            screenLabel.label =
                `Monitor: ${mW} × ${mH}  ·  Icon area: ~${layout.iconAreaW} × ${layout.iconAreaH}`;

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
                rows, columns, rowGap, colGap,
                fitRows, fitCols, usePresets, cellSize,
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

            cr.setSourceRGBA(0, 0, 0, 0.3);
            cr.rectangle(fx, fy, fW, fH);
            cr.fill();

            drawPanelSection(cr, fx, fy, fW, panelH, sc);
            drawSearchSection(cr, fx, fW,
                fy + searchY * sc, searchH * sc, sc);
            drawMiniWsSection(cr, fx, fW,
                fy + miniWsY * sc, miniWsH * sc, sc);

            const drawRows = usePresets ? fitRows : rows;
            const drawCols = usePresets ? fitCols : columns;
            drawGridSection(cr,
                fx + iconAreaX * sc, fy + iconAreaYPos * sc,
                iconAreaW * sc, iconAreaH * sc,
                drawRows, drawCols, fitRows, fitCols,
                cellSize * sc, cellSize * sc,
                colGap * sc, rowGap * sc,
                sc, usePresets);

            drawDashSection(cr, fx, fW,
                fy + dashY * sc, dashH * sc, sc);

            cr.setDash([], 0);
        });

        return {widget: rightBox, cleanupFns};
    }
}
