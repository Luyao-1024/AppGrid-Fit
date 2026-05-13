import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const DEFAULT_ICON_SIZE = 96;
const DEFAULT_GRID_ROWS = 6;
const DEFAULT_GRID_COLUMNS = 9;
const DEFAULT_GAP = 12;
const TILE_PADDING = 24;
const MIN_GRID_DIMENSION = 2;
const EFFECTIVE_WIDTH_RATIO = 2 / 3;

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

const SETTINGS_KEYS = [
    'use-presets', 'preset-level',
    'custom-icon-size', 'custom-rows', 'custom-columns',
    'custom-row-spacing', 'custom-column-spacing',
];

function recommendGrid(iconSize) {
    const scale = DEFAULT_ICON_SIZE / iconSize;
    const gap = Math.round(DEFAULT_GAP / scale);
    return {
        rows: Math.max(MIN_GRID_DIMENSION, Math.floor(DEFAULT_GRID_ROWS * scale)),
        columns: Math.max(MIN_GRID_DIMENSION, Math.floor(DEFAULT_GRID_COLUMNS * scale)),
        gap,
    };
}

const PRESETS = [96, 64, 48, 32].map(iconSize => ({
    iconSize,
    ...recommendGrid(iconSize),
}));

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
    cr.setSourceRGBA(0.6, 0.75, 0.9, 0.5);
    cr.rectangle(fx, fy, fW, panelHs);
    cr.stroke();
    cr.setSourceRGBA(0, 0, 0, 0.4);
    cr.fill();

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
    cr.setSourceRGBA(0.6, 0.75, 0.9, 0.5);
    cr.rectangle(fx, dY, fW, dH);
    cr.stroke();
    cr.setSourceRGBA(0, 0, 0, 0.35);
    cr.fill();

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
        const disconnectIds = [];
        const cleanupFns = [];

        window.connect('close-request', () => {
            for (const id of disconnectIds) settings.disconnect(id);
            for (const fn of cleanupFns) fn();
        });
        window.set_default_size(1200, 600);

        const page = new Adw.PreferencesPage({
            title: 'App Grid',
            icon_name: 'view-app-grid-symbolic',
        });
        window.add(page);

        const rootGroup = new Adw.PreferencesGroup({});
        page.add(rootGroup);

        const rootRow = new Adw.PreferencesRow({
            activatable: false,
            selectable: false,
        });

        const paned = new Gtk.Paned({
            orientation: Gtk.Orientation.HORIZONTAL,
            position: 300,
            shrink_start_child: false,
            shrink_end_child: false,
        });

        const {widget: leftScroll, disconnectIds: ctrlIds} =
            this._buildControlsPane(settings);
        disconnectIds.push(...ctrlIds);

        const {widget: rightBox, cleanupFns: prevFns} =
            this._buildPreviewPane(settings);
        cleanupFns.push(...prevFns);

        paned.set_start_child(leftScroll);
        paned.set_end_child(rightBox);
        rootRow.set_child(paned);
        rootGroup.add(rootRow);
    }

    _buildControlsPane(settings) {
        const disconnectIds = [];

        const leftBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 4,
            margin_top: 16, margin_bottom: 16,
            margin_start: 24, margin_end: 24,
        });

        const leftScroll = new Gtk.ScrolledWindow({
            hscrollbar_policy: Gtk.PolicyType.NEVER,
            vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
        });
        leftScroll.set_child(leftBox);

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
        disconnectIds.push(
            settings.connect('changed::preset-level', () => {
                comboRow.selected = settings.get_int('preset-level');
                updatePresetInfo();
            }),
            comboRow.connect('notify::selected', () => {
                settings.set_int('preset-level', comboRow.selected);
                updatePresetInfo();
            }));
        updatePresetInfo();
        presetsGroup.add(comboRow);
        presetsGroup.add(presetInfoRow);
        leftBox.append(presetsGroup);

        const customGroup = new Adw.PreferencesGroup({
            title: 'Custom',
            description: 'Adjust manually — rows/columns and spacing auto-suggest on icon size change',
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
            css_classes: ['dim-label'],
        });
        const infoRow = new Adw.PreferencesRow({
            activatable: false,
            selectable: false,
        });
        infoRow.set_child(infoLabel);
        customGroup.add(infoRow);
        leftBox.append(customGroup);

        const updateVisibility = () => {
            const preset = settings.get_boolean('use-presets');
            presetsGroup.visible = preset;
            customGroup.visible = !preset;
        };
        disconnectIds.push(
            settings.connect('changed::use-presets', updateVisibility));
        updateVisibility();

        disconnectIds.push(
            settings.connect('changed::custom-icon-size', () => {
                const rec = recommendGrid(settings.get_int('custom-icon-size'));
                settings.set_int('custom-rows', rec.rows);
                settings.set_int('custom-columns', rec.columns);
                settings.set_int('custom-row-spacing', rec.gap);
                settings.set_int('custom-column-spacing', rec.gap);
            }));

        const updateInfo = () => {
            const r = settings.get_int('custom-rows');
            const c = settings.get_int('custom-columns');
            const rsp = settings.get_int('custom-row-spacing');
            const csp = settings.get_int('custom-column-spacing');
            infoLabel.label =
                `${r} × ${c} = ${r * c} apps per page, gap ${rsp}×${csp} px`;
        };
        disconnectIds.push(
            settings.connect('changed::custom-rows', updateInfo),
            settings.connect('changed::custom-columns', updateInfo),
            settings.connect('changed::custom-row-spacing', updateInfo),
            settings.connect('changed::custom-column-spacing', updateInfo));
        updateInfo();

        return {widget: leftScroll, disconnectIds};
    }

    _buildPreviewPane(settings) {
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
            css_classes: ['dim-label', 'caption'],
        });

        const previewFrame = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            overflow: Gtk.Overflow.HIDDEN,
        });
        previewFrame.add_css_class('card');
        previewFrame.add_css_class('wp-preview');

        const da = new Gtk.DrawingArea();
        da.set_content_width(400);
        da.set_content_height(400);
        da.set_vexpand(true);
        previewFrame.append(da);

        const aspectFrame = new Gtk.AspectFrame({
            ratio: 16 / 9,
            obey_child: false,
        });
        aspectFrame.set_child(previewFrame);

        const fitLabel = new Gtk.Label({
            label: '',
            halign: Gtk.Align.CENTER,
            wrap: true,
            css_classes: ['dim-label', 'caption'],
        });

        rightBox.append(screenLabel);
        rightBox.append(aspectFrame);
        rightBox.append(fitLabel);

        const ps = {monitorW: 1920, monitorH: 1080};

        const refreshMonitorSize = () => {
            try {
                const display = Gdk.Display.get_default();
                if (!display) return;
                const monitor = display.get_monitors()?.get_item(0);
                if (!monitor) return;
                const geom = monitor.get_geometry();
                ps.monitorW = geom.width;
                ps.monitorH = geom.height;
            } catch (_e) {}
        };

        const bgSettings = Gio.Settings.new('org.gnome.desktop.background');
        const wpProvider = new Gtk.CssProvider();
        Gtk.StyleContext.add_provider_for_display(
            Gdk.Display.get_default(), wpProvider, Gtk.STYLE_PROVIDER_PRIORITY_USER);

        const loadWallpaper = () => {
            try {
                const isDark = Adw.StyleManager.get_default().dark;
                let uri = bgSettings.get_string(
                    isDark ? 'picture-uri-dark' : 'picture-uri');
                if (!uri)
                    uri = bgSettings.get_string('picture-uri');
                if (uri) {
                    const path = Gio.File.new_for_uri(uri).get_path();
                    wpProvider.load_from_data(
                        `.wp-preview{background-image:url("file://${path}");background-size:cover;}`, -1);
                    return;
                }
            } catch (_e) {}
            wpProvider.load_from_data(`.wp-preview{background-image:none;}`, -1);
        };

        loadWallpaper();
        const bgId1 = bgSettings.connect('changed::picture-uri', loadWallpaper);
        const bgId2 = bgSettings.connect('changed::picture-uri-dark', loadWallpaper);
        cleanupFns.push(() => {
            bgSettings.disconnect(bgId1);
            bgSettings.disconnect(bgId2);
            Gtk.StyleContext.remove_provider_for_display(
                Gdk.Display.get_default(), wpProvider);
        });

        const sm = Adw.StyleManager.get_default();
        const smId = sm.connect('notify::dark', loadWallpaper);
        cleanupFns.push(() => sm.disconnect(smId));

        const updatePreview = () => {
            refreshMonitorSize();

            const config = readGridConfig(settings);
            const {iconSize, rows, columns, rowGap, colGap, usePresets} = config;
            const mW = ps.monitorW;
            const mH = ps.monitorH;
            const layout = estimateGridArea(mW, mH);
            const cellSize = iconSize + TILE_PADDING;

            const effectiveW = usePresets
                ? Math.round(layout.iconAreaW * EFFECTIVE_WIDTH_RATIO)
                : layout.iconAreaW;
            const fitCols = Math.max(MIN_GRID_DIMENSION,
                Math.floor((effectiveW + colGap) / (cellSize + colGap)));
            const fitRows = Math.max(MIN_GRID_DIMENSION,
                Math.floor((layout.iconAreaH + rowGap) / (cellSize + rowGap)));

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
                    `Auto-fit: ${fitRows}×${fitCols} = ${fitRows * fitCols} apps/page`;
            } else {
                const gridW = columns * cellSize + Math.max(0, columns - 1) * colGap;
                const gridH = rows * cellSize + Math.max(0, rows - 1) * rowGap;
                const fGridW = fitCols * cellSize + Math.max(0, fitCols - 1) * colGap;
                const fGridH = fitRows * cellSize + Math.max(0, fitRows - 1) * rowGap;
                let text =
                    `Grid: ${rows}×${columns} = ${rows * columns} apps  ·  ` +
                    `${gridW}×${gridH}px  ·  ` +
                    `${Math.round(gridW / layout.iconAreaW * 100)}%×` +
                    `${Math.round(gridH / layout.iconAreaH * 100)}% of icon area\n` +
                    `Auto-fit: ${fitRows}×${fitCols} = ${fitRows * fitCols} apps  ·  ` +
                    `${fGridW}×${fGridH}px`;
                if (rows !== fitRows || columns !== fitCols)
                    text += '\nConfigured grid differs from auto-fit';
                fitLabel.label = text;
            }

            da.queue_draw();
        };

        const prevDisconnectIds = [];
        for (const key of SETTINGS_KEYS)
            prevDisconnectIds.push(settings.connect(`changed::${key}`, updatePreview));
        cleanupFns.push(() => {
            for (const id of prevDisconnectIds) settings.disconnect(id);
        });
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
