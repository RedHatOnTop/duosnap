import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    LAYOUT_ZONES, QUARTER_ZONES, THIRD_ZONES,
    fracRect, screenLabels, workAreaFor,
} from './zones.js';

const TILE_W = 62;
const TILE_H = 39;
const BTN_W = 106;
const BTN_H = 34;
const ITEM_GAP = 7;
const GROUP_GAP = 20;
const ROW_GAP = 11;
const PAD = 15;
const FILL_INSET = 4;
const TOP_MARGIN = 26;

export class SnapOverlay {
    constructor(settings) {
        this._settings = settings;
        this._monitorIndex = -1;
        this._items = [];
        this._active = null;

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

    get visible() {
        return this._card.visible;
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
        this._active = null;
    }

    _setItemActive(item, active) {
        if (item.active === active)
            return;
        item.active = active;

        const add = active ? 'add_style_class_name' : 'remove_style_class_name';
        item.actor[add]('duosnap-item-active');
        item.fill?.[add]('duosnap-fill-active');
        item.label?.[add]('duosnap-label-active');
    }

    _resolve(item) {
        const gap = this._settings.get_int('window-gap');

        if (item.type === 'tile') {
            return {
                id: item.id,
                rect: fracRect(this._monitorIndex, item.zone.frac, gap),
                monitorIndex: this._monitorIndex,
                maximize: item.zone.id === 'full' && gap === 0,
            };
        }

        const wa = workAreaFor(item.monitorIndex);
        return {
            id: item.id,
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

    _rowPlan() {
        const rows = [];

        rows.push([LAYOUT_ZONES.map(zone => ({
            type: 'tile', id: zone.id, zone, w: TILE_W, h: TILE_H,
        }))]);

        const gridGroups = [];
        if (this._settings.get_boolean('show-quarters')) {
            gridGroups.push(QUARTER_ZONES.map(zone => ({
                type: 'tile', id: zone.id, zone, w: TILE_W, h: TILE_H,
            })));
        }
        if (this._settings.get_boolean('show-thirds')) {
            gridGroups.push(THIRD_ZONES.map(zone => ({
                type: 'tile', id: zone.id, zone, w: TILE_W, h: TILE_H,
            })));
        }
        if (gridGroups.length)
            rows.push(gridGroups);

        if (this._settings.get_boolean('show-screen-row') && Main.layoutManager.monitors.length > 1) {
            rows.push([screenLabels().map(s => ({
                type: 'screen', id: `screen-${s.index}`, monitorIndex: s.index,
                text: `${s.glyph}  ${s.label}`, w: BTN_W, h: BTN_H,
            }))]);
        }

        return rows;
    }

    _build(monitorIndex) {
        this._monitorIndex = monitorIndex;
        this._card.remove_all_children();
        this._items = [];
        this._active = null;
        this._activeItem = null;

        const rows = this._rowPlan();
        const rowWidth = groups => groups.reduce((total, group, i) => {
            const inner = group.reduce((w, it) => w + it.w, 0) + ITEM_GAP * (group.length - 1);
            return total + inner + (i > 0 ? GROUP_GAP : 0);
        }, 0);

        const widths = rows.map(rowWidth);
        const heights = rows.map(groups =>
            Math.max(...groups.flat().map(it => it.h)));

        const cardW = Math.max(...widths) + 2 * PAD;
        const cardH = heights.reduce((a, b) => a + b, 0) + ROW_GAP * (rows.length - 1) + 2 * PAD;

        const monitor = Main.layoutManager.monitors[monitorIndex];
        const wa = workAreaFor(monitorIndex);
        const cardX = Math.round(monitor.x + (monitor.width - cardW) / 2);
        const cardY = Math.round(wa.y + TOP_MARGIN);

        this._card.set_position(cardX, cardY);
        this._card.set_size(cardW, cardH);

        let y = PAD;
        rows.forEach((groups, rowIndex) => {
            const rowH = heights[rowIndex];
            let x = Math.round((cardW - widths[rowIndex]) / 2);

            groups.forEach((group, groupIndex) => {
                if (groupIndex > 0) {
                    const sep = new St.Widget({style_class: 'duosnap-separator'});
                    sep.set_position(Math.round(x + GROUP_GAP / 2) - 1, y + 4);
                    sep.set_size(1, rowH - 8);
                    this._card.add_child(sep);
                    x += GROUP_GAP;
                }

                for (const item of group) {
                    const itemY = y + Math.round((rowH - item.h) / 2);
                    this._addItem(item, x, itemY, cardX, cardY);
                    x += item.w + ITEM_GAP;
                }
                x -= ITEM_GAP;
            });

            y += rowH + ROW_GAP;
        });
    }

    _addItem(item, x, y, cardX, cardY) {
        const actor = new St.Widget({
            style_class: item.type === 'tile' ? 'duosnap-tile' : 'duosnap-button',
            layout_manager: item.type === 'tile'
                ? new Clutter.FixedLayout()
                : new Clutter.BinLayout(),
            reactive: false,
        });
        actor.set_position(x, y);
        actor.set_size(item.w, item.h);
        this._card.add_child(actor);

        item.actor = actor;
        item.active = false;
        item.hit = {x: cardX + x, y: cardY + y, width: item.w, height: item.h};

        if (item.type === 'tile') {
            const innerW = item.w - 2 * FILL_INSET;
            const innerH = item.h - 2 * FILL_INSET;
            const [fx, fy, fw, fh] = item.zone.frac;
            const fill = new St.Widget({style_class: 'duosnap-fill', reactive: false});
            fill.set_position(
                FILL_INSET + Math.round(fx * innerW),
                FILL_INSET + Math.round(fy * innerH));
            fill.set_size(
                Math.max(3, Math.round(fw * innerW) - 1),
                Math.max(3, Math.round(fh * innerH) - 1));
            actor.add_child(fill);
            item.fill = fill;
        } else {
            const label = new St.Label({
                style_class: 'duosnap-label',
                text: item.text,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            actor.add_child(label);
            item.label = label;
        }

        this._items.push(item);
    }
}
