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
const PAD = 14;
const TRAY_PAD = 12;
const REVEAL_GAP = 14;
const FRAME_INSET = 3;
const SEAM = 1;
const TOP_MARGIN = 26;
const EDGE_MARGIN = 8;

// Miniatures carry the work area's aspect so a template reads as a picture of
// the screen it will produce, not an abstract rectangle.
function tileHeight(monitorIndex) {
    const wa = workAreaFor(monitorIndex);
    const h = Math.round(TILE_W * wa.height / wa.width);
    return Math.min(TILE_MAX_H, Math.max(TILE_MIN_H, h));
}

function contains(rect, x, y) {
    return x >= rect.x && x < rect.x + rect.width &&
        y >= rect.y && y < rect.y + rect.height;
}

export class SnapOverlay {
    constructor(settings) {
        this._settings = settings;
        this._monitorIndex = -1;
        this._armed = -1;
        this._screenItems = [];
        this._paneItems = [];
        this._bands = [];
        this._cardRect = {x: 0, y: 0, width: 0, height: 0};
        this._trayRect = {x: 0, y: 0, width: 0, height: 0};
        this._active = null;
        this._activeItem = null;

        this._preview = new St.Widget({
            style_class: 'duosnap-preview',
            reactive: false,
            visible: false,
        });
        // Two surfaces, not one card that grows: the screen row must not move a
        // pixel when the layouts appear underneath it.
        this._card = new St.Widget({
            style_class: 'duosnap-card',
            layout_manager: new Clutter.FixedLayout(),
            reactive: false,
            visible: false,
        });
        this._tray = new St.Widget({
            style_class: 'duosnap-card',
            layout_manager: new Clutter.FixedLayout(),
            reactive: false,
            visible: false,
        });

        for (const actor of [this._preview, this._card, this._tray]) {
            Main.layoutManager.addChrome(actor, {
                affectsStruts: false,
                trackFullscreen: false,
            });
        }
    }

    get activeZone() {
        return this._active;
    }

    get visible() {
        return this._card.visible || this._tray.visible;
    }

    show(monitorIndex) {
        this._build(monitorIndex);

        if (this._screenItems.length) {
            this._fadeIn(this._card);
        } else {
            // Nothing to choose between, so the layouts are the whole picker.
            this._positionTray(monitorIndex);
            this._fadeIn(this._tray);
        }
    }

    setMonitor(monitorIndex) {
        if (monitorIndex === this._monitorIndex || !this.visible)
            return;

        const trayWasUp = this._tray.visible;
        this._build(monitorIndex);
        this._card.visible = this._screenItems.length > 0;
        if (trayWasUp || !this._screenItems.length) {
            this._positionTray(monitorIndex);
            this._tray.show();
        }
    }

    // Manual hit testing: mutter owns the pointer for the duration of a move
    // grab, so neither surface sees a crossing event of its own.
    hoverAt(x, y) {
        if (!this.visible)
            return null;

        let hit = null;

        for (const item of this._screenItems) {
            if (contains(item.hit, x, y)) {
                hit = item;
                break;
            }
        }

        if (hit) {
            // A screen block is the maximize target, and going back up to one
            // puts the picker back to just asking which screen.
            this._setArmed(hit.monitorIndex);
            this._hideTray();
        } else {
            const band = this._bands.find(b => contains(b.rect, x, y));
            if (band) {
                // The strip under a screen block is what asks for its layouts.
                this._setArmed(band.monitorIndex);
                this._showTray(band.monitorIndex);
            } else if (this._tray.visible && contains(this._trayRect, x, y)) {
                hit = this._paneItems.find(item =>
                    contains(this._paneHit(item), x, y)) ?? null;
            } else if (!contains(this._cardRect, x, y)) {
                this._hideTray();
            }
        }

        if (hit === this._activeItem)
            return this._active;
        this._activeItem = hit;

        for (const item of this._screenItems)
            this._setItemActive(item, item === hit);
        for (const item of this._paneItems)
            this._setItemActive(item, item === hit);

        const resolved = hit ? this._resolve(hit) : null;
        this._active = resolved;
        this._updatePreview(resolved);
        return resolved;
    }

    hide() {
        this._active = null;
        this._activeItem = null;
        for (const actor of [this._card, this._tray, this._preview]) {
            actor.hide();
            actor.remove_all_transitions();
        }
        for (const item of this._screenItems)
            this._setItemActive(item, false);
        for (const item of this._paneItems)
            this._setItemActive(item, false);
    }

    destroy() {
        for (const actor of [this._card, this._tray, this._preview]) {
            Main.layoutManager.removeChrome(actor);
            actor.destroy();
        }
        this._screenItems = [];
        this._paneItems = [];
        this._bands = [];
        this._active = null;
    }

    _fadeIn(actor) {
        actor.opacity = 0;
        actor.translation_y = -10;
        actor.show();
        actor.ease({
            opacity: 255,
            translation_y: 0,
            duration: 140,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    // Pane hit rects are kept relative to the tray, which moves under whichever
    // screen block asked for it.
    _paneHit(item) {
        return {
            x: this._trayRect.x + item.local.x,
            y: this._trayRect.y + item.local.y,
            width: item.local.width,
            height: item.local.height,
        };
    }

    _showTray(monitorIndex) {
        if (this._tray.visible && monitorIndex === this._trayMonitor)
            return;

        this._positionTray(monitorIndex);
        if (!this._tray.visible)
            this._fadeIn(this._tray);
    }

    _hideTray() {
        if (!this._tray.visible)
            return;
        this._tray.remove_all_transitions();
        this._tray.hide();
        for (const item of this._paneItems)
            this._setItemActive(item, false);
    }

    _positionTray(monitorIndex) {
        this._trayMonitor = monitorIndex;

        const monitor = Main.layoutManager.monitors[this._monitorIndex];
        const block = this._screenItems.find(i => i.monitorIndex === monitorIndex);
        const centre = block
            ? block.hit.x + block.hit.width / 2
            : monitor.x + monitor.width / 2;

        const x = Math.round(Math.min(
            Math.max(centre - this._trayRect.width / 2, monitor.x + EDGE_MARGIN),
            monitor.x + monitor.width - this._trayRect.width - EDGE_MARGIN));

        this._trayRect.x = x;
        this._tray.set_position(x, this._trayRect.y);
    }

    // Aiming only changes which monitor panes resolve against; every tray
    // rectangle is identical between screens, so nothing is rebuilt.
    _setArmed(monitorIndex) {
        if (monitorIndex === this._armed)
            return;
        this._armed = monitorIndex;

        for (const item of this._screenItems) {
            const fn = item.monitorIndex === monitorIndex
                ? 'add_style_class_name' : 'remove_style_class_name';
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
        this._trayMonitor = -1;
        this._card.remove_all_children();
        this._tray.remove_all_children();
        this._screenItems = [];
        this._paneItems = [];
        this._bands = [];
        this._active = null;
        this._activeItem = null;
        this._hideTray();

        const tileH = tileHeight(monitorIndex);
        const templates = TEMPLATES.filter(t =>
            !t.setting || this._settings.get_boolean(t.setting));
        const screens = Main.layoutManager.monitors.length > 1 ? screenLabels() : [];

        const monitor = Main.layoutManager.monitors[monitorIndex];
        const wa = workAreaFor(monitorIndex);

        const screenRowW = screens.length * TILE_W + SCREEN_GAP * (screens.length - 1);
        const cardW = screenRowW + 2 * PAD;
        const cardH = tileH + LABEL_GAP + LABEL_H + 2 * PAD;
        const cardX = Math.round(monitor.x + (monitor.width - cardW) / 2);
        const cardY = Math.round(wa.y + TOP_MARGIN);

        this._cardRect = {x: cardX, y: cardY, width: cardW, height: cardH};
        this._card.set_position(cardX, cardY);
        this._card.set_size(cardW, cardH);

        let x = PAD;
        for (const screen of screens) {
            this._addScreen(screen, x, PAD, tileH, cardX, cardY);
            x += TILE_W + SCREEN_GAP;
        }

        const trayW = templates.length * TILE_W + TPL_GAP * (templates.length - 1) + 2 * TRAY_PAD;
        const trayH = tileH + 2 * TRAY_PAD;
        const trayY = screens.length
            ? cardY + cardH + REVEAL_GAP
            : cardY;

        this._trayRect = {
            x: Math.round(monitor.x + (monitor.width - trayW) / 2),
            y: trayY,
            width: trayW,
            height: trayH,
        };
        this._tray.set_position(this._trayRect.x, trayY);
        this._tray.set_size(trayW, trayH);

        x = TRAY_PAD;
        for (const template of templates) {
            this._addTemplate(template, x, TRAY_PAD, tileH);
            x += TILE_W + TPL_GAP;
        }

        // The strip each screen block owns between itself and the tray. Half the
        // inter-block gap on each side keeps the strips contiguous, so a pointer
        // travelling straight down never falls between them.
        for (const item of this._screenItems) {
            this._bands.push({
                monitorIndex: item.monitorIndex,
                rect: {
                    x: item.hit.x - SCREEN_GAP / 2,
                    y: item.hit.y + item.hit.height,
                    width: TILE_W + SCREEN_GAP,
                    height: trayY - (item.hit.y + item.hit.height),
                },
            });
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

        this._screenItems.push(item);
    }

    _addTemplate(template, x, y, tileH) {
        const frame = new St.Widget({
            style_class: 'duosnap-frame',
            layout_manager: new Clutter.FixedLayout(),
            reactive: false,
        });
        frame.set_position(x, y);
        frame.set_size(TILE_W, tileH);
        this._tray.add_child(frame);

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

            this._paneItems.push({
                type: 'pane',
                id: pane.id,
                frac: pane.frac,
                actor,
                frame,
                activeClass: 'duosnap-pane-active',
                active: false,
                local: {
                    x: x + hl,
                    y: y + ht,
                    width: hr - hl,
                    height: hb - ht,
                },
            });
        }
    }
}
