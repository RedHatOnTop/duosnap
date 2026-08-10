import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {TEMPLATES, fracRect, screenLabels, workAreaFor} from './zones.js';

const TILE_W = 74;
const TILE_MIN_H = 32;
const TILE_MAX_H = 58;
const TPL_GAP = 8;
const SCREEN_GAP = 10;
const LABEL_H = 15;
const LABEL_GAP = 4;
const ROW_GAP = 14;
const PAD = 14;
const FRAME_INSET = 3;
const SEAM = 1;
const TOP_MARGIN = 26;

// Miniatures carry the work area's aspect so a template reads as a picture of
// the screen it will produce, not an abstract rectangle.
function tileHeight(monitorIndex) {
    const wa = workAreaFor(monitorIndex);
    const h = Math.round(TILE_W * wa.height / wa.width);
    return Math.min(TILE_MAX_H, Math.max(TILE_MIN_H, h));
}

export class SnapOverlay {
    constructor(settings) {
        this._settings = settings;
        this._monitorIndex = -1;
        this._armed = -1;
        this._items = [];
        this._screens = [];
        this._active = null;
        this._activeItem = null;

        this._preview = new St.Widget({
            style_class: 'duosnap-preview',
            reactive: false,
            visible: false,
        });
        this._card = new St.Widget({
            style_class: 'duosnap-card',
            layout_manager: new Clutter.FixedLayout(),
            reactive: false,
            visible: false,
        });

        Main.layoutManager.addChrome(this._preview, {
            affectsStruts: false,
            trackFullscreen: false,
        });
        Main.layoutManager.addChrome(this._card, {
            affectsStruts: false,
            trackFullscreen: false,
        });
    }

    get activeZone() {
        return this._active;
    }

    get visible() {
        return this._card.visible;
    }

    show(monitorIndex) {
        this._build(monitorIndex);

        this._card.opacity = 0;
        this._card.translation_y = -10;
        this._card.show();
        this._card.ease({
            opacity: 255,
            translation_y: 0,
            duration: 140,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    setMonitor(monitorIndex) {
        if (monitorIndex === this._monitorIndex || !this._card.visible)
            return;
        this._build(monitorIndex);
    }

    // Manual hit testing: mutter owns the pointer for the duration of a move
    // grab, so the card never sees a crossing event of its own.
    hoverAt(x, y) {
        if (!this._card.visible)
            return null;

        let hit = null;
        for (const item of this._items) {
            const r = item.hit;
            if (x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height) {
                hit = item;
                break;
            }
        }

        // Entering a screen aims the tray at it, so the layouts below always
        // belong to the screen the pointer last committed to. It stays aimed
        // once the pointer moves down into the tray.
        if (hit?.type === 'screen')
            this._setArmed(hit.monitorIndex);

        if (hit === this._activeItem)
            return this._active;
        this._activeItem = hit;

        for (const item of this._items)
            this._setItemActive(item, item === hit);

        const resolved = hit ? this._resolve(hit) : null;
        this._active = resolved;
        this._updatePreview(resolved);
        return resolved;
    }

    hide() {
        this._active = null;
        this._activeItem = null;
        this._card.hide();
        this._card.remove_all_transitions();
        this._preview.hide();
        this._preview.remove_all_transitions();
        for (const item of this._items)
            this._setItemActive(item, false);
    }

    destroy() {
        Main.layoutManager.removeChrome(this._card);
        Main.layoutManager.removeChrome(this._preview);
        this._card.destroy();
        this._preview.destroy();
        this._items = [];
        this._screens = [];
        this._active = null;
    }

    // Aiming only changes which monitor panes resolve against; every tray
    // rectangle is identical between screens, so nothing is rebuilt and no hit
    // target shifts under the pointer.
    _setArmed(monitorIndex) {
        if (monitorIndex === this._armed)
            return;
        this._armed = monitorIndex;

        for (const item of this._screens) {
            const armed = item.monitorIndex === monitorIndex;
            const fn = armed ? 'add_style_class_name' : 'remove_style_class_name';
            item.actor[fn]('duosnap-screen-armed');
        }

        if (this._activeItem?.type === 'pane') {
            this._active = this._resolve(this._activeItem);
            this._updatePreview(this._active);
        }
    }

    _setItemActive(item, active) {
        if (item.active === active)
            return;
        item.active = active;

        const fn = active ? 'add_style_class_name' : 'remove_style_class_name';
        item.actor[fn](item.activeClass);
        item.frame?.[fn]('duosnap-frame-active');
    }

    _resolve(item) {
        const gap = this._settings.get_int('window-gap');

        if (item.type === 'pane') {
            return {
                id: `${item.id}@${this._armed}`,
                rect: fracRect(this._armed, item.frac, gap),
                monitorIndex: this._armed,
                maximize: false,
            };
        }

        const wa = workAreaFor(item.monitorIndex);
        return {
            id: `screen-${item.monitorIndex}`,
            rect: gap === 0
                ? {x: wa.x, y: wa.y, width: wa.width, height: wa.height}
                : fracRect(item.monitorIndex, [0, 0, 1, 1], gap),
            monitorIndex: item.monitorIndex,
            maximize: gap === 0,
        };
    }

    _updatePreview(resolved) {
        if (!resolved) {
            if (this._preview.visible) {
                this._preview.ease({
                    opacity: 0,
                    duration: 110,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => this._preview.hide(),
                });
            }
            return;
        }

        const {x, y, width, height} = resolved.rect;
        if (!this._preview.visible) {
            this._preview.set_position(x, y);
            this._preview.set_size(width, height);
            this._preview.opacity = 0;
            this._preview.show();
            this._preview.ease({
                opacity: 255,
                duration: 120,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
            return;
        }

        this._preview.remove_all_transitions();
        this._preview.ease({
            x, y, width, height,
            opacity: 255,
            duration: 130,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _build(monitorIndex) {
        this._monitorIndex = monitorIndex;
        this._armed = monitorIndex;
        this._card.remove_all_children();
        this._items = [];
        this._screens = [];
        this._active = null;
        this._activeItem = null;

        const tileH = tileHeight(monitorIndex);
        const templates = TEMPLATES.filter(t =>
            !t.setting || this._settings.get_boolean(t.setting));
        const screens = Main.layoutManager.monitors.length > 1 ? screenLabels() : [];

        const trayW = templates.length * TILE_W + TPL_GAP * (templates.length - 1);
        const screenRowW = screens.length * TILE_W + SCREEN_GAP * (screens.length - 1);
        const screenRowH = screens.length ? tileH + LABEL_GAP + LABEL_H : 0;

        const cardW = Math.max(trayW, screenRowW) + 2 * PAD;
        const cardH = screenRowH + (screens.length ? ROW_GAP : 0) + tileH + 2 * PAD;

        const monitor = Main.layoutManager.monitors[monitorIndex];
        const wa = workAreaFor(monitorIndex);
        const cardX = Math.round(monitor.x + (monitor.width - cardW) / 2);
        const cardY = Math.round(wa.y + TOP_MARGIN);

        this._card.set_position(cardX, cardY);
        this._card.set_size(cardW, cardH);

        let trayY = PAD;
        if (screens.length) {
            let x = Math.round((cardW - screenRowW) / 2);
            for (const screen of screens) {
                this._addScreen(screen, x, PAD, tileH, cardX, cardY);
                x += TILE_W + SCREEN_GAP;
            }

            const sep = new St.Widget({style_class: 'duosnap-separator'});
            sep.set_position(PAD, PAD + screenRowH + Math.round(ROW_GAP / 2));
            sep.set_size(cardW - 2 * PAD, 1);
            this._card.add_child(sep);

            trayY = PAD + screenRowH + ROW_GAP;
        }

        let x = Math.round((cardW - trayW) / 2);
        for (const template of templates) {
            this._addTemplate(template, x, trayY, tileH, cardX, cardY);
            x += TILE_W + TPL_GAP;
        }
    }

    _addScreen(screen, x, y, tileH, cardX, cardY) {
        const frame = new St.Widget({
            style_class: 'duosnap-screen',
            layout_manager: new Clutter.BinLayout(),
            reactive: false,
        });
        frame.set_position(x, y);
        frame.set_size(TILE_W, tileH);
        frame.add_child(new St.Label({
            style_class: 'duosnap-ordinal',
            text: screen.ordinal,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._card.add_child(frame);

        const caption = new St.Widget({layout_manager: new Clutter.BinLayout()});
        caption.set_position(x, y + tileH + LABEL_GAP);
        caption.set_size(TILE_W, LABEL_H);
        caption.add_child(new St.Label({
            style_class: 'duosnap-screen-label',
            text: screen.glyph ? `${screen.glyph} ${screen.label}` : screen.label,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._card.add_child(caption);

        const item = {
            type: 'screen',
            id: `screen-${screen.index}`,
            monitorIndex: screen.index,
            actor: frame,
            activeClass: 'duosnap-screen-hover',
            active: false,
            // The caption is part of the target, so the block does not go dead
            // in the strip of pixels under the miniature.
            hit: {
                x: cardX + x,
                y: cardY + y,
                width: TILE_W,
                height: tileH + LABEL_GAP + LABEL_H,
            },
        };

        if (screen.index === this._armed)
            frame.add_style_class_name('duosnap-screen-armed');

        this._screens.push(item);
        this._items.push(item);
    }

    _addTemplate(template, x, y, tileH, cardX, cardY) {
        const frame = new St.Widget({
            style_class: 'duosnap-frame',
            layout_manager: new Clutter.FixedLayout(),
            reactive: false,
        });
        frame.set_position(x, y);
        frame.set_size(TILE_W, tileH);
        this._card.add_child(frame);

        const innerW = TILE_W - 2 * FRAME_INSET;
        const innerH = tileH - 2 * FRAME_INSET;

        for (const pane of template.panes) {
            const [fx, fy, fw, fh] = pane.frac;
            const left = Math.round(fx * innerW);
            const top = Math.round(fy * innerH);
            const right = Math.round((fx + fw) * innerW);
            const bottom = Math.round((fy + fh) * innerH);

            const actor = new St.Widget({style_class: 'duosnap-pane', reactive: false});
            actor.set_position(FRAME_INSET + left + SEAM, FRAME_INSET + top + SEAM);
            actor.set_size(
                Math.max(2, right - left - 2 * SEAM),
                Math.max(2, bottom - top - 2 * SEAM));
            frame.add_child(actor);

            // Hit rects tile the whole miniature, seams and border included, so
            // there is nowhere inside a template that selects nothing.
            const hl = Math.round(fx * TILE_W);
            const ht = Math.round(fy * tileH);
            const hr = Math.round((fx + fw) * TILE_W);
            const hb = Math.round((fy + fh) * tileH);

            this._items.push({
                type: 'pane',
                id: pane.id,
                frac: pane.frac,
                actor,
                frame,
                activeClass: 'duosnap-pane-active',
                active: false,
                hit: {
                    x: cardX + x + hl,
                    y: cardY + y + ht,
                    width: hr - hl,
                    height: hb - ht,
                },
            });
        }
    }
}
