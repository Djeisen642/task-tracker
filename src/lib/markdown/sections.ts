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
/**
 * Unmodelled lines from one owned section, split by where they sat.
 *
 * Two buckets rather than one, because a section's prose is almost always
 * *introducing* the list or *following* it: a `### Morning` subheading above
 * the items, a paragraph of context below them. Re-emitting all of it below the
 * list moved that subheading underneath the tasks it labels, which reads as a
 * mistake even though nothing was lost.
 *
 * It is still not a faithful record of position — a paragraph written between
 * two items lands at the end of `trail` — because the app owns the ordering of
 * what it models and there is no stable anchor between two items that may swap
 * places. Leading and trailing are the two positions that survive reordering.
 */
export interface PreservedSection {
  /** Before the first item the format recognized. */
  lead: string[];
  /** After it. */
  trail: string[];
}

export interface PreservedLines {
  /** Between the `#` title and the first `##` heading. */
  preamble: string[];
  /** Inside the tasks section, but not a task item. */
  tasks: PreservedSection;
  /** Inside the notes section, but not a note. */
  notes: PreservedSection;
}

/**
 * Split collected non-item lines into what led the list and what followed it.
 *
 * `firstItemAt` is the index, within the lines collected so far, at which the
 * section's first real item appeared — so everything gathered before that point
 * introduced the list.
 */
export function splitPreserved(lines: readonly string[], firstItemAt: number): PreservedSection {
  // No items at all: the whole section is somebody's prose, and it leads
  // nothing. `-1` passed straight to `slice` would quietly move its last line
  // to the other bucket.
  const at = firstItemAt === -1 ? lines.length : firstItemAt;

  return {
    lead: preservedLines(lines.slice(0, at)),
    trail: preservedLines(lines.slice(at)),
  };
}

/** An empty pair, for a section with nothing to preserve. */
export function emptySection(): PreservedSection {
  return { lead: [], trail: [] };
}

/** Nothing preserved — the starting point for a document the app creates. */
export function emptyPreserved(): PreservedLines {
  return { preamble: [], tasks: emptySection(), notes: emptySection() };
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
function preservedPreamble(lines: readonly string[]): string[] {
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
function isHeading(heading: string, canonical: string): boolean {
  return heading.trim().toLowerCase().replace(/:$/, '') === canonical.toLowerCase();
}

interface Section {
  heading: string;
  lines: string[];
}

/**
 * Which lines are inside a fenced code block or an HTML comment.
 *
 * Structure detection has to stop at the edge of a code fence. A file that
 * quotes this very format — a pasted snippet, a schema reminder, a log excerpt
 * — otherwise has its fenced `## Tasks` treated as the real heading and its
 * fenced `- [ ] example` treated as a real task, while the user's actual list
 * becomes an unowned section they can no longer see in the app. An HTML comment
 * is the same story with intent attached: a task someone deliberately parked
 * inside `<!-- … -->` came back as live work and carried forward daily.
 *
 * An *unclosed* fence or comment is deliberately not masked. A stray triple
 * backtick in prose would otherwise swallow the rest of the file, which turns a
 * cosmetic mistake into an invisible task list.
 *
 * Masked lines are not dropped: every caller treats them as "not an item",
 * which is the path that already preserves them verbatim.
 */
export function maskedLines(lines: readonly string[]): boolean[] {
  const masked = lines.map(() => false);
  let fenceChar = '';
  let fenceWidth = 0;
  let openedAt = -1;

  const closeFrom = (index: number): void => {
    for (let i = openedAt; i <= index; i += 1) masked[i] = true;
    openedAt = -1;
    fenceChar = '';
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';

    if (openedAt === -1) {
      const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      const run = fence?.[1] ?? '';
      const info = (fence?.[2] ?? '').trim();
      // A backtick fence's info string may not itself contain a backtick.
      if (fence !== null && !(run.startsWith('`') && info.includes('`'))) {
        fenceChar = run[0] ?? '`';
        fenceWidth = run.length;
        openedAt = index;
        continue;
      }

      if (line.includes('<!--')) {
        if (line.includes('-->')) {
          masked[index] = true;
        } else {
          fenceChar = '<';
          openedAt = index;
        }
      }
      continue;
    }

    if (fenceChar === '<') {
      if (line.includes('-->')) closeFrom(index);
      continue;
    }

    const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
    const run = close?.[1] ?? '';
    if (close !== null && run.startsWith(fenceChar) && run.length >= fenceWidth) closeFrom(index);
  }

  return masked;
}

/** Split a body into `##`-delimited sections, keeping any preamble separate. */
export function splitSections(body: string): { preamble: string[]; sections: Section[] } {
  const preamble: string[] = [];
  const sections: Section[] = [];
  let current: Section | null = null;

  const lines = body.split('\n');
  const masked = maskedLines(lines);

  lines.forEach((line, index) => {
    if (/^##\s+/.test(line) && masked[index] !== true) {
      current = { heading: line.trim(), lines: [] };
      sections.push(current);
      return;
    }

    if (current === null) {
      preamble.push(line);
    } else {
      current.lines.push(line);
    }
  });

  return { preamble, sections };
}

/** A body split into the sections a format owns and everything else. */
export interface OwnedBody {
  /** Lines under each requested heading, keyed by it. Absent heading → empty. */
  owned: Map<string, string[]>;
  /** Above the first `##`, already stripped of the title and placeholders. */
  preamble: string[];
  /** Sections the format doesn't own, in file order. */
  extraSections: ExtraSection[];
}

/**
 * Split a body into the sections a format owns and everything else.
 *
 * Both formats need the same three rules, and had them written out twice: match
 * a heading case-insensitively (a hand-written `## tasks` is the tasks
 * section), let the *first* section of a name win, and treat everything else —
 * including a second `## Tasks` somebody added — as an unowned section to
 * preserve rather than as a replacement.
 */
export function splitOwnedSections(body: string, headings: readonly string[]): OwnedBody {
  const { preamble, sections } = splitSections(body);
  const owned = new Map<string, string[]>();
  const extraSections: ExtraSection[] = [];

  for (const section of sections) {
    const match = headings.find((heading) => isHeading(section.heading, heading));
    if (match !== undefined && !owned.has(match)) {
      owned.set(match, [...section.lines]);
    } else {
      extraSections.push({ heading: section.heading, lines: [...section.lines] });
    }
  }

  return { owned, preamble: preservedPreamble(preamble), extraSections };
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
  preserved: PreservedSection,
): string {
  const body: string[] = [];
  const push = (lines: readonly string[]): void => {
    if (lines.length === 0) return;
    if (body.length > 0) body.push('');
    body.push(...trimBlankEdges(lines));
  };

  push(preserved.lead);
  // The placeholder is the app saying the section is empty. With preserved
  // prose sitting there it would be talking over somebody, so it appears only
  // when the section really has nothing in it.
  push(
    items.length > 0
      ? items
      : preserved.lead.length + preserved.trail.length > 0
        ? []
        : [placeholder],
  );
  push(preserved.trail);

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
