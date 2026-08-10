import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const SHORTCUTS = [
    ['snap-screen-up', 'Maximize on the screen above'],
    ['snap-screen-down', 'Maximize on the screen below'],
];

const ShortcutRow = GObject.registerClass(
class ShortcutRow extends Adw.ActionRow {
    _init(settings, key, title) {
        super._init({title, activatable: true});

        this._settings = settings;
        this._key = key;

        this._display = new Gtk.ShortcutLabel({
            disabled_text: 'Disabled',
            valign: Gtk.Align.CENTER,
        });
        this.add_suffix(this._display);

        const clear = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
            tooltip_text: 'Clear shortcut',
        });
        clear.connect('clicked', () => this._settings.set_strv(this._key, []));
        this.add_suffix(clear);

        this._settingsChangedId = settings.connect(`changed::${key}`, () => this._sync());
        this.connect('destroy', () => settings.disconnect(this._settingsChangedId));
        this.connect('activated', () => this._capture());
        this._sync();
    }

    _sync() {
        this._display.accelerator = this._settings.get_strv(this._key)[0] ?? '';
    }

    _capture() {
        const dialog = new Adw.AlertDialog({
            heading: this.title,
            body: 'Press the new shortcut, or Backspace to clear it.',
            close_response: 'cancel',
        });
        dialog.add_response('cancel', 'Cancel');

        const controller = new Gtk.EventControllerKey();
        controller.connect('key-pressed', (_c, keyval, keycode, state) => {
            const mask = state & Gtk.accelerator_get_default_mod_mask() & ~Gdk.ModifierType.LOCK_MASK;

            if (!mask && keyval === Gdk.KEY_Escape) {
                dialog.close();
                return Gdk.EVENT_STOP;
            }
            if (!mask && keyval === Gdk.KEY_BackSpace) {
                this._settings.set_strv(this._key, []);
                dialog.close();
                return Gdk.EVENT_STOP;
            }
            if (!mask || !Gtk.accelerator_valid(keyval, mask))
                return Gdk.EVENT_STOP;

            const accel = Gtk.accelerator_name_with_keycode(null, keyval, keycode, mask);
            this._settings.set_strv(this._key, [accel]);
            dialog.close();
            return Gdk.EVENT_STOP;
        });
        dialog.add_controller(controller);
        dialog.present(this.get_root());
    }
});

export default class DuoSnapPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'Duo Snap',
            icon_name: 'view-grid-symbolic',
        });
        window.add(page);

        const dragGroup = new Adw.PreferencesGroup({
            title: 'Drag',
            description: 'The zone picker that appears while a window is being dragged.',
        });
        page.add(dragGroup);

        const hudRow = new Adw.SwitchRow({title: 'Show the zone picker'});
        settings.bind('drag-hud', hudRow, 'active', 0);
        dragGroup.add(hudRow);

        const delayRow = new Adw.SpinRow({
            title: 'Appearance delay',
            subtitle: 'Milliseconds of dragging before the picker fades in',
            adjustment: new Gtk.Adjustment({lower: 0, upper: 1500, step_increment: 20, page_increment: 100}),
        });
        settings.bind('show-delay', delayRow, 'value', 0);
        dragGroup.add(delayRow);

        const zonesGroup = new Adw.PreferencesGroup({
            title: 'Layouts',
            description: 'Left and right halves and top and bottom halves are always offered.',
        });
        page.add(zonesGroup);

        const quartersRow = new Adw.SwitchRow({title: 'Quarters'});
        settings.bind('show-quarters', quartersRow, 'active', 0);
        zonesGroup.add(quartersRow);

        const thirdsRow = new Adw.SwitchRow({title: 'Thirds'});
        settings.bind('show-thirds', thirdsRow, 'active', 0);
        zonesGroup.add(thirdsRow);

        const gapRow = new Adw.SpinRow({
            title: 'Window gap',
            subtitle: 'Pixels left around every snapped window',
            adjustment: new Gtk.Adjustment({lower: 0, upper: 64, step_increment: 1, page_increment: 4}),
        });
        settings.bind('window-gap', gapRow, 'value', 0);
        zonesGroup.add(gapRow);

        const keysGroup = new Adw.PreferencesGroup({title: 'Keyboard'});
        page.add(keysGroup);
        for (const [key, title] of SHORTCUTS)
            keysGroup.add(new ShortcutRow(settings, key, title));
    }
}
