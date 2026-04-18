import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getProjectContext } from "../context/project.js";

/**
 * Registers the `get_project_context` tool on the provided MCP server.
 *
 * Design notes:
 * - Takes an explicit `path` argument (required). Relying on process.cwd()
 *   would be fragile: Claude Desktop launches the server with its own cwd,
 *   not the user's project folder.
 * - Returns human-readable markdown in the primary `text` content block so
 *   clients that don't parse `structuredContent` still get a useful answer.
 * - Also returns `structuredContent` matching the tool's outputSchema so
 *   clients that do parse it get machine-readable fields.
 */
export function registerGetProjectContext(server: McpServer): void {
  server.registerTool(
    "get_project_context",
    {
      title: "Get project context",
      description:
        "Summarize a software project at the given path: name, description, detected languages, top-level structure, and current Git state.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe("Absolute path to the project root on the local filesystem."),
      },
    },
    async ({ path }) => {
      const ctx = await getProjectContext(path);

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

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    },
  );
}
