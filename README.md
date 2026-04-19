# Project Memory MCP

> A neutral context layer for AI coding tools. Exposes structured, curated project context to any MCP-compatible client (Claude Desktop, Cursor, Claude Code, etc.).

**Status:** early development. Published to npm as [`@feralcaraz/project-memory-mcp`](https://www.npmjs.com/package/@feralcaraz/project-memory-mcp).

## Why

Every time you switch AI tool, you re-explain the same project from scratch: what it is, what stack, what conventions, what you're currently working on. Project Memory MCP is a small server that lives next to your code and gives any AI client a consistent, up-to-date view of the project — without you having to paste the same context ten times a week.

It speaks the [Model Context Protocol](https://modelcontextprotocol.io), so any MCP client can talk to it.

## Tools exposed

- **`set_active_project`** — cache a project path for the rest of the MCP session. Once set, the other tools default to it and `path` becomes optional on every call.
- **`get_project_context`** — summarize a project: name, description, detected languages, top-level structure, and current Git state.
- **`list_recent_changes`** — summarize recent Git activity: the last N commits (or every commit since a date) plus a "hotspots" ranking of files touched most in that range.
- **`get_open_questions`** — extract live state from a project's `MEMORY.md` (or any file you point it at): open questions, next steps, and explicit non-goals.
- **`get_dependency_graph`** — TypeScript/JavaScript import graph. Without `target`, summarizes the project (most-imported modules, entrypoints). With `target`, returns one file's imports and the files that import it.

On any tool, `path` is optional IF you've called `set_active_project` earlier in the session. Otherwise pass it explicitly. There is no silent `cwd` fallback.

More tools coming (see `ARCHITECTURE.md` for the roadmap).

## Requirements

- Node.js 20 or newer
- A project on your local filesystem (Git repo optional but recommended)

## Install

The simplest way to run the server is via `npx` — no clone, no build, no install steps. The MCP client (Claude Desktop, Cursor, etc.) will fetch and run it on demand.

```bash
npx -y @feralcaraz/project-memory-mcp
```

That command starts the MCP server over stdio. You normally don't run it directly — your MCP client does. See the next section for how to wire it into Claude Desktop.

If you'd rather build from source (for development or to pin a specific commit):

```bash
git clone https://github.com/feralcarazp/project-memory-mcp.git
cd project-memory-mcp
npm install
npm run build
```

## Connect to Claude Desktop

Edit your Claude Desktop config file:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Add an `mcpServers` entry. The simplest version uses `npx`:

```json
{
  "mcpServers": {
    "project-memory": {
      "command": "npx",
      "args": ["-y", "@feralcaraz/project-memory-mcp"]
    }
  }
}
```

Or, if you built from source, point to the local `dist/index.js`:

```json
{
  "mcpServers": {
    "project-memory": {
      "command": "node",
      "args": ["/absolute/path/to/project-memory-mcp/dist/index.js"]
    }
  }
}
```

Quit Claude Desktop fully and reopen it. You should see a new server in the MCP panel, and five tools should appear. A good opener for any session:

> Call `set_active_project` with `/absolute/path/to/my/project`, then `get_open_questions` and `get_dependency_graph`.

That's ~700 tokens of full orientation before any real work begins.

## Development

```bash
npm run dev          # watch mode
npm run typecheck    # tsc --noEmit
npm test             # vitest
```

## Project narrative

Built publicly by [Fer](mailto:fernandoalcarazp@gmail.com), with Claude writing the code and Fer directing. See `DECISIONS.md` for the architectural choices and why they were made.

## License

MIT
