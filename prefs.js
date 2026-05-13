import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const DEFAULT_ICON_SIZE = 96;

function recommendGrid(iconSize) {
    const scale = DEFAULT_ICON_SIZE / iconSize;
    const spacing = Math.round(12 / scale);
    return {
        rows: Math.max(2, Math.floor(6 * scale)),
        columns: Math.max(2, Math.floor(9 * scale)),
        spacing,
    };
}

const PRESETS = [96, 64, 48, 32].map(iconSize => {
    const {rows, columns} = recommendGrid(iconSize);
    return {
        iconSize,
        rows,
        columns,
    };
});

function estimateGridArea(monitorW, monitorH) {
    const panelH = 30;
    const workH = monitorH - panelH;
    const spacing = Math.round(workH * 0.02);
    const searchH = 52;
    const dashH = 72;
    const miniWsH = Math.round(workH * 0.15);
    const appDspH = workH - searchH - dashH - 3 * spacing - miniWsH;
    const pageIndH = 16;
    const pageW = monitorW;
    const pageH = Math.max(100, appDspH - pageIndH);
    const indW = Math.max(Math.round(monitorW * 0.10), 60);
    const iconAreaW = Math.max(100, pageW - 2 * (indW + 18));
    const iconAreaH = Math.max(100, pageH - 2 * 24);
    const searchY = panelH;
    const miniWsY = panelH + searchH + spacing;
    const appDspY = miniWsY + miniWsH + spacing;
    const dashY = appDspY + appDspH + spacing;
    return {
        pageW, pageH, iconAreaW, iconAreaH, indW,
        panelH, spacing, searchH, dashH, miniWsH, appDspH,
        searchY, appDspY, miniWsY, dashY,
        iconAreaX: indW + 18,
        iconAreaYPos: appDspY + 24,
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

export default class AppGridSizePrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const disconnectIds = [];

        const cleanupFns = [];
        const cleanup = () => {
            for (const id of disconnectIds)
                settings.disconnect(id);
            for (const fn of cleanupFns)
                fn();
        };
        window.connect('close-request', cleanup);
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

        /* ======== Left: Controls ======== */
        const leftBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 4,
            margin_top: 16,
            margin_bottom: 16,
            margin_start: 24,
            margin_end: 24,
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

        const SIZE_NAMES = ['Large', 'Medium', 'Small', 'Tiny'];

        const model = new Gtk.StringList();
        PRESETS.forEach((p, i) => model.append(`${SIZE_NAMES[i]} — ${p.iconSize}px`));

        const comboRow = new Adw.ComboRow({
            title: 'Size',
            model,
        });
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
                `${p.iconSize}px icons · ${p.rows}×${p.columns} grid · ${recommendGrid(p.iconSize).spacing}px gap · ${p.rows * p.columns} apps/page`;
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

        const iconAdjustment = new Gtk.Adjustment({
            lower: 16, upper: 160, step_increment: 8, page_increment: 16,
        });
        const iconRow = new Adw.SpinRow({
            title: 'Icon pixel size',
            adjustment: iconAdjustment,
            value: settings.get_int('custom-icon-size'),
        });

        const rowsAdjustment = new Gtk.Adjustment({
            lower: 2, upper: 20, step_increment: 1, page_increment: 2,
        });
        const rowsRow = new Adw.SpinRow({
            title: 'Rows per page',
            adjustment: rowsAdjustment,
            value: settings.get_int('custom-rows'),
        });

        const columnsAdjustment = new Gtk.Adjustment({
            lower: 2, upper: 20, step_increment: 1, page_increment: 2,
        });
        const columnsRow = new Adw.SpinRow({
            title: 'Columns per page',
            adjustment: columnsAdjustment,
            value: settings.get_int('custom-columns'),
        });

        const rowSpacingAdjustment = new Gtk.Adjustment({
            lower: 0, upper: 200, step_increment: 2, page_increment: 8,
        });
        const rowSpacingRow = new Adw.SpinRow({
            title: 'Row spacing (px)',
            adjustment: rowSpacingAdjustment,
            value: settings.get_int('custom-row-spacing'),
        });

        const columnSpacingAdjustment = new Gtk.Adjustment({
            lower: 0, upper: 200, step_increment: 2, page_increment: 8,
        });
        const columnSpacingRow = new Adw.SpinRow({
            title: 'Column spacing (px)',
            adjustment: columnSpacingAdjustment,
            value: settings.get_int('custom-column-spacing'),
        });

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

        settings.bind('custom-icon-size', iconRow, 'value',
            Gio.SettingsBindFlags.DEFAULT);
        settings.bind('custom-rows', rowsRow, 'value',
            Gio.SettingsBindFlags.DEFAULT);
        settings.bind('custom-columns', columnsRow, 'value',
            Gio.SettingsBindFlags.DEFAULT);
        settings.bind('custom-row-spacing', rowSpacingRow, 'value',
            Gio.SettingsBindFlags.DEFAULT);
        settings.bind('custom-column-spacing', columnSpacingRow, 'value',
            Gio.SettingsBindFlags.DEFAULT);

        customGroup.add(iconRow);
        customGroup.add(rowsRow);
        customGroup.add(columnsRow);
        customGroup.add(rowSpacingRow);
        customGroup.add(columnSpacingRow);
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
                const size = settings.get_int('custom-icon-size');
                const rec = recommendGrid(size);
                settings.set_int('custom-rows', rec.rows);
                settings.set_int('custom-columns', rec.columns);
                settings.set_int('custom-row-spacing', rec.spacing);
                settings.set_int('custom-column-spacing', rec.spacing);
            }));

        const updateInfo = () => {
            const r = settings.get_int('custom-rows');
            const c = settings.get_int('custom-columns');
            const rsp = settings.get_int('custom-row-spacing');
            const csp = settings.get_int('custom-column-spacing');
            infoLabel.label = `${r} × ${c} = ${r * c} apps per page, gap ${rsp}×${csp} px`;
        };
        disconnectIds.push(
            settings.connect('changed::custom-rows', updateInfo),
            settings.connect('changed::custom-columns', updateInfo),
            settings.connect('changed::custom-row-spacing', updateInfo),
            settings.connect('changed::custom-column-spacing', updateInfo));
        updateInfo();

        /* ======== Right: Preview ======== */
        const rightBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 4,
            margin_top: 16,
            margin_bottom: 16,
            margin_start: 24,
            margin_end: 24,
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
                if (!display)
                    return;
                const monitors = display.get_monitors();
                const monitor = monitors.get_item(0);
                if (!monitor)
                    return;
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
                let uri = bgSettings.get_string(isDark ? 'picture-uri-dark' : 'picture-uri');
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

            let iconSize, rows, columns, rowGap, colGap;
            if (settings.get_boolean('use-presets')) {
                const level = settings.get_int('preset-level');
                const preset = PRESETS[level];
                const rec = recommendGrid(preset.iconSize);
                iconSize = preset.iconSize;
                rows = rec.rows;
                columns = rec.columns;
                rowGap = rec.spacing;
                colGap = rec.spacing;
            } else {
                iconSize = settings.get_int('custom-icon-size');
                rows = settings.get_int('custom-rows');
                columns = settings.get_int('custom-columns');
                rowGap = settings.get_int('custom-row-spacing');
                colGap = settings.get_int('custom-column-spacing');
            }

            const mW = ps.monitorW;
            const mH = ps.monitorH;
            const layout = estimateGridArea(mW, mH);
            const {iconAreaW, iconAreaH} = layout;
            const cellSize = iconSize + 24;
            const usePresets = settings.get_boolean('use-presets');
            const effectiveW = usePresets ? Math.round(iconAreaW * 2 / 3) : iconAreaW;
            const fitCols = Math.max(2, Math.floor((effectiveW + colGap) / (cellSize + colGap)));
            const fitRows = Math.max(2, Math.floor((iconAreaH + rowGap) / (cellSize + rowGap)));
            Object.assign(ps, layout, {iconSize, rows, columns, rowGap, colGap, fitRows, fitCols,
                usePresets, cellSize, monitorW: mW, monitorH: mH});

            aspectFrame.ratio = mW / mH;

            screenLabel.label = `Monitor: ${mW} × ${mH}  ·  Icon area: ~${iconAreaW} × ${iconAreaH}`;

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
                    `${Math.round(gridW / iconAreaW * 100)}%×${Math.round(gridH / iconAreaH * 100)}% of icon area\n` +
                    `Auto-fit: ${fitRows}×${fitCols} = ${fitRows * fitCols} apps  ·  ` +
                    `${fGridW}×${fGridH}px`;
                if (rows !== fitRows || columns !== fitCols)
                    text += '\nConfigured grid differs from auto-fit';
                fitLabel.label = text;
            }

            da.queue_draw();
        };

        for (const key of ['use-presets', 'preset-level',
            'custom-icon-size', 'custom-rows', 'custom-columns',
            'custom-row-spacing', 'custom-column-spacing'])
            disconnectIds.push(settings.connect(`changed::${key}`, updatePreview));
        updatePreview();

        da.set_draw_func((_area, cr, drawW, drawH) => {
            const {
                monitorW, monitorH, panelH, searchH, dashH, miniWsH,
                searchY, appDspY, miniWsY, dashY,
                iconAreaX, iconAreaYPos, iconAreaW, iconAreaH,
                rows, columns, rowGap, colGap, fitRows, fitCols, usePresets, cellSize,
            } = ps;

            const pad = 8;
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

            cr.setDash([3, 2], 0);
            cr.setLineWidth(1);

            const panelY = fy;
            const panelHs = panelH * sc;
            cr.setSourceRGBA(0.6, 0.75, 0.9, 0.5);
            cr.rectangle(fx, panelY, fW, panelHs);
            cr.stroke();
            cr.setSourceRGBA(0, 0, 0, 0.4);
            cr.fill();
            cr.setSourceRGBA(0.5, 0.6, 0.7, 0.4);
            const actH = Math.max(2, 10 * sc);
            roundedRect(cr, fx + 10 * sc, panelY + (panelHs - actH) / 2, Math.max(4, 70 * sc), actH, Math.max(1, 3 * sc));
            cr.fill();
            cr.arc(fx + fW / 2, panelY + panelHs / 2, Math.max(2, 4 * sc), 0, Math.PI * 2);
            cr.fill();
            const sysW = Math.max(4, 50 * sc);
            roundedRect(cr, fx + fW - sysW - 10 * sc, panelY + (panelHs - actH) / 2, sysW, actH, Math.max(1, 3 * sc));
            cr.fill();

            const sY = fy + searchY * sc;
            const sH = searchH * sc;
            cr.setSourceRGBA(0.6, 0.75, 0.9, 0.4);
            cr.rectangle(fx, sY, fW, sH);
            cr.stroke();
            const pillH = Math.max(4, 30 * sc);
            const pillW = Math.min(360 * sc, fW * 0.35);
            const pillX = fx + (fW - pillW) / 2;
            const pillY = sY + (sH - pillH) / 2;
            cr.setSourceRGBA(0.5, 0.5, 0.55, 0.3);
            roundedRect(cr, pillX, pillY, pillW, pillH, pillH / 2);
            cr.fill();

            const mwY = fy + miniWsY * sc;
            const mwH = miniWsH * sc;
            cr.setDash([3, 2], 0);
            cr.setLineWidth(1);
            cr.setSourceRGBA(0.6, 0.75, 0.9, 0.4);
            cr.rectangle(fx, mwY, fW, mwH);
            cr.stroke();
            const wsThumbW = Math.max(8, 120 * sc);
            const wsThumbH = mwH * 0.6;
            const wsGap = Math.max(2, 10 * sc);
            const wsCount = Math.max(2, Math.min(4, Math.floor((fW - 40 * sc) / (wsThumbW + wsGap))));
            const wsTotalW = wsCount * wsThumbW + (wsCount - 1) * wsGap;
            const wsStartX = fx + (fW - wsTotalW) / 2;
            const wsStartY = mwY + (mwH - wsThumbH) / 2;
            cr.setSourceRGBA(0.5, 0.5, 0.55, 0.25);
            for (let i = 0; i < wsCount; i++) {
                roundedRect(cr, wsStartX + i * (wsThumbW + wsGap), wsStartY, wsThumbW, wsThumbH, Math.max(1, 3 * sc));
                cr.fill();
            }

            const iaX = fx + iconAreaX * sc;
            const iaY = fy + iconAreaYPos * sc;
            const iaW = iconAreaW * sc;
            const iaH = iconAreaH * sc;

            const drawRows = usePresets ? fitRows : rows;
            const drawCols = usePresets ? fitCols : columns;
            const cellW = cellSize * sc;
            const cellH = cellSize * sc;
            const gapW = colGap * sc;
            const gapH = rowGap * sc;
            const gridW = drawCols * cellW + Math.max(0, drawCols - 1) * gapW;
            const gridH = drawRows * cellH + Math.max(0, drawRows - 1) * gapH;
            const gx = iaX + (iaW - gridW) / 2;
            const gy = iaY + (iaH - gridH) / 2;

            for (let row = 0; row < drawRows; row++) {
                for (let col = 0; col < drawCols; col++) {
                    const cx = gx + col * (cellW + gapW);
                    const cy = gy + row * (cellH + gapH);
                    const overflow = !usePresets && (row >= fitRows || col >= fitCols);
                    cr.setSourceRGBA(
                        overflow ? 0.85 : 0.35,
                        overflow ? 0.30 : 0.55,
                        overflow ? 0.30 : 0.85,
                        overflow ? 0.45 : 0.65,
                    );
                    roundedRect(cr, cx, cy, cellW, cellH, Math.max(1, 3 * sc));
                    cr.fill();
                }
            }

            if (!usePresets && (fitRows !== rows || fitCols !== columns)) {
                const afW = fitCols * cellW + Math.max(0, fitCols - 1) * gapW;
                const afH = fitRows * cellH + Math.max(0, fitRows - 1) * gapH;
                const afx = iaX + (iaW - afW) / 2;
                const afy = iaY + (iaH - afH) / 2;
                cr.setSourceRGBA(0.3, 0.8, 0.4, 0.6);
                cr.setLineWidth(1.5);
                cr.setDash([4, 3], 0);
                cr.rectangle(afx - 2, afy - 2, afW + 4, afH + 4);
                cr.stroke();
            }

            const dY = fy + dashY * sc;
            const dH = dashH * sc;
            cr.setDash([3, 2], 0);
            cr.setLineWidth(1);
            cr.setSourceRGBA(0.6, 0.75, 0.9, 0.5);
            cr.rectangle(fx, dY, fW, dH);
            cr.stroke();
            cr.setSourceRGBA(0, 0, 0, 0.35);
            cr.fill();
            const dockIc = Math.max(4, 46 * sc);
            const dockGap = Math.max(2, 8 * sc);
            const dockN = 5;
            const dockTW = dockN * dockIc + (dockN - 1) * dockGap;
            const dockSX = fx + (fW - dockTW) / 2;
            const dockSY = dY + (dH - dockIc) / 2;
            cr.setSourceRGBA(0.45, 0.55, 0.65, 0.35);
            for (let i = 0; i < dockN; i++) {
                roundedRect(cr, dockSX + i * (dockIc + dockGap), dockSY, dockIc, dockIc, Math.max(1, 6 * sc));
                cr.fill();
            }

            cr.setDash([], 0);
        });

        paned.set_start_child(leftScroll);
        paned.set_end_child(rightBox);
        rootRow.set_child(paned);
        rootGroup.add(rootRow);
    }
}
