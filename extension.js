import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {SnapOverlay} from './overlay.js';
import {fracRect, monitorIndexAt, neighbourMonitor, workAreaFor} from './zones.js';

const POLL_INTERVAL_MS = 16;

const KEYBINDINGS = [
    ['snap-screen-up', -1],
    ['snap-screen-down', 1],
];

function isMoveGrab(op) {
    return op === Meta.GrabOp.MOVING || op === Meta.GrabOp.MOVING_UNCONSTRAINED;
}

// console.log rather than console.debug: GLib drops DEBUG unless G_MESSAGES_DEBUG
// names the domain, and a log that is off by default records nothing the one time
// it is needed. Both call sites are user-initiated and fire at most a few times a
// minute, so always-on costs nothing.
function log(message) {
    console.log(`duosnap: ${message}`);
}

function describeMonitors() {
    const {monitors, primaryIndex} = Main.layoutManager;
    return `${monitors.length} [${monitors
        .map(m => `${m.index}${m.index === primaryIndex ? '*' : ''}:${m.width}x${m.height}+${m.x}+${m.y}`)
        .join(' ')}]`;
}

export default class DuoSnapExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._overlay = new SnapOverlay(this._settings);

        this._dragWindow = null;
        this._zone = null;
        this._pollId = 0;
        this._grabStartedAt = 0;

        this._grabBeginId = global.display.connect('grab-op-begin',
            (_display, window, op) => this._onGrabBegin(window, op));
        this._grabEndId = global.display.connect('grab-op-end',
            () => this._onGrabEnd());
        this._monitorLayout = describeMonitors();
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => {
            const previous = this._monitorLayout;
            this._monitorLayout = describeMonitors();
            log(`monitors-changed: ${previous} -> ${this._monitorLayout}`);
            this._endDrag();
        });

        log(`enabled, monitors ${this._monitorLayout}`);

        for (const [name, direction] of KEYBINDINGS) {
            Main.wm.addKeybinding(name, this._settings, Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL, () => this._snapToNeighbour(direction));
        }
    }

    disable() {
        this._endDrag();

        for (const [name] of KEYBINDINGS)
            Main.wm.removeKeybinding(name);

        if (this._grabBeginId)
            global.display.disconnect(this._grabBeginId);
        if (this._grabEndId)
            global.display.disconnect(this._grabEndId);
        if (this._monitorsId)
            Main.layoutManager.disconnect(this._monitorsId);
        this._grabBeginId = this._grabEndId = this._monitorsId = 0;

        this._overlay?.destroy();
        this._overlay = null;
        this._settings = null;
    }

    _snappable(window) {
        return !!window &&
            window.get_window_type() === Meta.WindowType.NORMAL &&
            !window.is_fullscreen() &&
            window.allows_move();
    }

    _onGrabBegin(window, op) {
        if (!isMoveGrab(op) || !this._settings.get_boolean('drag-hud'))
            return;
        if (!this._snappable(window) || Main.overview.visible)
            return;

        this._dragWindow = window;
        this._zone = null;
        this._grabStartedAt = GLib.get_monotonic_time();
        this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_INTERVAL_MS, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _onGrabEnd() {
        const window = this._dragWindow;
        const zone = this._zone;
        this._endDrag();

        if (window && zone && window.get_compositor_private())
            this._apply(window, zone);
    }

    _endDrag() {
        if (this._pollId) {
            GLib.source_remove(this._pollId);
            this._pollId = 0;
        }
        this._dragWindow = null;
        this._zone = null;
        this._overlay?.hide();
    }

    _tick() {
        const [x, y] = global.get_pointer();

        if (!this._overlay.visible) {
            const elapsedMs = (GLib.get_monotonic_time() - this._grabStartedAt) / 1000;
            if (elapsedMs < this._settings.get_int('show-delay'))
                return;
            this._overlay.show(monitorIndexAt(x, y));
        } else {
            this._overlay.setMonitor(monitorIndexAt(x, y));
        }

        this._zone = this._overlay.hoverAt(x, y);
    }

    // Deferred: at grab-op-end mutter has not finished placing the window it
    // was dragging, and an immediate move_resize_frame gets overwritten.
    _apply(window, zone) {
        const laters = global.compositor.get_laters();
        laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
            if (window.get_compositor_private())
                this._applyNow(window, zone);
            return GLib.SOURCE_REMOVE;
        });
    }

    _applyNow(window, zone) {
        const {rect} = zone;

        // Read the monitor before move_to_monitor, so the line records where the
        // window came from rather than where it ended up.
        log(`apply ${zone.id} to ${window.get_wm_class() ?? '?'} ` +
            `"${window.get_title() ?? '?'}": monitor ${window.get_monitor()} -> ` +
            `${zone.monitorIndex}, ${rect.width}x${rect.height}+${rect.x}+${rect.y}` +
            `${zone.maximize ? ' (maximize)' : ''}`);

        if (window.is_maximized())
            window.unmaximize();

        // The tray can aim at a screen the pointer never visited, so every path
        // has to be able to land the window on another monitor.
        if (window.get_monitor() !== zone.monitorIndex)
            window.move_to_monitor(zone.monitorIndex);

        if (!window.allows_resize()) {
            const frame = window.get_frame_rect();
            window.move_frame(true,
                rect.x + Math.round((rect.width - frame.width) / 2),
                rect.y + Math.round((rect.height - frame.height) / 2));
            return;
        }

        if (zone.maximize) {
            window.maximize();
            return;
        }

        window.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
    }

    _snapToNeighbour(direction) {
        const window = global.display.focus_window;
        if (!this._snappable(window))
            return;

        const target = neighbourMonitor(window.get_monitor(), direction);
        if (target < 0)
            return;

        const gap = this._settings.get_int('window-gap');
        const wa = workAreaFor(target);
        this._applyNow(window, {
            id: `screen-${target}`,
            rect: gap === 0
                ? {x: wa.x, y: wa.y, width: wa.width, height: wa.height}
                : fracRect(target, [0, 0, 1, 1], gap),
            monitorIndex: target,
            maximize: gap === 0,
        });
    }

}
