import { describe, expect, it } from 'vitest';

import { addNote, createDay } from './markdown/day.ts';
import { formatTrayStatus } from './tray.ts';

function day(tasks: Parameters<typeof createDay>[3] = [], notes: [string, string][] = []) {
  let doc = createDay('2026-08-03', '09:00', '17:00', tasks);
  for (const [time, text] of notes) doc = addNote(doc, time, text);
  return doc;
}

describe('formatTrayStatus', () => {
  it('reports nothing logged when there is no day file', () => {
    expect(formatTrayStatus(null)).toBe('No check-ins yet today');
  });

  it('reports nothing logged for an empty day rather than a row of zeros', () => {
    // "0 done · 0 open · 0 notes" reads like a broken app.
    expect(formatTrayStatus(day())).toBe('No check-ins yet today');
  });

  it('summarizes tasks and notes', () => {
    const doc = day(
      [
        { title: 'Done', status: 'completed' },
        { title: 'Doing', status: 'in-progress' },
        { title: 'Todo', status: 'upcoming' },
      ],
      [['10:00', 'a note']],
    );
    expect(formatTrayStatus(doc)).toBe('1 done · 2 open · 1 note');
  });

  it('pluralizes notes', () => {
    const doc = day(
      [{ title: 'Todo', status: 'upcoming' }],
      [
        ['10:00', 'one'],
        ['11:00', 'two'],
      ],
    );
    expect(formatTrayStatus(doc)).toBe('0 done · 1 open · 2 notes');
  });

  it('counts a day with only notes', () => {
    expect(formatTrayStatus(day([], [['10:00', 'thinking']]))).toBe('0 done · 0 open · 1 note');
  });

  it('counts a day with only tasks', () => {
    expect(formatTrayStatus(day([{ title: 'Todo', status: 'upcoming' }]))).toBe(
      '0 done · 1 open · 0 notes',
    );
  });
});
