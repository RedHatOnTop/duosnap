import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Fractional rects [x, y, w, h] inside a monitor work area.
export const LAYOUT_ZONES = [
    {id: 'full', frac: [0, 0, 1, 1]},
    {id: 'left-half', frac: [0, 0, 0.5, 1]},
    {id: 'right-half', frac: [0.5, 0, 0.5, 1]},
    {id: 'top-half', frac: [0, 0, 1, 0.5]},
    {id: 'bottom-half', frac: [0, 0.5, 1, 0.5]},
];

export const QUARTER_ZONES = [
    {id: 'q-tl', frac: [0, 0, 0.5, 0.5]},
    {id: 'q-tr', frac: [0.5, 0, 0.5, 0.5]},
    {id: 'q-bl', frac: [0, 0.5, 0.5, 0.5]},
    {id: 'q-br', frac: [0.5, 0.5, 0.5, 0.5]},
];

const T = 1 / 3;

export const THIRD_ZONES = [
    {id: 'third-l', frac: [0, 0, T, 1]},
    {id: 'third-c', frac: [T, 0, T, 1]},
    {id: 'third-r', frac: [2 * T, 0, T, 1]},
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

// Monitors stacked in one column get "Top"/"Bottom" instead of ordinals — the
// Zenbook Duo's two panels are the whole reason this extension exists.
export function screenLabels() {
    const monitors = [...Main.layoutManager.monitors].sort((a, b) => a.y - b.y || a.x - b.x);
    const stacked = monitors.length === 2 &&
        monitors.every(m => m.x === monitors[0].x && m.width === monitors[0].width) &&
        monitors[0].y !== monitors[1].y;

    return monitors.map((m, i) => ({
        index: m.index,
        label: stacked ? (i === 0 ? 'Top' : 'Bottom') : `Screen ${i + 1}`,
        glyph: stacked ? (i === 0 ? '▲' : '▼') : `${i + 1}`,
    }));
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
