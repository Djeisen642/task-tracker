/**
 * Derived views over day files: the clipboard standup and the weekly rollup.
 *
 * Neither is an "export" in the usual sense — the day files are already the
 * durable artifact. These exist because the two moments where logging pays off
 * are *standup tomorrow morning* and *review season in December*, and both want
 * the data reshaped rather than re-entered.
 *
 * The weekly rollup is written back into the vault as `YYYY-Www.md` so an agent
 * asked about a quarter can read 13 rollups instead of 65 day files.
 */

import { fromDateKey, describeDate, toWeekKey, type DateKey } from '../dates.ts';
import { extractPeople, isKudos } from './mentions.ts';
import type { DayDocument } from './day.ts';

function heading(day: DayDocument): string {
  const parsed = fromDateKey(day.date);
  return parsed === null ? day.date : describeDate(parsed);
}

function titles(day: DayDocument, statuses: readonly string[]): string[] {
  return day.tasks.filter((task) => statuses.includes(task.status)).map((task) => task.title);
}

function bulletList(items: readonly string[], empty: string): string[] {
  return items.length > 0 ? items.map((item) => `- ${item}`) : [`- ${empty}`];
}

/**
 * The standup summary, ready to paste into Slack or a status doc.
 *
 * Plain text rather than Markdown-with-headings: it's going into a chat box, and
 * `##` renders as literal hashes in most of them.
 */
export function standupSummary(today: DayDocument, previous: DayDocument | null): string {
  const lines: string[] = [];

  if (previous !== null) {
    lines.push(`Since ${heading(previous)}:`);
    lines.push(...bulletList(titles(previous, ['completed']), 'Nothing marked complete'));
    lines.push('');
  }

  lines.push('Today:');
  lines.push(...bulletList(titles(today, ['in-progress', 'upcoming']), 'Nothing planned yet'));

  const blockers = today.notes.filter((note) => note.text.toLowerCase().includes('#blocker'));
  if (blockers.length > 0) {
    lines.push('');
    lines.push('Blockers:');
    lines.push(...blockers.map((note) => `- ${note.text}`));
  }

  return lines.join('\n');
}

/** Everything noteworthy about one person across a set of days. */
export interface PersonHighlight {
  person: string;
  moments: string[];
}

/**
 * Kudos-tagged notes grouped by the people they mention.
 *
 * This is the year-end-review payload. A note tagged `#kudos` that names nobody
 * is still worth keeping, so it's filed under `me` rather than dropped.
 */
export function collectKudos(days: readonly DayDocument[]): PersonHighlight[] {
  const byPerson = new Map<string, string[]>();

  for (const day of days) {
    for (const note of day.notes) {
      if (!isKudos(note.text)) continue;

      const people = extractPeople(note.text);
      const keys = people.length > 0 ? people : ['me'];
      for (const person of keys) {
        const moments = byPerson.get(person) ?? [];
        moments.push(`${day.date} — ${note.text}`);
        byPerson.set(person, moments);
      }
    }
  }

  return [...byPerson.entries()]
    .map(([person, moments]) => ({ person, moments }))
    .sort((a, b) => a.person.localeCompare(b.person));
}

/**
 * The weekly rollup file body.
 *
 * `days` may be any subset of the week (a four-day week, or a week still in
 * progress); the key is derived from the first day supplied.
 */
export function weeklyRollup(days: readonly DayDocument[]): string {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0];
  const weekKey =
    first === undefined ? 'unknown' : toWeekKey(fromDateKey(first.date) ?? new Date(0));

  const completed: string[] = [];
  const stillOpen: string[] = [];
  for (const day of sorted) {
    completed.push(...titles(day, ['completed']).map((title) => `${title} _(${day.date})_`));
  }
  const last = sorted[sorted.length - 1];
  if (last !== undefined) {
    stillOpen.push(...titles(last, ['in-progress', 'upcoming']));
  }

  const kudos = collectKudos(sorted);
  const kudosLines =
    kudos.length > 0
      ? kudos.flatMap(({ person, moments }) => [
          `### @${person}`,
          '',
          ...moments.map((moment) => `- ${moment}`),
          '',
        ])
      : ['_No kudos recorded this week._', ''];

  return [
    `# Week ${weekKey}`,
    '',
    `Days logged: ${String(sorted.length)}`,
    '',
    '## Completed',
    '',
    ...bulletList(completed, 'Nothing marked complete'),
    '',
    '## Still open',
    '',
    ...bulletList(stillOpen, 'Nothing outstanding'),
    '',
    '## Kudos',
    '',
    ...kudosLines,
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .concat('\n');
}

/** The vault filename for the week containing `date`. */
export function weekFileName(date: DateKey): string | null {
  const parsed = fromDateKey(date);
  return parsed === null ? null : `${toWeekKey(parsed)}.md`;
}

/**
 * The week's rollup with enough preamble to hand to an agent that cannot see
 * the vault.
 *
 * `CONTEXT.md` already explains the conventions, but it explains them *to a
 * reader of the folder*. This text exists for the opposite situation: it is
 * pasted into a chat with an agent that has no filesystem access and will never
 * see `CONTEXT.md`, so it has to carry its own key. Hence the preamble — and
 * hence the two disclaimers, which are the mistakes an agent reliably makes on
 * this data: reading a gap as "nothing happened" and reading "still open" as
 * "abandoned".
 *
 * Returns `null` for a week with no logged days. A briefing whose body is three
 * "Nothing" bullets tells an agent nothing while looking authoritative, and
 * that's worse than the app saying it has nothing to give you.
 */
export function agentWeekBriefing(days: readonly DayDocument[]): string | null {
  if (days.length === 0) return null;

  return [
    'Below is one week from a work journal kept by Task Tracker, a desktop app that',
    "prompts its user hourly to record what they're working on. It is the raw record,",
    'not a summary written afterwards.',
    '',
    'Conventions: `@name` is a colleague. `#tag` is a freeform label — `#kudos` marks a',
    'moment worth remembering at review time, `#blocker` something impeding progress,',
    '`#decision` a decision and its reasoning.',
    '',
    'Two things not to misread: "Still open" is the state at the end of the last logged',
    'day, not work that was abandoned; and a day with no entry means nothing was logged,',
    'not that nothing happened.',
    '',
    '---',
    '',
    weeklyRollup(days),
  ].join('\n');
}
