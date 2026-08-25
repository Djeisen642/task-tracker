/**
 * `##`-delimited section splitting, shared by every vault document that owns
 * some headings and has to preserve the rest.
 *
 * Both the day file (`day.ts`) and the per-report team file (`team.ts`) are
 * "frontmatter + a handful of owned `##` sections + whatever else a human
 * added by hand." This is the one place that split and the trim it needs
 * before re-emitting a preserved section, so the two formats can't drift on
 * how "preserve unowned content" actually works.
 */

/** A heading and its body, preserved verbatim for sections a document doesn't own. */
export interface ExtraSection {
  heading: string;
  lines: string[];
}

/**
 * Lines a document read but doesn't model, kept so a write can put them back.
 *
 * Preserving whole *unowned* sections was never enough. Three kinds of content
 * live inside the parts of the file the app does own, and all three used to be
 * deleted by the next write: anything above the first `##` heading, any `###`
 * subheading and its body (which is section content, not a section), and any
 * line inside `## Tasks` or `## Notes` that isn't an item — a paragraph of
 * context, a stray thought. The file is the only copy of that data, and the
 * app rewrites it on every check-in.
 */
export interface PreservedLines {
  /** Between the `#` title and the first `##` heading. */
  preamble: string[];
  /** Inside the tasks section, but not a task item. */
  tasks: string[];
  /** Inside the notes section, but not a note. */
  notes: string[];
}

/** Nothing preserved — the starting point for a document the app creates. */
export function emptyPreserved(): PreservedLines {
  return { preamble: [], tasks: [], notes: [] };
}

/**
 * The placeholders the app writes into an empty section of a day or team file.
 *
 * They are the app's own output, not content, so reading one back must not
 * preserve it — otherwise every empty-then-filled section keeps a fossil
 * "_No tasks yet._" above its first real entry, forever.
 *
 * Only what *these two formats* write belongs here. A rollup's placeholders are
 * not on the list even though they look the same: a rollup is a derived file
 * that is never parsed, so listing its wording here would only mean deleting a
 * line from someone's day file for the crime of resembling generated text.
 */
const PLACEHOLDERS = new Set(['_No tasks yet._', '_No notes yet._', '_Nothing tracked yet._']);

/** `true` when a line is one of the app's own empty-section placeholders. */
export function isPlaceholder(line: string): boolean {
  return PLACEHOLDERS.has(line.trim());
}

/**
 * Preserved lines, ready to store: placeholders removed, blank edges trimmed,
 * and everything else — blank lines in the middle included — left alone.
 *
 * The interior blanks matter. Dropping them silently turned two paragraphs of
 * somebody's writing into one, because in Markdown that blank line *is* the
 * paragraph break. Preserving content means preserving what it says.
 */
export function preservedLines(lines: readonly string[]): string[] {
  return trimBlankEdges(lines.filter((line) => !isPlaceholder(line)));
}

/**
 * The preamble worth keeping: everything above the first `##` heading except
 * the document's own `#` title.
 *
 * The title is app-owned and re-emitted on every write, so preserving it too
 * appends a second copy each time the file is saved — the round-trip test
 * caught exactly that. Anything else up there is the writer's own.
 */
export function preservedPreamble(lines: readonly string[]): string[] {
  let titleSeen = false;
  const kept: string[] = [];

  for (const line of lines) {
    if (!titleSeen && /^#\s+/.test(line)) {
      titleSeen = true;
      continue;
    }
    kept.push(line);
  }

  return preservedLines(kept);
}

/**
 * `true` when a `##` heading names the given section, whatever its casing.
 *
 * A file written by hand — or by an agent asked to "add a task for Greg" —
 * routinely says `## tasks`. Matching that exactly meant the app read no tasks
 * at all and quietly treated the whole section as somebody else's, so the
 * entries sat in the file, invisible in the app.
 */
export function isHeading(heading: string, canonical: string): boolean {
  return heading.trim().toLowerCase().replace(/:$/, '') === canonical.toLowerCase();
}

interface Section {
  heading: string;
  lines: string[];
}

/** Split a body into `##`-delimited sections, keeping any preamble separate. */
export function splitSections(body: string): { preamble: string[]; sections: Section[] } {
  const preamble: string[] = [];
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const line of body.split('\n')) {
    if (/^##\s+/.test(line)) {
      current = { heading: line.trim(), lines: [] };
      sections.push(current);
      continue;
    }

    if (current === null) {
      preamble.push(line);
    } else {
      current.lines.push(line);
    }
  }

  return { preamble, sections };
}

/**
 * One owned section: its items, then anything preserved from the file below
 * them.
 *
 * Preserved lines go *after* the items because the app owns the ordering of
 * what it models — notes sort by time, tasks move as they are edited — and
 * there is no stable anchor to put a paragraph back between two items that may
 * have swapped places. Keeping the content is the guarantee; keeping its exact
 * line number is not.
 *
 * The placeholder appears only when the section is genuinely empty: with
 * preserved prose and no items, "_No tasks yet._" above someone's paragraph
 * reads as the app talking over them.
 */
export function renderSection(
  heading: string,
  items: readonly string[],
  placeholder: string,
  preserved: readonly string[],
): string {
  const body = items.length > 0 ? [...items] : preserved.length > 0 ? [] : [placeholder];
  if (preserved.length > 0) {
    if (body.length > 0) body.push('');
    body.push(...trimBlankEdges(preserved));
  }

  return [heading, '', ...body].join('\n');
}

/** Trim leading and trailing blank lines from a preserved section body. */
export function trimBlankEdges(lines: readonly string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && (lines[start] ?? '').trim() === '') start += 1;
  while (end > start && (lines[end - 1] ?? '').trim() === '') end -= 1;
  return lines.slice(start, end);
}
