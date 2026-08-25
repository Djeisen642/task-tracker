import { describe, expect, it } from 'vitest';

import { parseFrontmatter, serializeFrontmatter } from './frontmatter.ts';

describe('parseFrontmatter', () => {
  it('reads fenced key/value pairs and returns the body', () => {
    const { fields, body } = parseFrontmatter('---\ndate: 2026-08-02\n---\n\n# Heading\n');
    expect(fields).toEqual({ date: '2026-08-02' });
    expect(body).toBe('# Heading\n');
  });

  it('splits on the first colon so times survive', () => {
    const { fields } = parseFrontmatter('---\nwork_start: 09:00\n---\n');
    expect(fields.work_start).toBe('09:00');
  });

  it('treats a document without a fence as all body', () => {
    const source = '# Just a heading\n';
    expect(parseFrontmatter(source)).toEqual({ fields: {}, body: source });
  });

  it('treats an unterminated fence as body rather than swallowing the file', () => {
    const source = '---\ndate: 2026-08-02\n\n# Heading\n';
    const { fields, body } = parseFrontmatter(source);
    expect(fields).toEqual({});
    expect(body).toBe(source);
  });

  it('preserves keys it does not recognize', () => {
    const { fields } = parseFrontmatter('---\ndate: 2026-08-02\nmood: focused\n---\n');
    expect(fields.mood).toBe('focused');
  });

  it('skips blank and separator-less lines', () => {
    const { fields } = parseFrontmatter('---\n\ndate: 2026-08-02\nnonsense\n---\n');
    expect(fields).toEqual({ date: '2026-08-02' });
  });

  it('normalizes CRLF line endings', () => {
    const { fields, body } = parseFrontmatter(
      '---\r\ndate: 2026-08-02\r\n---\r\n\r\n# Heading\r\n',
    );
    expect(fields).toEqual({ date: '2026-08-02' });
    expect(body).toBe('# Heading\n');
  });

  it('trims whitespace around keys and values', () => {
    const { fields } = parseFrontmatter('---\n  date  :   2026-08-02  \n---\n');
    expect(fields.date).toBe('2026-08-02');
  });
});

describe('serializeFrontmatter', () => {
  it('emits a fenced block', () => {
    expect(serializeFrontmatter({ date: '2026-08-02' })).toBe('---\ndate: 2026-08-02\n---\n');
  });

  it('emits nothing for empty fields rather than a vacant fence', () => {
    expect(serializeFrontmatter({})).toBe('');
  });

  it('round-trips through parseFrontmatter', () => {
    const fields = { date: '2026-08-02', work_start: '09:00', work_end: '17:00' };
    expect(parseFrontmatter(serializeFrontmatter(fields)).fields).toEqual(fields);
  });
});

describe('shapes other editors write', () => {
  it('keeps a block-style list rather than deleting its items', () => {
    // Obsidian's property editor writes exactly this. The items carry no key of
    // their own, and skipping them left a bare `tags:` with the values gone.
    const source = [
      '---',
      'date: 2026-08-03',
      'tags:',
      '  - work',
      '  - migration',
      '---',
      '',
    ].join('\n');
    const { fields } = parseFrontmatter(source);

    const written = serializeFrontmatter(fields);
    expect(written).toContain('  - work');
    expect(written).toContain('  - migration');
    expect(parseFrontmatter(written).fields).toEqual(fields);
  });

  it('keeps a wrapped value with the key that introduced it', () => {
    const source = ['---', 'note: a long value', '  continued here', '---', ''].join('\n');
    expect(serializeFrontmatter(parseFrontmatter(source).fields)).toContain('  continued here');
  });

  it('reads a quoted scalar as the value it names', () => {
    // `date: "2026-08-03"` read literally becomes a filename with quotes in it.
    expect(parseFrontmatter('---\ndate: "2026-08-03"\n---\n').fields.date).toBe('2026-08-03');
    expect(parseFrontmatter("---\ndate: '2026-08-03'\n---\n").fields.date).toBe('2026-08-03');
  });

  it('leaves an unbalanced quote alone', () => {
    expect(parseFrontmatter('---\nnote: "unfinished\n---\n').fields.note).toBe('"unfinished');
  });
});
