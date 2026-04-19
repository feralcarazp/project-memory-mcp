import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getRecentChanges, type RecentChanges } from "../context/changes.js";
import { resolveTargetPath } from "../session.js";

/**
 * Render a RecentChanges result as the markdown we return to MCP clients.
 *
 * Exported so tools other than the MCP adapter (for example, the token
 * benchmark) can measure the exact text the client receives.
 */
export function formatRecentChanges(result: RecentChanges): string {
  const lines: string[] = [];
  const header =
    result.range.type === "since"
      ? `# Changes since ${result.range.value}`
      : `# Last ${result.range.value} commits`;
  lines.push(header);
  lines.push("");

  if (result.commits.length === 0) {
    lines.push("_No commits in range._");
    return lines.join("\n");
  }

  lines.push(`**${result.commits.length} commit(s):**`);
  for (const c of result.commits) {
    lines.push(
      `- \`${c.hash}\` ${c.date.slice(0, 10)} · ${c.author}: ${c.message}  _(${c.filesChanged} file${c.filesChanged === 1 ? "" : "s"})_`,
    );
  }

  if (result.hotspots.length > 0) {
    lines.push("");
    lines.push("## Hotspots (files touched most)");
    for (const h of result.hotspots) {
      lines.push(
        `- ${h.path}  _(${h.changes} change${h.changes === 1 ? "" : "s"})_`,
      );
    }
  }

  return lines.join("\n");
}

/**
 * Registers `list_recent_changes` — summary of recent Git activity.
 *
 * Accepts either `limit` (last N commits) or `since` (ISO date). If both are
 * provided, `since` wins and `limit` is ignored.
 *
 * Returns human-readable markdown. The hotspots section is the headline
 * signal — it tells the LLM where activity has been concentrated.
 */
export function registerListRecentChanges(server: McpServer): void {
  server.registerTool(
    "list_recent_changes",
    {
      title: "List recent changes",
      description:
        "Summarize recent Git activity in a project: last N commits (or since a date) and a ranking of files touched most in that range.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Absolute path to the Git project root. Optional: if omitted, falls back to the active project set via `set_active_project`.",
          ),
        limit: z
          .number()
          .int()
          .positive()
          .max(200)
          .optional()
          .describe(
            "Number of most recent commits to inspect. Default 10, max 200. Ignored if `since` is set.",
          ),
        since: z
          .string()
          .optional()
          .describe(
            "ISO date (e.g. 2026-04-10) or relative date (e.g. '7 days ago'). If set, returns every commit since this date and overrides `limit`.",
          ),
      },
    },
    async ({ path, limit, since }) => {
      const root = resolveTargetPath(path);
      const result = await getRecentChanges({ root, limit, since });
      return {
        content: [{ type: "text", text: formatRecentChanges(result) }],
      };
    },
  );
}
