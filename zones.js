// SPDX-License-Identifier: GPL-2.0-or-later

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const T = 1 / 3;

// One entry per layout, each a complete split of the work area rather than a
// single zone. The tray draws the whole split and the pointer picks a pane
// inside it, which is what keeps the picker from listing every zone at once.
// Order follows ScreenXpert's app switcher: quarters, left/right, top/bottom.
export const TEMPLATES = [
    {
        id: 'quarters',
        setting: 'show-quarters',
        panes: [
            {id: 'q-tl', frac: [0, 0, 0.5, 0.5]},
            {id: 'q-tr', frac: [0.5, 0, 0.5, 0.5]},
            {id: 'q-bl', frac: [0, 0.5, 0.5, 0.5]},
            {id: 'q-br', frac: [0.5, 0.5, 0.5, 0.5]},
        ],
    },
    {
        id: 'halves-v',
        panes: [
            {id: 'left-half', frac: [0, 0, 0.5, 1]},
            {id: 'right-half', frac: [0.5, 0, 0.5, 1]},
        ],
    },
    {
        id: 'halves-h',
        panes: [
            {id: 'top-half', frac: [0, 0, 1, 0.5]},
            {id: 'bottom-half', frac: [0, 0.5, 1, 0.5]},
        ],
    },
    {
        id: 'thirds',
        setting: 'show-thirds',
        panes: [
            {id: 'third-l', frac: [0, 0, T, 1]},
            {id: 'third-c', frac: [T, 0, T, 1]},
            {id: 'third-r', frac: [2 * T, 0, T, 1]},
        ],
    },
];

export function workAreaFor(monitorIndex) {
    return Main.layoutManager.getWorkAreaForMonitor(monitorIndex);
}

export function monitorIndexAt(x, y) {
    const monitors = Main.layoutManager.monitors;
    for (const m of monitors) {
        if (x >= m.x && x < m.x + m.width && y >= m.y && y < m.y + m.height)
            return m.index;
    }
    return Main.layoutManager.primaryIndex;
}

function inset(rect, gap) {
    if (gap <= 0)
        return rect;
    return {
        x: rect.x + gap,
        y: rect.y + gap,
        width: Math.max(1, rect.width - 2 * gap),
        height: Math.max(1, rect.height - 2 * gap),
    };
}

export function fracRect(monitorIndex, frac, gap) {
    const wa = workAreaFor(monitorIndex);
    const [fx, fy, fw, fh] = frac;
    const x = wa.x + Math.round(fx * wa.width);
    const y = wa.y + Math.round(fy * wa.height);
    // Derive the far edge from the fraction too, so adjacent zones meet exactly
    // instead of leaving a rounding seam.
    const right = wa.x + Math.round((fx + fw) * wa.width);
    const bottom = wa.y + Math.round((fy + fh) * wa.height);
    return inset({x, y, width: right - x, height: bottom - y}, gap);
}

// Ordinals in screen order, which is what ScreenXpert labels its screens with
// and therefore what anyone arriving from it already reads fluently.
export function screenOrdinals() {
    return [...Main.layoutManager.monitors]
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .map((m, i) => ({index: m.index, ordinal: `${i + 1}`}));
}

// Nearest monitor whose centre lies in the given direction, so the keybindings
// work on side-by-side setups as well as the Duo's stack.
export function neighbourMonitor(fromIndex, direction) {
    const monitors = Main.layoutManager.monitors;
    const from = monitors[fromIndex];
    if (!from)
        return -1;

    const cy = from.y + from.height / 2;
    let best = -1;
    let bestDist = Infinity;
    for (const m of monitors) {
        if (m.index === fromIndex)
            continue;
        const my = m.y + m.height / 2;
        const delta = my - cy;
        if (direction < 0 ? delta >= 0 : delta <= 0)
            continue;
        const dist = Math.abs(delta);
        if (dist < bestDist) {
            bestDist = dist;
            best = m.index;
        }
    }
    return best;
}
