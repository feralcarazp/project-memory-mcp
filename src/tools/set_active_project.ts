import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { setActiveProject } from "../session.js";
import { getProjectContext } from "../context/project.js";
import { formatProjectContext } from "./get_project_context.js";

/**
 * Registers `set_active_project` — caches a project path for the rest
 * of the session so the other tools can be called without repeating it.
 *
 * Why this exists: ADR-004 committed to "explicit path on every call"
 * because Claude Desktop launches this server with a cwd that isn't
 * the user's project folder. That decision has held up — but with four
 * tools now live, repeating the path every call has become real friction.
 * ADR-012 layers a session cache on top without giving up the safety
 * property: `path` is still required *somewhere* (either on each call
 * or once via this tool), so we never fall back to a silent `cwd`.
 *
 * The tool does double duty:
 *  1. Validates + caches the path in the session module.
 *  2. Returns the project context for that path, so the caller immediately
 *     sees what the server will use for every subsequent `get_*` call.
 */
export function registerSetActiveProject(server: McpServer): void {
  server.registerTool(
    "set_active_project",
    {
      title: "Set active project",
      description:
        "Cache a project path for the rest of this MCP session so the other tools (get_project_context, list_recent_changes, get_open_questions, get_dependency_graph) can be called without repeating `path`. Returns the project's context as confirmation.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe(
            "Absolute path to the project root. The path is validated (must exist and be a directory) before being cached.",
          ),
      },
    },
    async ({ path }) => {
      // Stash the path first. If this throws (missing dir, etc.), the
      // existing cached value is untouched and the error surfaces verbatim.
      const active = setActiveProject(path);

      // Enrich: same summary get_project_context returns. Cheap and
      // confirms "this is what I saw at that path" on the same response.
      const ctx = await getProjectContext(active.root);
      const body = [
        `✅ Active project set: **${active.name}**`,
        `_All subsequent tool calls can omit \`path\` and default to \`${active.root}\`._`,
        "",
        formatProjectContext(ctx),
      ].join("\n");

      return {
        content: [{ type: "text", text: body }],
      };
    },
  );
}
