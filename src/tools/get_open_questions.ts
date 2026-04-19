import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { basename } from "node:path";
import {
  getOpenQuestions,
  type OpenQuestions,
} from "../context/questions.js";
import { resolveTargetPath } from "../session.js";

/**
 * Render an OpenQuestions result as markdown for the MCP client.
 *
 * Exported so the benchmark and any future non-MCP consumer can get the
 * same text the client sees.
 */
export function formatOpenQuestions(result: OpenQuestions): string {
  const lines: string[] = [];
  lines.push(`# Live state — ${basename(result.source)}`);
  lines.push("");

  if (result.sections.length === 0) {
    lines.push(
      "_No matching sections found. Looked for H2 headings containing the configured section names._",
    );
    return lines.join("\n");
  }

  for (const section of result.sections) {
    lines.push(`## ${section.title}`);
    lines.push("");
    if (section.items.length === 0) {
      lines.push("_(no items)_");
    } else {
      for (const item of section.items) {
        lines.push(`- ${item}`);
      }
    }
    lines.push("");
  }

  // Trim trailing blank line.
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

/**
 * Registers `get_open_questions` — surfaces the "live" parts of a
 * project's memory file (open questions, next steps, explicit non-goals)
 * so the LLM can orient itself without re-reading full docs.
 */
export function registerGetOpenQuestions(server: McpServer): void {
  server.registerTool(
    "get_open_questions",
    {
      title: "Get open questions",
      description:
        "Extract live state from a project's memory file: open questions, next steps, and explicit non-goals. Default target is MEMORY.md.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Absolute path to the project root. Optional: if omitted, falls back to the active project set via `set_active_project`.",
          ),
        file: z
          .string()
          .optional()
          .describe(
            "Markdown file to parse, relative to `path`. Default: MEMORY.md.",
          ),
        sections: z
          .array(z.string().min(1))
          .optional()
          .describe(
            'Section titles to extract (case-insensitive substring match against H2 headings). Default: ["Open questions", "Next steps", "NOT doing"].',
          ),
      },
    },
    async ({ path, file, sections }) => {
      const root = resolveTargetPath(path);
      const result = await getOpenQuestions({ root, file, sections });
      return {
        content: [{ type: "text", text: formatOpenQuestions(result) }],
      };
    },
  );
}
