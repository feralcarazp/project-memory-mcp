# Architecture

> Shape of the codebase and where things live. Updated as the design evolves.

## Overview

Project Memory MCP is an **MCP server** — a long-running Node.js process that speaks JSON-RPC 2.0 over stdio (standard input/output). A client (Claude Desktop, Cursor, etc.) launches the server as a subprocess, exchanges messages, and exposes the tools to the underlying LLM.

```
┌──────────────────┐     stdin/stdout      ┌──────────────────────────┐
│  MCP client      │  ◄── JSON-RPC 2.0 ──► │  project-memory-mcp      │
│  (Claude, etc.)  │                        │  (Node.js subprocess)    │
└──────────────────┘                        └──────────────────────────┘
                                                        │
                                                        ▼
                                              ┌──────────────────┐
                                              │  User's project  │
                                              │  (filesystem,    │
                                              │   Git, etc.)     │
                                              └──────────────────┘
```

## Layers

```
src/
├── index.ts                    Entry point. Wires up the server + transport.
├── tools/                      Each file = one MCP tool. Thin adapter:
│   ├── get_project_context.ts    validates input, calls context/, formats output.
│   └── list_recent_changes.ts
└── context/                    Pure domain logic — reads the filesystem/Git.
    ├── project.ts                getProjectContext(path) → ProjectContext
    └── changes.ts                getRecentChanges(opts) → RecentChanges
```

**Separation of concerns:**

- `tools/*` are the MCP interface. They know about the SDK, Zod schemas, and formatting. They do **not** hold business logic.
- `context/*` are pure functions over the filesystem and Git. They know nothing about MCP. This makes them trivial to test and reusable across tools.

This split is the single most important architectural decision early on. Each new tool becomes a two-file PR: one function in `context/`, one adapter in `tools/`.

## Transport

We use **stdio** (`StdioServerTransport`) because that is what Claude Desktop's MCP config expects. Adding HTTP/SSE is possible later if we want remote hosting, but stdio covers the primary use case (local dev tools).

**Invariant:** nothing else in the process may write to `stdout`. `stdout` is the JSON-RPC channel — any stray log corrupts it. Diagnostics go to `stderr`, which Claude Desktop surfaces in the MCP logs panel.

## Tool design principles

1. **Each tool returns both `content` and, where useful, `structuredContent`.** Human-readable markdown in `text` so every client is useful; machine-readable fields for clients that parse them.
2. **Tools take an explicit `path` argument.** The server's `process.cwd()` is wherever Claude Desktop launched it from — usually not where the user's project lives. Making `path` explicit avoids silent-wrong-answer bugs.
3. **Fail clearly.** If a path doesn't exist or isn't a project, raise a useful error — don't invent data.

## Planned tools (roadmap)

Order is tentative; driven by dogfooding.

- ✅ `get_project_context` — high-level snapshot of a project.
- ✅ `list_recent_changes` — git log + hotspot ranking over the last N commits or since a date.
- `summarize_file` — AST-aware summary of a source file (uses tree-sitter).
- `get_dependency_graph` — import graph for a file or folder.
- `get_open_questions` — reads structured `DECISIONS.md` / `MEMORY.md` and exposes unresolved items.
- `search_project` — semantic + keyword search across code and docs.

## Data model conventions

- Paths in return values are **absolute and resolved** (not relative to cwd).
- All timestamps are ISO 8601 strings.
- Git hashes are returned as **7-char short hashes** unless a tool explicitly needs the full SHA.

## Testing strategy

See `TESTING.md`.

## Key dependencies

- **`@modelcontextprotocol/sdk`** — official MCP server/client library. High-level `McpServer` class with `registerTool`.
- **`simple-git`** — Promise-based wrapper around the `git` CLI. Chosen over `isomorphic-git` because it's a thin shell wrapper, no reimplementation of Git internals.
- **`zod`** — input schema validation. The MCP SDK integrates with Zod natively.
- **`tree-sitter`** (not yet in use) — will power AST-level tools (`summarize_file`, `get_dependency_graph`).
