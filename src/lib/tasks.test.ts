import { describe, expect, it } from 'vitest';

import {
  addTask,
  carryOverTasks,
  cycleStatus,
  isOpen,
  removeTask,
  sameTask,
  setTaskStatus,
  summarizeTasks,
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
    expect(carryOverTasks(TASKS).map((task) => task.title)).toEqual([
      'Draft the RFC',
      'Ship the rollback',
    ]);
  });

  it('preserves the in-progress status rather than resetting it', () => {
    const carried = carryOverTasks(TASKS);
    expect(carried.find((task) => task.title === 'Ship the rollback')?.status).toBe('in-progress');
  });

  it('flags every carried task so the UI can show what slipped', () => {
    expect(carryOverTasks(TASKS).every((task) => task.carriedOver === true)).toBe(true);
  });

  it('returns nothing when the previous day is fully complete', () => {
    expect(carryOverTasks([{ title: 'Done', status: 'completed' }])).toEqual([]);
  });

  it('does not mutate the previous day', () => {
    carryOverTasks(TASKS);
    expect(TASKS[0]?.carriedOver).toBeUndefined();
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
