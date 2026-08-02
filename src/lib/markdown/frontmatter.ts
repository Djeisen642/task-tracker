/**
 * A deliberately tiny YAML-frontmatter reader/writer.
 *
 * The vault holds *scalars only* in frontmatter — `date`, `work_start`,
 * `work_end` — because everything structured (tasks, notes) lives in the
 * Markdown body where it stays readable to a human and to an agent. That lets us
 * avoid a full YAML dependency and its parsing surface entirely.
 *
 * Unrecognized keys are preserved rather than dropped, so a key you add to a day
 * file by hand survives the next write from the app.
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
  for (const line of lines.slice(1, closing)) {
    if (line.trim() === '') continue;

    // Split on the first colon only — values such as `work_start: 09:00`
    // legitimately contain more.
    const separator = line.indexOf(':');
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    if (key === '') continue;
    fields[key] = line.slice(separator + 1).trim();
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
 * Render frontmatter fields as a fenced block, in insertion order.
 *
 * Returns an empty string for empty fields so we never emit a vacant `---\n---`
 * header.
 */
export function serializeFrontmatter(fields: Record<string, string>): string {
  const entries = Object.entries(fields);
  if (entries.length === 0) return '';

  const body = entries.map(([key, value]) => `${key}: ${value}`).join('\n');
  return `${FENCE}\n${body}\n${FENCE}\n`;
}
