import { describe, expect, it } from 'vitest';

import {
  addTask,
  carryOverTasks,
  completedBeforeCheckIn,
  cycleStatus,
  isCarriedOver,
  isOpen,
  MAX_PRIORITIES,
  normalizePriorities,
  prioritiesFull,
  priorityTasks,
  removeTask,
  sameTask,
  setTaskStatus,
  summarizeTasks,
  tasksForCheckIn,
  togglePriority,
  type Task,
} from './tasks.ts';

const TASKS: Task[] = [
  { title: 'Draft the RFC', status: 'upcoming' },
  { title: 'Ship the rollback', status: 'in-progress' },
  { title: 'Review the checklist', status: 'completed' },
];

describe('isOpen', () => {
  it('counts upcoming and in-progress as open', () => {
    expect(isOpen({ title: 'a', status: 'upcoming' })).toBe(true);
    expect(isOpen({ title: 'b', status: 'in-progress' })).toBe(true);
    expect(isOpen({ title: 'c', status: 'completed' })).toBe(false);
  });
});

describe('sameTask', () => {
  it('ignores case and surrounding whitespace', () => {
    expect(sameTask('Draft the RFC', '  draft the rfc  ')).toBe(true);
  });

  it('distinguishes different titles', () => {
    expect(sameTask('Draft the RFC', 'Draft the ADR')).toBe(false);
  });
});

describe('cycleStatus', () => {
  it('advances upcoming → in-progress → completed → upcoming', () => {
    expect(cycleStatus('upcoming')).toBe('in-progress');
    expect(cycleStatus('in-progress')).toBe('completed');
    expect(cycleStatus('completed')).toBe('upcoming');
  });

  it('returns to the start after three steps', () => {
    expect(cycleStatus(cycleStatus(cycleStatus('upcoming')))).toBe('upcoming');
  });
});

describe('tasksForCheckIn', () => {
  it('puts in-progress work first, then upcoming, then completed', () => {
    expect(tasksForCheckIn(TASKS).map((task) => task.title)).toEqual([
      'Ship the rollback',
      'Draft the RFC',
      'Review the checklist',
    ]);
  });

  it('preserves relative order within each group', () => {
    const tasks: Task[] = [
      { title: 'First done', status: 'completed' },
      { title: 'Still open', status: 'upcoming' },
      { title: 'Second done', status: 'completed' },
      { title: 'Also open', status: 'in-progress' },
    ];

    expect(tasksForCheckIn(tasks).map((task) => task.title)).toEqual([
      'Also open',
      'Still open',
      'First done',
      'Second done',
    ]);
  });

  it('hides tasks that were already done when the check-in opened', () => {
    const tasks: Task[] = [
      { title: 'Old done', status: 'completed' },
      { title: 'Still open', status: 'upcoming' },
      { title: 'Just finished', status: 'completed' },
    ];

    expect(tasksForCheckIn(tasks, new Set(['Old done'])).map((task) => task.title)).toEqual([
      'Still open',
      'Just finished',
    ]);
  });
});

describe('completedBeforeCheckIn', () => {
  it('snapshots completed titles from the opening task list', () => {
    expect(completedBeforeCheckIn(TASKS)).toEqual(new Set(['Review the checklist']));
  });
});

describe('addTask', () => {
  it('appends a new task as upcoming by default', () => {
    expect(addTask([], 'New thing')).toEqual([{ title: 'New thing', status: 'upcoming' }]);
  });

  it('trims the title', () => {
    expect(addTask([], '  padded  ')[0]?.title).toBe('padded');
  });

  it('ignores a blank title', () => {
    expect(addTask([], '   ')).toEqual([]);
  });

  it('ignores a duplicate regardless of case', () => {
    expect(addTask(TASKS, 'draft the rfc')).toHaveLength(TASKS.length);
  });

  it('accepts an explicit status', () => {
    expect(addTask([], 'Started', 'in-progress')[0]?.status).toBe('in-progress');
  });

  it('stamps the day it was added when one is supplied', () => {
    expect(addTask([], 'New thing', 'upcoming', '2026-08-05')[0]?.added).toBe('2026-08-05');
  });

  it('omits the date entirely when none is supplied', () => {
    expect(addTask([], 'New thing')[0]).not.toHaveProperty('added');
  });

  it('does not mutate the input', () => {
    const input: Task[] = [];
    addTask(input, 'New thing');
    expect(input).toEqual([]);
  });
});

describe('setTaskStatus', () => {
  it('updates the matching task only', () => {
    const updated = setTaskStatus(TASKS, 'Draft the RFC', 'completed');
    expect(updated[0]?.status).toBe('completed');
    expect(updated[1]?.status).toBe('in-progress');
  });

  it('matches case-insensitively', () => {
    expect(setTaskStatus(TASKS, 'draft the rfc', 'completed')[0]?.status).toBe('completed');
  });

  it('is a no-op for an unknown title', () => {
    expect(setTaskStatus(TASKS, 'Nope', 'completed')).toEqual(TASKS);
  });

  it('does not mutate the input', () => {
    setTaskStatus(TASKS, 'Draft the RFC', 'completed');
    expect(TASKS[0]?.status).toBe('upcoming');
  });
});

describe('removeTask', () => {
  it('drops the matching task', () => {
    expect(removeTask(TASKS, 'Draft the RFC').map((task) => task.title)).toEqual([
      'Ship the rollback',
      'Review the checklist',
    ]);
  });

  it('is a no-op for an unknown title', () => {
    expect(removeTask(TASKS, 'Nope')).toHaveLength(3);
  });
});

describe('carryOverTasks', () => {
  it('carries open tasks and leaves completed ones behind', () => {
    expect(carryOverTasks(TASKS, '2026-08-03').map((task) => task.title)).toEqual([
      'Draft the RFC',
      'Ship the rollback',
    ]);
  });

  it('preserves the in-progress status rather than resetting it', () => {
    const carried = carryOverTasks(TASKS, '2026-08-03');
    expect(carried.find((task) => task.title === 'Ship the rollback')?.status).toBe('in-progress');
  });

  it('stamps an undated task with the day it is carried from', () => {
    expect(carryOverTasks(TASKS, '2026-08-03').every((task) => task.added === '2026-08-03')).toBe(
      true,
    );
  });

  it('keeps the original date through repeated carry-overs', () => {
    let tasks = carryOverTasks(TASKS, '2026-08-03');
    for (const date of ['2026-08-04', '2026-08-05', '2026-08-06']) {
      tasks = carryOverTasks(tasks, date);
    }

    expect(tasks.every((task) => task.added === '2026-08-03')).toBe(true);
  });

  it('returns nothing when the previous day is fully complete', () => {
    expect(carryOverTasks([{ title: 'Done', status: 'completed' }], '2026-08-03')).toEqual([]);
  });

  it('does not mutate the previous day', () => {
    carryOverTasks(TASKS, '2026-08-03');
    expect(TASKS[0]?.added).toBeUndefined();
  });
});

describe('isCarriedOver', () => {
  it('is true when the task predates the day it is sitting in', () => {
    expect(
      isCarriedOver({ title: 'a', status: 'upcoming', added: '2026-08-03' }, '2026-08-05'),
    ).toBe(true);
  });

  it('is false for a task added on the day itself', () => {
    expect(
      isCarriedOver({ title: 'a', status: 'upcoming', added: '2026-08-05' }, '2026-08-05'),
    ).toBe(false);
  });

  it('is false when the task has no date at all', () => {
    expect(isCarriedOver({ title: 'a', status: 'upcoming' }, '2026-08-05')).toBe(false);
  });
});

describe('summarizeTasks', () => {
  it('counts by status', () => {
    expect(summarizeTasks(TASKS)).toEqual({
      upcoming: 1,
      inProgress: 1,
      completed: 1,
      open: 2,
      total: 3,
    });
  });

  it('handles an empty list', () => {
    expect(summarizeTasks([])).toEqual({
      upcoming: 0,
      inProgress: 0,
      completed: 0,
      open: 0,
      total: 0,
    });
  });
});

/** Titles paired with their rank, which is what most of these assert on. */
function ranks(tasks: readonly Task[]): [string, number | undefined][] {
  return tasks.map((task) => [task.title, task.priority]);
}

describe('togglePriority', () => {
  it('ranks in the order they are picked', () => {
    let tasks = togglePriority(TASKS, 'Ship the rollback');
    tasks = togglePriority(tasks, 'Draft the RFC');

    expect(ranks(tasks)).toEqual([
      ['Draft the RFC', 2],
      ['Ship the rollback', 1],
      ['Review the checklist', undefined],
    ]);
  });

  it('unranks a ranked task and closes the gap', () => {
    let tasks = togglePriority(TASKS, 'Ship the rollback');
    tasks = togglePriority(tasks, 'Draft the RFC');
    tasks = togglePriority(tasks, 'Ship the rollback');

    expect(ranks(tasks)).toEqual([
      ['Draft the RFC', 1],
      ['Ship the rollback', undefined],
      ['Review the checklist', undefined],
    ]);
  });

  it('leaves a day where nothing was ranked completely unannotated', () => {
    expect(TASKS.every((task) => task.priority === undefined)).toBe(true);
    expect(togglePriority(TASKS, 'Nothing by this name')).toEqual(TASKS);
  });

  it('refuses a sixth priority rather than evicting the fifth', () => {
    const many: Task[] = Array.from({ length: 6 }, (_unused, index) => ({
      title: `Task ${String(index)}`,
      status: 'upcoming',
    }));

    const ranked = many.reduce<Task[]>((tasks, task) => togglePriority(tasks, task.title), many);

    expect(prioritiesFull(ranked)).toBe(true);
    expect(priorityTasks(ranked).map((task) => task.title)).toEqual([
      'Task 0',
      'Task 1',
      'Task 2',
      'Task 3',
      'Task 4',
    ]);
    expect(ranked[5]?.priority).toBeUndefined();
  });

  it('will not rank completed work', () => {
    expect(togglePriority(TASKS, 'Review the checklist')).toEqual(TASKS);
  });
});

describe('normalizePriorities', () => {
  it('promotes the rest when a ranked task is completed', () => {
    let tasks = togglePriority(TASKS, 'Ship the rollback');
    tasks = togglePriority(tasks, 'Draft the RFC');

    const done = setTaskStatus(tasks, 'Ship the rollback', 'completed');

    expect(ranks(done)).toEqual([
      ['Draft the RFC', 1],
      ['Ship the rollback', undefined],
      ['Review the checklist', undefined],
    ]);
  });

  it('promotes the rest when a ranked task is removed', () => {
    let tasks = togglePriority(TASKS, 'Ship the rollback');
    tasks = togglePriority(tasks, 'Draft the RFC');

    expect(ranks(removeTask(tasks, 'Ship the rollback'))).toEqual([
      ['Draft the RFC', 1],
      ['Review the checklist', undefined],
    ]);
  });

  it('compacts the sparse ranks a hand edit can leave behind', () => {
    const handEdited: Task[] = [
      { title: 'a', status: 'upcoming', priority: 7 },
      { title: 'b', status: 'upcoming', priority: 3 },
      { title: 'c', status: 'upcoming' },
    ];

    expect(ranks(normalizePriorities(handEdited))).toEqual([
      ['a', 2],
      ['b', 1],
      ['c', undefined],
    ]);
  });

  it('breaks a duplicated rank by file order', () => {
    const handEdited: Task[] = [
      { title: 'a', status: 'upcoming', priority: 2 },
      { title: 'b', status: 'upcoming', priority: 2 },
    ];

    expect(ranks(normalizePriorities(handEdited))).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
  });

  it('keeps only the first five when a hand edit ranks more', () => {
    const handEdited: Task[] = Array.from({ length: 7 }, (_unused, index) => ({
      title: `Task ${String(index)}`,
      status: 'upcoming',
      priority: index + 1,
    }));

    const normalized = normalizePriorities(handEdited);
    expect(priorityTasks(normalized)).toHaveLength(MAX_PRIORITIES);
    expect(normalized[5]?.priority).toBeUndefined();
    expect(normalized[6]?.priority).toBeUndefined();
  });

  it('leaves an unranked list untouched', () => {
    expect(normalizePriorities(TASKS)).toEqual(TASKS);
  });
});

describe('tasksForCheckIn with priorities', () => {
  it('leads with the ranked tasks in rank order', () => {
    let tasks = togglePriority(TASKS, 'Draft the RFC');
    tasks = togglePriority(tasks, 'Ship the rollback');

    expect(tasksForCheckIn(tasks).map((task) => task.title)).toEqual([
      'Draft the RFC',
      'Ship the rollback',
      'Review the checklist',
    ]);
  });

  it('does not lead with a rank a hand edit left on completed work', () => {
    const handEdited: Task[] = [
      { title: 'Review the checklist', status: 'completed', priority: 1 },
      { title: 'Ship the rollback', status: 'in-progress' },
    ];

    expect(tasksForCheckIn(handEdited).map((task) => task.title)).toEqual([
      'Ship the rollback',
      'Review the checklist',
    ]);
  });
});

describe('carryOverTasks with priorities', () => {
  it('carries the ranking forward, compacted around what got done', () => {
    const yesterday: Task[] = [
      { title: 'Ship the rollback', status: 'completed', priority: 1, added: '2026-08-03' },
      { title: 'Draft the RFC', status: 'upcoming', priority: 2, added: '2026-08-03' },
      { title: 'Review the checklist', status: 'in-progress', priority: 3, added: '2026-08-03' },
      { title: 'Answer the survey', status: 'upcoming', added: '2026-08-03' },
    ];

    expect(ranks(carryOverTasks(yesterday, '2026-08-03'))).toEqual([
      ['Draft the RFC', 1],
      ['Review the checklist', 2],
      ['Answer the survey', undefined],
    ]);
  });
});
