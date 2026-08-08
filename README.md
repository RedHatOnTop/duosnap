# Duo Snap

A GNOME Shell 50 extension that gives a dual-screen laptop the two things Windows
has and GNOME does not: a snap-layout picker that appears while you drag a window,
and a one-gesture "maximize on the other screen" target. Written for an ASUS
Zenbook Duo UX8406MA (two stacked 1920x1200 panels, 1.25 scale), but nothing in it
is hardcoded to that machine.

## What it does

Start dragging a window and a picker fades in at the top of whichever screen the
pointer is over:

- **Row 1** — full, left half, right half, top half, bottom half
- **Row 2** — the four quarters, then the three vertical thirds
- **Row 3** — one maximize target per screen, labelled `Top` / `Bottom` when the
  monitors are stacked in a column and `Screen 1` / `Screen 2` otherwise

Hovering a target outlines the exact rectangle the window will land in. Releasing
the button snaps it there; releasing anywhere else leaves the drag alone, so
GNOME's own edge tiling still works as usual.

The picker follows the pointer across screens, so you can throw a window from the
lower panel to the upper one without ever letting go of the button.

### Keyboard

| Shortcut | Action |
| --- | --- |
| <kbd>Super</kbd>+<kbd>Ctrl</kbd>+<kbd>↑</kbd> | Maximize on the screen above |
| <kbd>Super</kbd>+<kbd>Ctrl</kbd>+<kbd>↓</kbd> | Maximize on the screen below |

Both are rebindable in the extension's preferences.

### Preferences

`gnome-extensions prefs duosnap@local` — toggle the picker, set how long a drag has
to last before it appears, drop the quarter/third/screen rows you do not use, and
set a gap to leave around every snapped window.

## What it deliberately does not do

There is no "stretch across both screens" target. Mutter clamps every window to a
single monitor's work area: asking for 1536x1888 on this machine yields 1536x928,
and the clamp applies to Wayland and X11 clients alike, in both axes, whether or
not the resize is flagged as a user action. A span target would silently do
something other than what it promised, so it is not offered.

## Notes on the implementation

Mutter owns the pointer for the duration of a move grab, so the picker never
receives crossing events of its own. Instead `extension.js` polls `global.get_pointer()`
on a 16 ms timer that only lives as long as the grab, and `overlay.js` hit-tests
against rectangles it computed itself when laying the card out. That is also why
the card is built from fixed-position children rather than a box layout — the hit
rectangles have to be known exactly, not inferred from an allocation.

Snapping happens in a `BEFORE_REDRAW` later rather than directly in `grab-op-end`,
because at that point mutter has not finished placing the window it was dragging
and an immediate `move_resize_frame` gets overwritten.

Full-monitor targets go through `maximize()` rather than an equivalent
`move_resize_frame`, so the window ends up genuinely maximized and unmaximizes the
way the user expects. That is skipped when a window gap is configured, since a
maximized window cannot have one.

## Development

GNOME Shell caches extension ES modules by URL and cannot be restarted in place on
Wayland, so edits are tested against a throwaway nested shell rather than the live
session:

```
gnome-shell --headless --wayland-display=duosnap-test \
    --virtual-monitor 1920x1200 --virtual-monitor 1920x1200
```

with `XDG_DATA_HOME`/`XDG_CONFIG_HOME` redirected so its dconf and extension set
stay isolated, `gdctl` to stack the two virtual monitors at 1.25 scale, and a
second throwaway extension that flips `global.context.unsafe_mode` so the test
driver can reach the shell over `org.gnome.Shell.Eval`. Drags are synthesised with
a `Clutter` virtual pointer device; a real drag needs interpolated motion, as a
couple of large jumps never crosses GTK's drag threshold.
