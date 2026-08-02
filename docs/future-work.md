# Future work

Everything we want built, in one place. The **MVP line** divides what has to
work before this is worth using daily from what can come later.

Items above the line are the definition of "v0.1 is done". Items below are
ordered roughly by value, not by sequence — pull from them as they become the
thing standing between you and using the app.

Status keys: **done** · **partial** · **todo**

---

## Above the MVP line

These ship in v0.1. The app is not usable without them.

### The check-in loop

| Status | Item                                                                                                                                                      |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| done   | Slot-based scheduler: day-start, hourly, day-end; coalesces missed slots after sleep.                                                                     |
| done   | Prompt repeats until dismissed or submitted; Snooze defers by a configurable interval.                                                                    |
| done   | Work start / end times, weekend suppression, hourly nudges toggleable.                                                                                    |
| done   | Card slides in from the **top-left** (bottom-right belongs to the calendar alert).                                                                        |
| done   | Keyboard-first: type a task, Enter to add; Esc snoozes.                                                                                                   |
| done   | Survives a restart: the handled slot is recorded in the day file and restored on launch, so a reboot doesn't re-prompt for a completed check-in.          |
| done   | The first check-in of a day is always the day-start prompt, whatever the hour — a late start or a machine that was off at 09:00 still gets shown the day. |
| todo   | **Verify the window actually takes focus on Windows.** See "Known unknowns" below.                                                                        |

### The vault

| Status | Item                                                                              |
| ------ | --------------------------------------------------------------------------------- |
| done   | One Markdown file per day, frontmatter + `## Tasks` + `## Notes`.                 |
| done   | Hand edits survive: unowned sections and frontmatter keys are preserved verbatim. |
| done   | Atomic writes (temp file + rename) so a crash can't truncate a day's notes.       |
| done   | Open tasks carry over to the next day, bounded by a 4-day horizon.                |
| done   | `CONTEXT.md` regenerated on launch so an agent can read the schema.               |
| done   | Inline `@person` and `#tag` parsing, with `#kudos` indexed for review season.     |
| done   | Filename allowlist enforced in Rust — nothing escapes the vault directory.        |

### Output

| Status | Item                                                                |
| ------ | ------------------------------------------------------------------- |
| done   | Clipboard standup summary (yesterday done / today open / blockers). |
| done   | Weekly rollup file `YYYY-Www.md`, regenerated at each day-end.      |

### Shell

| Status  | Item                                                                                                                    |
| ------- | ----------------------------------------------------------------------------------------------------------------------- |
| done    | Tray icon and menu: status line, check in now, copy standup, open vault, quit.                                          |
| done    | Least-privilege capabilities — only the plugin commands JS invokes.                                                     |
| done    | End-to-end suite driving the real card in a browser, plus screenshot capture and a `verify-app` skill.                  |
| partial | Launch at login: the bridge is wired, but nothing toggles it yet (needs the settings UI below).                         |
| todo    | **A settings UI.** Work hours are only editable by hand-editing `settings.json`. This is the largest remaining MVP gap. |
| done    | App icons generated from the SVG master and committed (`generate_context!` embeds them at compile time).                |

---

# ═══════════ MVP LINE ═══════════

Everything below is post-v0.1.

---

## Storage and querying

**SQLite as a derived index — not a second source of truth.** The open question
was whether to keep a database alongside the Markdown so we don't have to parse
files. The recommendation is to add one _later, and only as a cache_:

- The Markdown files stay authoritative. The index is rebuildable from them at
  any time, and if the two ever disagree, you delete the index and re-derive it.
  That turns the classic two-stores sync problem into a non-problem.
- It isn't needed yet. A year is ~250 files of a few KB each; parsing all of
  them is milliseconds, and the parser is already written and tested.
- It becomes worth it at the multi-year scale, for queries like "every `#kudos`
  mentioning `@alice` since 2024" without touching every file — which is exactly
  the year-end-review workload.

If we do it: `tauri-plugin-sql`, a `rebuild_index()` that walks the vault, and a
schema version so a format change just triggers a rebuild. **Never** write to
SQLite without writing the Markdown first.

Other items:

- Full-text search across the vault, surfaced in the app.
- Configurable vault path via a folder picker (the Rust command exists; no UI).
- Optional encryption at rest, if work notes ever warrant it.

## The people pillar

Currently `@person` and `#kudos` are parsed and indexed, but there's no UI built
on them. That's where the compounding value is:

- A per-person view: everything mentioning `@alice`, kudos first.
- 1:1 prep — agenda items accumulated since the last 1:1, and carry-over of
  anything not covered.
- A dedicated end-of-week prompt: "anything to note about your reports?"
- Roster management so `@alice` and `@alice.smith` are one person.
- Quarterly and annual rollups per person, sized for a review document.

## Nudge behavior

- Escalating presence when a check-in is ignored — brighter, larger, more
  insistent — rather than one flash and silence.
- Idle detection: don't count an hour you spent away from the machine, and don't
  prompt into an empty room.
- Meeting awareness: read the calendar and skip a nudge that would land mid-call.
  (The sibling `noticeable-calendar-alert` already has a tested Google Calendar
  layer to borrow.)
- Do-not-disturb / focus-mode respect.
- A holiday calendar so PTO days aren't counted as missed logging.

## Task model

Deliberately minimal today: title, status, notes. Candidates, each weighed
against the friction it adds to a prompt seen eight times a day:

- Projects or tags for grouping, and rollups grouped by project.
- Estimates and actuals, and time tracking accumulated from the hourly check-ins.
- Subtasks.
- Due dates and a "what's overdue" view.
- Import from Jira / Linear / GitHub Issues — read-only first, as an adapter
  behind the existing `VaultPort` seam.

## Views

- A history browser: scroll back through days without opening files.
- A week-at-a-glance view.
- Charts: completion rate, carry-over rate — the "am I overcommitting?" question.

## Platform and release

- Taskbar-aware placement: respect the OS work area, not just the monitor bounds.
- Per-monitor DPI correctness for the card's size.
- A signed Windows installer and an auto-update channel.
- macOS and Linux support (the code is portable; only the tray and positioning
  have been reasoned about for Windows).
- Coverage thresholds in CI.

## Agent integration

The vault is designed to be read by an agent, but that's currently a manual
"point Claude at this folder" step. Worth exploring:

- An MCP server exposing the vault as structured tools (`search_notes`,
  `person_summary`, `week_rollup`) so an agent gets precise answers instead of
  grepping Markdown.
- A "draft my review" command that assembles the year's kudos and completed work
  into a starting document.

---

## Known unknowns

The Rust compiles and its tests pass — `cargo check`, `cargo test`, `cargo
clippy --all-targets -- -D warnings` and `cargo fmt --check` were all run
against this tree, and `Cargo.lock` is committed.

What was **never executed** is anything requiring a desktop webview or a Windows
machine. The list below is reviewed for correctness only; verify each on real
hardware before trusting it:

1. **Windows foreground activation.** `SetForegroundWindow` is refused for a
   process that hasn't received recent user input, which is exactly a timer
   firing at 14:00. `show()` + `set_focus()` + `request_user_attention()` is the
   documented mitigation, but whether the card reliably lands _focused and ready
   to type_ is the single most important thing to test on-device. If it doesn't,
   the fallback is a brief `always_on_top` toggle or an `AttachThreadInput`
   workaround in Rust.
2. **Transparency, `skipTaskbar` and always-on-top** behaving as configured on
   Windows 11, including on a multi-monitor setup with mixed DPI.
3. **Tray icon and menu** rendering, and each menu item's event reaching the
   webview.
4. **The autostart plugin** actually registering at login.
5. **Clipboard writes** from a hidden window — the standup copy fires from the
   tray while the card may not be visible.
6. **The whole loop end to end** — a real workday of hourly prompts producing a
   day file you'd actually want to read back.
