# Duo Snap

A GNOME Shell 50 extension that gives a dual-screen laptop the two things Windows
has and GNOME does not: a snap-layout picker that appears while you drag a window,
and a one-gesture "maximize on the other screen" target. Written for an ASUS
Zenbook Duo UX8406MA (two stacked 1920x1200 panels, 1.25 scale), but nothing in it
is hardcoded to that machine.

## Installing

```
git clone <this repo> ~/.local/share/gnome-shell/extensions/duosnap@local
glib-compile-schemas ~/.local/share/gnome-shell/extensions/duosnap@local/schemas
gnome-extensions enable duosnap@local
```

The compiled schema is not checked in, so the second line is not optional — without
it the extension fails to load its settings. GNOME Shell cannot be restarted in
place on Wayland, so log out and back in before it appears.

## What it does

Start dragging a window and a picker fades in at the top of whichever screen the
pointer is over. It asks two questions in the order ScreenXpert's app switcher
asks them — which screen, then which shape:

- **Screen row** — one number per monitor, in screen order, the way ScreenXpert
  numbers them. A number is itself the "maximize on that screen" target; the plate
  behind it is only drawn once the pointer is on it.
- **Layout tray** — under each number is a grip, and entering it raises that
  screen's layouts: quarters, left and right halves, top and bottom halves,
  vertical thirds. Each is a miniature of the screen split into every pane it
  offers, and hovering a pane outlines the exact rectangle the window will land
  in. Releasing on a grip snaps nothing; it is a way in, not a destination. Going
  back up to the screen row puts the tray away again.

So nothing but the screens is on offer until a screen has been chosen, and the
layouts that then appear belong to that screen — which means a window can be
thrown into the bottom panel's bottom-right quarter without the pointer ever
leaving the top panel. Releasing anywhere outside the picker leaves the drag
alone, so GNOME's own edge tiling still works as usual.

The picker follows the pointer across screens. With one monitor connected there is
nothing to choose between, so the screen row is dropped and the tray is shown
straight away.

### Keyboard

| Shortcut | Action |
| --- | --- |
| <kbd>Super</kbd>+<kbd>Ctrl</kbd>+<kbd>↑</kbd> | Maximize on the screen above |
| <kbd>Super</kbd>+<kbd>Ctrl</kbd>+<kbd>↓</kbd> | Maximize on the screen below |

Both are rebindable in the extension's preferences.

### Preferences

`gnome-extensions prefs duosnap@local` — toggle the picker, set how long a drag has
to last before it appears, drop the quarters or thirds layouts, and set a gap to
leave around every snapped window. Halves are always offered.

## What it deliberately does not do

There is no "stretch across both screens" target. Mutter clamps every window to a
single monitor's work area: asking for 1536x1888 on this machine yields 1536x928,
and the clamp applies to Wayland and X11 clients alike, in both axes, whether or
not the resize is flagged as a user action. A span target would silently do
something other than what it promised, so it is not offered.

## Notes on the implementation

The look is taken from ScreenXpert's app switcher rather than from the shell's own
menus: light panels, hairline grey borders, grey panes, and one solid navy for
whatever is selected. It is deliberately not Adwaita — a picker that reads as part
of the desktop chrome is a picker you lose track of mid-drag.

Mutter owns the pointer for the duration of a move grab, so the picker never
receives crossing events of its own. Instead `extension.js` polls `global.get_pointer()`
on a 16 ms timer that only lives as long as the grab, and `overlay.js` hit-tests
against rectangles it computed itself when laying the card out. That is also why
the card is built from fixed-position children rather than a box layout — the hit
rectangles have to be known exactly, not inferred from an allocation.

The screen row and the tray are separate surfaces rather than one card that grows,
because a card that grew would re-centre and drag the screen blocks sideways out
from under a pointer already moving toward one. Aiming the tray at a screen
changes nothing but the monitor its panes resolve against, so it is repositioned
and never rebuilt, and pane hit rectangles are stored relative to it. They tile a
template's full miniature, seams and border included, so there is nowhere inside a
template that selects nothing.

The grip is a drawn mark rather than a hot strip of card because a reveal the eye
cannot find is not a reveal. It keeps a lit state for as long as the tray it
opened is up, so it is clear which screen the layouts on offer belong to. Below it,
down to the top of the tray, is an undrawn band that counts as the same target,
widened by half the gap between columns so the bands meet: a pointer travelling
straight down to the tray never falls out of the reveal and closes it.

Snapping happens in a `BEFORE_REDRAW` later rather than directly in `grab-op-end`,
because at that point mutter has not finished placing the window it was dragging
and an immediate `move_resize_frame` gets overwritten.

Full-screen targets go through `maximize()` rather than an equivalent
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

run under `dbus-run-session` with `XDG_DATA_HOME`/`XDG_CONFIG_HOME` redirected so
its dconf and extension set stay isolated, `gdctl` to stack the two virtual
monitors at 1.25 scale, and a second throwaway extension that flips
`global.context.unsafe_mode` and hands the test driver a `globalThis` bridge —
`org.gnome.Shell.Eval` runs outside any module scope, so since GNOME 45 there is
no other way to reach `Main` or the extension object from it.

Clutter virtual pointer events move the shell's own pointer in that headless
session but are never delivered to Wayland clients, so a client cannot be made to
request a move grab and the drag gesture itself cannot be synthesised. The driver
emits `grab-op-begin` and `grab-op-end` on `global.display` instead and walks the
virtual pointer between them, which exercises every line of the extension on a
real window.
