# CLAUDE.md

Guidance for working in this repository. Read this before making changes.

## What this is

**Task Tracker** — an ultra-lightweight system-tray utility (Windows tray, macOS
menu bar, Linux panel) that prompts you every hour during your workday to log
what you're doing: add upcoming tasks, move in-progress ones to done, and jot
notes. At work start it shows the day's
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

1. **`pnpm run check` passes** — format, lint (type-aware), `tsc --noEmit`, and
   the unit tests.
2. **`pnpm run build` passes** — a green lint/test run does **not** prove the app
   bundles. Check both.
3. **New logic has a unit test.** Pure logic lives in `src/lib/*.ts` and must be
   tested in a sibling `*.test.ts`. Bugs get a regression test.
4. **`pnpm run e2e` passes** — the app actually runs. Unit tests prove the logic;
   only this proves the controller finds its elements and that clicks reach the
   model. A blank-window regression passes every other gate. Invoke the
   `verify-app` skill, and **look at `docs/screenshots/`** — a capture once
   silently showed the wrong prompt, which no assertion had caught.
   If _every_ spec fails in ~3ms, that is a missing browser, not your change:
   Playwright wants a version the image doesn't ship. Point it at the one that
   is there — `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium-<ver>/chrome-linux/chrome`
   (`ls /opt/pw-browsers` for the version). Never run Playwright's browser
   installer here, under either `pnpm exec` or `npx` — it fails on the network
   after several wasted minutes.
5. **Rust changes pass the Rust gate.** In `src-tauri`: `cargo fmt --check`,
   `cargo clippy --all-targets -- -D warnings`, `cargo check`, `cargo test`.
   All four run in CI, and all four work in this sandbox once the GTK/WebKit dev
   packages are installed — so run them, don't defer to CI.
6. **Vault format changes round-trip and preserve hand edits.** The day file is
   the only copy of that data. `parseDay(serializeDay(doc))` must equal `doc`,
   and content the app doesn't own must survive a write untouched.
7. **Adversarial self-review before declaring victory.** Re-read your own diff
   hunting for the bug that breaks the _app_, not the lint nit. The CSP/stylesheet
   trap below is a real example that passes every automated gate.
8. **If the change moves something across the MVP line, re-read `README.md`.**
   Nothing fails when it drifts, so it drifts silently and always in the same
   direction — claiming shipped work doesn't exist. It once told readers there
   was no settings UI and to hand-edit `settings.json`, months after the panel
   shipped with e2e coverage. Check the Status section, the feature it describes,
   and the tray-menu list against the menu actually built in `src-tauri/src/lib.rs`.
   Test counts in prose go stale the same way; either update them or don't cite
   them.

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
  main.ts               # CheckInController: scheduler tick, serialized vault writes, settings panel
  styles.css            # Transparent window; top-left slide-in check-in card + settings overlay
  lib/
    dates.ts(.test)      # Local-date/clock helpers, ISO week math
    time.ts              # Millisecond constants
    tasks.ts(.test)      # Task model, status cycle, carry-over
    schedule.ts(.test)   # Slot-based check-in scheduler (the heart of the app)
    settings.ts(.test)   # Settings model, defensive parsing, panel draft + validation
    tray.ts(.test)       # The tray's status line
    vault.ts(.test)      # VaultPort seam, day load/save, MemoryVault fake
    errors.ts(.test)     # describeError() for native dialogs
    tauri.ts             # Optional native bridge; degrades gracefully in a browser
    markdown/
      frontmatter.ts(.test)  # Tiny scalar-only YAML frontmatter reader/writer
      sections.ts(.test)     # Owned-vs-unowned section split; what a write preserves
      task-line.ts(.test)    # The checkbox grammar both file formats share
      day.ts(.test)          # The day file: parse/serialize, preserves hand edits
      team.ts(.test)         # team.<person>.md: one running file per report
      mentions.ts(.test)     # @person / #tag extraction
      rollup.ts(.test)       # Standup summary + weekly rollup
      context-doc.ts         # CONTEXT.md — the schema guide for agents
src-tauri/
  src/lib.rs            # Tray, window, top-left positioning, attention request
  src/vault.rs          # Vault file I/O (atomic writes) + settings persistence
  src/main.rs           # Binary entry point
  tauri.conf.json       # Transparent, alwaysOnTop, skipTaskbar, hidden-until-needed
  capabilities/         # Least-privilege permission set
e2e/
  harness.ts            # startApp(): frozen clock + seeded localStorage vault
  checkin.spec.ts       # The check-in loop, driven in a real browser
  priorities.spec.ts    # The top five: star, reorder, renumber, carry over
  settings.spec.ts      # The settings panel: validation, persistence, live effect
  team.spec.ts          # The Team panel and the day-end manager step
  expand.spec.ts        # The card's expand toggle
  capture.spec.ts       # Screenshots into docs/screenshots/
scripts/
  version.ts(.test)              # The version, derived from the commit subjects
  commit-msg.ts                  # The hook that holds a subject to that grammar
  backfill-provenance.ts(.test)  # One-shot: reconstruct task `added` dates in a
                                 # pre-v2 vault. NOT app code — see below.
docs/
  future-work.md        # Everything planned, with the MVP line
  screenshots/          # Regenerated by `pnpm run e2e -- capture`
.claude/skills/
  verify-app/           # How to run and look at the app
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
- **The working week is a list, not a weekend flag.** `settings.workDays` holds
  `Date.getDay()` numbers, because "the weekend" is Friday/Saturday in much of
  the world and plenty of people work four days or Tuesday-to-Saturday. Parsing
  still understands the superseded `includeWeekends` boolean.
- **The copy has to know about the weekend too, not just the scheduler.** The
  wrap-up asks you to plan `describeNextWorkingDay(…)` — "tomorrow" midweek,
  "Monday" on a Friday. Asked on a Friday to "plan tomorrow" you either plan a
  Saturday you won't work or you ignore the prompt, and the point of the day-end
  check-in is that the next working morning opens with a list already on it.
- **"The end of the week" is the longest gap in `workDays`, not an ISO
  boundary.** `endsWorkingWeek` is what upgrades the headline to "Wrapping up the
  week". Comparing ISO weeks gets a Sunday-to-Thursday week exactly backwards
  (Thursday and the following Sunday share an ISO week, so the label lands on the
  day the week _starts_), and "the next working day isn't tomorrow" fires every
  Tuesday for someone who takes Wednesdays off. The longest gap is right for all
  four shapes.
- **Weekly rollups are derived and self-healing.** They refresh on every check-in
  and, on the first check-in of a new week, rebuild the previous week too. Written
  only at `day-end`, a week whose last working day never got a wrap-up produced no
  rollup at all — and the rollups are what make a year of day files reviewable.
- **Scheduler state is persisted in the day file, not in memory.** The handled
  slot is written as `last_check_in` in frontmatter and restored on launch. The
  app must survive reboots, Windows updates and its own crashes mid-workday;
  without this it relaunches believing nothing was handled and re-prompts for a
  check-in the user already completed. A snooze is deliberately _not_ restored.
- **The clipboard briefing carries its own schema; `CONTEXT.md` does not travel.**
  `agentWeekBriefing` prepends the notation key to the weekly rollup because it
  is pasted into a chat with an agent that will never see the vault. That is also
  why it returns `null` for an empty week rather than a body of "Nothing" bullets
  — those read as authoritative and say nothing. Don't collapse it into
  `weeklyRollup`, whose output lands _in_ the folder next to the guide.
- **A task is identified by reference, not by its title.** `sameTask` ignores
  case and surrounding whitespace, which is right for "don't add this twice"
  and wrong for "which row did the user just click" — a hand-edited file holding
  `- Ship it` and `- [ ] ship it` is two lines and two rows. Every mutator takes
  the `Task` object: `setTaskStatus`, `removeTask`, `togglePriority` and
  `movePriority`. The last one needs care — it normalizes first, and
  `normalizePriorities` returns a _new_ object for every rank it changes, so the
  caller's reference is stale by then. It resolves `tasks.indexOf(target)`
  against the array it was handed, before normalizing; the index survives
  because normalize is a `map`.
- **Ranking is optional, and the ranks are dense over the _open_ tasks.**
  `normalizePriorities` in `tasks.ts` is the whole feature: it renumbers to
  `1…n`, strips the rank from anything completed, and drops anything past
  `MAX_PRIORITIES`. Every mutator (`setTaskStatus`, `removeTask`,
  `togglePriority`, `carryOverTasks`) calls it, and `openDay` runs it once as
  the app takes ownership of today's file, so no caller has to remember —
  finishing your number two promotes number three instead of leaving the list
  reading `1, 3, 4`. The deliberate exceptions are `addTask` (adds nothing
  ranked) and `parseDay`, which repairs nothing because reading a file is not
  the moment to rewrite it. `priorityTasks` is open-only for the same reason:
  five ranks a hand edit left on finished work must not report the top five as
  full when the card has nothing ranked to show. Two
  things follow that are easy to "fix" and shouldn't be: a day where nothing was
  ranked writes no `_(priority …)_` anywhere (that is what makes the feature
  optional rather than another field to fill in), and a full list refuses a
  sixth rather than evicting number five, because five was a decision.
- **Reordering is two buttons and a keyboard shortcut, not drag-and-drop.** The
  ranked list is at most five rows in a 420px window, and a drag would still
  need a keyboard equivalent to be usable at all — so ▲▼ (plus Alt+↑/↓ from any
  control on the row; the `li` itself is not focusable) is the whole feature
  rather than half of it. Three things it rests on, each of which was a bug
  first:
  - **`render()` hands focus back to the same control** after rebuilding the
    list (`captureRowFocus`/`restoreRowFocus`), so the second press has
    something to land on. Rows are matched by comparing `dataset` values, never
    by building a selector out of a task title — vault content is untrusted.
  - **Only when the keyboard is driving** (`keyboardDriven`). Restoring focus
    after a _mouse_ click arms a control that draws no ring and is invisible
    once the pointer leaves the row, so the next Space or Enter re-fires it —
    a task's status silently cycling in the only copy of that day's notes.
  - **Unavailable controls are `aria-disabled`, not `disabled`** (`setInert`).
    A `disabled` button drops focus the instant the attribute lands, which
    happens mid-gesture as a task reaches the top; focus then fell to the row's
    _other_ arrow and the next press sent it back down. Every handler on such a
    control must check the attribute itself, because the click still arrives.
- **The mouse and the keyboard differ here, and the docs must say so.** Focus
  follows the row, a pointer does not: click ▲ and the displaced task lands
  under the cursor, so a second click in the same spot undoes the first. Alt+↑
  repeats cleanly; the mouse needs re-aiming. Don't write "click it three times
  to reach the top" again.
- **The row's controls are under WCAG 2.5.8's 24×24px target size, knowingly.**
  Four of them (▲▼★×) at 24px would be 96px of a 420px row, taken from the task
  title. They are 17–18px wide and 21px tall, at `--ink-dim` rather than the
  faint grey the × used, which is the most that fits. If the card ever gets
  wider, this is the first thing to spend it on.
- **The rank renders inline; nothing is reserved for it.** The first cut gave
  every row a leading star column, hidden until hover — which indented every
  task on the card by 24px on days nobody ranked, i.e. most of them. The number
  is now a `.task-rank` span present only on ranked rows, and the star that sets
  it sits with the remove button inside `.task-controls`, revealed on hover or
  focus. What an unranked day does still pay is the star's own width: a task
  title is ~293px against ~312px before the feature (measured at the real
  420×470 window), which is why the trailing controls share one tight flex box
  instead of each sitting in the row's 9px gap. Measure it before adding a
  fourth control, and look at `day-start.png` — its rows are the unranked case.
- **The Markdown is the source of truth.** Not a cache, not an export. If a
  SQLite index is ever added it must be _derived_ and rebuildable — never written
  before the Markdown. See `docs/future-work.md`.
- **Hand edits survive — including inside the sections the app owns.** Whole
  unowned sections and frontmatter keys were always preserved; everything else
  in the file was not, and the app rewrites that file on every check-in. Three
  kinds of content were silently deleted: anything above the first `##` heading,
  a `###` subheading and its body (that is section _content_, not a section),
  and any line inside `## Tasks`/`## Notes` that wasn't an item. They now live
  in `DayDocument.preserved` / `TeamMemberDocument.preserved`, split into what
  _led_ the item list and what _followed_ it — a `### Morning` subheading
  re-emitted below the tasks it labels reads as a bug even though nothing was
  lost. Those are the two positions that survive the app reordering its own
  items; a paragraph written between two tasks still lands at the end. The
  content is the guarantee, its exact line number is not. Anything new that
  reads a section must keep what it doesn't model.
- **A task is identified by reference, not by its title.** `sameTask` ignores
  case and surrounding whitespace, which is right for "don't add this twice"
  and wrong for "which row did the user just click" — a hand-edited file
  holding `- Ship it` and `- [ ] ship it` is two lines and two rows, and
  `setTaskStatus`/`removeTask` used to hit both. They take the `Task` object
  now. Titles remain the key for adding, carrying over, and the team file's
  `completedDates`, which is the same bug one level down and is written up in
  `docs/future-work.md`.
- **Structure detection stops at a code fence or an HTML comment.**
  `maskedLines` in `sections.ts` marks those regions, and the heading split and
  both item parsers skip them. Without it a file that _quotes this format_ — a
  pasted snippet, a schema reminder from `CONTEXT.md` — had its fenced
  `## Tasks` treated as the real heading, so the user's actual list became an
  unowned section and the card showed the example task instead. A parked
  `<!-- - [ ] not yet -->` came back as live work the same way. An _unclosed_
  fence is deliberately not masked: a stray ``` in prose would otherwise swallow
  the rest of the file. Masked lines are never dropped — they take the same
  preserved path as any other unmodelled line.
- **A marker the app doesn't model is read as upcoming and written back
  unchanged.** `[-]`, `[>]` and friends mean cancelled or deferred to whoever
  wrote them. Reading them is what makes them visible; rewriting them as `[ ]`
  turned somebody's cancelled item into live work that then carried forward
  every day. `Task.marker` holds the character until the status actually
  changes, at which point the app does know what the line means.
- **An indented bullet is not a task.** The model is flat, so parsing a
  sub-bullet promoted it to a peer of its parent and dropped the indentation
  from the file — a hierarchy the vault could no longer express. It is
  preserved as written instead. Depth is judged against the _first_ item in the
  section, so a list that is wholly indented is still a list of tasks.
- **The grammar the two formats share lives in one module each.**
  `task-line.ts` holds the checkbox grammar and `sections.ts` the section split,
  because a day file and a team file are supposed to agree about both and had
  each grown their own identical copy. Adding a marker or a bullet shape means
  editing one file, not two that drift. What stays per-format is what genuinely
  differs: the day file's `_(added …)_` provenance, the team file's `_(date)_`
  completion stamp, and their different note stamps (`HH:MM` vs `YYYY-MM-DD`).
- **Read the file the way people write it, not the way the app writes it.** A
  task line is any bullet — `-`, `*`, `+`, or `1.` — with the checkbox
  _optional_, and an unrecognized marker (`[-]`, `[>]`) reads as upcoming rather
  than being skipped. Owned headings match case-insensitively, so `## tasks` is
  the tasks section. This is what a report file actually looks like after a
  human or an agent has typed into it, and every one of those shapes used to be
  invisible in the app _and_ deleted on the next write. The report was "I can
  see the item in the Greg file but it's not showing up in the app."
- **A task keeps the date it first appeared; the suffix is written only when it
  outlives that day.** `_(added YYYY-MM-DD)_` on a day-file task means "this
  predates this file", so its presence _is_ the carried-over marker and a day of
  fresh work stays unannotated. The file's own date is when an `[x]` finished, so
  one line yields start, finish and duration — the one fact about a task that was
  otherwise unrecoverable except by diffing consecutive files and matching on
  title. `carriedOver` used to be a flag set at carry-over time and was silently
  lost on every restart; it is now derived by `isCarriedOver`. Don't reintroduce
  a stored flag, and don't switch to the team file's unlabelled `_(date)_` — the
  two files share a folder, and there the bare date means _completed_.
- **`format` is stamped when the app _creates_ a day file, never when it edits
  one.** The absence of `_(added …)_` is a positive claim ("started here") in a
  v2 file and means nothing in a v1 one, and that difference is invisible without
  the version. Upgrading a legacy file in place would manufacture provenance for
  tasks that predate the field — so `createDay` sets `DAY_FORMAT_VERSION` and
  `parseDay`/`serializeDay` preserve whatever was already there, including a
  version newer than this build understands. Version 1 is the _absence_ of the
  key; never write `format: 1`. Bump the constant when the meaning of existing
  syntax changes, not when something is merely added.
- **The version is derived from the commit subjects, and lives in four files at
  once.** `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`
  and the crate's entry in `src-tauri/Cargo.lock` all carry it, and nothing
  failed when they disagreed — a Tauri installer reads `tauri.conf.json`, so the
  number in Add/Remove Programs came from a different file than the one anybody
  edited. `scripts/version.ts` is the single writer: it rewrites the _text_ of
  each file rather than re-serializing it (a JSON round-trip that silently drops
  a key from `tauri.conf.json` is a configuration bug with no error message),
  throws unless it finds exactly one place to write, and `pnpm run version:check`
  is part of `pnpm run check` so drift fails the same gate as everything else.
  Anything that adds a fifth home for the version adds an entry to `FILES` too.
- **`feat`/`fix`/`perf` move the number; nothing else does.** The `commit-msg`
  hook enforces the Conventional Commits grammar because the version now depends
  on it, and the failure mode without it is silent — the commit lands and the
  version simply doesn't move. A week of `chore:` and `docs:` releases nothing on
  purpose. Merge, revert and `fixup!` subjects are exempt — git wrote them.
- **1.0 is set by hand; the tooling will not promote an app to it.** Below 1.0.0
  `nextVersion` demotes a breaking change to a _minor_ bump, because declaring
  1.0 is a statement that the app is finished enough to promise compatibility —
  a person's decision, not something to fall out of a `!` in a subject line.
  This app is past that now (the author set 1.0.0 on the strength of using it
  daily), so the rule is inert here and a breaking change costs a major. Don't
  delete it: it is what a fork starting from zero runs into. The other half of
  that decision is `versionToRelease` — a version declared in `package.json`
  but never tagged releases _as itself_ rather than being bumped past, which is
  the only reason `v1.0.0` exists at all. Without it the first `fix:` after the
  decision would have tagged `v1.0.1` over a version nobody ever shipped.
- **A vault migration is a script, not a startup path.** `scripts/` is outside
  the app for a reason: the app touches one file at a time and has no evidence
  about what preceded it, whereas a migration reads the whole vault, derives
  each value from the file it can actually be observed in, backs everything up
  and shows a diff a human approves. Don't move that work into launch. The
  backfill also groups task titles with its own `normalize`, which must stay in
  step with `sameTask` — two spellings of one task would otherwise be dated as
  two separate runs.
- **A review surface for a destructive operation is load-bearing code — test it
  against a known-good case.** The backfill's first diff renderer aligned by line
  index, so inserting one frontmatter key reported every following line as
  changed and made a _preserved_ note look deleted. It nearly got reported as
  data loss in the tool's own output. A human approving a rewrite of the only
  copy of their notes can only be as careful as the diff lets them be, so a
  renderer that cries wolf is worse than none — it trains them to click through.
  It uses an LCS diff now, under a plain-language summary of what each task's
  derived span actually is.
- **Writes are atomic and serialized.** Rust writes to a temp file and renames
  (a day file is the only copy of that day's notes); `main.ts` chains every save
  through `this.writes` so concurrent edits can't interleave.
- **The check-in window takes focus.** Unlike the sibling calendar overlay, this
  one is typed into — so it is _not_ click-through, and it deliberately occupies
  the **top-left** corner, because bottom-right belongs to
  noticeable-calendar-alert. Two utilities in one corner means ignoring both.
- **Settings are an overlay in the one window, not a second window.** A second
  Tauri window would need its own capability set and its own positioning, and
  would surface in the taskbar this app skips. The panel is a sibling of the
  card, so it can paint alone when opened from the tray with nothing due — and
  it marks the card `inert` while open, because `aria-modal` doesn't stop Tab
  from reaching an input hidden behind the overlay.
- **The scheduler does not prompt over the settings panel.** `tick()` returns
  early while it is open. Slots coalesce, so the check-in is served as soon as
  the panel closes rather than being lost.
- **The form validates; the file falls back.** `parseSettings` silently repairs
  a corrupt `settings.json` so the app always starts. `validateDraft` does the
  opposite — it reports, because a settings panel that silently reverts what you
  typed teaches you nothing. Don't collapse the two.
- **`settings.json` is written before the in-memory settings change**, so a
  failed write leaves the running app on the values actually on disk. Launch-at-
  login is OS state applied after, and its failure doesn't undo the save.
- **The frontend must run framework-free in a plain browser too.** Every native
  call in `tauri.ts` is guarded by `isTauri()` and degrades to a no-op or a
  browser equivalent (the vault falls back to `localStorage`). This keeps
  `pnpm run dev` a fast iteration loop with no Rust build.
- **Link the stylesheet from `index.html`; never `import './styles.css'`.** A JS
  CSS import injects a `<style>` tag in dev, which the app's `style-src 'self'`
  CSP blocks. That breaks only in the desktop webview — never in lint, tests, or
  a browser `pnpm run dev`.
- **The settings panel reserves its scrollbar gutter on both edges.** A scrollbar
  drawn inside the panel's right-hand padding steals it from the content, so the
  fields sit ~11px closer to the left edge than the right and the panel reads as
  misaligned. `scrollbar-gutter: stable both-edges` keeps it symmetric whether or
  not it scrolls — which matters because whether it scrolls depends on how tall
  the platform paints `type="time"`, and Chromium is not the platform that ships.
- **Giving an element a `display` also overrides `[hidden]`.** `.settings` is a
  flex column, so it needs an explicit `.settings[hidden] { display: none }` —
  without it the panel is on screen permanently, covering the card, and the app
  looks dead on launch. Any new `hidden` element with a `display` rule needs the
  same line.
- **Transparency on macOS is off by default and fails silently.** A transparent
  window there needs _both_ `app.macOSPrivateApi: true` in `tauri.conf.json` and
  the `macos-private-api` Cargo feature on `tauri`; with only one of them the
  card paints on an opaque rectangle, and nothing in lint, tests or a Linux/
  Windows build says a word. The pair is enabled — keep them together. (It also
  means the app can't ship on the Mac App Store, which is fine: it's a direct
  download.)
- **Installers are built per-OS, never cross-compiled.** `tauri build` on a
  Windows machine makes an `.msi`/`.exe`; on macOS, the universal-target flag
  from the README makes one `.dmg` covering both chips; this sandbox can
  prove the Linux `.deb`/`.rpm`/`.AppImage` and nothing else. There is no CI
  job doing this — a change to packaging needs a manual build on the
  platform it touches, since the sandbox can't stand in for one it doesn't
  have.
- **Filenames are validated in Rust.** `is_safe_name` in `src-tauri/src/vault.rs`
  is the security boundary; the TypeScript `isSafeVaultName` is an early-failure
  convenience. Keep both in sync, and never widen the Rust one to a general path.
- **Security: vault content is untrusted.** Task titles and notes round-trip
  through files other tools can write, so they are rendered with `textContent`,
  never `innerHTML`.
- **Tauri permissions need a _scope_, not just the permission.** A bare
  capability string enables the command but leaves its allowlist empty, so every
  call is denied at runtime — and only on a real desktop run, never in
  lint/tests/`pnpm run dev`. Plugins that take a scope (opener, fs, http) must
  list their allowed targets in `capabilities/default.json`. This app avoids the
  problem by doing file and opener work in app-defined Rust commands, which
  don't pass through the capability system in v2.
- **Surface native-side failures in a dialog, not `console.error`.** Check-ins
  fire from a timer while the window is hidden, so console logs and a webview
  `alert()` are invisible. Route user-facing errors through `showError()`.
- **Motion is GPU-only.** Animate `transform`/`opacity` exclusively; never
  animate layout properties. Respect `prefers-reduced-motion`.

### Borrowed scars

`noticeable-calendar-alert` is the sibling project and paid for these already.
Each one is applied here; don't undo them.

- **Two icon masters.** Downscaling detailed art to 32px produces a smudge in the
  tray. `icon-small.svg` exists for ≤32px. Also: `.ico`/`.icns` must be listed in
  `bundle.icon` or Windows/macOS bundling fails, and `tauri icon` overwrites the
  hand-tuned sizes every time it runs. See `src-tauri/icons/README.md`.
- **A status line refreshed only on events is a stale snapshot.** The tray text
  re-renders on the scheduler tick and pushes only when it changed.
- **A flag set after an `await` is not a guard.** `presenting` is raised
  synchronously before the vault read, because `visible` is set after it — the
  sibling shipped a double-present race of exactly this shape.
- **Size the window to its content.** Theirs was 420×600 with content in the
  bottom 250px; ours is 420×470 for the same reason.
- **Don't assume an input is sorted.** Their `selectNextEvent` relied on
  ascending order that no signature promised. Ours re-derive order themselves.

## Commands

**The package manager is pnpm**, pinned by `packageManager` in `package.json`.
On a fresh container it may not be on PATH; `corepack enable && corepack prepare
pnpm@<pinned> --activate` installs exactly the pinned version. Don't reintroduce
`npm install` — it would write a `package-lock.json` alongside `pnpm-lock.yaml`
and the two would drift silently. (`npm view` is fine; that's a registry query,
not a project command.)

Build scripts are blocked by default from pnpm 10 on, and every skipped one is
reported at the end of an install. `pnpm-workspace.yaml` records the decision
per package under `allowBuilds` so the expected skips are silent and a genuinely
new one stands out. `pnpm approve-builds <pkg>` / `'!<pkg>'` writes that file for
you, which beats guessing the key by hand.

| Command                  | Purpose                                         |
| ------------------------ | ----------------------------------------------- |
| `pnpm install`           | Install deps + git hooks (`prepare` → lefthook) |
| `pnpm run dev`           | Browser-only preview of the card (no Rust)      |
| `pnpm run tauri dev`     | Full desktop app (needs Rust + Tauri prereqs)   |
| `pnpm run check`         | format + lint + typecheck + test (the web gate) |
| `pnpm run build`         | `tsc --noEmit` + `vite build`                   |
| `pnpm run test:watch`    | Vitest in watch mode                            |
| `pnpm run tauri icon X`  | Regenerate the platform icon set from `X.png`   |
| `pnpm run version:check` | Do the four files carrying the version agree?   |
| `pnpm run version:next`  | The version the commits since the last tag earn |
| `pnpm run version:sync`  | Write a version into all four of those files    |

Run a one-shot script with Node's own type stripping — there is no bundler step
for `scripts/`, and no `tsx` dependency:

```bash
node --experimental-strip-types scripts/backfill-provenance.ts <vault-dir>
```

`scripts/` is inside `tsconfig`, eslint and vitest, so a script and its tests
are held to the same bar as `src/` and `pnpm run check` covers them.

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

**A fresh container does not have the system libraries yet**, and the failure
does not say so — `cargo check` reports `The system library gdk-3.0 required by
crate gdk-sys was not found`, which reads like the crate is broken. Two
commands, in this order:

```bash
apt-get update    # REQUIRED FIRST — a stale index 404s on every package below,
                  # which looks like they don't exist rather than like a cache miss
apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev \
  libayatana-appindicator3-dev librsvg2-dev libsoup-3.0-dev pkg-config
```

Then all four gates run (~90s for the first `cargo check`; seconds after that).
Verified in this sandbox. Don't conclude from the first error that Rust can only
be checked in CI, and don't report the Rust gate as passing without running it.

What this environment lacks is a **desktop webview and any real desktop machine**
(no Windows, no macOS), so the following are _reviewed for correctness but never
executed_. Verify each on real hardware before trusting it. The full list lives in `docs/future-work.md`
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
