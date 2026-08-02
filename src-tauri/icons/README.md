# App icons

The icon set referenced by `tauri.conf.json` (`bundle.icon`). The tray reuses the
embedded window icon at runtime.

**These files are build inputs, not build outputs.** `tauri::generate_context!`
embeds them at compile time, so a missing PNG fails `cargo check` with
`failed to open icon icons/32x32.png` — they must stay committed.

## The design

A blue clock dial with a green check inside it and an amber pip at 12 o'clock:
"the hourly check-in". Drawn in the app's own palette — the accent blue of the
card, the amber it uses for work in progress, the green it uses for done — so the
icon and the UI look like the same product. Deliberately not a calendar glyph:
the bottom-right corner of the screen and the calendar metaphor both belong to
the sibling `noticeable-calendar-alert`.

## Two masters, on purpose

| File             | Used for                                                       |
| ---------------- | -------------------------------------------------------------- |
| `icon.svg`       | Everything ≥48px. Thin dial, open at 12 o'clock.               |
| `icon-small.svg` | 16–32px only. Fatter strokes, closed dial, no inner highlight. |

Downscaling the full master to 32px turns its 34px dial stroke into roughly two
pixels and the 12 o'clock gap into noise. The small master is the _same_ icon
with detail dropped and shapes fattened — keep the two in sync when the design
changes.

> Verify this rather than trusting it. Render both at 16/24/32px and view them
> magnified with `image-rendering: pixelated` before committing. Judging a tray
> icon from the 512px artboard is how you ship a smudge.

| Output           | Size      | Rendered from    | Used for                           |
| ---------------- | --------- | ---------------- | ---------------------------------- |
| `32x32.png`      | 32×32     | `icon-small.svg` | Windows window/tray icon           |
| `128x128.png`    | 128×128   | `icon.svg`       | Linux window icon                  |
| `128x128@2x.png` | 256×256   | `icon.svg`       | HiDPI                              |
| `icon.png`       | 1024×1024 | `icon.svg`       | Default icon + `tauri icon` source |
| `icon.ico`       | multi     | both             | Windows executable/installer       |
| `icon.icns`      | multi     | `icon.svg`       | macOS bundle                       |

## Regenerating

```bash
# From the project root — `tauri icon` crashes if run from inside this folder.
rsvg-convert -w 1024 -h 1024 src-tauri/icons/icon.svg -o src-tauri/icons/icon.png
npx tauri icon src-tauri/icons/icon.png
```

`tauri icon` rasterizes **every** platform format from that one source, which
means it will happily overwrite the hand-tuned small art and scatter assets this
desktop app never ships. Always follow it with:

```bash
cd src-tauri/icons
rm -rf android ios 64x64.png Square*.png StoreLogo.png     # unused Appx/mobile assets

# Restore the hand-tuned sizes that `tauri icon` just clobbered.
rsvg-convert -w 32   -h 32   icon-small.svg -o 32x32.png
rsvg-convert -w 128  -h 128  icon.svg       -o 128x128.png
rsvg-convert -w 256  -h 256  icon.svg       -o '128x128@2x.png'
rsvg-convert -w 1024 -h 1024 icon.svg       -o icon.png
```

### The `.ico`

`tauri icon` derives every sub-size in the `.ico` from the single detailed
source, so its 16 and 32px entries get the blurry art — which is exactly the
entry Windows shows in the taskbar. Assemble it from per-size PNGs instead, small
master for the small entries:

```bash
for s in 16 24 32; do rsvg-convert -w $s -h $s icon-small.svg -o /tmp/$s.png; done
for s in 48 64 128 256; do rsvg-convert -w $s -h $s icon.svg -o /tmp/$s.png; done
npx png-to-ico /tmp/16.png /tmp/24.png /tmp/32.png /tmp/48.png \
               /tmp/64.png /tmp/128.png /tmp/256.png > icon.ico
```

Keep `icon.icns` from `tauri icon` — macOS is not a target platform here, so its
small entries aren't worth hand-tuning.

## Rasterizer notes

- An `objectBoundingBox` gradient collapses on any shape with a zero-width or
  zero-height bounding box (a perfectly vertical or horizontal stroked line) and
  silently renders black. Both masters use `gradientUnits="userSpaceOnUse"`.
- Headless-Chromium screenshots come out blank below roughly a 200px viewport;
  use a real rasterizer (`rsvg-convert`, `@resvg/resvg-js`, Inkscape) for the
  small sizes rather than a browser screenshot.
