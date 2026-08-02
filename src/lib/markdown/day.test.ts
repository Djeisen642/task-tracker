import { describe, expect, it } from 'vitest';

import { addNote, createDay, parseDay, serializeDay, type DayDocument } from './day.ts';

const FALLBACK = { date: '2026-08-02', workStart: '09:00', workEnd: '17:00' };

const SAMPLE = `---
date: 2026-08-02
work_start: 09:00
work_end: 17:00
---

# Sunday, 2 August 2026

## Tasks

- [ ] Draft the RFC
- [/] Ship the rollback path
- [x] Review the checklist

## Notes

- 10:15 — @alice unblocked the release #kudos
- 14:00 — Deferred the cache work #decision
`;

describe('parseDay', () => {
  it('reads frontmatter', () => {
    const day = parseDay(SAMPLE, FALLBACK);
    expect(day.date).toBe('2026-08-02');
    expect(day.workStart).toBe('09:00');
    expect(day.workEnd).toBe('17:00');
  });

  it('reads all three task markers', () => {
    expect(parseDay(SAMPLE, FALLBACK).tasks).toEqual([
      { title: 'Draft the RFC', status: 'upcoming' },
      { title: 'Ship the rollback path', status: 'in-progress' },
      { title: 'Review the checklist', status: 'completed' },
    ]);
  });

  it('accepts an uppercase completed marker', () => {
    const day = parseDay('## Tasks\n\n- [X] Done\n', FALLBACK);
    expect(day.tasks).toEqual([{ title: 'Done', status: 'completed' }]);
  });

  it('accepts `*` bullets as well as `-`', () => {
    const day = parseDay('## Tasks\n\n* [ ] Starred\n', FALLBACK);
    expect(day.tasks).toEqual([{ title: 'Starred', status: 'upcoming' }]);
  });

  it('skips an unknown marker rather than guessing at its meaning', () => {
    const day = parseDay('## Tasks\n\n- [?] Mystery\n- [ ] Real\n', FALLBACK);
    expect(day.tasks).toEqual([{ title: 'Real', status: 'upcoming' }]);
  });

  it('skips a checkbox with no title', () => {
    expect(parseDay('## Tasks\n\n- [ ]   \n', FALLBACK).tasks).toEqual([]);
  });

  it('reads timestamped notes', () => {
    expect(parseDay(SAMPLE, FALLBACK).notes).toEqual([
      { time: '10:15', text: '@alice unblocked the release #kudos' },
      { time: '14:00', text: 'Deferred the cache work #decision' },
    ]);
  });

  it('accepts an en dash or hyphen as the note separator', () => {
    const day = parseDay('## Notes\n\n- 09:00 – en dash\n- 09:01 - hyphen\n', FALLBACK);
    expect(day.notes.map((note) => note.text)).toEqual(['en dash', 'hyphen']);
  });

  it('zero-pads a single-digit note hour', () => {
    const day = parseDay('## Notes\n\n- 9:05 — early\n', FALLBACK);
    expect(day.notes[0]?.time).toBe('09:05');
  });

  it('falls back for a file with no frontmatter', () => {
    const day = parseDay('# Hand-written\n', FALLBACK);
    expect(day.date).toBe(FALLBACK.date);
    expect(day.workStart).toBe(FALLBACK.workStart);
  });

  it('returns an empty document for empty input rather than throwing', () => {
    const day = parseDay('', FALLBACK);
    expect(day.tasks).toEqual([]);
    expect(day.notes).toEqual([]);
    expect(day.date).toBe(FALLBACK.date);
  });

  it('ignores the placeholder lines it writes for empty sections', () => {
    const round = parseDay(serializeDay(createDay('2026-08-02', '09:00', '17:00')), FALLBACK);
    expect(round.tasks).toEqual([]);
    expect(round.notes).toEqual([]);
  });

  it('reads the last handled check-in', () => {
    const day = parseDay('---\ndate: 2026-08-02\nlast_check_in: 14:00\n---\n', FALLBACK);
    expect(day.lastCheckIn).toBe('14:00');
  });

  it('leaves the check-in record undefined when absent', () => {
    expect(parseDay(SAMPLE, FALLBACK).lastCheckIn).toBeUndefined();
  });

  it('drops a malformed check-in record rather than trusting it', () => {
    const day = parseDay('---\ndate: 2026-08-02\nlast_check_in: lunchtime\n---\n', FALLBACK);
    expect(day.lastCheckIn).toBeUndefined();
  });

  it('does not leak the check-in record into unowned fields', () => {
    const day = parseDay('---\ndate: 2026-08-02\nlast_check_in: 14:00\n---\n', FALLBACK);
    expect(day.extraFields).toEqual({});
  });

  it('keeps unknown frontmatter keys', () => {
    const day = parseDay('---\ndate: 2026-08-02\nmood: focused\n---\n', FALLBACK);
    expect(day.extraFields).toEqual({ mood: 'focused' });
  });

  it('keeps sections it does not own', () => {
    const day = parseDay(`${SAMPLE}\n## Retro\n\nWent well.\n`, FALLBACK);
    expect(day.extraSections).toEqual([{ heading: '## Retro', lines: ['', 'Went well.', ''] }]);
  });
});

describe('serializeDay', () => {
  it('round-trips a parsed document', () => {
    const day = parseDay(SAMPLE, FALLBACK);
    expect(parseDay(serializeDay(day), FALLBACK)).toEqual(day);
  });

  it('writes the human date heading', () => {
    expect(serializeDay(parseDay(SAMPLE, FALLBACK))).toContain('# Sunday, 2 August 2026');
  });

  it('falls back to the raw key when the date is unparseable', () => {
    const day: DayDocument = { ...createDay('not-a-date', '09:00', '17:00') };
    expect(serializeDay(day)).toContain('# not-a-date');
  });

  it('writes each status with its marker', () => {
    const output = serializeDay(parseDay(SAMPLE, FALLBACK));
    expect(output).toContain('- [ ] Draft the RFC');
    expect(output).toContain('- [/] Ship the rollback path');
    expect(output).toContain('- [x] Review the checklist');
  });

  it('sorts notes chronologically regardless of insertion order', () => {
    let day = createDay('2026-08-02', '09:00', '17:00');
    day = addNote(day, '15:00', 'later');
    day = addNote(day, '09:30', 'earlier');

    const notes = parseDay(serializeDay(day), FALLBACK).notes;
    expect(notes.map((note) => note.text)).toEqual(['earlier', 'later']);
  });

  it('emits placeholders for empty sections so the file never looks broken', () => {
    const output = serializeDay(createDay('2026-08-02', '09:00', '17:00'));
    expect(output).toContain('_No tasks yet._');
    expect(output).toContain('_No notes yet._');
  });

  it('preserves an unowned section through a full round trip', () => {
    const day = parseDay(`${SAMPLE}\n## Retro\n\nWent well.\n`, FALLBACK);
    const output = serializeDay(day);
    expect(output).toContain('## Retro');
    expect(output).toContain('Went well.');
    expect(parseDay(output, FALLBACK).extraSections[0]?.heading).toBe('## Retro');
  });

  it('writes the last handled check-in so it survives a restart', () => {
    const day = { ...createDay('2026-08-02', '09:00', '17:00'), lastCheckIn: '14:00' };
    expect(serializeDay(day)).toContain('last_check_in: 14:00');
    expect(parseDay(serializeDay(day), FALLBACK).lastCheckIn).toBe('14:00');
  });

  it('omits the check-in key entirely when nothing has been handled', () => {
    expect(serializeDay(createDay('2026-08-02', '09:00', '17:00'))).not.toContain('last_check_in');
  });

  it('preserves an unowned frontmatter key through a full round trip', () => {
    const day = parseDay('---\ndate: 2026-08-02\nmood: focused\n---\n', FALLBACK);
    expect(serializeDay(day)).toContain('mood: focused');
  });

  it('is idempotent — serializing twice changes nothing', () => {
    const once = serializeDay(parseDay(SAMPLE, FALLBACK));
    const twice = serializeDay(parseDay(once, FALLBACK));
    expect(twice).toBe(once);
  });
});

describe('addNote', () => {
  it('appends a note', () => {
    const day = addNote(createDay('2026-08-02', '09:00', '17:00'), '10:00', 'something');
    expect(day.notes).toEqual([{ time: '10:00', text: 'something' }]);
  });

  it('ignores blank text', () => {
    const base = createDay('2026-08-02', '09:00', '17:00');
    expect(addNote(base, '10:00', '   ').notes).toEqual([]);
  });

  it('does not mutate the input document', () => {
    const base = createDay('2026-08-02', '09:00', '17:00');
    addNote(base, '10:00', 'something');
    expect(base.notes).toEqual([]);
  });
});

describe('createDay', () => {
  it('seeds tasks carried in from a previous day', () => {
    const day = createDay('2026-08-03', '09:00', '17:00', [
      { title: 'Carried', status: 'in-progress', carriedOver: true },
    ]);
    expect(day.tasks).toHaveLength(1);
    expect(serializeDay(day)).toContain('- [/] Carried');
  });
});
