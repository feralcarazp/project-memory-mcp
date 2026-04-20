/**
 * append_to_memory — native write tool so Claude (or a human operating
 * via the MCP client) can add lines to a project's MEMORY.md without
 * needing a separate filesystem MCP.
 *
 * Closes the conceptual gap in v0.1.x: the "brain that doesn't forget"
 * could only read. Now it can also write, into a curated set of sections.
 *
 * The section enum is intentionally closed in v0.2.0. Rationale: we want
 * Claude's writes to land in predictable places so the read-side tools
 * stay meaningful and the file doesn't drift into a junk drawer of ad-hoc
 * H2 headings. If the constraint ends up biting, open it up in v0.3.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { basename } from "node:path";
import {
  appendToMemory,
  type AppendResult,
  type MemorySection,
} from "../context/memory_writes.js";
import { resolveTargetPath } from "../session.js";

function formatResult(result: AppendResult): string {
  const lines: string[] = [];
  const verb = result.skipped ? "skipped" : "appended";
  lines.push(`# ${verb} — ${basename(result.file)} · ${result.section}`);
  lines.push("");

  if (result.skipped) {
    lines.push(`Nothing written (${result.reason ?? "no reason given"}).`);
  } else {
    lines.push(`Wrote ${result.bytesAdded} bytes to \`${result.file}\`.`);
    lines.push("");
    lines.push(
      "Verify with `get_open_questions` or open the file manually.",
    );
  }

  return lines.join("\n");
}

export function registerAppendToMemory(server: McpServer): void {
  server.registerTool(
    "append_to_memory",
    {
      title: "Append to memory",
      description:
        "Append markdown content to a specific section of the project's MEMORY.md. " +
        "Use this to record open questions, next steps, session notes, or decisions " +
        "as the conversation progresses — so the next session can recover context. " +
        'Sections "open-questions" and "next-steps" must already exist in the file; ' +
        '"session-notes" and "decisions-made" are created on first use.',
      inputSchema: {
        section: z
          .enum([
            "open-questions",
            "next-steps",
            "session-notes",
            "decisions-made",
          ])
          .describe(
            "Which curated section to append to. Closed enum in v0.2.0 to keep " +
              "MEMORY.md structure predictable across projects.",
          ),
        content: z
          .string()
          .min(1)
          .describe(
            "Markdown content to append. For list sections prefix with `- ` to " +
              "keep bullets consistent; for notes/decisions plain paragraphs are fine.",
          ),
        path: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Absolute path to the project root. Optional: falls back to the " +
              "active project set via `set_active_project`.",
          ),
        file: z
          .string()
          .optional()
          .describe(
            "Markdown file to modify, relative to `path`. Default: MEMORY.md.",
          ),
      },
    },
    async ({ section, content, path, file }) => {
      const root = resolveTargetPath(path);
      const result = await appendToMemory({
        root,
        section: section as MemorySection,
        content,
        file,
      });
      return {
        content: [{ type: "text", text: formatResult(result) }],
      };
    },
  );
}
