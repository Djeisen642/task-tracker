/**
 * User settings: the work window, the vault location, and nudge behavior.
 *
 * Settings live in the app config directory rather than the vault, because the
 * vault path itself is a setting — storing it inside the vault would be
 * circular. Parsing is defensive: the file is on disk and hand-editable, so
 * every field is validated and falls back to its default rather than trusting
 * the shape.
 */

import { formatClock, parseClock } from './dates.ts';

export interface Settings {
  /** Local `HH:MM` when the workday starts. */
  workStart: string;
  /** Local `HH:MM` when the workday ends. */
  workEnd: string;
  /**
   * Absolute path to the vault folder. Empty means "use the platform default",
   * resolved on the Rust side (`$DOCUMENT/TaskTracker`) since the frontend has
   * no business knowing OS path conventions.
   */
  vaultDir: string;
  /** Whether the hourly nudge fires at all (day start/end still do). */
  hourlyEnabled: boolean;
  /** How long "Snooze" defers the current check-in. */
  snoozeMinutes: number;
  /** Fire check-ins on Saturday and Sunday too. */
  includeWeekends: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  workStart: '09:00',
  workEnd: '17:00',
  vaultDir: '',
  hourlyEnabled: true,
  snoozeMinutes: 10,
  includeWeekends: false,
};

/** Snooze bounds. Below a minute is a busy-loop; above an hour is the next slot. */
export const MIN_SNOOZE_MINUTES = 1;
export const MAX_SNOOZE_MINUTES = 60;

function readString(source: Record<string, unknown>, key: string, fallback: string): string {
  const value = source[key];
  return typeof value === 'string' ? value : fallback;
}

function readBoolean(source: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = source[key];
  return typeof value === 'boolean' ? value : fallback;
}

function readClock(source: Record<string, unknown>, key: string, fallback: string): string {
  const raw = readString(source, key, fallback);
  const minutes = parseClock(raw);
  // Re-format through `formatClock` so `9:00` is normalized to `09:00`.
  return minutes === null ? fallback : formatClock(minutes);
}

/**
 * Parse settings from parsed JSON of unknown shape.
 *
 * Returns fully-populated `Settings` for any input, including `null` and
 * non-objects — a corrupt settings file must not stop the app from starting.
 */
export function parseSettings(input: unknown): Settings {
  if (typeof input !== 'object' || input === null) {
    return { ...DEFAULT_SETTINGS };
  }

  const source = input as Record<string, unknown>;
  const snoozeRaw = source.snoozeMinutes;
  const snooze =
    typeof snoozeRaw === 'number' && Number.isFinite(snoozeRaw)
      ? Math.min(MAX_SNOOZE_MINUTES, Math.max(MIN_SNOOZE_MINUTES, Math.round(snoozeRaw)))
      : DEFAULT_SETTINGS.snoozeMinutes;

  const settings: Settings = {
    workStart: readClock(source, 'workStart', DEFAULT_SETTINGS.workStart),
    workEnd: readClock(source, 'workEnd', DEFAULT_SETTINGS.workEnd),
    vaultDir: readString(source, 'vaultDir', DEFAULT_SETTINGS.vaultDir),
    hourlyEnabled: readBoolean(source, 'hourlyEnabled', DEFAULT_SETTINGS.hourlyEnabled),
    snoozeMinutes: snooze,
    includeWeekends: readBoolean(source, 'includeWeekends', DEFAULT_SETTINGS.includeWeekends),
  };

  // A window that ends before it starts would make every slot calculation
  // nonsense, so fall back to the defaults as a pair rather than half-fixing it.
  const start = parseClock(settings.workStart);
  const end = parseClock(settings.workEnd);
  if (start === null || end === null || start >= end) {
    settings.workStart = DEFAULT_SETTINGS.workStart;
    settings.workEnd = DEFAULT_SETTINGS.workEnd;
  }

  return settings;
}

/** Serialize settings for `settings.json`. */
export function serializeSettings(settings: Settings): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}
