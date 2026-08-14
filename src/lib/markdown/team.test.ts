import { describe, expect, it } from 'vitest';

import {
  addTeamNote,
  createTeamMember,
  parseTeamMember,
  serializeTeamMember,
  type TeamMemberDocument,
} from './team.ts';

const FALLBACK = { person: 'alice' };

const SAMPLE = `---
person: alice
---

# @alice

## Tasks

- [ ] Migrate the queue consumer
- [/] Onboarding for the new hire
- [x] Reviewed the design doc

## Notes

- 2026-08-10 — Shipped the migration script #kudos
- 2026-08-12 — Waiting on design review #blocker
`;

describe('parseTeamMember', () => {
  it('reads the person from frontmatter', () => {
    expect(parseTeamMember(SAMPLE, FALLBACK).person).toBe('alice');
  });

  it('reads all three task markers', () => {
    expect(parseTeamMember(SAMPLE, FALLBACK).tasks).toEqual([
      { title: 'Migrate the queue consumer', status: 'upcoming' },
      { title: 'Onboarding for the new hire', status: 'in-progress' },
      { title: 'Reviewed the design doc', status: 'completed' },
    ]);
  });

  it('reads dated notes', () => {
    expect(parseTeamMember(SAMPLE, FALLBACK).notes).toEqual([
      { date: '2026-08-10', text: 'Shipped the migration script #kudos' },
      { date: '2026-08-12', text: 'Waiting on design review #blocker' },
    ]);
  });

  it('accepts an en dash or hyphen as the note separator', () => {
    const member = parseTeamMember(
      '## Notes\n\n- 2026-08-01 – en dash\n- 2026-08-02 - hyphen\n',
      FALLBACK,
    );
    expect(member.notes.map((note) => note.text)).toEqual(['en dash', 'hyphen']);
  });

  it('skips an unknown task marker rather than guessing at its meaning', () => {
    const member = parseTeamMember('## Tasks\n\n- [?] Mystery\n- [ ] Real\n', FALLBACK);
    expect(member.tasks).toEqual([{ title: 'Real', status: 'upcoming' }]);
  });

  it('falls back for a file with no frontmatter', () => {
    const member = parseTeamMember('# Hand-written\n', FALLBACK);
    expect(member.person).toBe(FALLBACK.person);
  });

  it('returns an empty document for empty input rather than throwing', () => {
    const member = parseTeamMember('', FALLBACK);
    expect(member.tasks).toEqual([]);
    expect(member.notes).toEqual([]);
    expect(member.person).toBe(FALLBACK.person);
  });

  it('ignores the placeholder lines it writes for empty sections', () => {
    const round = parseTeamMember(serializeTeamMember(createTeamMember('alice')), FALLBACK);
    expect(round.tasks).toEqual([]);
    expect(round.notes).toEqual([]);
  });

  it('keeps unknown frontmatter keys', () => {
    const member = parseTeamMember('---\nperson: alice\nrole: engineer\n---\n', FALLBACK);
    expect(member.extraFields).toEqual({ role: 'engineer' });
  });

  it('keeps sections it does not own', () => {
    const member = parseTeamMember(`${SAMPLE}\n## 1:1 agenda\n\nPromo case.\n`, FALLBACK);
    expect(member.extraSections).toEqual([
      { heading: '## 1:1 agenda', lines: ['', 'Promo case.', ''] },
    ]);
  });
});

describe('serializeTeamMember', () => {
  it('round-trips a parsed document', () => {
    const member = parseTeamMember(SAMPLE, FALLBACK);
    expect(parseTeamMember(serializeTeamMember(member), FALLBACK)).toEqual(member);
  });

  it('writes the @handle heading', () => {
    expect(serializeTeamMember(parseTeamMember(SAMPLE, FALLBACK))).toContain('# @alice');
  });

  it('writes each status with its marker', () => {
    const output = serializeTeamMember(parseTeamMember(SAMPLE, FALLBACK));
    expect(output).toContain('- [ ] Migrate the queue consumer');
    expect(output).toContain('- [/] Onboarding for the new hire');
    expect(output).toContain('- [x] Reviewed the design doc');
  });

  it('sorts notes chronologically regardless of insertion order', () => {
    let member = createTeamMember('alice');
    member = addTeamNote(member, '2026-08-15', 'later');
    member = addTeamNote(member, '2026-08-01', 'earlier');

    const notes = parseTeamMember(serializeTeamMember(member), FALLBACK).notes;
    expect(notes.map((note) => note.text)).toEqual(['earlier', 'later']);
  });

  it('emits placeholders for empty sections so the file never looks broken', () => {
    const output = serializeTeamMember(createTeamMember('alice'));
    expect(output).toContain('_Nothing tracked yet._');
    expect(output).toContain('_No notes yet._');
  });

  it('preserves an unowned section through a full round trip', () => {
    const member = parseTeamMember(`${SAMPLE}\n## 1:1 agenda\n\nPromo case.\n`, FALLBACK);
    const output = serializeTeamMember(member);
    expect(output).toContain('## 1:1 agenda');
    expect(output).toContain('Promo case.');
    expect(parseTeamMember(output, FALLBACK).extraSections[0]?.heading).toBe('## 1:1 agenda');
  });

  it('preserves an unowned frontmatter key through a full round trip', () => {
    const member = parseTeamMember('---\nperson: alice\nrole: engineer\n---\n', FALLBACK);
    expect(serializeTeamMember(member)).toContain('role: engineer');
  });

  it('is idempotent — serializing twice changes nothing', () => {
    const once = serializeTeamMember(parseTeamMember(SAMPLE, FALLBACK));
    const twice = serializeTeamMember(parseTeamMember(once, FALLBACK));
    expect(twice).toBe(once);
  });

  it('falls back to the raw key when the person is somehow unset', () => {
    const member: TeamMemberDocument = { ...createTeamMember('alice'), person: '' };
    expect(serializeTeamMember(member)).toContain('person: \n');
  });
});

describe('addTeamNote', () => {
  it('appends a note', () => {
    const member = addTeamNote(createTeamMember('alice'), '2026-08-10', 'something');
    expect(member.notes).toEqual([{ date: '2026-08-10', text: 'something' }]);
  });

  it('ignores blank text', () => {
    const base = createTeamMember('alice');
    expect(addTeamNote(base, '2026-08-10', '   ').notes).toEqual([]);
  });

  it('does not mutate the input document', () => {
    const base = createTeamMember('alice');
    addTeamNote(base, '2026-08-10', 'something');
    expect(base.notes).toEqual([]);
  });
});

describe('createTeamMember', () => {
  it('starts empty', () => {
    const member = createTeamMember('alice');
    expect(member).toEqual({
      person: 'alice',
      tasks: [],
      notes: [],
      extraFields: {},
      extraSections: [],
    });
  });
});
