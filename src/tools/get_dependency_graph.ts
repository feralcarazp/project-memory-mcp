import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getDependencyGraph,
  type DependencyGraph,
} from "../context/deps.js";
import { resolveTargetPath } from "../session.js";

/**
 * Render a DependencyGraph result as markdown.
 *
 * Two shapes:
 * - Targeted (`target` is set): prints the target's out-edges and
 *   in-edges. Aggregate stats (most-imported, entrypoints) are omitted
 *   because the caller asked about one file — spamming the wider graph
 *   would dilute the answer.
 * - Aggregate (`target` unset): prints project-level summary only.
 */
export function formatDependencyGraph(g: DependencyGraph): string {
  const lines: string[] = [];

  if (g.target) {
    lines.push(`# ${g.target.file}`);
    lines.push("");
    lines.push(
      `_Scanned ${g.scanned} file${g.scanned === 1 ? "" : "s"} in the project._`,
    );
    lines.push("");

    // Out-edges
    lines.push(`## Imports (${g.target.imports.length})`);
    if (g.target.imports.length === 0) {
      lines.push("_(no imports)_");
    } else {
      for (const i of g.target.imports) {
        if (i.kind === "internal") {
          lines.push(`- \`${i.spec}\` → ${i.resolved}`);
        } else if (i.kind === "external") {
          lines.push(`- \`${i.spec}\` _(external)_`);
        } else {
          lines.push(`- \`${i.spec}\` _(unresolved)_`);
        }
      }
    }
    lines.push("");

    // In-edges
    lines.push(`## Imported by (${g.target.importedBy.length})`);
    if (g.target.importedBy.length === 0) {
      lines.push("_(no inbound imports — likely an entrypoint or unused)_");
    } else {
      for (const f of g.target.importedBy) {
        lines.push(`- ${f}`);
      }
    }
  } else {
    lines.push(`# Project dependency graph`);
    lines.push("");
    lines.push(
      `Scanned **${g.scanned}** source file${g.scanned === 1 ? "" : "s"}.`,
    );
    lines.push("");

    lines.push(`## Most-imported modules (top ${g.mostImported.length})`);
    if (g.mostImported.length === 0) {
      lines.push("_(no imports found)_");
    } else {
      for (const m of g.mostImported) {
        const kindTag = m.kind === "external" ? " _(external)_" : "";
        lines.push(
          `- \`${m.module}\`${kindTag} — ${m.count} import${m.count === 1 ? "" : "s"}`,
        );
      }
    }
    lines.push("");

    lines.push(`## Entrypoints (top ${g.entrypoints.length})`);
    if (g.entrypoints.length === 0) {
      lines.push("_(none — every scanned file is imported by another)_");
    } else {
      for (const f of g.entrypoints) {
        lines.push(`- ${f}`);
      }
    }
  }

  // Trim trailing empties.
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

export function registerGetDependencyGraph(server: McpServer): void {
  server.registerTool(
    "get_dependency_graph",
    {
      title: "Get dependency graph",
      description:
        "Map internal and external imports across a TypeScript/JavaScript project. Without `target`, returns project-level summary (most-imported modules, entrypoints). With `target`, returns that file's imports and the files that import it.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Absolute path to the project root. Optional: if omitted, falls back to the active project set via `set_active_project`.",
          ),
        target: z
          .string()
          .optional()
          .describe(
            "Optional: path to a single file, relative to `path`. When set, the response focuses on this file's imports and reverse imports.",
          ),
        limit: z
          .number()
          .int()
          .positive()
          .max(100)
          .optional()
          .describe(
            "Top-N cap for aggregate lists (most-imported modules, entrypoints). Default 10, max 100.",
          ),
      },
    },
    async ({ path, target, limit }) => {
      const root = resolveTargetPath(path);
      const g = await getDependencyGraph({ root, target, limit });
      return {
        content: [{ type: "text", text: formatDependencyGraph(g) }],
      };
    },
  );
}
