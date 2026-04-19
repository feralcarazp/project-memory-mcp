import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getProjectContext, type ProjectContext } from "../context/project.js";
import { resolveTargetPath } from "../session.js";

/**
 * Render a ProjectContext as the markdown we return to MCP clients.
 *
 * Exported so tools other than the MCP adapter (for example, the token
 * benchmark) can measure the exact text the client receives.
 */
export function formatProjectContext(ctx: ProjectContext): string {
  const lines: string[] = [];
  lines.push(`# ${ctx.name}`);
  if (ctx.description) lines.push(ctx.description);
  lines.push("");
  lines.push(`**Root:** ${ctx.root}`);
  if (ctx.languages.length > 0) {
    lines.push(`**Languages:** ${ctx.languages.join(", ")}`);
  }
  if (ctx.git) {
    const dirty = ctx.git.isDirty ? " (dirty)" : "";
    lines.push(
      `**Git:** ${ctx.git.branch}${dirty} — last commit ${ctx.git.lastCommit.hash} "${ctx.git.lastCommit.message}" by ${ctx.git.lastCommit.author}`,
    );
  }
  lines.push("");
  lines.push("## Top-level");
  for (const entry of ctx.topLevel) {
    const marker = entry.type === "dir" ? "📁" : "📄";
    lines.push(`- ${marker} ${entry.name}`);
  }
  return lines.join("\n");
}

/**
 * Registers the `get_project_context` tool on the provided MCP server.
 *
 * Design notes:
 * - `path` is optional IF `set_active_project` has been called earlier in
 *   this server session. We still never fall back to `process.cwd()` —
 *   Claude Desktop launches the server with its own cwd, not the user's
 *   project folder, so silently using it would cause wrong answers.
 *   Resolution order: explicit `path` → session's active project → error.
 * - Returns human-readable markdown in the primary `text` content block so
 *   clients that don't parse `structuredContent` still get a useful answer.
 */
export function registerGetProjectContext(server: McpServer): void {
  server.registerTool(
    "get_project_context",
    {
      title: "Get project context",
      description:
        "Summarize a software project: name, description, detected languages, top-level structure, and current Git state. If `path` is omitted, uses the active project set via `set_active_project`.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Absolute path to the project root. Optional: if omitted, falls back to the active project set via `set_active_project`.",
          ),
      },
    },
    async ({ path }) => {
      const root = resolveTargetPath(path);
      const ctx = await getProjectContext(root);
      return {
        content: [{ type: "text", text: formatProjectContext(ctx) }],
      };
    },
  );
}
