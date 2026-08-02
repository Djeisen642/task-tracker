# Icons

`icon.svg` is the master. The platform icon set (PNGs, `.ico`, `.icns`) **is
committed**, because `tauri::generate_context!` embeds those files at compile
time — without them `cargo check` fails with "failed to open icon
`icons/32x32.png`". They are build inputs, not build outputs.

Regenerate whenever the master changes:

```bash
# Rasterize the master (rsvg-convert, ImageMagick, or any renderer):
rsvg-convert -w 1024 -h 1024 src-tauri/icons/icon.svg -o icon-1024.png

# Then let Tauri produce every platform size, including the tray icon:
npm run tauri icon icon-1024.png
```

`npm run tauri icon` also emits `android/` and `ios/` asset folders. This is a
desktop app — delete them rather than committing a few hundred KB of unused
mipmaps.

Keep the design legible at 16×16: at tray size the three task rows read as a
stack of horizontal marks, which is the intent. Don't add fine detail that only
survives at 512×512.
