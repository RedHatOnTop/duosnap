import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {TEMPLATES, fracRect, screenLabels, workAreaFor} from './zones.js';

const SCREEN_W = 132;
const TPL_W = 104;
const TILE_MIN_H = 40;
const TILE_MAX_H = 96;
const TPL_GAP = 10;
const SCREEN_GAP = 14;
const LABEL_H = 14;
const LABEL_GAP = 8;
const TAB_H = 20;
const TAB_GAP = 8;
const GRIP_W = 18;
const GRIP_H = 2;
const GRIP_GAP = 4;
const PAD = 20;
const PAD_BOTTOM = 12;
const TRAY_PAD = 14;
const REVEAL_GAP = 16;
const CORD_W = 2;
const FRAME_INSET = 1;
const SEAM = 1;
const TOP_MARGIN = 26;
const EDGE_MARGIN = 8;

// Miniatures carry the work area's aspect so a template reads as a picture of
// the screen it will produce, not an abstract rectangle.
function tileHeight(width, monitorIndex) {
    const wa = workAreaFor(monitorIndex);
    const h = Math.round(width * wa.height / wa.width);
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
        this._trayMonitor = -1;
        this._screenItems = [];
        this._tabItems = [];
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
        // Ties the open tray back to the tab that pulled it out, which is the
        // only thing saying which screen those layouts belong to.
        this._cord = new St.Widget({
            style_class: 'duosnap-cord',
            reactive: false,
            visible: false,
        });

        for (const actor of [this._preview, this._cord, this._card, this._tray]) {
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

    get _items() {
        return [...this._screenItems, ...this._tabItems, ...this._paneItems];
    }

    show(monitorIndex) {
        this._build(monitorIndex);

        if (this._screenItems.length) {
            this._fadeIn(this._card);
        } else {
            // Nothing to choose between, so the layouts are the whole picker.
            this._fadeIn(this._tray);
        }
    }

    setMonitor(monitorIndex) {
        if (monitorIndex === this._monitorIndex || !this.visible)
            return;

        const trayWasUp = this._tray.visible;
        this._build(monitorIndex);
        this._card.visible = this._screenItems.length > 0;
        if (trayWasUp || !this._screenItems.length)
            this._showTray(monitorIndex);
    }

    // Manual hit testing: mutter owns the pointer for the duration of a move
    // grab, so neither surface sees a crossing event of its own.
    hoverAt(x, y) {
        if (!this.visible)
            return null;

        let hit = this._screenItems.find(item => contains(item.hit, x, y)) ?? null;

        if (hit) {
            // A screen is the maximize target, and going back up to one puts the
            // picker back to just asking which screen.
            this._setArmed(hit.monitorIndex);
            this._hideTray();
        } else {
            hit = this._tabItems.find(item => contains(item.hit, x, y)) ?? null;
            const reveal = hit ?? this._bands.find(b => contains(b.rect, x, y));

            if (reveal) {
                // The tab under a screen is what pulls its layouts out; the band
                // carries on down to the tray so the pointer can reach it
                // without falling out of the reveal.
                this._setArmed(reveal.monitorIndex);
                this._showTray(reveal.monitorIndex);
            } else if (this._tray.visible && contains(this._trayRect, x, y)) {
                hit = this._paneItems.find(item => contains(item.hit, x, y)) ?? null;
            } else if (!contains(this._cardRect, x, y)) {
                this._hideTray();
            }
        }

        if (hit === this._activeItem)
            return this._active;
        this._activeItem = hit;

        for (const item of this._items)
            this._setItemActive(item, item === hit);

        // A tab is a way in, not a destination: releasing on one snaps nothing.
        const resolved = hit && hit.type !== 'tab' ? this._resolve(hit) : null;
        this._active = resolved;
        this._updatePreview(resolved);
        return resolved;
    }

    hide() {
        this._active = null;
        this._activeItem = null;
        for (const actor of [this._card, this._tray, this._cord, this._preview]) {
            actor.hide();
            actor.remove_all_transitions();
        }
        for (const item of this._items)
            this._setItemActive(item, false);
        this._markOpenTab(-1);
    }

    destroy() {
        for (const actor of [this._card, this._tray, this._cord, this._preview]) {
            Main.layoutManager.removeChrome(actor);
            actor.destroy();
        }
        this._screenItems = [];
        this._tabItems = [];
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

    _markOpenTab(monitorIndex) {
        for (const item of this._tabItems) {
            const fn = item.monitorIndex === monitorIndex
                ? 'add_style_class_name' : 'remove_style_class_name';
            item.actor[fn]('duosnap-tab-open');
        }
    }

    _showTray(monitorIndex) {
        if (this._tray.visible && monitorIndex === this._trayMonitor)
            return;

        this._trayMonitor = monitorIndex;
        this._markOpenTab(monitorIndex);

        const tab = this._tabItems.find(i => i.monitorIndex === monitorIndex);
        if (tab) {
            this._cord.set_position(
                Math.round(tab.hit.x + tab.hit.width / 2 - CORD_W / 2),
                this._cardRect.y + this._cardRect.height);
            this._cord.set_size(CORD_W, REVEAL_GAP);
            this._cord.show();
        }

        if (!this._tray.visible)
            this._fadeIn(this._tray);
    }

    _hideTray() {
        if (!this._tray.visible)
            return;
        this._tray.remove_all_transitions();
        this._tray.hide();
        this._cord.hide();
        this._trayMonitor = -1;
        this._markOpenTab(-1);
        for (const item of this._paneItems)
            this._setItemActive(item, false);
    }

    // Aiming only changes which monitor panes resolve against; the tray is the
    // same picture either way, so it is never rebuilt or moved.
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
        this._card.remove_all_children();
        this._tray.remove_all_children();
        this._screenItems = [];
        this._tabItems = [];
        this._paneItems = [];
        this._bands = [];
        this._active = null;
        this._activeItem = null;
        this._hideTray();

        const screenH = tileHeight(SCREEN_W, monitorIndex);
        const tplH = tileHeight(TPL_W, monitorIndex);
        const templates = TEMPLATES.filter(t =>
            !t.setting || this._settings.get_boolean(t.setting));
        const screens = Main.layoutManager.monitors.length > 1 ? screenLabels() : [];

        const monitor = Main.layoutManager.monitors[monitorIndex];
        const wa = workAreaFor(monitorIndex);

        const cardW = screens.length * SCREEN_W + SCREEN_GAP * (screens.length - 1) + 2 * PAD;
        const cardH = PAD + screenH + LABEL_GAP + LABEL_H + TAB_GAP + TAB_H + PAD_BOTTOM;
        const cardX = Math.round(monitor.x + (monitor.width - cardW) / 2);
        const cardY = Math.round(wa.y + TOP_MARGIN);

        this._cardRect = {x: cardX, y: cardY, width: cardW, height: cardH};
        this._card.set_position(cardX, cardY);
        this._card.set_size(cardW, cardH);

        const columnH = screenH + LABEL_GAP + LABEL_H + TAB_GAP + TAB_H;
        let x = PAD;
        screens.forEach((screen, i) => {
            if (i > 0) {
                const divider = new St.Widget({style_class: 'duosnap-divider'});
                divider.set_position(Math.round(x - SCREEN_GAP / 2), PAD);
                divider.set_size(1, columnH);
                this._card.add_child(divider);
            }
            this._addScreen(screen, x, PAD, screenH, cardX, cardY);
            x += SCREEN_W + SCREEN_GAP;
        });

        const trayW = templates.length * TPL_W + TPL_GAP * (templates.length - 1) + 2 * TRAY_PAD;
        const trayH = tplH + 2 * TRAY_PAD;
        const trayX = Math.round(Math.min(
            Math.max(monitor.x + (monitor.width - trayW) / 2, monitor.x + EDGE_MARGIN),
            monitor.x + monitor.width - trayW - EDGE_MARGIN));
        const trayY = screens.length ? cardY + cardH + REVEAL_GAP : cardY;

        this._trayRect = {x: trayX, y: trayY, width: trayW, height: trayH};
        this._tray.set_position(trayX, trayY);
        this._tray.set_size(trayW, trayH);

        x = TRAY_PAD;
        for (const template of templates) {
            this._addTemplate(template, x, TRAY_PAD, tplH, trayX, trayY);
            x += TPL_W + TPL_GAP;
        }

        // Tolerance below each tab, so a pointer on its way down to the tray does
        // not leave the reveal and close it. Half the inter-column gap on each
        // side keeps the bands contiguous.
        for (const item of this._tabItems) {
            this._bands.push({
                monitorIndex: item.monitorIndex,
                rect: {
                    x: item.hit.x - SCREEN_GAP / 2,
                    y: item.hit.y + item.hit.height,
                    width: SCREEN_W + SCREEN_GAP,
                    height: trayY - (item.hit.y + item.hit.height),
                },
            });
        }
    }

    _addScreen(screen, x, y, screenH, cardX, cardY) {
        const frame = new St.Widget({
            style_class: 'duosnap-screen',
            layout_manager: new Clutter.BinLayout(),
            reactive: false,
        });
        frame.set_position(x, y);
        frame.set_size(SCREEN_W, screenH);
        frame.add_child(new St.Label({
            style_class: 'duosnap-ordinal',
            text: screen.ordinal,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._card.add_child(frame);

        const captionY = y + screenH + LABEL_GAP;
        const caption = new St.Widget({layout_manager: new Clutter.BinLayout()});
        caption.set_position(x, captionY);
        caption.set_size(SCREEN_W, LABEL_H);
        caption.add_child(new St.Label({
            style_class: 'duosnap-screen-label',
            text: (screen.glyph ? `${screen.glyph}  ${screen.label}` : screen.label).toUpperCase(),
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._card.add_child(caption);

        this._screenItems.push({
            type: 'screen',
            id: `screen-${screen.index}`,
            monitorIndex: screen.index,
            actor: frame,
            activeClass: 'duosnap-screen-hover',
            active: false,
            // The caption is part of the target, so the screen does not go dead
            // in the strip of pixels under the miniature.
            hit: {
                x: cardX + x,
                y: cardY + y,
                width: SCREEN_W,
                height: screenH + LABEL_GAP + LABEL_H,
            },
        });

        if (screen.index === this._armed)
            frame.add_style_class_name('duosnap-screen-armed');

        // The reveal has to be somewhere the eye can find it, so it gets a
        // control of its own rather than an invisible strip of card.
        const tabY = captionY + LABEL_H + TAB_GAP;
        const tab = new St.Widget({
            style_class: 'duosnap-tab',
            layout_manager: new Clutter.FixedLayout(),
            reactive: false,
        });
        tab.set_position(x, tabY);
        tab.set_size(SCREEN_W, TAB_H);
        this._card.add_child(tab);

        const gripX = Math.round((SCREEN_W - GRIP_W) / 2);
        const gripY = Math.round((TAB_H - (2 * GRIP_H + GRIP_GAP)) / 2);
        for (let i = 0; i < 2; i++) {
            const bar = new St.Widget({style_class: 'duosnap-grip'});
            bar.set_position(gripX, gripY + i * (GRIP_H + GRIP_GAP));
            bar.set_size(GRIP_W, GRIP_H);
            tab.add_child(bar);
        }

        this._tabItems.push({
            type: 'tab',
            id: `tab-${screen.index}`,
            monitorIndex: screen.index,
            actor: tab,
            activeClass: 'duosnap-tab-hover',
            active: false,
            hit: {x: cardX + x, y: cardY + tabY, width: SCREEN_W, height: TAB_H},
        });
    }

    _addTemplate(template, x, y, tplH, trayX, trayY) {
        const frame = new St.Widget({
            style_class: 'duosnap-frame',
            layout_manager: new Clutter.FixedLayout(),
            reactive: false,
        });
        frame.set_position(x, y);
        frame.set_size(TPL_W, tplH);
        this._tray.add_child(frame);

        const innerW = TPL_W - 2 * FRAME_INSET;
        const innerH = tplH - 2 * FRAME_INSET;

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
            const hl = Math.round(fx * TPL_W);
            const ht = Math.round(fy * tplH);
            const hr = Math.round((fx + fw) * TPL_W);
            const hb = Math.round((fy + fh) * tplH);

            this._paneItems.push({
                type: 'pane',
                id: pane.id,
                frac: pane.frac,
                actor,
                frame,
                activeClass: 'duosnap-pane-active',
                active: false,
                hit: {
                    x: trayX + x + hl,
                    y: trayY + y + ht,
                    width: hr - hl,
                    height: hb - ht,
                },
            });
        }
    }
}
