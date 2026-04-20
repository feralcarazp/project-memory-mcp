/**
 * Write-side helpers for a project's memory file.
 *
 * Mirrors the read-side in `questions.ts`: pure functions, no MCP
 * transport concerns. A tool adapter (`src/tools/append_to_memory.ts`)
 * wraps these into an MCP tool call. Keeping logic separate means
 * we can unit-test append logic without spinning up a server.
 *
 * Design notes:
 *
 * - Sections are a closed enum in v0.2.0. We resolve them to H2 headings
 *   using case-insensitive regex, same fuzzy-match style as
 *   `getOpenQuestions`. Closed enum keeps MEMORY.md structure consistent
 *   across projects while we learn real usage patterns; we can open it
 *   up in a later version if the constraint starts to bite.
 *
 * - Two sections ("open-questions", "next-steps") MUST already exist:
 *   they're the spine of the file and the read tools depend on them.
 *   The other two ("session-notes", "decisions-made") are written
 *   opportunistically during a session, so we auto-create them at the
 *   end of the file on first use.
 *
 * - Writes are atomic via tmp-file + rename(). MCP calls are serial
 *   within a single server process, but this still protects against
 *   process crashes mid-write corrupting MEMORY.md.
 *
 * - Trivial dedup: if the new content exactly matches the last
 *   non-blank line in the target section, skip the write. Keeps
 *   the tool idempotent across retries and prevents Claude from
 *   doubling up identical bullets when looping.
 */

import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";

export type MemorySection =
  | "open-questions"
  | "next-steps"
  | "session-notes"
  | "decisions-made";

interface SectionConfig {
  match: RegExp;
  canonicalTitle: string;
  createIfMissing: boolean;
}

const SECTION_CONFIG: Record<MemorySection, SectionConfig> = {
  "open-questions": {
    match: /open\s*questions?/i,
    canonicalTitle: "Open questions",
    createIfMissing: false,
  },
  "next-steps": {
    match: /next\s*steps?/i,
    canonicalTitle: "Next steps",
    createIfMissing: false,
  },
  "session-notes": {
    match: /session\s*notes?/i,
    canonicalTitle: "Session notes",
    createIfMissing: true,
  },
  "decisions-made": {
    match: /decisions?\s*made/i,
    canonicalTitle: "Decisions made this session",
    createIfMissing: true,
  },
};

export interface AppendOptions {
  root: string;
  section: MemorySection;
  content: string;
  /** Markdown file to modify, relative to `root`. Default: MEMORY.md. */
  file?: string;
}

export interface AppendResult {
  file: string;
  section: string;
  bytesAdded: number;
  skipped: boolean;
  reason?: string;
}

export async function appendToMemory(
  opts: AppendOptions,
): Promise<AppendResult> {
  const { root, section, content } = opts;
  const relFile = opts.file ?? "MEMORY.md";
  const absFile = resolve(join(root, relFile));

  let original: string;
  try {
    original = await fs.readFile(absFile, "utf8");
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      throw new Error(
        `Memory file not found: ${absFile}. Create it first — ` +
          `project-memory won't scaffold it for you (intentional: the file ` +
          `is the project's knowledge base, not boilerplate).`,
      );
    }
    throw err;
  }

  const normalizedContent = content.trimEnd();
  if (normalizedContent.length === 0) {
    return {
      file: absFile,
      section: SECTION_CONFIG[section].canonicalTitle,
      bytesAdded: 0,
      skipped: true,
      reason: "empty content",
    };
  }

  const cfg = SECTION_CONFIG[section];
  const lines = original.split("\n");

  const range = findSectionRange(lines, cfg.match);

  let newLines: string[];
  if (range) {
    const lastLine = findLastNonBlank(
      lines,
      range.headingIndex + 1,
      range.bodyEnd,
    );
    if (lastLine !== null && lastLine.trim() === normalizedContent.trim()) {
      return {
        file: absFile,
        section: cfg.canonicalTitle,
        bytesAdded: 0,
        skipped: true,
        reason: "content duplicates last line of section",
      };
    }
    newLines = insertAt(lines, range.bodyEnd, normalizedContent);
  } else if (cfg.createIfMissing) {
    newLines = appendNewSection(lines, cfg.canonicalTitle, normalizedContent);
  } else {
    throw new Error(
      `Section "${cfg.canonicalTitle}" not found in ${relFile}. ` +
        `Expected an H2 heading matching /${cfg.match.source}/. ` +
        `This section is load-bearing — add it manually rather than ` +
        `auto-creating, to avoid drifting from the other tools' assumptions.`,
    );
  }

  const updated = ensureTrailingNewline(newLines.join("\n"));
  const bytesAdded =
    Buffer.byteLength(updated, "utf8") - Buffer.byteLength(original, "utf8");

  const tmp = `${absFile}.tmp`;
  await fs.writeFile(tmp, updated, "utf8");
  await fs.rename(tmp, absFile);

  return {
    file: absFile,
    section: cfg.canonicalTitle,
    bytesAdded,
    skipped: false,
  };
}

interface SectionRange {
  headingIndex: number;
  /** Exclusive index where new content should be inserted. */
  bodyEnd: number;
}

function findSectionRange(
  lines: string[],
  match: RegExp,
): SectionRange | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("## ") && match.test(line.slice(3))) {
      let j = i + 1;
      while (j < lines.length && !lines[j].startsWith("## ")) j++;
      let bodyEnd = j;
      while (bodyEnd > i + 1 && lines[bodyEnd - 1].trim() === "") bodyEnd--;
      return { headingIndex: i, bodyEnd };
    }
  }
  return null;
}

function findLastNonBlank(
  lines: string[],
  start: number,
  endExclusive: number,
): string | null {
  for (let i = endExclusive - 1; i >= start; i--) {
    if (lines[i].trim() !== "") return lines[i];
  }
  return null;
}

function insertAt(lines: string[], at: number, content: string): string[] {
  const contentLines = content.split("\n");
  const prevLine = at > 0 ? lines[at - 1] : "";
  const firstNewLine = contentLines[0] ?? "";

  const bothBullets =
    firstNewLine.trimStart().startsWith("- ") &&
    prevLine.trimStart().startsWith("- ");
  const prevIsBlank = prevLine.trim() === "";
  const needsGap = !bothBullets && !prevIsBlank && at > 0;

  const toInsert = needsGap ? ["", ...contentLines] : contentLines;
  return [...lines.slice(0, at), ...toInsert, ...lines.slice(at)];
}

function appendNewSection(
  lines: string[],
  title: string,
  content: string,
): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === "") end--;
  return [
    ...lines.slice(0, end),
    "",
    `## ${title}`,
    "",
    ...content.split("\n"),
  ];
}

function ensureTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s : s + "\n";
}
