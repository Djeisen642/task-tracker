/**
 * The team file: parse and serialize `team.<person>.md`.
 *
 * A day file is scoped to a date; this is scoped to a person instead, because a
 * manager's notes about one report accumulate across weeks in one place, not
 * per date the way the manager's own work does. There is no roster to manage —
 * a file is created the first time you log something about someone, the same
 * "no ceremony before the first entry" spirit as the day file itself.
 *
 * `person` is the lowercase handle, using the exact character set `@mentions`
 * already extract (see `mentions.ts`), so a note that types `@alice` and a team
 * file for `alice` refer to the same person without a translation step.
 *
 * ```markdown
 * ---
 * person: alice
 * ---
 *
 * # @alice
 *
 * ## Tasks
 *
 * - [ ] Migrate the queue consumer
 * - [/] Onboarding for the new hire
 * - [x] Reviewed the design doc _(2026-08-03)_
 *
 * ## Notes
 *
 * - 2026-08-10 — Shipped the migration script, unblocked the release #kudos
 * - 2026-08-12 — Waiting on design review before starting the API work #blocker
 * ```
 *
 * A completed task carries the date it was completed, in the same `_(date)_`
 * shape the weekly rollup already uses for a finished item. This is what lets
 * the rollup show "completed *this week*" instead of every completion the
 * file has ever recorded — a personal day file gets this for free because
 * each day is its own file, but one report's tasks live in one file for as
 * long as they're a report, so completion needs its own timestamp.
 */

import type { DateKey } from '../dates.ts';
import type { Task, TaskStatus } from '../tasks.ts';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.ts';
import {
  emptyPreserved,
  isHeading,
  isPlaceholder,
  preservedLines,
  preservedPreamble,
  renderSection,
  splitSections,
  trimBlankEdges,
  type ExtraSection,
  type PreservedLines,
} from './sections.ts';

/** A dated note about a report. `date` is the day it was logged, not a time. */
export interface TeamNote {
  date: DateKey;
  text: string;
}

export interface TeamMemberDocument {
  /** Lowercase handle, matching the character set `@mentions` extract. */
  person: string;
  tasks: Task[];
  /**
   * The day each currently-completed task was marked done, keyed by title.
   * Absent for an open task, and for a completed one whose date wasn't
   * recorded (a hand-checked box, say) — undated completions are simply not
   * attributable to any particular week.
   */
  completedDates: Record<string, DateKey>;
  notes: TeamNote[];
  /** Frontmatter keys we don't own, kept so hand-added keys survive a write. */
  extraFields: Record<string, string>;
  /** Sections we don't own, kept in file order and re-emitted after Notes. */
  extraSections: ExtraSection[];
  /**
   * Lines inside the sections we *do* own that aren't items — a paragraph of
   * context above the task list, a `###` subheading, a note written without a
   * date. Kept verbatim and written back, because this file is the only copy.
   */
  preserved: PreservedLines;
}

const TASKS_HEADING = '## Tasks';
const NOTES_HEADING = '## Notes';

/** Checkbox marker ↔ status. Mirrors the day file's convention exactly. */
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

/**
 * A task line: any bullet, with the checkbox optional.
 *
 * Deliberately loose. A manager typing into this file by hand — or an agent
 * asked to "add a task for greg" — writes `- Ship the migration` as often as
 * `- [ ] Ship the migration`, and a numbered list about as often as a dashed
 * one. Requiring the checkbox meant those lines were not tasks, so the app
 * showed nothing and then deleted them on its next write.
 */
const TASK_PATTERN = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[(.)\]\s*)?(.*)$/;
/** A trailing `_(2026-08-03)_` on a completed task line — see the module doc. */
const COMPLETED_DATE_PATTERN = /\s*_\((\d{4}-\d{2}-\d{2})\)_\s*$/;
/** `- 2026-08-10 — text`, accepting an em dash, en dash or hyphen as the separator. */
const NOTE_PATTERN = /^\s*[-*]\s*(\d{4}-\d{2}-\d{2})\s*[—–-]\s*(.*)$/;

/** Owned frontmatter keys, in the order they're written. */
const OWNED_FIELDS = ['person'];

function parseTasks(lines: readonly string[]): {
  tasks: Task[];
  completedDates: Record<string, DateKey>;
  extra: string[];
} {
  const tasks: Task[] = [];
  const completedDates: Record<string, DateKey> = {};
  const extra: string[] = [];

  for (const line of lines) {
    const match = TASK_PATTERN.exec(line);
    let title = (match?.[2] ?? '').trim();
    if (match === null || title === '') {
      // Not an item: a paragraph, a `###` subheading, a table. Keep it.
      if (!isPlaceholder(line)) extra.push(line);
      continue;
    }

    // An unrecognized marker (`[-]`, `[>]`, whatever convention the writer
    // brought with them) is still a task. Showing it as upcoming loses the
    // shade of meaning; not showing it at all lost the line.
    const status = MARKER_TO_STATUS[match[1] ?? ' '] ?? 'upcoming';

    if (status === 'completed') {
      const dateMatch = COMPLETED_DATE_PATTERN.exec(title);
      if (dateMatch !== null) {
        title = title.slice(0, dateMatch.index).trim();
        const date = dateMatch[1];
        if (date !== undefined && title !== '') completedDates[title] = date;
      }
    }

    if (title === '') continue;
    tasks.push({ title, status });
  }

  return { tasks, completedDates, extra };
}

function parseNotes(lines: readonly string[]): { notes: TeamNote[]; extra: string[] } {
  const notes: TeamNote[] = [];
  const extra: string[] = [];

  for (const line of lines) {
    const match = NOTE_PATTERN.exec(line);
    const text = (match?.[2] ?? '').trim();
    if (match === null || text === '') {
      // A note with no date can't be placed in a week, so it isn't modelled —
      // but it is somebody's writing, so it is kept exactly as they left it.
      if (!isPlaceholder(line)) extra.push(line);
      continue;
    }

    notes.push({ date: match[1] ?? '', text });
  }

  return { notes, extra };
}

/**
 * Parse a team file. Never throws: a malformed or empty file yields a document
 * with the supplied fallback, because losing notes about a report to a parse
 * error is far worse than tolerating a stray line.
 */
export function parseTeamMember(source: string, fallback: { person: string }): TeamMemberDocument {
  const { fields, body } = parseFrontmatter(source);
  const { preamble, sections } = splitSections(body);

  const extraFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!OWNED_FIELDS.includes(key)) extraFields[key] = value;
  }

  let tasks: Task[] = [];
  let completedDates: Record<string, DateKey> = {};
  let notes: TeamNote[] = [];
  const preserved = emptyPreserved();
  const extraSections: ExtraSection[] = [];
  let seenTasks = false;
  let seenNotes = false;

  // Anything above the first `##` heading. The app never writes here, so this
  // is always somebody's own words — and it used to be dropped on every write.
  preserved.preamble = preservedPreamble(preamble);

  for (const section of sections) {
    // Case-insensitively: `## tasks` is the tasks section. A second section of
    // the same name is somebody's own structure and is preserved as-is rather
    // than silently replacing the first.
    if (isHeading(section.heading, TASKS_HEADING) && !seenTasks) {
      seenTasks = true;
      const parsed = parseTasks(section.lines);
      tasks = parsed.tasks;
      completedDates = parsed.completedDates;
      preserved.tasks = preservedLines(parsed.extra);
    } else if (isHeading(section.heading, NOTES_HEADING) && !seenNotes) {
      seenNotes = true;
      const parsed = parseNotes(section.lines);
      notes = parsed.notes;
      preserved.notes = preservedLines(parsed.extra);
    } else {
      extraSections.push({ heading: section.heading, lines: [...section.lines] });
    }
  }

  return {
    person: fields.person ?? fallback.person,
    tasks,
    completedDates,
    notes,
    extraFields,
    extraSections,
    preserved,
  };
}

/** Render a team document back to Markdown. Round-trips with `parseTeamMember`. */
export function serializeTeamMember(member: TeamMemberDocument): string {
  const fields: Record<string, string> = {
    person: member.person,
    ...member.extraFields,
  };

  const preserved = member.preserved;
  const blocks: string[] = [`# @${member.person}`];
  if (preserved.preamble.length > 0) blocks.push(trimBlankEdges(preserved.preamble).join('\n'));

  const taskLines = member.tasks.map((task) => {
    const date = task.status === 'completed' ? member.completedDates[task.title] : undefined;
    const suffix = date === undefined ? '' : ` _(${date})_`;
    return `- [${STATUS_TO_MARKER[task.status]}] ${task.title.trim()}${suffix}`;
  });
  blocks.push(renderSection(TASKS_HEADING, taskLines, '_Nothing tracked yet._', preserved.tasks));

  const noteLines = [...member.notes]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((note) => `- ${note.date} — ${note.text.trim()}`);
  blocks.push(renderSection(NOTES_HEADING, noteLines, '_No notes yet._', preserved.notes));

  for (const section of member.extraSections) {
    blocks.push([section.heading, '', ...trimBlankEdges(section.lines)].join('\n'));
  }

  return `${serializeFrontmatter(fields)}\n${blocks.join('\n\n')}\n`;
}

/** A fresh, empty team document for `person`. */
export function createTeamMember(person: string): TeamMemberDocument {
  return {
    person,
    tasks: [],
    completedDates: {},
    notes: [],
    extraFields: {},
    extraSections: [],
    preserved: emptyPreserved(),
  };
}

/**
 * Recompute completion dates after a task list changes.
 *
 * A task that just became completed (it wasn't, a moment ago) is stamped
 * `today`. One that moved off completed — reopened, or removed outright —
 * loses its date; there's nothing to carry forward. A task that was already
 * completed and still is keeps whatever date it already had, rather than
 * getting re-stamped on every unrelated edit to the list.
 */
export function updateCompletedDates(
  previousTasks: readonly Task[],
  previousDates: Readonly<Record<string, DateKey>>,
  nextTasks: readonly Task[],
  today: DateKey,
): Record<string, DateKey> {
  const previousStatus = new Map(previousTasks.map((task) => [task.title, task.status]));
  const dates: Record<string, DateKey> = {};

  for (const task of nextTasks) {
    if (task.status !== 'completed') continue;

    const justCompleted = previousStatus.get(task.title) !== 'completed';
    dates[task.title] = justCompleted ? today : (previousDates[task.title] ?? today);
  }

  return dates;
}

/** Append a dated note. Returns a new document; the input is never mutated. */
export function addTeamNote(
  member: TeamMemberDocument,
  date: DateKey,
  text: string,
): TeamMemberDocument {
  const trimmed = text.trim();
  if (trimmed === '') return member;

  return { ...member, notes: [...member.notes, { date, text: trimmed }] };
}
