/**
 * The day file: parse and serialize `YYYY-MM-DD.md`.
 *
 * This format *is* the database. Two consequences drive every decision here:
 *
 * 1. **It has to read well.** A human opening the file, and an agent asked
 *    "what did I do in July?", both see the same plain Markdown. No synthetic
 *    IDs, no HTML comment metadata, no base64.
 * 2. **Hand edits have to survive.** You (or an agent) may edit a day file
 *    directly. Any section this module doesn't own is preserved verbatim and
 *    written back out, so an app write never eats content it didn't author.
 *
 * ```markdown
 * ---
 * format: 2
 * date: 2026-08-02
 * work_start: 09:00
 * work_end: 17:00
 * ---
 *
 * # Sunday, 2 August 2026
 *
 * ## Tasks
 *
 * - [ ] Draft the RFC _(priority 2)_ _(added 2026-07-30)_
 * - [/] Ship the migration rollback _(priority 1)_
 * - [x] Review the release checklist
 *
 * ## Notes
 *
 * - 10:15 — @alice unblocked the release single-handedly #kudos
 * ```
 *
 * The `_(added …)_` suffix appears only when a task predates the file it is
 * sitting in, so its presence *is* the carried-over marker and a clean day of
 * fresh work stays free of annotation. Combined with the file's own date — the
 * day an `[x]` was finished — one line answers "how long did this take" without
 * reading a single other file. It is labelled rather than the bare `_(date)_`
 * the team file uses for *completion*, because the two files sit in one folder
 * and an unlabelled date that means opposite things in each is a trap for
 * whoever reads the vault next.
 *
 * `_(priority N)_` is the user's top five for the day, `1` first. It is optional
 * in the strongest sense: a day where nothing was ranked carries the suffix
 * nowhere and reads exactly as day files always have. Ranks are dense (`1…n`)
 * across the *open* tasks and never sit on a completed one — see
 * `normalizePriorities`, which is what closes the gap when a ranked task is
 * finished.
 *
 * Both annotations are claims on a *shape* of trailing text, which a title can
 * collide with: a task literally called "Bump the ticket to _(priority 3)_"
 * parses as a rank and loses those words the moment the rank is dropped. The
 * cost is accepted here as it already was for `_(added …)_` — the alternative
 * is an escaping scheme in a file whose whole point is that a human can read
 * and edit it — but note the asymmetry: an unwanted `_(added …)_` survives
 * every app write, while a rank is released by an ordinary click on the star.
 *
 * ## `format`
 *
 * The absence of a suffix means two different things depending on who wrote the
 * file, and that difference is not otherwise visible:
 *
 * - In a file this format wrote, the task provably first appeared that day.
 * - In a file written before the suffix existed, we simply don't know — it may
 *   have been carried for weeks.
 *
 * `format` resolves it. A file the app *creates* is stamped with the current
 * version, and one it merely *edits* keeps whatever version it already had, so
 * the app never retroactively vouches for dates it can't actually prove. A
 * legacy file has no `format` key and is version 1.
 *
 * A version this build doesn't recognize is preserved rather than overwritten —
 * the same rule as unowned keys and sections. Downgrading must not strip a
 * newer format's marker and leave the file claiming to be something it isn't.
 */

import { describeDate, fromDateKey, parseClock, type Clock, type DateKey } from '../dates.ts';
import type { Task, TaskStatus } from '../tasks.ts';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.ts';
import { splitSections, trimBlankEdges, type ExtraSection } from './sections.ts';

export type { ExtraSection } from './sections.ts';

/** A timestamped thought. `time` is local `HH:MM`. */
export interface Note {
  time: Clock;
  text: string;
}

/**
 * The version stamped on day files this build creates.
 *
 * Bump this when the meaning of existing syntax changes, not merely when
 * something is added — a reader that ignores an unknown addition still reads
 * the file correctly, but one that misreads a changed meaning does so silently.
 *
 * - **1** — implicit; no `format` key. Tasks carry no provenance, so an
 *   undated task's start date is unknown, floored at the file's own date.
 * - **2** — tasks carry `_(added …)_` when they outlive the day they appeared,
 *   so an *un*annotated task is a positive claim: it started here.
 */
export const DAY_FORMAT_VERSION = 2;

export interface DayDocument {
  /**
   * Which revision of this format the file is written in. See
   * `DAY_FORMAT_VERSION`. Preserved on read so editing a file never upgrades
   * the claims it makes about data written by an older build.
   */
  formatVersion: number;
  date: DateKey;
  workStart: Clock;
  workEnd: Clock;
  /**
   * The check-in slot most recently handled on this day, as local `HH:MM`.
   *
   * This is the scheduler's memory, and it lives in the day file rather than in
   * app state on purpose: the machine can be rebooted, the app quit, or the
   * process killed at any point in the workday. Without it, relaunching at 14:30
   * re-prompts for the 14:00 slot you already completed — and an app that nags
   * you for work you've done is one you stop running.
   *
   * `undefined` means no check-in has been handled yet today.
   */
  lastCheckIn?: Clock;
  tasks: Task[];
  notes: Note[];
  /** Frontmatter keys we don't own, kept so hand-added keys survive a write. */
  extraFields: Record<string, string>;
  /** Sections we don't own, kept in file order and re-emitted after Notes. */
  extraSections: ExtraSection[];
}

const TASKS_HEADING = '## Tasks';
const NOTES_HEADING = '## Notes';

/** Checkbox marker ↔ status. `/` for in-progress follows the Obsidian Tasks convention. */
const MARKER_TO_STATUS: Record<string, TaskStatus> = {
  ' ': 'upcoming',
  '/': 'in-progress',
  x: 'completed',
  X: 'completed',
};

const STATUS_TO_MARKER: Record<TaskStatus, string> = {
  upcoming: ' ',
  'in-progress': '/',
  completed: 'x',
};

const TASK_PATTERN = /^\s*[-*]\s*\[(.)\]\s*(.*)$/;
/** A trailing `_(added 2026-07-30)_` — see the module doc. */
const ADDED_DATE_PATTERN = /\s*_\(added (\d{4}-\d{2}-\d{2})\)_\s*$/;
/**
 * A trailing `_(priority 2)_` — the user's top five for the day.
 *
 * Two digits at most. An unbounded `\d+` accepts a number that `String()`
 * renders in exponent form on the way back out (`1e+21`), which this pattern
 * then can't match — the annotation would be swallowed into the title and the
 * round-trip identity would break. Nothing that long was a rank anyway.
 */
const PRIORITY_PATTERN = /\s*_\(priority (\d{1,2})\)_\s*$/;
/** `- 10:15 — text`, accepting an em dash, en dash or hyphen as the separator. */
const NOTE_PATTERN = /^\s*[-*]\s*(\d{1,2}:\d{2})\s*[—–-]\s*(.*)$/;

/** Owned frontmatter keys, in the order they're written. */
const OWNED_FIELDS = ['format', 'date', 'work_start', 'work_end', 'last_check_in'];

/**
 * Read the `format` key, defaulting to 1 for a file that has none.
 *
 * Anything unparseable is also 1: a corrupt version has to mean "assume the
 * weakest guarantees", never "assume the strongest".
 */
function parseFormatVersion(raw: string | undefined): number {
  if (raw === undefined) return 1;

  const version = Number(raw);
  return Number.isInteger(version) && version >= 1 ? version : 1;
}

/** What a task line's trailing `_(…)_` annotations said. */
interface Annotations {
  title: string;
  added?: DateKey;
  priority?: number;
}

/**
 * Peel the trailing annotations off a task title.
 *
 * They are written in a fixed order (`_(priority 1)_ _(added 2026-07-30)_`) but
 * are peeled from whichever end they turn up on, because a hand edit is free to
 * write them the other way round and losing a rank to key order would be a
 * silent data loss in the one file that holds the data.
 *
 * A suffix with nothing in front of it is someone's prose, not an annotation,
 * and stops the peeling: `- [ ] _(added 2026-07-30)_` is a line about a date,
 * not a task with an empty title.
 */
function stripAnnotations(rawTitle: string): Annotations {
  let title = rawTitle;
  let added: DateKey | undefined;
  let priority: number | undefined;

  for (;;) {
    const dateMatch = added === undefined ? ADDED_DATE_PATTERN.exec(title) : null;
    if (dateMatch !== null) {
      const annotated = dateMatch[1];
      const stripped = title.slice(0, dateMatch.index).trim();
      if (annotated === undefined || stripped === '') break;

      added = annotated;
      title = stripped;
      continue;
    }

    const rankMatch = priority === undefined ? PRIORITY_PATTERN.exec(title) : null;
    if (rankMatch !== null) {
      const stripped = title.slice(0, rankMatch.index).trim();
      const rank = Number(rankMatch[1]);
      // `_(priority 0)_` is not a rank this format can mean anything by, so the
      // text stays in the title rather than being swallowed.
      if (stripped === '' || !Number.isInteger(rank) || rank < 1) break;

      priority = rank;
      title = stripped;
      continue;
    }

    break;
  }

  return {
    title,
    ...(added === undefined ? {} : { added }),
    ...(priority === undefined ? {} : { priority }),
  };
}

/**
 * `date` is the file's own date, and is the default `added` for any task
 * without the suffix: an unannotated line means "first appeared here", which is
 * what every file written before the field existed is truthfully saying.
 */
function parseTasks(lines: readonly string[], date: DateKey): Task[] {
  const tasks: Task[] = [];

  for (const line of lines) {
    const match = TASK_PATTERN.exec(line);
    if (match === null) continue;

    const status = MARKER_TO_STATUS[match[1] ?? ''];
    const rawTitle = (match[2] ?? '').trim();
    // An unknown marker means someone is using a convention we don't model;
    // skipping keeps the line intact on the next write rather than guessing.
    if (status === undefined || rawTitle === '') continue;

    const { title, added, priority } = stripAnnotations(rawTitle);

    tasks.push({
      title,
      status,
      added: added ?? date,
      // An out-of-range or duplicated rank from a hand edit is kept as written
      // and tidied by `normalizePriorities` on the next edit, rather than being
      // second-guessed here — parsing repairs nothing, it only reads.
      ...(priority === undefined ? {} : { priority }),
    });
  }

  return tasks;
}

function parseNotes(lines: readonly string[]): Note[] {
  const notes: Note[] = [];

  for (const line of lines) {
    const match = NOTE_PATTERN.exec(line);
    if (match === null) continue;

    const time = match[1] ?? '';
    const text = (match[2] ?? '').trim();
    if (text === '') continue;

    // Normalize `9:05` to `09:05` so sorting and rendering stay uniform.
    notes.push({ time: time.padStart(5, '0'), text });
  }

  return notes;
}

/**
 * Parse a day file. Never throws: a malformed or empty file yields a document
 * with the supplied fallbacks, because losing a day's notes to a parse error is
 * far worse than tolerating a stray line.
 */
export function parseDay(
  source: string,
  fallback: { date: DateKey; workStart: Clock; workEnd: Clock },
): DayDocument {
  const { fields, body } = parseFrontmatter(source);
  const { sections } = splitSections(body);

  const extraFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!OWNED_FIELDS.includes(key)) extraFields[key] = value;
  }

  const date = fields.date ?? fallback.date;

  let tasks: Task[] = [];
  let notes: Note[] = [];
  const extraSections: ExtraSection[] = [];

  for (const section of sections) {
    if (section.heading === TASKS_HEADING) {
      tasks = parseTasks(section.lines, date);
    } else if (section.heading === NOTES_HEADING) {
      notes = parseNotes(section.lines);
    } else {
      extraSections.push({ heading: section.heading, lines: [...section.lines] });
    }
  }

  // A malformed hand-edited value is dropped rather than trusted: a bad slot key
  // would suppress check-ins for the rest of the day, which fails silently.
  const lastCheckIn = fields.last_check_in;
  const validLastCheckIn =
    lastCheckIn !== undefined && parseClock(lastCheckIn) !== null ? lastCheckIn : undefined;

  return {
    formatVersion: parseFormatVersion(fields.format),
    date,
    workStart: fields.work_start ?? fallback.workStart,
    workEnd: fields.work_end ?? fallback.workEnd,
    ...(validLastCheckIn === undefined ? {} : { lastCheckIn: validLastCheckIn }),
    tasks,
    notes,
    extraFields,
    extraSections,
  };
}

/** Render a day document back to Markdown. Round-trips with `parseDay`. */
export function serializeDay(day: DayDocument): string {
  const fields: Record<string, string> = {
    // Version 1 is the unversioned legacy format — writing `format: 1` would
    // invent a key the format it describes never had.
    ...(day.formatVersion <= 1 ? {} : { format: String(day.formatVersion) }),
    date: day.date,
    work_start: day.workStart,
    work_end: day.workEnd,
    ...(day.lastCheckIn === undefined ? {} : { last_check_in: day.lastCheckIn }),
    ...day.extraFields,
  };

  const parsed = fromDateKey(day.date);
  const heading = parsed === null ? day.date : describeDate(parsed);

  const blocks: string[] = [`# ${heading}`];

  const taskLines = day.tasks.map((task) => {
    // Only when it differs from this file's own date — see the module doc.
    const carried = task.added !== undefined && task.added !== day.date;
    const added = carried ? ` _(added ${String(task.added)})_` : '';
    const rank = task.priority === undefined ? '' : ` _(priority ${String(task.priority)})_`;
    // Rank first, date last: the date suffix has been the trailing annotation
    // since the format existed, and every reader — ours included — anchors on
    // the end of the line to find it.
    return `- [${STATUS_TO_MARKER[task.status]}] ${task.title.trim()}${rank}${added}`;
  });
  blocks.push(
    [TASKS_HEADING, '', ...(taskLines.length > 0 ? taskLines : ['_No tasks yet._'])].join('\n'),
  );

  const noteLines = [...day.notes]
    .sort((a, b) => a.time.localeCompare(b.time))
    .map((note) => `- ${note.time} — ${note.text.trim()}`);
  blocks.push(
    [NOTES_HEADING, '', ...(noteLines.length > 0 ? noteLines : ['_No notes yet._'])].join('\n'),
  );

  for (const section of day.extraSections) {
    blocks.push([section.heading, '', ...trimBlankEdges(section.lines)].join('\n'));
  }

  return `${serializeFrontmatter(fields)}\n${blocks.join('\n\n')}\n`;
}

/** A fresh day document, optionally seeded with tasks carried over from before. */
export function createDay(
  date: DateKey,
  workStart: Clock,
  workEnd: Clock,
  tasks: readonly Task[] = [],
): DayDocument {
  return {
    // The app is creating this file, so it can vouch for everything in it.
    formatVersion: DAY_FORMAT_VERSION,
    date,
    workStart,
    workEnd,
    // Anything arriving without provenance first appeared here, by definition.
    tasks: tasks.map((task) => ({ ...task, added: task.added ?? date })),
    notes: [],
    extraFields: {},
    extraSections: [],
  };
}

/** Append a note. Returns a new document; the input is never mutated. */
export function addNote(day: DayDocument, time: Clock, text: string): DayDocument {
  const trimmed = text.trim();
  if (trimmed === '') return day;

  return { ...day, notes: [...day.notes, { time, text: trimmed }] };
}
