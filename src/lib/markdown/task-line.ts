/**
 * The checkbox grammar, shared by every vault document that has a task list.
 *
 * The day file and the team file both write `- [x] Something`, and both have to
 * read back the looser shapes a human or an agent actually types. That grammar
 * lived in each of them as an identical regex and an identical pair of marker
 * maps, which is how two formats that are supposed to agree quietly stop
 * agreeing — the same reason `sections.ts` exists. What stays in each format is
 * the part that genuinely differs: the day file's `_(added …)_` provenance, the
 * team file's `_(date)_` completion stamp.
 */

import type { TaskStatus } from '../tasks.ts';

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

/**
 * A task line: any bullet — `-`, `*`, `+` or `1.` — with the checkbox optional.
 *
 * Deliberately loose. A file this app writes always has `- [ ]`, but a file a
 * human or an agent edited often has `- Ship the thing`, or a numbered list.
 * Requiring the checkbox meant those lines were not tasks, so they never
 * appeared in the app — and the next write, which re-emits the section from the
 * tasks it parsed, deleted them from the only copy.
 */
const TASK_LINE = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[(.)\]\s*)?(.*)$/;

/** A task line's two parts: where it stands, and everything after the checkbox. */
export interface TaskLine {
  status: TaskStatus;
  /** Still carries whatever trailing annotations the format defines. */
  text: string;
}

/**
 * Read one line as a task, or `null` when it isn't one.
 *
 * An unrecognized marker (`[-]`, `[>]`, whatever convention the writer brought
 * with them) reads as upcoming. That loses a shade of meaning; not reading it
 * at all lost the line.
 */
export function parseTaskLine(line: string): TaskLine | null {
  const match = TASK_LINE.exec(line);
  if (match === null) return null;

  const text = (match[2] ?? '').trim();
  if (text === '') return null;

  return { status: MARKER_TO_STATUS[match[1] ?? ' '] ?? 'upcoming', text };
}

/** Write a task line in the app's canonical form. */
export function renderTaskLine(status: TaskStatus, text: string): string {
  return `- [${STATUS_TO_MARKER[status]}] ${text}`;
}
