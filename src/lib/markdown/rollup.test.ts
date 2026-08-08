import { describe, expect, it } from 'vitest';

import { addNote, createDay, type DayDocument } from './day.ts';
import {
  agentWeekBriefing,
  collectKudos,
  standupSummary,
  weeklyRollup,
  weekFileName,
} from './rollup.ts';

function day(date: string, tasks: DayDocument['tasks'], notes: [string, string][] = []) {
  let doc = createDay(date, '09:00', '17:00', tasks);
  for (const [time, text] of notes) doc = addNote(doc, time, text);
  return doc;
}

describe('standupSummary', () => {
  const today = day('2026-08-04', [
    { title: 'Ship the rollback', status: 'in-progress' },
    { title: 'Draft the RFC', status: 'upcoming' },
    { title: 'Already done', status: 'completed' },
  ]);

  const yesterday = day('2026-08-03', [
    { title: 'Review the checklist', status: 'completed' },
    { title: 'Ship the rollback', status: 'in-progress' },
  ]);

  it("lists yesterday's completed work", () => {
    const summary = standupSummary(today, yesterday);
    expect(summary).toContain('Since Monday, 3 August 2026:');
    expect(summary).toContain('- Review the checklist');
  });

  it("omits yesterday's unfinished work from the completed list", () => {
    const summary = standupSummary(today, yesterday);
    const sinceSection = summary.split('Today:')[0] ?? '';
    expect(sinceSection).not.toContain('Ship the rollback');
  });

  it("lists today's open work and omits what's already done", () => {
    const summary = standupSummary(today, yesterday);
    expect(summary).toContain('- Ship the rollback');
    expect(summary).toContain('- Draft the RFC');
    expect(summary).not.toContain('Already done');
  });

  it('omits the "since" block when there is no previous day', () => {
    expect(standupSummary(today, null)).not.toContain('Since');
  });

  it('says so explicitly when nothing is planned', () => {
    expect(standupSummary(day('2026-08-04', []), null)).toContain('Nothing planned yet');
  });

  it('says so explicitly when nothing was completed', () => {
    expect(standupSummary(today, day('2026-08-03', []))).toContain('Nothing marked complete');
  });

  it('surfaces blockers as their own section', () => {
    const blocked = day('2026-08-04', [], [['11:00', 'waiting on infra #blocker']]);
    const summary = standupSummary(blocked, null);
    expect(summary).toContain('Blockers:');
    expect(summary).toContain('waiting on infra #blocker');
  });

  it('omits the blockers section when there are none', () => {
    expect(standupSummary(today, null)).not.toContain('Blockers:');
  });

  it('emits plain text with no Markdown headings, for pasting into chat', () => {
    expect(standupSummary(today, yesterday)).not.toContain('#');
  });
});

describe('collectKudos', () => {
  it('groups kudos notes by the people they mention', () => {
    const days = [
      day('2026-08-03', [], [['10:00', '@alice saved the release #kudos']]),
      day('2026-08-04', [], [['11:00', '@bob wrote the runbook #kudos']]),
    ];
    expect(collectKudos(days)).toEqual([
      { person: 'alice', moments: ['2026-08-03 — @alice saved the release #kudos'] },
      { person: 'bob', moments: ['2026-08-04 — @bob wrote the runbook #kudos'] },
    ]);
  });

  it('files a kudos note that names two people under both', () => {
    const days = [day('2026-08-03', [], [['10:00', '@alice and @bob paired on it #kudos']])];
    expect(collectKudos(days).map((entry) => entry.person)).toEqual(['alice', 'bob']);
  });

  it('files an unattributed kudos under "me" rather than dropping it', () => {
    const days = [day('2026-08-03', [], [['10:00', 'landed the migration #kudos']])];
    expect(collectKudos(days)).toEqual([
      { person: 'me', moments: ['2026-08-03 — landed the migration #kudos'] },
    ]);
  });

  it('ignores notes that mention someone without the kudos tag', () => {
    const days = [day('2026-08-03', [], [['10:00', '@alice asked about the RFC']])];
    expect(collectKudos(days)).toEqual([]);
  });

  it('accumulates several moments for one person', () => {
    const days = [
      day('2026-08-03', [], [['10:00', '@alice one #kudos']]),
      day('2026-08-04', [], [['10:00', '@alice two #kudos']]),
    ];
    expect(collectKudos(days)[0]?.moments).toHaveLength(2);
  });

  it('returns nothing for an empty vault', () => {
    expect(collectKudos([])).toEqual([]);
  });
});

describe('weeklyRollup', () => {
  const week = [
    day('2026-08-03', [{ title: 'Review the checklist', status: 'completed' }]),
    day(
      '2026-08-04',
      [
        { title: 'Ship the rollback', status: 'completed' },
        { title: 'Draft the RFC', status: 'in-progress' },
      ],
      [['10:00', '@alice saved the release #kudos']],
    ),
  ];

  it('titles the file with the ISO week', () => {
    expect(weeklyRollup(week)).toContain('# Week 2026-W32');
  });

  it('counts the days logged', () => {
    expect(weeklyRollup(week)).toContain('Days logged: 2');
  });

  it('lists completed work from every day, attributed to its date', () => {
    const output = weeklyRollup(week);
    expect(output).toContain('- Review the checklist _(2026-08-03)_');
    expect(output).toContain('- Ship the rollback _(2026-08-04)_');
  });

  it("carries open items from the week's last day only", () => {
    expect(weeklyRollup(week)).toContain('- Draft the RFC');
  });

  it('includes a kudos section grouped by person', () => {
    const output = weeklyRollup(week);
    expect(output).toContain('### @alice');
    expect(output).toContain('@alice saved the release #kudos');
  });

  it('says so when there were no kudos', () => {
    expect(weeklyRollup([day('2026-08-03', [])])).toContain('_No kudos recorded this week._');
  });

  it('sorts days regardless of the order supplied', () => {
    expect(weeklyRollup([...week].reverse())).toBe(weeklyRollup(week));
  });

  it('handles an empty week without throwing', () => {
    expect(weeklyRollup([])).toContain('Days logged: 0');
  });

  it('never emits three consecutive newlines', () => {
    expect(weeklyRollup(week)).not.toMatch(/\n{3}/);
  });
});

describe('weekFileName', () => {
  it('names the file for the containing week', () => {
    expect(weekFileName('2026-08-04')).toBe('2026-W32.md');
  });

  it('returns null for a malformed date', () => {
    expect(weekFileName('nope')).toBeNull();
  });
});

describe('agentWeekBriefing', () => {
  const days = [
    day(
      '2026-08-03',
      [
        { title: 'Ship the rollback', status: 'completed' },
        { title: 'Draft the RFC', status: 'in-progress' },
      ],
      [['10:00', '@alice saved the release #kudos']],
    ),
    day('2026-08-04', [{ title: 'Draft the RFC', status: 'in-progress' }]),
  ];

  it('carries the week itself', () => {
    const briefing = agentWeekBriefing(days);
    expect(briefing).toContain('# Week 2026-W32');
    expect(briefing).toContain('Ship the rollback');
    expect(briefing).toContain('Draft the RFC');
    expect(briefing).toContain('@alice saved the release #kudos');
  });

  it('carries its own schema key, since the reader never sees CONTEXT.md', () => {
    // The whole point: this is pasted into a chat, not read next to the vault.
    const briefing = agentWeekBriefing(days) ?? '';
    expect(briefing).toContain('`@name` is a colleague');
    expect(briefing).toContain('#kudos');
    expect(briefing).toContain('#blocker');
    expect(briefing).toContain('#decision');
  });

  it('warns off the two readings an agent gets wrong', () => {
    const briefing = agentWeekBriefing(days) ?? '';
    expect(briefing).toContain('not work that was abandoned');
    expect(briefing).toContain('not that nothing happened');
  });

  it('puts the preamble before the rollup, not after it', () => {
    const briefing = agentWeekBriefing(days) ?? '';
    expect(briefing.indexOf('Conventions:')).toBeLessThan(briefing.indexOf('# Week'));
  });

  it('returns null for a week with nothing logged', () => {
    // A briefing whose body is three "Nothing" bullets looks authoritative and
    // says nothing, which is worse than the app admitting it has nothing.
    expect(agentWeekBriefing([])).toBeNull();
  });
});
