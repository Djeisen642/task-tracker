import { describe, expect, it } from 'vitest';

import { parseTaskLine, renderTaskLine } from './task-line.ts';

describe('parseTaskLine', () => {
  it('reads the three markers the app writes', () => {
    expect(parseTaskLine('- [ ] Draft the RFC')).toEqual({
      status: 'upcoming',
      text: 'Draft the RFC',
      indent: 0,
    });
    expect(parseTaskLine('- [/] Draft the RFC')?.status).toBe('in-progress');
    expect(parseTaskLine('- [x] Draft the RFC')?.status).toBe('completed');
    expect(parseTaskLine('- [X] Draft the RFC')?.status).toBe('completed');
    // The app's own markers are re-derived from the status, so none is carried.
    expect(parseTaskLine('- [x] Draft the RFC')?.marker).toBeUndefined();
  });

  it('reads the shapes people write by hand', () => {
    expect(parseTaskLine('- Draft the RFC')?.status).toBe('upcoming');
    expect(parseTaskLine('* Draft the RFC')?.text).toBe('Draft the RFC');
    expect(parseTaskLine('+ Draft the RFC')?.text).toBe('Draft the RFC');
    expect(parseTaskLine('1. Draft the RFC')?.text).toBe('Draft the RFC');
    expect(parseTaskLine('2) Draft the RFC')?.text).toBe('Draft the RFC');
    expect(parseTaskLine('  - Draft the RFC')?.text).toBe('Draft the RFC');
  });

  it('reads an unknown marker as upcoming, and keeps the character', () => {
    // Visible in the app, unchanged on disk: `[-]` means cancelled to whoever
    // wrote it, and rewriting it as `[ ]` makes it live work again.
    expect(parseTaskLine('- [>] Draft the RFC')).toEqual({
      status: 'upcoming',
      text: 'Draft the RFC',
      marker: '>',
      indent: 0,
    });
  });

  it('measures indentation, so a nested bullet can be told apart', () => {
    expect(parseTaskLine('- Top level')?.indent).toBe(0);
    expect(parseTaskLine('  - Nested')?.indent).toBe(2);
    expect(parseTaskLine('\t- Tabbed')?.indent).toBe(1);
  });

  it('leaves trailing annotations for the format to interpret', () => {
    expect(parseTaskLine('- [x] Draft the RFC _(added 2026-07-30)_')?.text).toBe(
      'Draft the RFC _(added 2026-07-30)_',
    );
  });

  it('is not a task line', () => {
    expect(parseTaskLine('Just a paragraph')).toBeNull();
    expect(parseTaskLine('### A subheading')).toBeNull();
    expect(parseTaskLine('---')).toBeNull();
    expect(parseTaskLine('| a | b |')).toBeNull();
    // A bullet with nothing after it says nothing; the line is kept elsewhere.
    expect(parseTaskLine('- ')).toBeNull();
    expect(parseTaskLine('- [ ] ')).toBeNull();
  });
});

describe('renderTaskLine', () => {
  it('writes the canonical form, whatever it was read from', () => {
    expect(renderTaskLine('upcoming', 'Draft the RFC')).toBe('- [ ] Draft the RFC');
    expect(renderTaskLine('in-progress', 'Draft the RFC')).toBe('- [/] Draft the RFC');
    expect(renderTaskLine('completed', 'Draft the RFC')).toBe('- [x] Draft the RFC');
  });

  it('round-trips with the parser', () => {
    const line = renderTaskLine('in-progress', 'Draft the RFC');
    expect(parseTaskLine(line)).toEqual({
      status: 'in-progress',
      text: 'Draft the RFC',
      indent: 0,
    });
  });

  it('keeps an unmodelled marker until the status actually changes', () => {
    expect(renderTaskLine('upcoming', 'Cancelled: vendor pulled out', '-')).toBe(
      '- [-] Cancelled: vendor pulled out',
    );
    // Cycled in the app, so the app now knows what the line means.
    expect(renderTaskLine('in-progress', 'Cancelled: vendor pulled out', '-')).toBe(
      '- [/] Cancelled: vendor pulled out',
    );
  });
});
