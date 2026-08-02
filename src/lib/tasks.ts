/**
 * The task model and its transitions.
 *
 * Deliberately three states and a title. Every extra field is friction on a
 * prompt you see eight times a day, and a check-in you resent filling in is a
 * check-in you stop filling in. Projects, estimates and time tracking are
 * tracked in `docs/future-work.md`, not here.
 */

/** Where a task stands. Mirrors the checkbox markers in the day file. */
export type TaskStatus = 'upcoming' | 'in-progress' | 'completed';

export interface Task {
  /** Free text, exactly as typed. Rendered with `textContent`, never HTML. */
  title: string;
  status: TaskStatus;
  /**
   * `true` when this task rolled over from an earlier day. Derived at carry-over
   * time and not persisted — the previous day's file is the record of when a
   * task first appeared.
   */
  carriedOver?: boolean;
}

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

/**
 * Append a task, ignoring blank titles and exact duplicates.
 *
 * Returns a new array; the input is never mutated.
 */
export function addTask(tasks: readonly Task[], title: string, status: TaskStatus = 'upcoming') {
  const trimmed = title.trim();
  if (trimmed === '') return [...tasks];
  if (tasks.some((task) => sameTask(task.title, trimmed))) return [...tasks];

  return [...tasks, { title: trimmed, status }];
}

/** Set the status of the task matching `title`. Returns a new array. */
export function setTaskStatus(tasks: readonly Task[], title: string, status: TaskStatus): Task[] {
  return tasks.map((task) => (sameTask(task.title, title) ? { ...task, status } : task));
}

/** Remove the task matching `title`. Returns a new array. */
export function removeTask(tasks: readonly Task[], title: string): Task[] {
  return tasks.filter((task) => !sameTask(task.title, title));
}

/**
 * The open tasks to seed tomorrow with.
 *
 * Completed work stays behind in the day that finished it — carrying it forward
 * would make every day file an ever-growing copy of the last. In-progress tasks
 * keep their status (you were mid-flight, you still are); upcoming tasks stay
 * upcoming. Both get flagged so the UI can show what slipped.
 */
export function carryOverTasks(previous: readonly Task[]): Task[] {
  return previous.filter(isOpen).map((task) => ({
    title: task.title,
    status: task.status,
    carriedOver: true,
  }));
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
