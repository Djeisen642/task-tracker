import { describe, expect, it } from 'vitest';

import {
  addTeamNote,
  createTeamMember,
  parseTeamMember,
  serializeTeamMember,
  updateCompletedDates,
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
- [x] Reviewed the design doc _(2026-08-03)_

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

  it('reads an unknown task marker as upcoming rather than dropping the line', () => {
    // This used to be "skip it rather than guess", on the theory that skipping
    // left the line intact. It did not: the next write re-emitted the section
    // from the parsed tasks only, so the line was deleted from the file — and
    // in the app it was simply never there.
    const member = parseTeamMember('## Tasks\n\n- [?] Mystery\n- [ ] Real\n', FALLBACK);

    expect(member.tasks).toEqual([
      { title: 'Mystery', status: 'upcoming' },
      { title: 'Real', status: 'upcoming' },
    ]);
    expect(serializeTeamMember(member)).toContain('- [ ] Mystery');
  });

  it('reads a bullet with no checkbox as a task', () => {
    const member = parseTeamMember('## Tasks\n\n- Ship the migration\n', FALLBACK);
    expect(member.tasks).toEqual([{ title: 'Ship the migration', status: 'upcoming' }]);
  });

  it('reads a numbered list as tasks', () => {
    const member = parseTeamMember('## Tasks\n\n1. [ ] First\n2) Second\n', FALLBACK);
    expect(member.tasks.map((task) => task.title)).toEqual(['First', 'Second']);
  });

  it('reads a lower-case section heading', () => {
    const member = parseTeamMember('## tasks\n\n- [ ] Ship it\n', FALLBACK);

    expect(member.tasks).toEqual([{ title: 'Ship it', status: 'upcoming' }]);
    expect(member.extraSections).toEqual([]);
  });

  it('keeps a second section of the same name rather than replacing the first', () => {
    const member = parseTeamMember(
      '## Tasks\n\n- [ ] First\n\n## Tasks\n\n- [ ] Second\n',
      FALLBACK,
    );

    expect(member.tasks).toEqual([{ title: 'First', status: 'upcoming' }]);
    expect(member.extraSections).toEqual([
      { heading: '## Tasks', lines: ['', '- [ ] Second', ''] },
    ]);
    expect(serializeTeamMember(member)).toContain('- [ ] Second');
  });

  it('keeps the paragraph break between two preserved paragraphs', () => {
    // The blank line *is* the paragraph break in Markdown. Dropping it as
    // "layout" silently merged two paragraphs of somebody's writing into one.
    const source = '---\nperson: alice\n---\n\n# @alice\n\n## Tasks\n\nPara one.\n\nPara two.\n';
    const written = serializeTeamMember(parseTeamMember(source, FALLBACK));

    expect(written).toContain('Para one.\n\nPara two.');
    expect(serializeTeamMember(parseTeamMember(written, FALLBACK))).toBe(written);
  });

  it("keeps a line that merely resembles a rollup's generated placeholder", () => {
    // Only the placeholders *this* format writes are the app's own output. A
    // weekly rollup's wording is not, and deleting someone's line for looking
    // like generated text is the bug this file is fixing, not an exception.
    const source =
      '---\nperson: alice\n---\n\n# @alice\n\n## Notes\n\n_No kudos recorded this week._\n';

    expect(serializeTeamMember(parseTeamMember(source, FALLBACK))).toContain(
      '_No kudos recorded this week._',
    );
  });

  it('drops its own empty-section placeholder rather than preserving it', () => {
    const source = '---\nperson: alice\n---\n\n# @alice\n\n## Tasks\n\n_Nothing tracked yet._\n';
    const member = parseTeamMember(source, FALLBACK);

    expect(member.preserved.tasks).toEqual({ lead: [], trail: [] });
    // And it comes back exactly once, because the section is still empty.
    expect(serializeTeamMember(member).match(/_Nothing tracked yet\._/g)).toHaveLength(1);
  });

  it('flattens a nested bullet into a task of its own', () => {
    // There is no sub-task in this model, so an indented bullet becomes a task.
    // Documented rather than fixed: the alternative on the way in was deleting
    // the line, and inventing a hierarchy the file format cannot express would
    // be worse than reading it as the flat list the app actually stores.
    const member = parseTeamMember('## Tasks\n\n- [ ] Parent\n  - detail\n', FALLBACK);

    expect(member.tasks.map((task) => task.title)).toEqual(['Parent', 'detail']);
  });

  it('keeps a subheading above the list it introduces', () => {
    // Position is not fully recoverable, but leading and trailing are: a
    // `### This quarter` re-emitted *below* the tasks it labels reads as a bug
    // even though nothing was lost.
    const source = [
      '---',
      'person: alice',
      '---',
      '',
      '# @alice',
      '',
      '## Tasks',
      '',
      '### This quarter',
      '',
      '- [ ] Ship the migration',
      '',
      'Chased legal on Tuesday.',
      '',
    ].join('\n');

    const written = serializeTeamMember(parseTeamMember(source, FALLBACK));
    const tasks = written.split('## Tasks')[1]?.split('## Notes')[0] ?? '';

    expect(tasks.trim().split('\n').filter(Boolean)).toEqual([
      '### This quarter',
      '- [ ] Ship the migration',
      'Chased legal on Tuesday.',
    ]);
    expect(serializeTeamMember(parseTeamMember(written, FALLBACK))).toBe(written);
  });

  it('keeps prose in a section with no items at all', () => {
    const source =
      '---\nperson: alice\n---\n\n# @alice\n\n## Tasks\n\nNothing assigned yet, see the doc.\n';
    const member = parseTeamMember(source, FALLBACK);

    expect(member.preserved.tasks).toEqual({
      lead: ['Nothing assigned yet, see the doc.'],
      trail: [],
    });
    expect(serializeTeamMember(member)).toContain('Nothing assigned yet, see the doc.');
  });

  it('preserves prose inside the sections it owns', () => {
    const source = [
      '---',
      'person: alice',
      '---',
      '',
      '# @alice',
      '',
      'Joined the team in June. Prefers written feedback.',
      '',
      '## Tasks',
      '',
      '### This quarter',
      '',
      '- [ ] Ship the migration',
      '',
      '## Notes',
      '',
      '- Undated thought about the reorg',
      '',
    ].join('\n');

    const member = parseTeamMember(source, FALLBACK);
    expect(member.tasks).toEqual([{ title: 'Ship the migration', status: 'upcoming' }]);

    const written = serializeTeamMember(member);
    expect(written).toContain('Joined the team in June. Prefers written feedback.');
    expect(written).toContain('### This quarter');
    expect(written).toContain('- Undated thought about the reorg');

    // And it stays put: a second write neither loses it nor duplicates it.
    expect(serializeTeamMember(parseTeamMember(written, FALLBACK))).toBe(written);
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

  it('reads the completion date off a completed task', () => {
    expect(parseTeamMember(SAMPLE, FALLBACK).completedDates).toEqual({
      'Reviewed the design doc': '2026-08-03',
    });
  });

  it('does not record a completion date for an open or in-progress task', () => {
    const member = parseTeamMember('## Tasks\n\n- [ ] Upcoming\n- [/] In progress\n', FALLBACK);
    expect(member.completedDates).toEqual({});
  });

  it('leaves a hand-checked task with no recorded date rather than guessing one', () => {
    const member = parseTeamMember('## Tasks\n\n- [x] Checked by hand\n', FALLBACK);
    expect(member.tasks).toEqual([{ title: 'Checked by hand', status: 'completed' }]);
    expect(member.completedDates).toEqual({});
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
    expect(output).toContain('- [x] Reviewed the design doc _(2026-08-03)_');
  });

  it('omits the date suffix for a completed task with no recorded date', () => {
    const member: TeamMemberDocument = {
      ...createTeamMember('alice'),
      tasks: [{ title: 'Checked by hand', status: 'completed' }],
    };
    const output = serializeTeamMember(member);
    expect(output).toContain('- [x] Checked by hand\n');
    expect(output).not.toContain('_(');
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
      completedDates: {},
      notes: [],
      extraFields: {},
      extraSections: [],
      preserved: {
        preamble: [],
        tasks: { lead: [], trail: [] },
        notes: { lead: [], trail: [] },
      },
    });
  });
});

describe('updateCompletedDates', () => {
  const TODAY = '2026-08-10';

  it('stamps today on a task that just became completed', () => {
    const previous = [{ title: 'Ship it', status: 'in-progress' as const }];
    const next = [{ title: 'Ship it', status: 'completed' as const }];
    expect(updateCompletedDates(previous, {}, next, TODAY)).toEqual({ 'Ship it': TODAY });
  });

  it('keeps the existing date for a task that was already completed', () => {
    const previous = [{ title: 'Ship it', status: 'completed' as const }];
    const next = [{ title: 'Ship it', status: 'completed' as const }];
    expect(updateCompletedDates(previous, { 'Ship it': '2026-08-01' }, next, TODAY)).toEqual({
      'Ship it': '2026-08-01',
    });
  });

  it('drops the date for a task reopened from completed', () => {
    const previous = [{ title: 'Ship it', status: 'completed' as const }];
    const next = [{ title: 'Ship it', status: 'upcoming' as const }];
    expect(updateCompletedDates(previous, { 'Ship it': '2026-08-01' }, next, TODAY)).toEqual({});
  });

  it('drops the date for a task that was removed', () => {
    const previous = [{ title: 'Ship it', status: 'completed' as const }];
    expect(updateCompletedDates(previous, { 'Ship it': '2026-08-01' }, [], TODAY)).toEqual({});
  });

  it('re-stamps today for a task completed, reopened, then completed again', () => {
    // Reopening and finishing again is new work, not a continuation of the
    // original completion — it should not keep the stale first date.
    const previous = [{ title: 'Ship it', status: 'in-progress' as const }];
    const next = [{ title: 'Ship it', status: 'completed' as const }];
    // Simulate the prior completion's date still sitting around from before
    // the reopen (the caller would have cleared it on the reopen step, but
    // this proves `justCompleted` — not "has a stale date" — is what decides).
    expect(updateCompletedDates(previous, { 'Ship it': '2026-07-01' }, next, TODAY)).toEqual({
      'Ship it': TODAY,
    });
  });

  it('ignores tasks that are not completed', () => {
    const next = [
      { title: 'Open', status: 'upcoming' as const },
      { title: 'Active', status: 'in-progress' as const },
    ];
    expect(updateCompletedDates([], {}, next, TODAY)).toEqual({});
  });

  it('does not mutate the previous dates object', () => {
    const previousDates = { 'Ship it': '2026-08-01' };
    const previous = [{ title: 'Ship it', status: 'completed' as const }];
    updateCompletedDates(previous, previousDates, previous, TODAY);
    expect(previousDates).toEqual({ 'Ship it': '2026-08-01' });
  });
});
