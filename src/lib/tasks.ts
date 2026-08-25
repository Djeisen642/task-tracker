/**
 * The task model and its transitions.
 *
 * Deliberately three states, a title, and the date it first appeared. Every
 * extra field the *user* has to fill is friction on a prompt you see eight
 * times a day, and a check-in you resent filling in is a check-in you stop
 * filling in — so `added` is stamped by the app and never typed. Projects,
 * estimates and time tracking are tracked in `docs/future-work.md`, not here.
 */

import type { DateKey } from './dates.ts';

/** Where a task stands. Mirrors the checkbox markers in the day file. */
export type TaskStatus = 'upcoming' | 'in-progress' | 'completed';

export interface Task {
  /** Free text, exactly as typed. Rendered with `textContent`, never HTML. */
  title: string;
  status: TaskStatus;
  /**
   * The checkbox character this task was read from, when it isn't one of the
   * three the app writes — `[-]`, `[>]`, and other tools' conventions.
   *
   * Carried so a write doesn't turn somebody's cancelled or deferred item into
   * live work. Dropped as soon as the status changes, because at that point the
   * app does know what the line means. See `renderTaskLine`.
   */
  marker?: string;
  /**
   * The day this task first appeared, preserved as it carries forward.
   *
   * This is the one thing about a task that cannot be recovered by reading the
   * file it lives in. A day file's own date tells you when a task was
   * *completed* — the `[x]` is sitting in that day. Nothing tells you when it
   * started, so "this took five days" and "this kept slipping" are only
   * answerable by diffing consecutive files and matching on title, which is
   * exactly the kind of reconstruction an agent does confidently and wrong.
   *
   * Optional because team-file tasks (`team.<person>.md`) don't carry it —
   * that file spans many days and stamps completion instead.
   */
  added?: DateKey;
  /**
   * Where this task sits in today's top five, `1` being first.
   *
   * Optional, and *staying* optional is the point: a day with nothing ranked
   * behaves exactly as it did before ranking existed. Only the tasks the user
   * deliberately picked out carry a number, and the numbers are always a dense
   * `1…n` over the open ones — see `normalizePriorities`, which is what makes
   * finishing your number two promote number three rather than leave a hole.
   *
   * Never set on a completed task: a rank is a claim about what to do next, so
   * it leaves with the work. Team-file tasks don't carry one either — the top
   * five is the user's own day, not a ranking imposed on someone else's.
   */
  priority?: number;
}

/**
 * How many tasks may carry a rank at once.
 *
 * Five because the list has to fit on a card the user glances at eight times a
 * day, and because a "top ten" is just the task list with extra typing.
 */
export const MAX_PRIORITIES = 5;

/** Statuses that mean "still on your plate". */
export const OPEN_STATUSES: readonly TaskStatus[] = ['upcoming', 'in-progress'];

/** `true` when the task still needs work. */
export function isOpen(task: Task): boolean {
  return OPEN_STATUSES.includes(task.status);
}

/**
 * Compare two titles for identity. Tasks are keyed by title within a day — no
 * synthetic IDs, because an ID in the file is noise to every human and agent
 * that reads it. Case and surrounding whitespace are ignored so re-typing a
 * carried-over task doesn't duplicate it.
 */
export function sameTask(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * The status a task moves to when its checkbox is clicked:
 * upcoming → in-progress → completed → upcoming.
 */
export function cycleStatus(status: TaskStatus): TaskStatus {
  switch (status) {
    case 'upcoming':
      return 'in-progress';
    case 'in-progress':
      return 'completed';
    case 'completed':
      return 'upcoming';
  }
}

/** Strip a rank, without leaving an explicit `undefined` behind to serialize. */
function withoutPriority(task: Task): Task {
  if (task.priority === undefined) return task;

  const { priority: _priority, ...rest } = task;
  return rest;
}

/**
 * Ranked tasks with their position in the array, in rank order.
 *
 * **Open tasks only.** A rank on a completed task is something only a hand edit
 * can produce, and every function that reads the ranking has to agree to ignore
 * it — otherwise five finished rows can report the list as full while the card
 * shows nothing to unrank. `normalizePriorities` strips those ranks on the next
 * write; until then they are invisible to the model.
 *
 * The index travels with the task because titles are not a safe key: `sameTask`
 * is case- and whitespace-insensitive, so a hand-edited file can hold two tasks
 * one title matches.
 */
function rankedEntries(tasks: readonly Task[]): { task: Task; index: number }[] {
  return tasks
    .map((task, index) => ({ task, index }))
    .filter(({ task }) => task.priority !== undefined && isOpen(task))
    .sort((a, b) => (a.task.priority ?? 0) - (b.task.priority ?? 0) || a.index - b.index);
}

/** The ranked tasks, in rank order. Empty when nothing has been ranked. */
export function priorityTasks(tasks: readonly Task[]): Task[] {
  return rankedEntries(tasks).map(({ task }) => task);
}

/** `true` when all five slots are taken, so nothing else can be promoted. */
export function prioritiesFull(tasks: readonly Task[]): boolean {
  return priorityTasks(tasks).length >= MAX_PRIORITIES;
}

/**
 * Re-number the ranks to a dense `1…n` over the open tasks that carry one.
 *
 * This is the whole behaviour of the feature, in one place: finish your number
 * two and number three becomes the new number two, rather than the list reading
 * `1, 3, 4` for the rest of the day. It runs after *every* mutation, because
 * every mutation can break the invariant — completing, removing, un-ranking,
 * carrying over into tomorrow, or a hand edit that numbered eight things.
 *
 * Three rules, in order:
 *
 * 1. A completed task keeps no rank. A rank says "do this next"; the work is
 *    done, so it leaves with the work rather than occupying a slot.
 * 2. Ranks compact to `1…n`, keeping their relative order — the user ranked
 *    *this before that*, and nothing here should reorder that judgement.
 * 3. Anything past `MAX_PRIORITIES` is unranked. Only reachable by hand-editing
 *    a day file, since the card stops offering the star at five.
 */
export function normalizePriorities(tasks: readonly Task[]): Task[] {
  const ranked: { rank: number; index: number }[] = [];

  tasks.forEach((task, index) => {
    const rank = task.priority;
    // Rule 1: completed work drops out here rather than being renumbered.
    if (rank === undefined || !isOpen(task)) return;
    ranked.push({ rank, index });
  });

  // Ties (two hand-written `_(priority 2)_`s) fall back to file order, so the
  // result is deterministic rather than dependent on the sort's stability.
  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);

  const assigned = new Map<number, number>();
  ranked.slice(0, MAX_PRIORITIES).forEach(({ index }, position) => {
    assigned.set(index, position + 1);
  });

  return tasks.map((task, index) => {
    const rank = assigned.get(index);
    if (rank === undefined) return withoutPriority(task);
    return rank === task.priority ? task : { ...task, priority: rank };
  });
}

/**
 * Promote an unranked task to the end of the top five, or drop a ranked one
 * back out of it — the single action behind the star on each row.
 *
 * Deliberately not "set rank 3": choosing a number means comparing against four
 * other numbers, on a card seen eight times a day. Picking them in order gets
 * the same list with one click each, and the remaining ranks close up when one
 * leaves. A full list is a no-op rather than a silent eviction of number five.
 */
export function togglePriority(tasks: readonly Task[], title: string): Task[] {
  const target = tasks.find((task) => sameTask(task.title, title));
  if (target === undefined) return [...tasks];

  if (target.priority !== undefined) {
    return normalizePriorities(
      tasks.map((task) => (sameTask(task.title, title) ? withoutPriority(task) : task)),
    );
  }

  // Ranking finished work would be undone by the very next normalize.
  if (!isOpen(target) || prioritiesFull(tasks)) return [...tasks];

  const last = tasks.reduce((highest, task) => Math.max(highest, task.priority ?? 0), 0);
  return normalizePriorities(
    tasks.map((task) => (sameTask(task.title, title) ? { ...task, priority: last + 1 } : task)),
  );
}

/** Which way a task moves through the ranking. */
export type PriorityMove = 'up' | 'down';

/**
 * Move a ranked task one place up or down the top five, swapping with its
 * neighbour. A no-op at either end, and for a task that isn't ranked.
 *
 * Swapping rather than inserting-and-shifting, because with at most five items
 * the two are identical for adjacent moves and swapping cannot renumber a task
 * the user didn't touch. Repeated presses walk a task to the top, which is the
 * gesture this is really for: something became urgent at 11:00 and needs to be
 * number one now.
 */
export function movePriority(
  tasks: readonly Task[],
  title: string,
  direction: PriorityMove,
): Task[] {
  // Normalize first so "one place" is meaningful even if the file arrived with
  // ranks like 2, 5, 9 from a hand edit.
  const normalized = normalizePriorities(tasks);
  const ranked = rankedEntries(normalized);

  const from = ranked.findIndex(({ task }) => sameTask(task.title, title));
  const to = from + (direction === 'up' ? -1 : 1);
  if (from === -1 || to < 0 || to >= ranked.length) return normalized;

  const moved = ranked[from];
  const displaced = ranked[to];
  if (moved === undefined || displaced === undefined) return normalized;

  // Swapped by position, not by title: two tasks whose titles `sameTask` treats
  // as one (a hand-edited "Review PR" and "review pr") would otherwise both take
  // the same new rank and quietly delete the other one from the ranking.
  return normalized.map((task, index) => {
    if (index === moved.index) return { ...task, priority: displaced.task.priority };
    if (index === displaced.index) return { ...task, priority: moved.task.priority };
    return task;
  });
}

/**
 * Order tasks for the check-in card: today's top five first in rank order, then
 * in-progress, then upcoming, then newly completed.
 *
 * The ranked block leads because that is the entire point of ranking — a list
 * whose top five are scattered through it in status order is a list you still
 * have to read in full.
 */
export function tasksForCheckIn(
  tasks: readonly Task[],
  previouslyCompleted: ReadonlySet<string> = new Set(),
): Task[] {
  const inProgress: Task[] = [];
  const upcoming: Task[] = [];
  const doneThisSession: Task[] = [];

  // `priorityTasks` is open-only, so a rank a hand edit left on completed work
  // doesn't drag yesterday's finished task to the top of today's card.
  const ranked = priorityTasks(tasks);

  for (const task of tasks) {
    if (ranked.includes(task)) {
      continue;
    } else if (task.status === 'in-progress') {
      inProgress.push(task);
    } else if (task.status === 'upcoming') {
      upcoming.push(task);
    } else if (!wasCompletedBefore(task.title, previouslyCompleted)) {
      doneThisSession.push(task);
    }
  }

  return [...ranked, ...inProgress, ...upcoming, ...doneThisSession];
}

/** Titles that were already done when this check-in opened — hidden until day-end. */
export function completedBeforeCheckIn(tasks: readonly Task[]): Set<string> {
  const titles = new Set<string>();
  for (const task of tasks) {
    if (task.status === 'completed') titles.add(task.title);
  }
  return titles;
}

function wasCompletedBefore(title: string, previouslyCompleted: ReadonlySet<string>): boolean {
  for (const existing of previouslyCompleted) {
    if (sameTask(existing, title)) return true;
  }
  return false;
}

/**
 * Append a task, ignoring blank titles and exact duplicates.
 *
 * Returns a new array; the input is never mutated.
 */
export function addTask(
  tasks: readonly Task[],
  title: string,
  status: TaskStatus = 'upcoming',
  added?: DateKey,
): Task[] {
  const trimmed = title.trim();
  if (trimmed === '') return [...tasks];
  if (tasks.some((task) => sameTask(task.title, trimmed))) return [...tasks];

  return [...tasks, { title: trimmed, status, ...(added === undefined ? {} : { added }) }];
}

/**
 * Set the status of one task. Returns a new array.
 *
 * Identified by *reference*, not by title. `sameTask` deliberately ignores case
 * and surrounding whitespace so re-typing a carried-over task doesn't duplicate
 * it, which makes it the wrong key for "which row did the user just click": a
 * hand-edited file holding `- Ship it` and `- [ ] ship it` is two lines and two
 * rows, and matching on the title hits both.
 *
 * Normalizes on the way out, which is what makes completing your number two
 * promote number three. Every mutator here does the same, so the `1…n`
 * invariant is a property of the model rather than something each caller has to
 * remember — and the check-in card is not the only caller.
 */
export function setTaskStatus(tasks: readonly Task[], target: Task, status: TaskStatus): Task[] {
  return normalizePriorities(tasks.map((task) => (task === target ? { ...task, status } : task)));
}

/** Remove one task, identified by reference. Returns a new array. */
export function removeTask(tasks: readonly Task[], target: Task): Task[] {
  return normalizePriorities(tasks.filter((task) => task !== target));
}

/**
 * The open tasks to seed tomorrow with.
 *
 * Completed work stays behind in the day that finished it — carrying it forward
 * would make every day file an ever-growing copy of the last. In-progress tasks
 * keep their status (you were mid-flight, you still are); upcoming tasks stay
 * upcoming.
 *
 * `previousDate` is the day being carried *from*, and stamps any task that has
 * no `added` date yet — a file written before this field existed, or one a hand
 * edit introduced a task into. It is a floor, not a correction: the task was
 * demonstrably alive on that day, even if it first appeared earlier.
 */
export function carryOverTasks(previous: readonly Task[], previousDate: DateKey): Task[] {
  return normalizePriorities(
    previous.filter(isOpen).map((task) => ({
      title: task.title,
      status: task.status,
      added: task.added ?? previousDate,
      // Yesterday's ranking is the best guess at today's, and it compacts on
      // the way through: finishing your number one leaves tomorrow opening
      // with a number one rather than a list that starts at two.
      ...(task.priority === undefined ? {} : { priority: task.priority }),
    })),
  );
}

/**
 * `true` when this task reached `dayDate` from an earlier day — what the card
 * marks as "slipped".
 *
 * Derived rather than stored: a flag set at carry-over time is gone the moment
 * the app restarts and re-reads the file, so the marker used to vanish mid-day
 * for exactly the tasks it was there to highlight.
 */
export function isCarriedOver(task: Task, dayDate: DateKey): boolean {
  return task.added !== undefined && task.added < dayDate;
}

/** Counts by status, for the tray tooltip and the day heading. */
export interface TaskSummary {
  upcoming: number;
  inProgress: number;
  completed: number;
  open: number;
  total: number;
}

export function summarizeTasks(tasks: readonly Task[]): TaskSummary {
  const upcoming = tasks.filter((task) => task.status === 'upcoming').length;
  const inProgress = tasks.filter((task) => task.status === 'in-progress').length;
  const completed = tasks.filter((task) => task.status === 'completed').length;

  return {
    upcoming,
    inProgress,
    completed,
    open: upcoming + inProgress,
    total: tasks.length,
  };
}
