#!/usr/bin/env node
/**
 * Project Memory MCP — entry point.
 *
 * Launches an MCP server over stdio (the transport Claude Desktop expects)
 * and registers every tool in src/tools/.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerGetProjectContext } from "./tools/get_project_context.js";
import { registerListRecentChanges } from "./tools/list_recent_changes.js";

const SERVER_NAME = "project-memory-mcp";
const SERVER_VERSION = "0.0.1";

async function main(): Promise<void> {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerGetProjectContext(server);
  registerListRecentChanges(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Important: NEVER write to stdout here. Claude Desktop parses stdout as
  // JSON-RPC messages; any stray log would corrupt the channel. Use stderr
  // for diagnostics — the desktop app surfaces it in the MCP logs tab.
  process.stderr.write(
    `[${SERVER_NAME}] v${SERVER_VERSION} ready over stdio\n`,
  );
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[${SERVER_NAME}] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
