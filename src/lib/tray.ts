/**
 * The tray menu's status line.
 *
 * Composed here rather than in Rust so it is pure and testable; `lib.rs` only
 * applies the string. Kept separate from the controller for the same reason the
 * sibling calendar-alert project split its own tray text out — the interesting
 * part is the wording and the pluralization, and that deserves tests rather than
 * a manual look at a menu.
 */

import type { DayDocument } from './markdown/day.ts';
import { summarizeTasks } from './tasks.ts';

/** Pluralize a count with its noun: `1 note`, `2 notes`. */
function count(value: number, noun: string): string {
  return `${String(value)} ${noun}${value === 1 ? '' : 's'}`;
}

/**
 * One line summarizing the day, for the disabled item at the top of the tray
 * menu. `null` means no file exists for today yet.
 *
 * The empty-vault case says "No check-ins yet today" rather than "0 done · 0
 * open · 0 notes": a row of zeros reads like the app is broken, when in fact
 * nothing has happened yet.
 */
export function formatTrayStatus(day: DayDocument | null): string {
  if (day === null) return 'No check-ins yet today';

  const summary = summarizeTasks(day.tasks);
  if (summary.total === 0 && day.notes.length === 0) return 'No check-ins yet today';

  return [
    `${String(summary.completed)} done`,
    `${String(summary.open)} open`,
    count(day.notes.length, 'note'),
  ].join(' · ');
}
