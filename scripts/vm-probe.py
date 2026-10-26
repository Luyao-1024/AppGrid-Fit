#!/usr/bin/env python3
import ast
import json
import os
import re
import shlex
import subprocess
import sys
import time
from pathlib import Path

UUID = os.environ.get('EXTENSION_UUID', 'appgrid-size@luyao')
SCHEMA = 'org.gnome.shell.extensions.appgrid-size'
LAYOUT_MODE = os.environ.get('EXPECTED_LAYOUT_MODE', 'adaptive')
FORCE_APP_GRID = os.environ.get('FORCE_APP_GRID') == '1'
TEST_FOLDER = os.environ.get('TEST_FOLDER') == '1'
FOLDER_ID = 'appgrid-probe-folder'
FOLDER_NAME = 'AppGrid Probe Folder'
FOLDER_SCHEMA = (
    'org.gnome.desktop.app-folders.folder:'
    f'/org/gnome/desktop/app-folders/folders/{FOLDER_ID}/')
FOLDER_APPS = [
    'appgrid-test-10.desktop',
    'appgrid-test-11.desktop',
    'appgrid-test-12.desktop',
    'appgrid-test-13.desktop',
]
HOME = Path.home()
DATA_HOME = Path(os.environ.get('XDG_DATA_HOME', HOME / '.local/share'))
EXTENSION_DIR = DATA_HOME / 'gnome-shell/extensions' / UUID
SCHEMA_DIR = EXTENSION_DIR / 'schemas'
EVAL_SCRIPT = Path('/tmp/appgrid-eval.sh')
EVAL_EXPR = Path('/tmp/appgrid-expr.js')
BUS_ADDRESS = os.environ.get(
    'DBUS_SESSION_BUS_ADDRESS', f'unix:path=/run/user/{os.getuid()}/bus')

PRESETS = [
    {'iconSize': 96, 'gap': 24},
    {'iconSize': 64, 'gap': 18},
    {'iconSize': 48, 'gap': 14},
    {'iconSize': 32, 'gap': 10},
]

os.environ['GSETTINGS_SCHEMA_DIR'] = str(SCHEMA_DIR)
os.environ['DBUS_SESSION_BUS_ADDRESS'] = BUS_ADDRESS

failures = []


def check(name, condition, detail=''):
    if condition:
        print(f'PASS {name}')
        return
    message = f'FAIL {name}' + (f': {detail}' if detail else '')
    print(message)
    failures.append(message)


def run(args, **kwargs):
    return subprocess.run(args, text=True, capture_output=True, **kwargs)


def output(args):
    result = run(args)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    return result.stdout.strip()


def gs_get(key):
    return output(['gsettings', 'get', SCHEMA, key])


def gs_set(key, value):
    if isinstance(value, bool):
        value = 'true' if value else 'false'
    output(['gsettings', 'set', SCHEMA, key, str(value)])


def gs_get_at(schema, key):
    return output(['gsettings', 'get', schema, key])


def gs_set_at(schema, key, value):
    output(['gsettings', 'set', schema, key, str(value)])


def parse_strv(raw):
    raw = raw.strip()
    if raw.startswith('@as '):
        raw = raw[4:].strip()
    return ast.literal_eval(raw)


def wait_for(predicate, description, timeout=10, interval=0.4):
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        try:
            last = predicate()
            if last:
                return last
        except Exception as error:
            last = error
        time.sleep(interval)
    raise RuntimeError(f'timed out waiting for {description}: {last}')


def snapshot():
    raw = gs_get('runtime-preview-layout')
    if not raw:
        return {}
    value = ast.literal_eval(raw)
    if not value:
        return {}
    return json.loads(value)


def geometry_settled(layout):
    grid = layout.get('grid') or {}
    indicator = layout.get('pageIndicatorRect')
    if not grid or not isinstance(indicator, dict):
        return True
    center = indicator['x'] + indicator['width'] / 2
    grid_center = grid['x'] + grid['width'] / 2
    grid_bottom = grid['y'] + grid['height']
    return (abs(center - grid_center) <= 4 and
        grid_bottom - 2 <= indicator['y'] <= grid_bottom + 32)


def wait_for_settled_layout(timeout=12):
    def settled():
        layout = snapshot()
        if layout.get('settled') is True and geometry_settled(layout):
            return layout
        return None
    return wait_for(settled, 'settled overview geometry', timeout=timeout)


def parse_eval_output(raw):
    match = re.fullmatch(r'\((true|false), (.*)\)', raw.strip(), re.S)
    if not match:
        raise RuntimeError(f'unexpected Shell Eval output: {raw!r}')
    try:
        payload = ast.literal_eval(match.group(2))
    except (SyntaxError, ValueError) as error:
        raise RuntimeError(f'cannot parse Shell Eval payload: {raw!r}') from error
    return match.group(1) == 'true', payload


def eval_js(expression):
    EVAL_EXPR.write_text(expression, encoding='utf-8')
    result = run([str(EVAL_SCRIPT)])
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    ok, payload = parse_eval_output(result.stdout)
    if not ok:
        raise RuntimeError(payload or 'Shell Eval rejected the expression')
    for _ in range(2):
        if not isinstance(payload, str):
            break
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            break
    return payload


def live_properties():
    return eval_js('''
const g = Main.overview._overview._controls.appDisplay._grid;
const l = g.layout_manager;
JSON.stringify({
    fixedIconSize: l.fixed_icon_size,
    effectiveIconSize: l._iconSize,
    rows: l.rows_per_page,
    columns: l.columns_per_page,
    rowSpacing: l.row_spacing,
    columnSpacing: l.column_spacing,
    maxRowSpacing: l.max_row_spacing,
    maxColumnSpacing: l.max_column_spacing,
    pageValign: l.page_valign,
    pageHalign: l.page_halign,
    hasFixedRows: Object.hasOwn(l, '_fixedRows'),
    hasFixedColumns: Object.hasOwn(l, '_fixedCols'),
    gridModes: Array.isArray(g._gridModes)
        ? g._gridModes.map(mode => ({rows: mode.rows, columns: mode.columns}))
        : null,
});
''')


def live_pages():
    return eval_js('''
const l = Main.overview._overview._controls.appDisplay._grid.layout_manager;
JSON.stringify(l._pages.map(page =>
    page.visibleChildren.map(item => item.id ?? item.app?.get_id?.() ?? null)));
''')


def flattened(pages):
    return [item for page in pages for item in page]


def extension_state():
    return eval_js(f'''
const extension = Main.extensionManager.lookup({json.dumps(UUID)});
JSON.stringify({{
    state: extension?.state ?? null,
    error: extension?.error ?? null,
}});
''')


def extension_info():
    return extension_state()


def extension_active():
    return extension_state().get('state') == 1


def set_extension_enabled(enabled):
    action = 'enableExtension' if enabled else 'disableExtension'
    eval_js(f'Main.extensionManager.{action}({json.dumps(UUID)}); 1')
    if enabled:
        wait_for(
            lambda: extension_state().get('state') == 1,
            'extension enabled', timeout=8)
    else:
        wait_for(
            lambda: extension_state().get('state') != 1,
            'extension disabled', timeout=8)


def wait_for_config(icon_size, rows, columns):
    def matches():
        layout = snapshot()
        config = layout.get('config') or {}
        if (layout.get('settled') is True and
            config.get('iconSize') == icon_size and
            config.get('rows') == rows and
            config.get('columns') == columns and
            layout.get('diagnostics') and
            geometry_settled(layout)):
            return layout
        return None
    try:
        return wait_for(matches,
            f'config {icon_size}px {rows}x{columns}', timeout=20)
    except RuntimeError as error:
        try:
            layout = snapshot()
            overview = eval_js('Main.overview.visible')
        except Exception as detail:
            layout = {'eval_error': str(detail)}
            overview = None
        raise RuntimeError(
            f'{error}; active={extension_active()}; overview={overview}; '
            f'snapshot={json.dumps(layout)[:1500]}') from error


def check_enabled_layout():
    time.sleep(1.2)
    live = live_properties()
    check('enabled icon size', live['fixedIconSize'] == 64, live)
    check('enabled dimensions',
        live['rows'] == 3 and live['columns'] == 5, live)
    check('enabled gaps',
        live['rowSpacing'] == 8 and live['columnSpacing'] == 16, live)


def open_apps():
    eval_js('Main.overview.showApps()')
    if FORCE_APP_GRID:
        # Headless sessions do not advance overview animations, so showApps()
        # leaves the shell in the window picker. Select the app grid directly.
        eval_js('''
const controls = Main.overview._overview._controls;
if (controls._stateAdjustment) {
    controls._stateAdjustment.value = 2;
    controls._stateAdjustment.target = 2;
    controls.queue_relayout();
    global.stage.queue_relayout();
}
''')
    return wait_for_settled_layout()


def close_apps():
    try:
        eval_js('Main.overview.hide()')
    except Exception:
        pass


def folder_state():
    return eval_js(f'''
const appDisplay = Main.overview._overview._controls.appDisplay;
const folder = appDisplay._folderIcons.find(
    icon => icon._id === {json.dumps(FOLDER_ID)});
const grid = folder?.view?._grid;
const lm = grid?.layout_manager;
JSON.stringify({{
    found: !!folder,
    open: folder?._dialog?.visible ?? false,
    fixedIconSize: lm?.fixed_icon_size ?? null,
    effectiveIconSize: lm?._iconSize ?? null,
    rows: lm?.rows_per_page ?? null,
    columns: lm?.columns_per_page ?? null,
    rowSpacing: lm?.row_spacing ?? null,
    columnSpacing: lm?.column_spacing ?? null,
    folderTileLabel: folder?.icon?.label?.visible ?? null,
    mainLabels: [...appDisplay._grid].map(
        child => child.icon?.label?.visible ?? null),
    childLabels: grid
        ? [...grid].map(child => child.icon?.label?.visible ?? null)
        : [],
    childIcons: grid
        ? [...grid].map(child => child.icon?.iconSize ?? null)
        : [],
}});
''')


def open_test_folder():
    eval_js(f'''
const appDisplay = Main.overview._overview._controls.appDisplay;
const folder = appDisplay._folderIcons.find(
    icon => icon._id === {json.dumps(FOLDER_ID)});
if (!folder)
    throw new Error('probe folder not found');
folder.open();
''')


def close_test_folder():
    try:
        eval_js(f'''
const appDisplay = Main.overview._overview._controls.appDisplay;
const folder = appDisplay._folderIcons.find(
    icon => icon._id === {json.dumps(FOLDER_ID)});
folder?._dialog?.popdown();
''')
    except Exception:
        pass


def folder_settings_backup():
    raw_children = gs_get_at(
        'org.gnome.desktop.app-folders', 'folder-children')
    existed = FOLDER_ID in parse_strv(raw_children)
    return {
        'raw_children': raw_children,
        'existed': existed,
        'name': gs_get_at(FOLDER_SCHEMA, 'name') if existed else None,
        'apps': gs_get_at(FOLDER_SCHEMA, 'apps') if existed else None,
    }


def create_test_folder(backup):
    gs_set_at(FOLDER_SCHEMA, 'name', FOLDER_NAME)
    gs_set_at(FOLDER_SCHEMA, 'apps', str(FOLDER_APPS))
    if not backup['existed']:
        children = parse_strv(backup['raw_children'])
        children.append(FOLDER_ID)
        gs_set_at('org.gnome.desktop.app-folders', 'folder-children',
            str(children))


def restore_test_folder(backup):
    if backup['existed']:
        gs_set_at(FOLDER_SCHEMA, 'name', backup['name'])
        gs_set_at(FOLDER_SCHEMA, 'apps', backup['apps'])
    else:
        for key in ('name', 'apps'):
            run(['gsettings', 'reset', FOLDER_SCHEMA, key])
    gs_set_at('org.gnome.desktop.app-folders', 'folder-children',
        backup['raw_children'])


def check_folder_icon_sizes():
    gs_set('folder-rows', 3)
    gs_set('folder-columns', 4)
    gs_set('folder-row-spacing', 8)
    gs_set('folder-column-spacing', 14)
    for size in (32, 96):
        gs_set('custom-icon-size', size)
        wait_for_config(size, 2, 3)
        open_test_folder()
        try:
            state = wait_for(
                lambda: (state := folder_state()) and
                    state.get('open') and
                    state.get('effectiveIconSize') == size and
                    state.get('rows') == 3 and
                    state.get('columns') == 4 and
                    state.get('rowSpacing') == 8 and
                    state.get('columnSpacing') == 14 and
                    len(state.get('childIcons') or []) == len(FOLDER_APPS) and
                    all(icon == size for icon in state['childIcons']) and
                    state,
                f'folder grid at {size}px')
        except RuntimeError as error:
            print(f'folder state at {size}px: {json.dumps(folder_state())}')
            raise error
        check(f'folder child icons follow {size}px setting',
            state['effectiveIconSize'] == size and
            all(icon == size for icon in state['childIcons']), state)
        time.sleep(0.5)

    check('folder layout follows settings',
        state.get('rows') == 3 and state.get('columns') == 4 and
        state.get('rowSpacing') == 8 and state.get('columnSpacing') == 14,
        state)

    gs_set('show-app-names', False)
    hidden = wait_for(
        lambda: (state := folder_state()) and
            state.get('open') and
            state.get('childLabels') and
            all(value is False for value in state['childLabels']) and
            state.get('mainLabels') and
            all(value is False for value in state['mainLabels']
                if value is not None) and
            state,
        'app names hidden')
    check('app names hide in grid and folders',
        all(value is False for value in hidden['childLabels']) and
        all(value is False for value in hidden['mainLabels']
            if value is not None), hidden)

    gs_set('show-app-names', True)
    shown = wait_for(
        lambda: (state := folder_state()) and
            state.get('open') and
            state.get('childLabels') and
            all(value is True for value in state['childLabels']) and
            state.get('mainLabels') and
            all(value is True for value in state['mainLabels']
                if value is not None) and
            state,
        'app names shown')
    check('app names show again',
        all(value is True for value in shown['childLabels']) and
        all(value is True for value in shown['mainLabels']
            if value is not None), shown)

    set_extension_enabled(False)
    try:
        restored = wait_for(
            lambda: (state := folder_state()) and
                state.get('fixedIconSize') == -1 and
                (state.get('effectiveIconSize') or 0) > 0 and
                state.get('rows') == 3 and
                state.get('columns') == 3 and
                (state.get('rowSpacing') or 0) > 0 and
                state.get('rowSpacing') == state.get('columnSpacing') and
                state.get('rowSpacing') not in (8, 14) and
                state,
            'folder adaptive layout restoration')
    except RuntimeError as error:
        print(f'folder state after disable: {json.dumps(folder_state())}')
        raise error
    check('folder restores adaptive layout on disable',
        restored['fixedIconSize'] == -1 and
        restored['rows'] == 3 and restored['columns'] == 3 and
        restored['rowSpacing'] > 0 and
        restored['rowSpacing'] == restored['columnSpacing'] and
        restored['rowSpacing'] not in (8, 14),
        restored)
    set_extension_enabled(True)
    wait_for_config(96, 2, 3)
    close_test_folder()


def check_theme_layout(css_row, css_column, css_max_row, css_max_column):
    properties = eval_js(f'''
const g = Main.overview._overview._controls.appDisplay._grid;
const n = g.get_theme_node();
JSON.stringify({{
    rowSpacing: n.get_length('row-spacing'),
    columnSpacing: n.get_length('column-spacing'),
    maxRowSpacing: n.lookup_length('max-row-spacing', false),
    maxColumnSpacing: n.lookup_length('max-column-spacing', false),
}});
''')
    check('theme row spacing', properties['rowSpacing'] == css_row,
        properties)
    check('theme column spacing', properties['columnSpacing'] == css_column,
        properties)
    check('theme max row spacing',
        properties['maxRowSpacing'] == [True, css_max_row], properties)
    check('theme max column spacing',
        properties['maxColumnSpacing'] == [True, css_max_column], properties)


def rect_contains(outer, inner, padding=8):
    return (inner['x'] >= outer['x'] - padding and
        inner['y'] >= outer['y'] - padding and
        inner['x'] + inner['width'] <=
            outer['x'] + outer['width'] + padding and
        inner['y'] + inner['height'] <=
            outer['y'] + outer['height'] + padding)


def ordered_axis(items, axis):
    values = [item[axis] for item in items]
    return values == sorted(values)


def check_overview_geometry(layout):
    grid = layout.get('grid') or {}
    indicator = layout.get('pageIndicatorRect')
    dash_rect = layout.get('dashRect')
    dash_items = layout.get('dashItems') or []
    dash_visible = layout.get('dashVisible')

    check('dash visibility reported', isinstance(dash_visible, bool),
        dash_visible)
    check('current page item count',
        layout.get('itemCount') == len(layout.get('items') or []),
        layout.get('itemCount'))

    if grid and isinstance(indicator, dict):
        center = indicator['x'] + indicator['width'] / 2
        grid_center = grid['x'] + grid['width'] / 2
        grid_bottom = grid['y'] + grid['height']
        check('page indicator centered under grid',
            abs(center - grid_center) <= 4,
            {'indicator': indicator, 'grid': grid})
        check('page indicator below grid',
            grid_bottom - 2 <= indicator['y'] <= grid_bottom + 32,
            {'indicator': indicator, 'gridBottom': grid_bottom})

    if not dash_visible or not dash_rect:
        return

    check('dock items measured', bool(dash_items), dash_rect)
    check('dock items inside dock',
        all(rect_contains(dash_rect, item) for item in dash_items),
        {'dashRect': dash_rect, 'items': dash_items})

    if dash_rect['height'] > dash_rect['width']:
        check('vertical dock anchored left', dash_rect['x'] <= 8, dash_rect)
        check('vertical dock spans grid',
            dash_rect['y'] <= 64 and
            dash_rect['height'] >= (grid.get('height') or 0), dash_rect)
        check('vertical dock items ordered',
            ordered_axis(dash_items, 'y'), dash_items)
    else:
        grid_bottom = grid['y'] + grid['height']
        check('horizontal dash below grid',
            dash_rect['y'] >= grid_bottom - 8, dash_rect)
        check('horizontal dash items ordered',
            ordered_axis(dash_items, 'x'), dash_items)


def main():
    EVAL_SCRIPT.write_text(
        '#!/bin/bash\n'
        f'export DBUS_SESSION_BUS_ADDRESS={shlex.quote(BUS_ADDRESS)}\n'
        'exec gdbus call --session --dest org.gnome.Shell '
        '--object-path /org/gnome/Shell --method org.gnome.Shell.Eval '
        f'"$(cat {EVAL_EXPR})"\n',
        encoding='utf-8')
    EVAL_SCRIPT.chmod(0o755)

    try:
        eval_js('1 + 1')
    except Exception as error:
        print(f'Shell Eval is unavailable: {error}')
        print('Enable Looking Glass unsafe mode before running the probe')
        return 2

    if not extension_active():
        print('Extension is not ACTIVE; enable it before running the probe')
        return 2

    settings_backup = output([
        'dconf', 'dump', '/org/gnome/shell/extensions/appgrid-size/',
    ])
    picker_backup = output([
        'gsettings', 'get', 'org.gnome.shell', 'app-picker-layout',
    ])
    live_picker = None
    theme_loaded = False

    try:
        check('Shell Eval', eval_js('1 + 1') == 2)
        check('extension active', extension_active(), extension_info())

        open_apps()
        eval_js('Main.overview._overview._controls.appDisplay._savePages()')
        live_picker = output([
            'gsettings', 'get', 'org.gnome.shell', 'app-picker-layout',
        ])
        layout = wait_for_settled_layout()
        diagnostics = layout.get('diagnostics') or {}
        live = live_properties()
        check('settled snapshot', layout.get('settled') is True, layout)
        check(f'{LAYOUT_MODE} layout detected',
            diagnostics.get('mode') == LAYOUT_MODE, diagnostics)
        if LAYOUT_MODE == 'adaptive':
            check('Ubuntu grid API',
                diagnostics.get('hasSetGridModes') is False and
                diagnostics.get('hasAdaptToSize') is True, diagnostics)
            check('adaptive grid modes absent',
                live.get('gridModes') is None, live)
        else:
            check('upstream grid API',
                diagnostics.get('hasSetGridModes') is True and
                diagnostics.get('hasGridModes') is True, diagnostics)
            check('upstream grid mode pinned',
                isinstance(live.get('gridModes'), list) and
                len(live['gridModes']) == 1, live)
        check('page indicator measured',
            isinstance(layout.get('pageIndicatorRect'), dict) and
            layout['pageIndicatorRect']['width'] > 0,
            layout.get('pageIndicatorRect'))
        check_overview_geometry(layout)

        for level, preset in enumerate(PRESETS):
            gs_set('use-presets', True)
            gs_set('preset-level', level)
            wait_for(lambda: (
                ((layout := snapshot()).get('config') or {}).get(
                    'iconSize') == preset['iconSize'] and
                (layout.get('diagnostics') or {}).get(
                    'fixedIconSize') == preset['iconSize'] and
                (layout.get('diagnostics') or {}).get(
                    'rowSpacing') == preset['gap'] and
                (layout.get('diagnostics') or {}).get(
                    'columnSpacing') == preset['gap']),
                f'preset {level} layout')
            layout = snapshot()
            diagnostics = layout.get('diagnostics') or {}
            cap = diagnostics.get('rows', 0) * diagnostics.get('columns', 0)
            check(f'preset {level} icon',
                diagnostics.get('fixedIconSize') == preset['iconSize'],
                diagnostics)
            check(f'preset {level} gap',
                diagnostics.get('rowSpacing') == preset['gap'] and
                diagnostics.get('columnSpacing') == preset['gap'],
                diagnostics)
            check(f'preset {level} fixed dimensions',
                diagnostics.get('hasFixedRows') is
                    (LAYOUT_MODE == 'adaptive') and
                diagnostics.get('hasFixedColumns') is
                    (LAYOUT_MODE == 'adaptive'),
                diagnostics)
            check(f'preset {level} capacity',
                cap >= 4 and max(layout.get('pageItemCounts') or [0]) <= cap,
                layout.get('pageItemCounts'))

        gs_set('use-presets', False)
        gs_set('custom-icon-size', 64)
        gs_set('custom-rows', 3)
        gs_set('custom-columns', 5)
        gs_set('custom-row-spacing', 8)
        gs_set('custom-column-spacing', 16)
        wait_for_config(64, 3, 5)
        layout = snapshot()
        diagnostics = layout.get('diagnostics') or {}
        check('custom icon size', diagnostics.get('fixedIconSize') == 64,
            diagnostics)
        check('custom dimensions', diagnostics.get('rows') == 3 and
            diagnostics.get('columns') == 5, diagnostics)
        check('custom gaps', diagnostics.get('rowSpacing') == 8 and
            diagnostics.get('columnSpacing') == 16, diagnostics)

        original_pages = live_pages()
        gs_set('custom-rows', 2)
        gs_set('custom-columns', 3)
        wait_for_config(64, 2, 3)
        reflowed_pages = live_pages()
        check('reflow keeps page order',
            flattened(reflowed_pages) == flattened(original_pages),
            {'before': original_pages, 'after': reflowed_pages})
        check('reflow respects capacity',
            max((len(page) for page in reflowed_pages), default=0) <= 6,
            reflowed_pages)

        gs_set('custom-rows', 3)
        gs_set('custom-columns', 5)
        wait_for_config(64, 3, 5)
        check('growing capacity keeps page order',
            flattened(live_pages()) == flattened(original_pages),
            live_pages())

        set_extension_enabled(False)
        time.sleep(1.5)
        disabled = live_properties()
        check('disable restores icon size',
            disabled['fixedIconSize'] == -1, disabled)
        if LAYOUT_MODE == 'adaptive':
            check('disable removes fixed dimensions',
                disabled['hasFixedRows'] is False and
                disabled['hasFixedColumns'] is False, disabled)
        else:
            check('disable restores grid modes',
                isinstance(disabled.get('gridModes'), list) and
                len(disabled['gridModes']) > 1 and
                disabled['hasFixedRows'] is False, disabled)
        check('disable restores alignment',
            disabled['pageValign'] == 0 and disabled['pageHalign'] == 0,
            disabled)
        check('disable restores native spacing',
            disabled['rowSpacing'] > 0 and disabled['columnSpacing'] > 0,
            disabled)
        check('disable restores native dimensions',
            disabled['rows'] >= 2 and disabled['columns'] >= 2, disabled)

        set_extension_enabled(True)
        wait_for_config(64, 3, 5)
        check_enabled_layout()

        Path('/tmp/appgrid-theme.css').write_text(
            '.icon-grid {\n'
            '  row-spacing: 50px;\n'
            '  column-spacing: 60px;\n'
            '  max-row-spacing: 70px;\n'
            '  max-column-spacing: 80px;\n'
            '}\n', encoding='utf-8')
        eval_js('''
const g = Main.overview._overview._controls.appDisplay._grid;
const theme = g.get_theme_node().get_theme();
const file = Gio.File.new_for_path('/tmp/appgrid-theme.css');
global.__appgridThemeFile = file;
theme.load_stylesheet(file);
''')
        theme_loaded = True
        time.sleep(2)
        check_theme_layout(50, 60, 70, 80)
        themed = live_properties()
        check('theme does not override gaps',
            themed['rowSpacing'] == 8 and themed['columnSpacing'] == 16,
            themed)

        set_extension_enabled(False)
        time.sleep(1.5)
        disabled = live_properties()
        check('themed disable keeps native icon size',
            disabled['fixedIconSize'] == -1 and
            disabled['effectiveIconSize'] > 0, disabled)
        if LAYOUT_MODE == 'adaptive':
            check('themed disable restores adaptive spacing',
                abs(disabled['rowSpacing'] -
                    disabled['effectiveIconSize'] * 0.5) <= 0.5 and
                abs(disabled['columnSpacing'] -
                    disabled['effectiveIconSize'] * 0.5) <= 0.5, disabled)
        else:
            check('themed disable restores CSS spacing',
                disabled['rowSpacing'] == 50 and
                disabled['columnSpacing'] == 60, disabled)
        check('themed disable restores CSS limits',
            disabled['maxRowSpacing'] == 70 and
            disabled['maxColumnSpacing'] == 80, disabled)

        set_extension_enabled(True)
        wait_for_config(64, 3, 5)
        check_enabled_layout()
        eval_js('''
const g = Main.overview._overview._controls.appDisplay._grid;
const theme = g.get_theme_node().get_theme();
theme.unload_stylesheet(global.__appgridThemeFile);
delete global.__appgridThemeFile;
''')
        theme_loaded = False
        time.sleep(2)
        default_limits = eval_js('''
const g = Main.overview._overview._controls.appDisplay._grid;
const n = g.get_theme_node();
JSON.stringify({
    maxRowSpacing: n.lookup_length('max-row-spacing', false),
    maxColumnSpacing: n.lookup_length('max-column-spacing', false),
});
''')
        set_extension_enabled(False)
        time.sleep(1.5)
        disabled = live_properties()
        expected_max_row = (default_limits['maxRowSpacing'][1]
            if default_limits['maxRowSpacing'][0] else -1)
        expected_max_column = (default_limits['maxColumnSpacing'][1]
            if default_limits['maxColumnSpacing'][0] else -1)
        check('default theme limits restored',
            disabled['maxRowSpacing'] == expected_max_row and
            disabled['maxColumnSpacing'] == expected_max_column, disabled)
        set_extension_enabled(True)
        wait_for_config(64, 3, 5)
        check_enabled_layout()

        before_consolidation = live_pages()
        gs_set('consolidate-pages', True)
        gs_set('custom-rows', 2)
        gs_set('custom-columns', 3)
        wait_for_config(64, 2, 3)
        consolidated = live_pages()
        check('consolidation preserves item order',
            flattened(consolidated) == flattened(before_consolidation),
            {'before': before_consolidation, 'after': consolidated})
        check('consolidation fills pages',
            all(len(page) == 6 for page in consolidated[:-1]) and
            len(consolidated[-1]) <= 6,
            consolidated)

        gs_set('consolidate-pages', False)
        time.sleep(1)
        output(['gsettings', 'set', 'org.gnome.shell',
            'app-picker-layout', live_picker])
        if LAYOUT_MODE == 'adaptive':
            restored = wait_for(
                lambda: (pages := live_pages()) and
                    flattened(pages) == flattened(before_consolidation) and
                    pages,
                'saved layout restoration')
            check('saved layout restoration preserves item order',
                flattened(restored) == flattened(before_consolidation),
                {'before': before_consolidation, 'after': restored})
        else:
            # Upstream Shell applies an externally changed picker layout on
            # the next display cycle; verify the stored value without relying
            # on a live PageManager reload.
            restored_picker = output([
                'gsettings', 'get', 'org.gnome.shell', 'app-picker-layout',
            ])
            check('saved layout setting restored',
                restored_picker == live_picker,
                {'expected': live_picker, 'actual': restored_picker})

        if TEST_FOLDER:
            folder_backup = folder_settings_backup()
            try:
                create_test_folder(folder_backup)
                open_apps()
                wait_for(lambda: folder_state().get('found'),
                    'probe folder icon')
                close_test_folder()
                gs_set('use-presets', False)
                gs_set('custom-rows', 2)
                gs_set('custom-columns', 3)
                gs_set('custom-icon-size', 32)
                wait_for_config(32, 2, 3)
                check_folder_icon_sizes()
            finally:
                close_test_folder()
                restore_test_folder(folder_backup)
    finally:
        if theme_loaded:
            try:
                eval_js('''
const g = Main.overview._overview._controls.appDisplay._grid;
const theme = g.get_theme_node().get_theme();
if (global.__appgridThemeFile)
    theme.unload_stylesheet(global.__appgridThemeFile);
delete global.__appgridThemeFile;
''')
            except Exception:
                pass
        try:
            gs_set('consolidate-pages', False)
        except Exception:
            pass
        if live_picker is not None:
            try:
                output(['gsettings', 'set', 'org.gnome.shell',
                    'app-picker-layout', live_picker])
            except Exception:
                pass
        else:
            try:
                output(['gsettings', 'set', 'org.gnome.shell',
                    'app-picker-layout', picker_backup])
            except Exception:
                pass
        try:
            output(['dconf', 'reset', '-f',
                '/org/gnome/shell/extensions/appgrid-size/'])
            if settings_backup:
                run(['dconf', 'load',
                    '/org/gnome/shell/extensions/appgrid-size/'],
                    input=settings_backup)
        except Exception:
            pass
        try:
            set_extension_enabled(True)
        except Exception:
            pass
        close_apps()

    if failures:
        print(f'\n{len(failures)} check(s) failed')
        return 1
    print('\nAll compatibility checks passed')
    return 0


if __name__ == '__main__':
    sys.exit(main())
