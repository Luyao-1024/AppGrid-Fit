import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const DEFAULT_ICON_SIZE = 96;

const PRESETS = [
    {label: 'Large — 96px, 4×6 grid, gap 24px', iconSize: 96, rows: 4, columns: 6},
    {label: 'Medium — 64px, 6×9 grid, gap 18px', iconSize: 64, rows: 6, columns: 9},
    {label: 'Small — 48px, 8×12 grid, gap 14px', iconSize: 48, rows: 8, columns: 12},
    {label: 'Tiny — 32px, 12×16 grid, gap 10px', iconSize: 32, rows: 12, columns: 16},
];

function recommendGrid(iconSize) {
    const scale = DEFAULT_ICON_SIZE / iconSize;
    const spacing = Math.round(12 / scale);
    return {
        rows: Math.max(2, Math.floor(6 * scale)),
        columns: Math.max(2, Math.floor(9 * scale)),
        rowSpacing: spacing,
        columnSpacing: spacing,
    };
}

export default class AppGridSizePrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const disconnectIds = [];

        const cleanup = () => {
            for (const id of disconnectIds)
                settings.disconnect(id);
        };
        window.connect('close-request', cleanup);

        /* ======== Page ======== */
        const page = new Adw.PreferencesPage({
            title: 'App Grid',
            icon_name: 'view-app-grid-symbolic',
        });
        window.add(page);

        /* ======== Mode group ======== */
        const modeGroup = new Adw.PreferencesGroup({title: 'Mode'});
        page.add(modeGroup);

        const switchRow = new Adw.SwitchRow({
            title: 'Use preset sizes',
            subtitle: 'Off to customize icon size and grid manually',
        });
        settings.bind('use-presets', switchRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        modeGroup.add(switchRow);

        /* ======== Presets group ======== */
        const presetsGroup = new Adw.PreferencesGroup({
            title: 'Presets',
            description: 'Pick a ready-made combination',
        });
        page.add(presetsGroup);

        const model = new Gtk.StringList();
        PRESETS.forEach(p => model.append(p.label));

        const comboRow = new Adw.ComboRow({
            title: 'Size',
            model,
        });
        comboRow.selected = settings.get_int('preset-level');
        disconnectIds.push(
            settings.connect('changed::preset-level', () => {
                comboRow.selected = settings.get_int('preset-level');
            }),
            comboRow.connect('notify::selected', () => {
                settings.set_int('preset-level', comboRow.selected);
            }));
        presetsGroup.add(comboRow);

        /* ======== Custom group ======== */
        const customGroup = new Adw.PreferencesGroup({
            title: 'Custom',
            description: 'Adjust manually — rows/columns and spacing auto‑suggest on icon size change',
        });
        page.add(customGroup);

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
        customGroup.add(infoLabel);

        /* ======== Visibility toggle ======== */
        const updateVisibility = () => {
            const preset = settings.get_boolean('use-presets');
            presetsGroup.visible = preset;
            customGroup.visible = !preset;
        };
        disconnectIds.push(
            settings.connect('changed::use-presets', updateVisibility));
        updateVisibility();

        /* ======== Auto‑recommend on icon size change ======== */
        disconnectIds.push(
            settings.connect('changed::custom-icon-size', () => {
                const size = settings.get_int('custom-icon-size');
                const rec = recommendGrid(size);
                settings.set_int('custom-rows', rec.rows);
                settings.set_int('custom-columns', rec.columns);
                settings.set_int('custom-row-spacing', rec.rowSpacing);
                settings.set_int('custom-column-spacing', rec.columnSpacing);
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
    }
}
