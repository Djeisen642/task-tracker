import { describe, expect, it } from 'vitest';

import {
  emptySection,
  isPlaceholder,
  maskedLines,
  preservedLines,
  renderSection,
  splitOwnedSections,
  splitPreserved,
  splitSections,
  trimBlankEdges,
} from './sections.ts';

describe('splitSections', () => {
  it('puts everything before the first heading in the preamble', () => {
    const { preamble, sections } = splitSections('# Title\n\nsome text\n\n## Tasks\n\nbody');
    expect(preamble).toEqual(['# Title', '', 'some text', '']);
    expect(sections).toEqual([{ heading: '## Tasks', lines: ['', 'body'] }]);
  });

  it('splits multiple sections, trimming trailing whitespace off the heading', () => {
    const { sections } = splitSections('## Tasks  \n- a\n## Notes\n- b');
    expect(sections).toEqual([
      { heading: '## Tasks', lines: ['- a'] },
      { heading: '## Notes', lines: ['- b'] },
    ]);
  });

  it('treats a body with no heading as pure preamble', () => {
    const { preamble, sections } = splitSections('just some text');
    expect(preamble).toEqual(['just some text']);
    expect(sections).toEqual([]);
  });

  it('does not treat a single `#` heading as a section boundary', () => {
    const { preamble, sections } = splitSections('# Title\ntext');
    expect(preamble).toEqual(['# Title', 'text']);
    expect(sections).toEqual([]);
  });
});

describe('trimBlankEdges', () => {
  it('removes leading and trailing blank lines', () => {
    expect(trimBlankEdges(['', '  ', 'content', 'more', '', ''])).toEqual(['content', 'more']);
  });

  it('leaves interior blank lines alone', () => {
    expect(trimBlankEdges(['a', '', 'b'])).toEqual(['a', '', 'b']);
  });

  it('returns an empty array for all-blank input', () => {
    expect(trimBlankEdges(['', '  ', ''])).toEqual([]);
  });
});

describe('splitOwnedSections', () => {
  it('matches an owned heading whatever its casing', () => {
    const { owned, extraSections } = splitOwnedSections('## tasks\n\n- [ ] Ship it\n', [
      '## Tasks',
    ]);

    expect(owned.get('## Tasks')).toEqual(['', '- [ ] Ship it', '']);
    expect(extraSections).toEqual([]);
  });

  it('keeps the first section of a name and preserves a later duplicate', () => {
    const { owned, extraSections } = splitOwnedSections(
      '## Tasks\n\nfirst\n\n## Tasks\n\nsecond\n',
      ['## Tasks'],
    );

    expect(owned.get('## Tasks')).toContain('first');
    expect(extraSections).toHaveLength(1);
    expect(extraSections[0]?.lines).toContain('second');
  });

  it('strips the document title from the preamble but keeps the rest', () => {
    const { preamble } = splitOwnedSections('# Monday\n\nAt the office today.\n\n## Tasks\n', [
      '## Tasks',
    ]);

    expect(preamble).toEqual(['At the office today.']);
  });

  it('does not split on a heading inside a code fence', () => {
    const { owned, extraSections } = splitOwnedSections(
      '## Tasks\n\n```\n## Tasks\n```\n\n- [ ] Ship it\n',
      ['## Tasks'],
    );

    expect(extraSections).toEqual([]);
    expect(owned.get('## Tasks')).toContain('- [ ] Ship it');
  });
});

describe('maskedLines', () => {
  it('masks a fenced block, delimiters included', () => {
    expect(maskedLines(['before', '```', 'inside', '```', 'after'])).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
  });

  it('masks a tilde fence and a longer closing run', () => {
    expect(maskedLines(['~~~', 'inside', '~~~~'])).toEqual([true, true, true]);
  });

  it('leaves an unclosed fence unmasked, so a stray ``` cannot eat the file', () => {
    expect(maskedLines(['```', '- [ ] Ship it'])).toEqual([false, false]);
  });

  it('masks an HTML comment, on one line or many', () => {
    expect(maskedLines(['<!-- parked -->'])).toEqual([true]);
    expect(maskedLines(['<!--', '- [ ] Parked', '-->', 'live'])).toEqual([true, true, true, false]);
  });

  it('does not treat an inline-backtick line as a fence', () => {
    expect(maskedLines(['```ts is not ``` a fence', 'after'])).toEqual([false, false]);
  });
});

describe('splitPreserved', () => {
  it('splits around the first item', () => {
    expect(splitPreserved(['above', 'below'], 1)).toEqual({ lead: ['above'], trail: ['below'] });
  });

  it('puts everything in lead when the section has no items', () => {
    // `-1` handed to `slice` would move the last line to the other bucket.
    expect(splitPreserved(['one', 'two'], -1)).toEqual({ lead: ['one', 'two'], trail: [] });
  });
});

describe('renderSection', () => {
  it('omits the placeholder when preserved prose stands in for items', () => {
    const out = renderSection('## Tasks', [], '_No tasks yet._', {
      lead: ['See the doc.'],
      trail: [],
    });

    expect(out).toContain('See the doc.');
    expect(out).not.toContain('_No tasks yet._');
  });

  it('omits it for trail-only prose too', () => {
    const out = renderSection('## Tasks', [], '_No tasks yet._', {
      lead: [],
      trail: ['See the doc.'],
    });

    expect(out).not.toContain('_No tasks yet._');
  });

  it('emits the placeholder when the section really is empty', () => {
    expect(renderSection('## Tasks', [], '_No tasks yet._', emptySection())).toContain(
      '_No tasks yet._',
    );
  });

  it('puts lead above the items and trail below', () => {
    const out = renderSection('## Tasks', ['- [ ] Ship it'], '_No tasks yet._', {
      lead: ['### Morning'],
      trail: ['Chased legal.'],
    });

    expect(out.split('\n').filter(Boolean)).toEqual([
      '## Tasks',
      '### Morning',
      '- [ ] Ship it',
      'Chased legal.',
    ]);
  });
});

describe('isPlaceholder', () => {
  it('matches only what the day and team files write', () => {
    expect(isPlaceholder('_No tasks yet._')).toBe(true);
    expect(isPlaceholder('  _Nothing tracked yet._  ')).toBe(true);
    // A rollup's wording is not this format's output, and a user may write it.
    expect(isPlaceholder('_No kudos recorded this week._')).toBe(false);
  });
});

describe('preservedLines', () => {
  it('keeps interior blank lines and trims the edges', () => {
    expect(preservedLines(['', 'one', '', 'two', ''])).toEqual(['one', '', 'two']);
  });
});
