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
 * date: 2026-08-02
 * work_start: 09:00
 * work_end: 17:00
 * ---
 *
 * # Sunday, 2 August 2026
 *
 * ## Tasks
 *
 * - [ ] Draft the RFC
 * - [/] Ship the migration rollback
 * - [x] Review the release checklist
 *
 * ## Notes
 *
 * - 10:15 — @alice unblocked the release single-handedly #kudos
 * ```
 */

import { describeDate, fromDateKey, type Clock, type DateKey } from '../dates.ts';
import type { Task, TaskStatus } from '../tasks.ts';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.ts';

/** A timestamped thought. `time` is local `HH:MM`. */
export interface Note {
  time: Clock;
  text: string;
}

/** A heading and its body, preserved verbatim for sections we don't own. */
export interface ExtraSection {
  heading: string;
  lines: string[];
}

export interface DayDocument {
  date: DateKey;
  workStart: Clock;
  workEnd: Clock;
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
/** `- 10:15 — text`, accepting an em dash, en dash or hyphen as the separator. */
const NOTE_PATTERN = /^\s*[-*]\s*(\d{1,2}:\d{2})\s*[—–-]\s*(.*)$/;

/** Owned frontmatter keys, in the order they're written. */
const OWNED_FIELDS = ['date', 'work_start', 'work_end'];

interface Section {
  heading: string;
  lines: string[];
}

/** Split a body into `##`-delimited sections, keeping any preamble separate. */
function splitSections(body: string): { preamble: string[]; sections: Section[] } {
  const preamble: string[] = [];
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const line of body.split('\n')) {
    if (/^##\s+/.test(line)) {
      current = { heading: line.trim(), lines: [] };
      sections.push(current);
      continue;
    }

    if (current === null) {
      preamble.push(line);
    } else {
      current.lines.push(line);
    }
  }

  return { preamble, sections };
}

function parseTasks(lines: readonly string[]): Task[] {
  const tasks: Task[] = [];

  for (const line of lines) {
    const match = TASK_PATTERN.exec(line);
    if (match === null) continue;

    const status = MARKER_TO_STATUS[match[1] ?? ''];
    const title = (match[2] ?? '').trim();
    // An unknown marker means someone is using a convention we don't model;
    // skipping keeps the line intact on the next write rather than guessing.
    if (status === undefined || title === '') continue;

    tasks.push({ title, status });
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

  let tasks: Task[] = [];
  let notes: Note[] = [];
  const extraSections: ExtraSection[] = [];

  for (const section of sections) {
    if (section.heading === TASKS_HEADING) {
      tasks = parseTasks(section.lines);
    } else if (section.heading === NOTES_HEADING) {
      notes = parseNotes(section.lines);
    } else {
      extraSections.push({ heading: section.heading, lines: [...section.lines] });
    }
  }

  return {
    date: fields.date ?? fallback.date,
    workStart: fields.work_start ?? fallback.workStart,
    workEnd: fields.work_end ?? fallback.workEnd,
    tasks,
    notes,
    extraFields,
    extraSections,
  };
}

/** Trim leading and trailing blank lines from a preserved section body. */
function trimBlankEdges(lines: readonly string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && (lines[start] ?? '').trim() === '') start += 1;
  while (end > start && (lines[end - 1] ?? '').trim() === '') end -= 1;
  return lines.slice(start, end);
}

/** Render a day document back to Markdown. Round-trips with `parseDay`. */
export function serializeDay(day: DayDocument): string {
  const fields: Record<string, string> = {
    date: day.date,
    work_start: day.workStart,
    work_end: day.workEnd,
    ...day.extraFields,
  };

  const parsed = fromDateKey(day.date);
  const heading = parsed === null ? day.date : describeDate(parsed);

  const blocks: string[] = [`# ${heading}`];

  const taskLines = day.tasks.map(
    (task) => `- [${STATUS_TO_MARKER[task.status]}] ${task.title.trim()}`,
  );
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
    date,
    workStart,
    workEnd,
    tasks: [...tasks],
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
