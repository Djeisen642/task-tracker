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

/** What one task line says. */
export interface TaskLine {
  status: TaskStatus;
  /** Still carries whatever trailing annotations the format defines. */
  text: string;
  /**
   * The raw checkbox character, when it isn't one this app models.
   *
   * `[-]`, `[>]`, `[?]` and friends come from conventions other tools use —
   * cancelled, forwarded, waiting. Reading them as upcoming is what makes them
   * visible in the app; *writing* them back as `[ ]` is what turns somebody's
   * cancelled item into live work that carries forward every day after. So the
   * character is kept and re-emitted verbatim unless the user changes the
   * task's status through the app.
   */
  marker?: string;
  /** Leading whitespace, in characters — see `isNested`. */
  indent: number;
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

  const marker = match[1];
  const known = marker === undefined ? undefined : MARKER_TO_STATUS[marker];

  return {
    status: known ?? 'upcoming',
    text,
    // Only an unmodelled marker is worth carrying; the app's own three are
    // re-derived from the status, which is the thing that can change.
    ...(marker !== undefined && known === undefined ? { marker } : {}),
    indent: (/^\s*/.exec(line)?.[0] ?? '').length,
  };
}

/**
 * `true` when this line sits deeper than the section's first item — a sub-task,
 * or a wrapped continuation of the line above.
 *
 * The model is a flat list, so a nested bullet has nowhere to go: parsing it as
 * a task promotes it to a peer of its parent and drops its indentation from the
 * file, which is a hierarchy the vault can no longer express. Treating it as
 * unmodelled content keeps the file exactly as written. Measured against the
 * *first* item rather than against zero, so a list that is wholly indented is
 * still a list of tasks.
 */
export function isNested(item: TaskLine, baseIndent: number): boolean {
  return item.indent > baseIndent;
}

/**
 * Write a task line, keeping an unmodelled marker where the status still
 * matches what that marker was read as.
 */
export function renderTaskLine(status: TaskStatus, text: string, marker?: string): string {
  const keep = marker !== undefined && marker !== '' && status === 'upcoming';
  return `- [${keep ? marker : STATUS_TO_MARKER[status]}] ${text}`;
}
