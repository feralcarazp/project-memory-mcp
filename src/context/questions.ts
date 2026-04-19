import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Extract the "live" parts of a project's memory file — the sections that
 * answer "what is this team currently thinking about, deferring, or about
 * to do." Parses Markdown; returns structured data.
 *
 * The default target is `MEMORY.md`, because that's the file the
 * project-memory discipline expects every repo to maintain. Callers can
 * point this at a different file (e.g. `DECISIONS.md`) if they keep their
 * live state somewhere else.
 *
 * Why a parser and not just "read the file": an MCP client can load the
 * raw text with a fs tool trivially. The value-add here is surfacing
 * *only* the live sections — open questions, next steps, explicit
 * non-goals — without the rest of the file competing for the model's
 * attention.
 */
export interface OpenQuestions {
  /** Absolute path of the file that was parsed. */
  source: string;
  /** The matched sections, in the order they appeared in the file. */
  sections: Array<{
    /** The section heading exactly as written in the source file. */
    title: string;
    /**
     * Bullet items under the heading, top-to-bottom, in source order.
     * List markers (-, *, 1.) are stripped. Nested bullets are flattened
     * with a leading "↳ " so the hierarchy is visible but the shape is
     * flat and easy to iterate.
     */
    items: string[];
  }>;
}

export interface OpenQuestionsOptions {
  /** Absolute path to the project root. */
  root: string;
  /**
   * Name of the markdown file to parse, relative to `root`. Default
   * `MEMORY.md`.
   */
  file?: string;
  /**
   * Section titles to extract (case-insensitive substring match against
   * the H2 heading text). Default: ["Open questions", "Next steps",
   * "NOT doing"]. We match substrings so small heading variations
   * ("Next steps (suggested, in order)") don't require an exact match.
   */
  sections?: string[];
}

const DEFAULT_FILE = "MEMORY.md";
const DEFAULT_SECTIONS = ["Open questions", "Next steps", "NOT doing"];

export async function getOpenQuestions(
  opts: OpenQuestionsOptions,
): Promise<OpenQuestions> {
  const root = resolve(opts.root);
  const rootStat = await stat(root).catch(() => null);
  if (!rootStat?.isDirectory()) {
    throw new Error(`Not a directory: ${root}`);
  }

  const fileName = opts.file ?? DEFAULT_FILE;
  const filePath = join(root, fileName);

  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read ${fileName} at ${filePath}: ${reason}`);
  }

  const wanted = (opts.sections ?? DEFAULT_SECTIONS).map((s) =>
    s.toLowerCase(),
  );
  const sections = parseSections(raw, wanted);
  return { source: filePath, sections };
}

// -- Parser ------------------------------------------------------------------
//
// The parser is intentionally dumb. It walks line by line, tracks whether
// it is currently inside a wanted H2 section, and collects bullet lines.
// No CommonMark AST; we don't need ordering, spans, or inline formatting.
// If we ever need to parse nested fenced code blocks that contain bullets,
// we'll upgrade to a real parser. So far: no.

interface Section {
  title: string;
  items: string[];
}

/**
 * Does this H2 heading match one of the requested section names?
 * Case-insensitive substring match — lets us tolerate minor variations
 * like "Next steps (suggested, in order)".
 */
function matchesWanted(headingText: string, wanted: string[]): boolean {
  const hay = headingText.toLowerCase();
  return wanted.some((w) => hay.includes(w));
}

/**
 * Extract the text of a bullet list item.
 *
 * Handles `-`, `*`, `+` markers and numbered-list markers (`1.`, `12)`).
 * Returns null if the line is not a list item at all. The returned text
 * is trimmed; no attempt is made to preserve trailing whitespace.
 */
function extractBullet(line: string): { indent: number; text: string } | null {
  // Capture leading whitespace + marker + first space after marker.
  const match = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
  if (!match) return null;
  const [, leading, , text] = match;
  return { indent: leading.length, text: text.trim() };
}

function parseSections(raw: string, wanted: string[]): Section[] {
  const lines = raw.split(/\r?\n/);
  const out: Section[] = [];
  let current: Section | null = null;

  for (const line of lines) {
    // New heading? Close the current section (if any) and maybe open a new one.
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const [, hashes, title] = headingMatch;
      // Close on any heading at the section level (H2) or shallower. A
      // deeper heading (H3+) inside a matched section is treated as part
      // of that section's body and doesn't close it — so a `### Subtopic`
      // under `## Open questions` doesn't drop us out.
      if (hashes.length <= 2) {
        if (current) {
          out.push(current);
          current = null;
        }
        if (hashes.length === 2 && matchesWanted(title, wanted)) {
          current = { title: title.trim(), items: [] };
        }
      }
      continue;
    }

    if (!current) continue;

    const bullet = extractBullet(line);
    if (!bullet) continue;

    // Top-level bullets (indent 0) go in as-is. Nested bullets (indent
    // > 0) get a "↳ " prefix so the reader still sees the hierarchy but
    // the output stays a flat list of strings.
    if (bullet.indent === 0) {
      current.items.push(bullet.text);
    } else {
      current.items.push(`↳ ${bullet.text}`);
    }
  }

  // Don't forget the last section.
  if (current) out.push(current);

  return out;
}
