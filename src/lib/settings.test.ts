import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SETTINGS,
  MAX_SNOOZE_MINUTES,
  MIN_SNOOZE_MINUTES,
  parseSettings,
  serializeSettings,
} from './settings.ts';

describe('parseSettings', () => {
  it('returns defaults for a non-object', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('nope')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('reads a full settings object', () => {
    const settings = parseSettings({
      workStart: '08:30',
      workEnd: '18:00',
      vaultDir: 'C:\\vault',
      hourlyEnabled: false,
      snoozeMinutes: 20,
      includeWeekends: true,
    });
    expect(settings).toEqual({
      workStart: '08:30',
      workEnd: '18:00',
      vaultDir: 'C:\\vault',
      hourlyEnabled: false,
      snoozeMinutes: 20,
      includeWeekends: true,
    });
  });

  it('normalizes a single-digit hour', () => {
    expect(parseSettings({ workStart: '9:00' }).workStart).toBe('09:00');
  });

  it('falls back for a malformed clock value', () => {
    expect(parseSettings({ workStart: 'lunchtime' }).workStart).toBe(DEFAULT_SETTINGS.workStart);
  });

  it('ignores fields of the wrong type', () => {
    const settings = parseSettings({ hourlyEnabled: 'yes', vaultDir: 42 });
    expect(settings.hourlyEnabled).toBe(DEFAULT_SETTINGS.hourlyEnabled);
    expect(settings.vaultDir).toBe(DEFAULT_SETTINGS.vaultDir);
  });

  it('clamps the snooze into range', () => {
    expect(parseSettings({ snoozeMinutes: 0 }).snoozeMinutes).toBe(MIN_SNOOZE_MINUTES);
    expect(parseSettings({ snoozeMinutes: 9999 }).snoozeMinutes).toBe(MAX_SNOOZE_MINUTES);
  });

  it('rounds a fractional snooze', () => {
    expect(parseSettings({ snoozeMinutes: 10.6 }).snoozeMinutes).toBe(11);
  });

  it('rejects a non-finite snooze', () => {
    expect(parseSettings({ snoozeMinutes: Number.NaN }).snoozeMinutes).toBe(
      DEFAULT_SETTINGS.snoozeMinutes,
    );
  });

  it('restores both ends of an inverted work window', () => {
    const settings = parseSettings({ workStart: '18:00', workEnd: '09:00' });
    expect(settings.workStart).toBe(DEFAULT_SETTINGS.workStart);
    expect(settings.workEnd).toBe(DEFAULT_SETTINGS.workEnd);
  });

  it('rejects a zero-length work window', () => {
    const settings = parseSettings({ workStart: '09:00', workEnd: '09:00' });
    expect(settings.workEnd).toBe(DEFAULT_SETTINGS.workEnd);
  });

  it('keeps other fields when the work window is repaired', () => {
    expect(
      parseSettings({ workStart: '18:00', workEnd: '09:00', snoozeMinutes: 5 }).snoozeMinutes,
    ).toBe(5);
  });
});

describe('serializeSettings', () => {
  it('round-trips through parseSettings', () => {
    const settings = parseSettings({ workStart: '08:00', workEnd: '16:30', snoozeMinutes: 5 });
    expect(parseSettings(JSON.parse(serializeSettings(settings)))).toEqual(settings);
  });

  it('ends with a newline', () => {
    expect(serializeSettings(DEFAULT_SETTINGS).endsWith('\n')).toBe(true);
  });
});
