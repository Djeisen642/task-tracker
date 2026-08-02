import { describe, expect, it } from 'vitest';

import {
  currentSlot,
  describeCheckIn,
  dueCheckIn,
  INITIAL_CHECK_IN_STATE,
  isWeekend,
  markHandled,
  onDemandSlot,
  snooze,
  type CheckInState,
} from './schedule.ts';
import { DEFAULT_SETTINGS, type Settings } from './settings.ts';

/** 2026-08-03 is a Monday, so the weekday path is exercised by default. */
function at(hours: number, minutes = 0): Date {
  return new Date(2026, 7, 3, hours, minutes);
}

const SETTINGS: Settings = { ...DEFAULT_SETTINGS, workStart: '09:00', workEnd: '17:00' };

describe('isWeekend', () => {
  it('identifies Saturday and Sunday', () => {
    expect(isWeekend(new Date(2026, 7, 1))).toBe(true);
    expect(isWeekend(new Date(2026, 7, 2))).toBe(true);
    expect(isWeekend(new Date(2026, 7, 3))).toBe(false);
  });
});

describe('currentSlot', () => {
  it('is null before the workday starts', () => {
    expect(currentSlot(at(8, 30), SETTINGS)).toBeNull();
  });

  it('opens with the day-start slot', () => {
    expect(currentSlot(at(9, 0), SETTINGS)).toMatchObject({
      kind: 'day-start',
      key: '2026-08-03T09:00',
    });
  });

  it('keeps the day-start slot current for its first hour', () => {
    expect(currentSlot(at(9, 45), SETTINGS)?.kind).toBe('day-start');
  });

  it('switches to hourly once the first hour is up', () => {
    expect(currentSlot(at(10, 0), SETTINGS)).toMatchObject({
      kind: 'hourly',
      key: '2026-08-03T10:00',
    });
  });

  it('anchors hourly slots to the hour, not to the work-start offset', () => {
    // A 09:30 start should still nudge at 10:00, not 10:30.
    const shifted: Settings = { ...SETTINGS, workStart: '09:30' };
    expect(currentSlot(at(10, 45), shifted)?.key).toBe('2026-08-03T10:00');
  });

  it('returns the day-end slot at and after the work end time', () => {
    expect(currentSlot(at(17, 0), SETTINGS)).toMatchObject({
      kind: 'day-end',
      key: '2026-08-03T17:00',
    });
    expect(currentSlot(at(21, 30), SETTINGS)?.kind).toBe('day-end');
  });

  it('is null on a weekend by default', () => {
    // 2026-08-01 is a Saturday.
    expect(currentSlot(new Date(2026, 7, 1, 12, 0), SETTINGS)).toBeNull();
  });

  it('includes weekends when configured to', () => {
    const weekends: Settings = { ...SETTINGS, includeWeekends: true };
    expect(currentSlot(new Date(2026, 7, 1, 12, 0), weekends)?.kind).toBe('hourly');
  });

  it('is null when the work window is inverted', () => {
    const broken: Settings = { ...SETTINGS, workStart: '17:00', workEnd: '09:00' };
    expect(currentSlot(at(12, 0), broken)).toBeNull();
  });

  it('collapses a long absence to a single slot', () => {
    // Lid closed at 11:55, reopened at 15:30. An interval-based scheduler would
    // owe four prompts; slots owe exactly one.
    expect(currentSlot(at(15, 30), SETTINGS)?.key).toBe('2026-08-03T15:00');
  });

  it('carries the local date on the slot', () => {
    expect(currentSlot(at(12, 0), SETTINGS)?.date).toBe('2026-08-03');
  });
});

describe('dueCheckIn', () => {
  it('is due when the slot has not been handled', () => {
    expect(dueCheckIn(at(12, 0), SETTINGS, INITIAL_CHECK_IN_STATE)?.kind).toBe('hourly');
  });

  it('is not due once the slot is handled', () => {
    const slot = currentSlot(at(12, 0), SETTINGS)!;
    expect(dueCheckIn(at(12, 30), SETTINGS, markHandled(slot))).toBeNull();
  });

  it('becomes due again at the next hour', () => {
    const slot = currentSlot(at(12, 0), SETTINGS)!;
    const state = markHandled(slot);
    expect(dueCheckIn(at(13, 0), SETTINGS, state)?.key).toBe('2026-08-03T13:00');
  });

  it('fires only once for a whole missed stretch', () => {
    // Away 12:00–15:30, handled on return: the 13:00 and 14:00 slots never
    // reappear, because "current" is always the latest slot.
    const onReturn = currentSlot(at(15, 30), SETTINGS)!;
    const state = markHandled(onReturn);
    expect(dueCheckIn(at(15, 45), SETTINGS, state)).toBeNull();
  });

  it('is suppressed while snoozed and returns when the snooze lapses', () => {
    const snoozed = snooze(INITIAL_CHECK_IN_STATE, at(12, 0), SETTINGS);
    expect(dueCheckIn(at(12, 5), SETTINGS, snoozed)).toBeNull();
    expect(dueCheckIn(at(12, 11), SETTINGS, snoozed)?.kind).toBe('hourly');
  });

  it('still fires day-start and day-end when hourly nudges are off', () => {
    const quiet: Settings = { ...SETTINGS, hourlyEnabled: false };
    expect(dueCheckIn(at(12, 0), quiet, INITIAL_CHECK_IN_STATE)).toBeNull();
    expect(dueCheckIn(at(9, 0), quiet, INITIAL_CHECK_IN_STATE)?.kind).toBe('day-start');
    expect(dueCheckIn(at(17, 0), quiet, INITIAL_CHECK_IN_STATE)?.kind).toBe('day-end');
  });

  it('leaves the user alone outside the work window', () => {
    expect(dueCheckIn(at(7, 0), SETTINGS, INITIAL_CHECK_IN_STATE)).toBeNull();
  });

  it('keeps the day-end check-in outstanding into the evening', () => {
    // Logging off at 17:00 and reopening the laptop at 21:00 should still get
    // the wrap-up prompt rather than silence.
    expect(dueCheckIn(at(21, 0), SETTINGS, INITIAL_CHECK_IN_STATE)?.kind).toBe('day-end');
  });

  it('is due immediately when the app launches mid-day', () => {
    // No waiting an hour for the first tick.
    expect(dueCheckIn(at(14, 20), SETTINGS, INITIAL_CHECK_IN_STATE)?.key).toBe('2026-08-03T14:00');
  });

  it("does not resurrect yesterday's handled slot today", () => {
    const yesterday: CheckInState = { handledSlotKey: '2026-08-02T14:00', snoozedUntil: null };
    expect(dueCheckIn(at(14, 0), SETTINGS, yesterday)?.key).toBe('2026-08-03T14:00');
  });
});

describe('snooze', () => {
  it('defers by the configured number of minutes', () => {
    const state = snooze(INITIAL_CHECK_IN_STATE, at(12, 0), { ...SETTINGS, snoozeMinutes: 15 });
    expect(state.snoozedUntil).toBe(at(12, 15).getTime());
  });

  it('preserves the handled slot so snoozing does not re-open a finished one', () => {
    const handled = markHandled(currentSlot(at(12, 0), SETTINGS)!);
    expect(snooze(handled, at(12, 0), SETTINGS).handledSlotKey).toBe('2026-08-03T12:00');
  });
});

describe('markHandled', () => {
  it('clears a pending snooze', () => {
    const slot = currentSlot(at(12, 0), SETTINGS)!;
    const snoozed = snooze(INITIAL_CHECK_IN_STATE, at(12, 0), SETTINGS);
    expect(markHandled(slot).snoozedUntil).toBeNull();
    expect(snoozed.snoozedUntil).not.toBeNull();
  });
});

describe('onDemandSlot', () => {
  it('returns the real current slot during the workday', () => {
    expect(onDemandSlot(at(14, 30), SETTINGS).key).toBe('2026-08-03T14:00');
  });

  it('does not re-prompt after an early manual check-in', () => {
    // Regression: minting a slot keyed to 14:30 left the genuine 14:00 slot
    // unhandled, so the scheduler fired again a minute later.
    const slot = onDemandSlot(at(14, 30), SETTINGS);
    const state = markHandled(slot);
    expect(dueCheckIn(at(14, 31), SETTINGS, state)).toBeNull();
    expect(dueCheckIn(at(14, 59), SETTINGS, state)).toBeNull();
  });

  it('still lets the next real slot through', () => {
    const state = markHandled(onDemandSlot(at(14, 30), SETTINGS));
    expect(dueCheckIn(at(15, 0), SETTINGS, state)?.key).toBe('2026-08-03T15:00');
  });

  it('synthesizes a slot outside the work window', () => {
    const slot = onDemandSlot(at(7, 15), SETTINGS);
    expect(slot.key).toBe('2026-08-03T07:15');
    expect(slot.date).toBe('2026-08-03');
  });

  it('synthesizes a slot on a weekend', () => {
    expect(onDemandSlot(new Date(2026, 7, 1, 12, 0), SETTINGS).key).toBe('2026-08-01T12:00');
  });

  it('handling a synthesized slot does not suppress the next workday', () => {
    const state = markHandled(onDemandSlot(at(7, 15), SETTINGS));
    expect(dueCheckIn(at(9, 0), SETTINGS, state)?.kind).toBe('day-start');
  });
});

describe('describeCheckIn', () => {
  it('labels every kind', () => {
    expect(describeCheckIn('day-start')).toBe("Here's your day");
    expect(describeCheckIn('hourly')).toBe('Quick check-in');
    expect(describeCheckIn('day-end')).toBe('Wrapping up');
  });
});
