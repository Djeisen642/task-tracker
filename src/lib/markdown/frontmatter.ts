/**
 * A deliberately tiny YAML-frontmatter reader/writer.
 *
 * The vault holds *scalars only* in frontmatter — `date`, `work_start`,
 * `work_end` — because everything structured (tasks, notes) lives in the
 * Markdown body where it stays readable to a human and to an agent. That lets us
 * avoid a full YAML dependency and its parsing surface entirely.
 *
 * Unrecognized keys are preserved rather than dropped, so a key you add to a day
 * file by hand survives the next write from the app — and that has to include
 * the shapes other editors write. Obsidian's property editor emits a block list:
 *
 * ```yaml
 * tags:
 *   - work
 *   - migration
 * ```
 *
 * Those item lines have no `key:` of their own. Skipping them, as this reader
 * first did, deleted somebody's tags on the next check-in while leaving a bare
 * `tags:` behind. They are kept verbatim with the key that introduced them.
 */

/** Frontmatter fields plus the Markdown body that followed them. */
export interface ParsedFrontmatter {
  fields: Record<string, string>;
  body: string;
}

const FENCE = '---';

/**
 * Split a document into frontmatter fields and body.
 *
 * A document with no leading `---` fence is treated as all body with no fields,
 * which is what makes a hand-written note file still parse.
 */
export function parseFrontmatter(source: string): ParsedFrontmatter {
  const normalized = source.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  if (lines[0]?.trim() !== FENCE) {
    return { fields: {}, body: normalized };
  }

  const closing = lines.indexOf(FENCE, 1);
  if (closing === -1) {
    // An unterminated fence is malformed; treat the whole file as body rather
    // than swallowing it as frontmatter.
    return { fields: {}, body: normalized };
  }

  const fields: Record<string, string> = {};
  let current: string | null = null;

  for (const line of lines.slice(1, closing)) {
    if (line.trim() === '') continue;

    // Split on the first colon only — values such as `work_start: 09:00`
    // legitimately contain more.
    const separator = line.indexOf(':');
    const key = separator === -1 ? '' : line.slice(0, separator).trim();

    // An *indented* line that is a list item, or carries no key of its own,
    // belongs to the key above it: a block list, or a wrapped value. Kept
    // exactly as written.
    //
    // Indentation is required. A flush-left line with no colon is malformed
    // YAML rather than a continuation, and attaching it would fold junk into
    // the value above — which for `date` means a filename built from two lines.
    const continues = /^\s/.test(line) && (key === '' || /^\s+-\s/.test(line));
    if (continues) {
      if (current !== null) fields[current] = `${fields[current] ?? ''}\n${line}`;
      continue;
    }

    if (key === '') continue;

    current = key;
    fields[key] = unquote(line.slice(separator + 1).trim());
  }

  return {
    fields,
    body: lines
      .slice(closing + 1)
      .join('\n')
      .replace(/^\n+/, ''),
  };
}

/**
 * Strip one layer of matching quotes from a scalar.
 *
 * An agent writing YAML quotes strings by habit, and `date: "2026-08-03"` read
 * literally becomes a filename with quotes in it — a junk second file in the
 * browser build, and a refused write on the desktop, where `is_safe_name`
 * rejects it and every check-in fails to save.
 */
/**
 * The scalar a field holds, ignoring any continuation lines beneath it.
 *
 * `date`, `work_start` and `person` are single values that end up in filenames
 * and clocks; whatever a hand edit left indented underneath must not become
 * part of them.
 */
export function scalarField(value: string | undefined): string | undefined {
  return value?.split('\n')[0]?.trim();
}

function unquote(value: string): string {
  const quoted = /^(["'])(.*)\1$/.exec(value);
  return quoted?.[2] ?? value;
}

/**
 * Render frontmatter fields as a fenced block, in insertion order.
 *
 * Returns an empty string for empty fields so we never emit a vacant `---\n---`
 * header.
 */
export function serializeFrontmatter(fields: Record<string, string>): string {
  const entries = Object.entries(fields);
  if (entries.length === 0) return '';

  const body = entries
    .map(([key, value]) => {
      // A value carrying its own continuation lines (a block list) writes the
      // key, then those lines verbatim beneath it.
      const [first = '', ...rest] = value.split('\n');
      const head = first === '' ? `${key}:` : `${key}: ${first}`;
      return [head, ...rest].join('\n');
    })
    .join('\n');
  return `${FENCE}\n${body}\n${FENCE}\n`;
}
