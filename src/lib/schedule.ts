/**
 * When to interrupt you, and with which kind of check-in.
 *
 * The model is **slots, not timers**. Each workday has a fixed set of check-in
 * slots derived from the work window — a `day-start` slot, an `hourly` slot on
 * each hour in between, and a `day-end` slot — and the app asks "which slot is
 * current, and have I already handled it?".
 *
 * That indirection is the whole point, because a naive `setInterval(HOUR)`
 * breaks in exactly the ways a laptop breaks:
 *
 * - **Sleep/wake.** Close the lid at 11:55, reopen at 15:30. An interval-based
 *   scheduler either fires nothing (the timer never ran) or fires four stacked
 *   prompts. Slots collapse to one: at 15:30 the current slot is 15:00, and the
 *   missed 12:00–14:00 slots are simply past.
 * - **Clock drift and DST.** Slots are recomputed from wall-clock time on every
 *   evaluation, so an hour that repeats or vanishes resolves correctly instead
 *   of accumulating error.
 * - **Launching mid-day.** Start the app at 14:20 and it immediately knows the
 *   14:00 slot is outstanding, without waiting an hour for the first tick.
 */

import { formatClock, minutesSinceMidnight, parseClock, toDateKey, type DateKey } from './dates.ts';
import type { Settings } from './settings.ts';
import { MS_PER_MINUTE } from './time.ts';

/** Which prompt is due. */
export type CheckInKind = 'day-start' | 'hourly' | 'day-end';

export interface CheckInSlot {
  kind: CheckInKind;
  /** Stable identity, e.g. `2026-08-02T14:00`. Used to mark a slot handled. */
  key: string;
  /** Local date the slot belongs to. */
  date: DateKey;
  /** Minutes since local midnight. */
  minutes: number;
}

/** What the scheduler needs to remember between evaluations. */
export interface CheckInState {
  /** Key of the most recently handled slot (submitted or dismissed). */
  handledSlotKey: string | null;
  /** Epoch ms until which the current slot is snoozed, if any. */
  snoozedUntil: number | null;
}

export const INITIAL_CHECK_IN_STATE: CheckInState = {
  handledSlotKey: null,
  snoozedUntil: null,
};

/**
 * How often to re-evaluate the scheduler. A minute is fine-grained enough that a
 * prompt never lands more than 60s late, and cheap enough to run all day — the
 * evaluation is pure arithmetic with no I/O.
 */
export const SCHEDULER_TICK_MS = MS_PER_MINUTE;

function slotKey(date: DateKey, minutes: number): string {
  const hours = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mins = String(minutes % 60).padStart(2, '0');
  return `${date}T${hours}:${mins}`;
}

/** `true` on Saturday or Sunday. */
export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/**
 * The slot that is current at `now`, or `null` outside the work window.
 *
 * "Current" means the latest slot at or before `now` — which is what makes
 * missed slots coalesce instead of queueing.
 */
export function currentSlot(now: Date, settings: Settings): CheckInSlot | null {
  if (!settings.includeWeekends && isWeekend(now)) return null;

  const start = parseClock(settings.workStart);
  const end = parseClock(settings.workEnd);
  if (start === null || end === null || start >= end) return null;

  const date = toDateKey(now);
  const nowMinutes = minutesSinceMidnight(now);

  if (nowMinutes < start) return null;

  // Past the end of the day, the outstanding slot is the wrap-up — and it stays
  // outstanding all evening, so logging off at 17:00 and opening the laptop at
  // 21:00 still gets you the end-of-day prompt rather than silence.
  if (nowMinutes >= end) {
    return { kind: 'day-end', key: slotKey(date, end), date, minutes: end };
  }

  if (nowMinutes < start + 60) {
    return { kind: 'day-start', key: slotKey(date, start), date, minutes: start };
  }

  // Hourly slots land on the hour, not on `start + n*60`: a 09:30 work start
  // should still nudge at 10:00, 11:00, … rather than 10:30, 11:30.
  const slotMinutes = Math.floor(nowMinutes / 60) * 60;
  return { kind: 'hourly', key: slotKey(date, slotMinutes), date, minutes: slotMinutes };
}

/** `true` when some check-in has already been handled on `date`. */
export function hasHandledToday(state: CheckInState, date: DateKey): boolean {
  return state.handledSlotKey?.startsWith(`${date}T`) === true;
}

/**
 * The check-in to show right now, or `null` for "leave the user alone".
 *
 * A slot is due when it is current, not already handled, and not snoozed.
 *
 * **The first check-in of a day is always a `day-start`,** whatever the hour.
 * `currentSlot` picks the kind from the clock alone, so booting at 11:30 — the
 * machine was off at 09:00, or you started late — would otherwise serve a
 * routine hourly nudge and you'd never be shown your day or what carried over.
 * Having seen your day is a question about state, not about what time it is.
 *
 * The upgrade changes the slot's *kind* but keeps the current slot's *key*, so
 * finishing a day-start surfaced at 11:30 marks the 11:00 slot handled. Keeping
 * the 09:00 key instead would leave 11:00 outstanding and fire a second prompt a
 * minute later.
 */
export function dueCheckIn(now: Date, settings: Settings, state: CheckInState): CheckInSlot | null {
  const current = currentSlot(now, settings);
  if (current === null) return null;

  // Only `hourly` is upgraded: past the work end the wrap-up is the more useful
  // prompt, even on a day where nothing was ever logged.
  const slot: CheckInSlot =
    current.kind === 'hourly' && !hasHandledToday(state, current.date)
      ? { ...current, kind: 'day-start' }
      : current;

  if (state.handledSlotKey === slot.key) return null;
  // Checked after the upgrade: with hourly nudges switched off you still get
  // your day once, because day-start and day-end always fire.
  if (slot.kind === 'hourly' && !settings.hourlyEnabled) return null;
  if (state.snoozedUntil !== null && now.getTime() < state.snoozedUntil) return null;

  return slot;
}

/**
 * Mark a slot handled — the user submitted it or dismissed it.
 *
 * Clears any snooze: the slot is finished, so a pending deferral of it is moot.
 */
export function markHandled(slot: CheckInSlot): CheckInState {
  return { handledSlotKey: slot.key, snoozedUntil: null };
}

/** The `HH:MM` to record in a day file so a slot survives a restart. */
export function slotClock(slot: CheckInSlot): string {
  return formatClock(slot.minutes);
}

/**
 * Rebuild scheduler state from what a day file recorded.
 *
 * Called at startup. Without it the scheduler starts every launch believing
 * nothing has been handled today, so a reboot at 14:30 re-prompts for the 14:00
 * check-in you already completed — the app nagging you for finished work.
 *
 * A snooze is deliberately *not* restored. It's a sub-hour deferral, and if the
 * machine was off long enough to restart you are back at the keyboard now; being
 * asked once on return is the better failure than silently swallowing a slot.
 */
export function restoreCheckInState(date: DateKey, lastCheckIn: string | undefined): CheckInState {
  if (lastCheckIn === undefined) return { ...INITIAL_CHECK_IN_STATE };

  const minutes = parseClock(lastCheckIn);
  if (minutes === null) return { ...INITIAL_CHECK_IN_STATE };

  return { handledSlotKey: slotKey(date, minutes), snoozedUntil: null };
}

/** Defer the current slot without handling it. */
export function snooze(state: CheckInState, now: Date, settings: Settings): CheckInState {
  return {
    handledSlotKey: state.handledSlotKey,
    snoozedUntil: now.getTime() + settings.snoozeMinutes * MS_PER_MINUTE,
  };
}

/**
 * The slot to open for an explicit "check in now", which ignores whether the
 * current slot was already handled.
 *
 * Returns the *real* current slot whenever there is one. Minting a fresh slot
 * keyed to the current minute looks equivalent and isn't: finishing a
 * 14:30-keyed ad-hoc slot would leave the genuine 14:00 slot unhandled, so the
 * scheduler would re-prompt within the minute — punishing the user for checking
 * in early.
 *
 * Outside the work window there is no current slot, so one is synthesized.
 * That's safe precisely because nothing is due out there for it to shadow.
 */
export function onDemandSlot(now: Date, settings: Settings): CheckInSlot {
  const current = currentSlot(now, settings);
  if (current !== null) return current;

  const date = toDateKey(now);
  const minutes = minutesSinceMidnight(now);
  return { kind: 'hourly', key: slotKey(date, minutes), date, minutes };
}

/** Human label for a slot, used as the check-in card's headline. */
export function describeCheckIn(kind: CheckInKind): string {
  switch (kind) {
    case 'day-start':
      return "Here's your day";
    case 'hourly':
      return 'Quick check-in';
    case 'day-end':
      return 'Wrapping up';
  }
}
