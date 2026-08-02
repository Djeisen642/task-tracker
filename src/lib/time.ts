/**
 * Time-unit conversion constants, in milliseconds.
 *
 * Centralized so the same `60_000` / `1_000` literals aren't re-spelled across
 * the check-in scheduler, the UI tick, and the tests.
 */

export const MS_PER_SECOND = 1_000;
export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MINUTES_PER_DAY = 1_440;
