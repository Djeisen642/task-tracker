# CLAUDE.md

Guidance for working in this repository. Read this before making changes.

## What this is

**Task Tracker** — an ultra-lightweight Windows system-tray utility that prompts
you every hour during your workday to log what you're doing: add upcoming tasks,
move in-progress ones to done, and jot notes. At work start it shows the day's
list prominently; at work end it asks for the final update and tomorrow's plan.

**The vault is the product.** Everything is stored as plain Markdown, one file
per day, in a folder you can point an AI agent at. The app is a pleasant way to
fill that folder; the folder is what answers "what did I do this year?" and
"what has my report been up to?" in December.

**Stack (deliberate):** Tauri v2 + Vanilla TypeScript + Vite. **No React, no UI
framework** — the app runs all day, so idle memory matters. Do not introduce a
framework.

## The quality bar (definition of done)

A change is **not done** until all of the following are true. Do not report
something as finished or "working" unless you have run these and seen them pass.

1. **`npm run check` passes** — format, lint (type-aware), `tsc --noEmit`, and
   the unit tests.
2. **`npm run build` passes** — a green lint/test run does **not** prove the app
   bundles. Check both.
3. **New logic has a unit test.** Pure logic lives in `src/lib/*.ts` and must be
   tested in a sibling `*.test.ts`. Bugs get a regression test.
4. **Rust changes pass the Rust gate.** In `src-tauri`: `cargo fmt --check`,
   `cargo clippy --all-targets -- -D warnings`, `cargo check`, `cargo test`.
   All four run in CI, and all four work in this sandbox once the GTK/WebKit dev
   packages are installed — so run them, don't defer to CI.
5. **Vault format changes round-trip and preserve hand edits.** The day file is
   the only copy of that data. `parseDay(serializeDay(doc))` must equal `doc`,
   and content the app doesn't own must survive a write untouched.
6. **Adversarial self-review before declaring victory.** Re-read your own diff
   hunting for the bug that breaks the _app_, not the lint nit. The CSP/stylesheet
   trap below is a real example that passes every automated gate.

### Verify, don't assume

- **Never trust training-cutoff memory for versions or API surfaces.** Check the
  live registry (`npm view <pkg> version`), installed type defs, and release
  pages for GitHub Actions before pinning or calling anything.
- **Newest is not always correct — check peer ranges.** TypeScript is pinned to
  `~6.0.3` even though 7.x is released, because `typescript-eslint` declares
  `typescript: ">=4.8.4 <6.1.0"`. Bumping past that silently disables type-aware
  linting rather than failing loudly. Re-check that peer range before raising it.
- **Distinguish "reviewed-correct" from "verified-running."** Say which one you
  mean. Don't claim a desktop behavior works if you only reasoned about it.

## Architecture

```
src/
  main.ts               # CheckInController: scheduler tick + serialized vault writes
  styles.css            # Transparent window; top-left slide-in check-in card
  lib/
    dates.ts(.test)      # Local-date/clock helpers, ISO week math
    time.ts              # Millisecond constants
    tasks.ts(.test)      # Task model, status cycle, carry-over
    schedule.ts(.test)   # Slot-based check-in scheduler (the heart of the app)
    settings.ts(.test)   # Settings model + defensive parsing
    vault.ts(.test)      # VaultPort seam, day load/save, MemoryVault fake
    errors.ts(.test)     # describeError() for native dialogs
    tauri.ts             # Optional native bridge; degrades gracefully in a browser
    markdown/
      frontmatter.ts(.test)  # Tiny scalar-only YAML frontmatter reader/writer
      day.ts(.test)          # The day file: parse/serialize, preserves hand edits
      mentions.ts(.test)     # @person / #tag extraction
      rollup.ts(.test)       # Standup summary + weekly rollup
      context-doc.ts         # CONTEXT.md — the schema guide for agents
src-tauri/
  src/lib.rs            # Tray, window, top-left positioning, attention request
  src/vault.rs          # Vault file I/O (atomic writes) + settings persistence
  src/main.rs           # Binary entry point
  tauri.conf.json       # Transparent, alwaysOnTop, skipTaskbar, hidden-until-needed
  capabilities/         # Least-privilege permission set
docs/
  future-work.md        # Everything planned, with the MVP line
```

### Key design decisions (don't regress these)

- **Slots, not intervals.** `schedule.ts` derives check-in _slots_ from the work
  window and asks "which slot is current, and was it handled?". A
  `setInterval(HOUR)` breaks on sleep/wake — close the lid at 11:55, reopen at
  15:30, and you either get nothing or four stacked prompts. Slots collapse a
  missed stretch to exactly one prompt and make a mid-day launch correct
  immediately. Never replace this with a plain timer.
- **The first check-in of a day is always a `day-start`, whatever the hour.**
  `currentSlot` picks a kind from the clock; `dueCheckIn` upgrades an `hourly`
  slot to `day-start` when nothing has been handled that date yet. Otherwise
  booting at 11:30 — machine off at 09:00, or a late start — serves a routine
  nudge and the user never sees their day or what carried over. The upgrade keeps
  the _current_ slot's key, so finishing it doesn't leave 11:00 outstanding.
- **Scheduler state is persisted in the day file, not in memory.** The handled
  slot is written as `last_check_in` in frontmatter and restored on launch. The
  app must survive reboots, Windows updates and its own crashes mid-workday;
  without this it relaunches believing nothing was handled and re-prompts for a
  check-in the user already completed. A snooze is deliberately _not_ restored.
- **The Markdown is the source of truth.** Not a cache, not an export. If a
  SQLite index is ever added it must be _derived_ and rebuildable — never written
  before the Markdown. See `docs/future-work.md`.
- **Hand edits survive.** `parseDay`/`serializeDay` preserve unowned sections and
  frontmatter keys verbatim. You or an agent may edit a day file directly, and
  the next app write must not eat it.
- **Writes are atomic and serialized.** Rust writes to a temp file and renames
  (a day file is the only copy of that day's notes); `main.ts` chains every save
  through `this.writes` so concurrent edits can't interleave.
- **The check-in window takes focus.** Unlike the sibling calendar overlay, this
  one is typed into — so it is _not_ click-through, and it deliberately occupies
  the **top-left** corner, because bottom-right belongs to
  noticeable-calendar-alert. Two utilities in one corner means ignoring both.
- **The frontend must run framework-free in a plain browser too.** Every native
  call in `tauri.ts` is guarded by `isTauri()` and degrades to a no-op or a
  browser equivalent (the vault falls back to `localStorage`). This keeps
  `npm run dev` a fast iteration loop with no Rust build.
- **Link the stylesheet from `index.html`; never `import './styles.css'`.** A JS
  CSS import injects a `<style>` tag in dev, which the app's `style-src 'self'`
  CSP blocks. That breaks only in the desktop webview — never in lint, tests, or
  a browser `npm run dev`.
- **Filenames are validated in Rust.** `is_safe_name` in `src-tauri/src/vault.rs`
  is the security boundary; the TypeScript `isSafeVaultName` is an early-failure
  convenience. Keep both in sync, and never widen the Rust one to a general path.
- **Security: vault content is untrusted.** Task titles and notes round-trip
  through files other tools can write, so they are rendered with `textContent`,
  never `innerHTML`.
- **Tauri permissions need a _scope_, not just the permission.** A bare
  capability string enables the command but leaves its allowlist empty, so every
  call is denied at runtime — and only on a real desktop run, never in
  lint/tests/`npm run dev`. Plugins that take a scope (opener, fs, http) must
  list their allowed targets in `capabilities/default.json`. This app avoids the
  problem by doing file and opener work in app-defined Rust commands, which
  don't pass through the capability system in v2.
- **Surface native-side failures in a dialog, not `console.error`.** Check-ins
  fire from a timer while the window is hidden, so console logs and a webview
  `alert()` are invisible. Route user-facing errors through `showError()`.
- **Motion is GPU-only.** Animate `transform`/`opacity` exclusively; never
  animate layout properties. Respect `prefers-reduced-motion`.

## Commands

| Command                | Purpose                                         |
| ---------------------- | ----------------------------------------------- |
| `npm install`          | Install deps + git hooks (`prepare` → lefthook) |
| `npm run dev`          | Browser-only preview of the card (no Rust)      |
| `npm run tauri dev`    | Full desktop app (needs Rust + Tauri prereqs)   |
| `npm run check`        | format + lint + typecheck + test (the web gate) |
| `npm run build`        | `tsc --noEmit` + `vite build`                   |
| `npm run test:watch`   | Vitest in watch mode                            |
| `npm run tauri icon X` | Regenerate the platform icon set from `X.png`   |

Git hooks (Lefthook) auto-run eslint `--fix`, prettier, and project `tsc` on
staged files at commit time.

## TypeScript conventions

- `verbatimModuleSyntax` is on → use `import type { … }` for type-only imports.
- Imports use explicit `.ts` extensions (`./lib/vault.ts`); Vite resolves them.
- `@typescript-eslint/no-floating-promises` is an error → `void` deliberate
  fire-and-forget promises.
- Unused args/vars must be `_`-prefixed.
- The config is strict (`strict`, `noUnusedLocals/Parameters`,
  `noImplicitReturns`, `noImplicitOverride`). Don't loosen it to dodge an error.
- `restrict-template-expressions` is on: wrap numbers in `String(…)` inside
  template literals rather than relying on implicit coercion.

## What CANNOT be verified in the agent sandbox

The Rust **does** compile here: `cargo check`, `cargo test`, `cargo clippy
--all-targets -- -D warnings` and `cargo fmt --check` all pass, and `Cargo.lock`
is committed (CI runs `--locked`). Run them before pushing Rust changes rather
than waiting for CI.

What this environment lacks is a **desktop webview and a Windows machine**, so
the following are _reviewed for correctness but never executed_. Verify each on
real hardware before trusting it. The full list lives in `docs/future-work.md`
under "Known unknowns"; the headlines:

- **Windows foreground activation.** `SetForegroundWindow` is refused for a
  process that hasn't received recent user input — exactly a timer firing at
  14:00. `show()` + `set_focus()` + `request_user_attention()` is the mitigation,
  but whether the card lands _focused and ready to type_ is the most important
  thing to test on-device.
- **The transparent, always-on-top, `skipTaskbar` window** behaving as configured
  on Windows 11, including top-left placement on a multi-monitor, mixed-DPI setup.
- **Tray icon + menu** rendering, and each item's event reaching the webview.
- **The autostart plugin** registering at login, and clipboard writes from a
  hidden window.

When you touch any of the above, say explicitly in your summary that it is
reviewed-but-unrun, and list what the user must check on-device.
