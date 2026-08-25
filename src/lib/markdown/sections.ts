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
 * The placeholders the app writes into an empty section.
 *
 * They are the app's own output, not content, so reading one back must not
 * preserve it — otherwise every empty-then-filled section keeps a fossil
 * "_No tasks yet._" above its first real entry, forever.
 */
const PLACEHOLDERS = new Set([
  '_No tasks yet._',
  '_No notes yet._',
  '_Nothing tracked yet._',
  '_No kudos recorded this week._',
]);

/**
 * `true` when a line inside an owned section is content worth keeping.
 *
 * Blank lines are dropped because the section's own layout is re-emitted; a
 * placeholder is dropped because the app wrote it.
 */
export function isPreservableLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed !== '' && !PLACEHOLDERS.has(trimmed);
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
    if (isPreservableLine(line)) kept.push(line);
  }

  return kept;
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

/** Trim leading and trailing blank lines from a preserved section body. */
export function trimBlankEdges(lines: readonly string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && (lines[start] ?? '').trim() === '') start += 1;
  while (end > start && (lines[end - 1] ?? '').trim() === '') end -= 1;
  return lines.slice(start, end);
}
