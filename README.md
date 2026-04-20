# Project Memory MCP

[![npm version](https://img.shields.io/npm/v/@feralcaraz/project-memory-mcp.svg)](https://www.npmjs.com/package/@feralcaraz/project-memory-mcp)
[![npm downloads](https://img.shields.io/npm/dw/@feralcaraz/project-memory-mcp.svg)](https://www.npmjs.com/package/@feralcaraz/project-memory-mcp)
[![CI](https://github.com/feralcarazp/project-memory-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/feralcarazp/project-memory-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/npm/l/@feralcaraz/project-memory-mcp.svg)](LICENSE)


> **A brain for your AI coding tools — one that doesn't forget.** Project Memory gives Claude, Cursor, and Claude Code a shared, always-fresh view of your codebase, cutting token usage by up to **88%**. [See the benchmark →](./BENCHMARKS.md)

**Status:** v0.2.0 on npm — now with one-command install and a native write tool. Published as [`@feralcaraz/project-memory-mcp`](https://www.npmjs.com/package/@feralcaraz/project-memory-mcp).

## Why

Every time you switch AI tool, you re-explain the same project from scratch: what it is, what stack, what conventions, what you're currently working on. Project Memory MCP is a small server that lives next to your code and gives any AI client a consistent, up-to-date view of the project — without you having to paste the same context ten times a week.

It speaks the [Model Context Protocol](https://modelcontextprotocol.io), so any MCP client can talk to it.

## Tools exposed

- **`set_active_project`** — cache a project path for the rest of the MCP session. Once set, the other tools default to it and `path` becomes optional on every call.
- **`get_project_context`** — summarize a project: name, description, detected languages, top-level structure, and current Git state.
- **`list_recent_changes`** — summarize recent Git activity: the last N commits (or every commit since a date) plus a "hotspots" ranking of files touched most in that range.
- **`get_open_questions`** — extract live state from a project's `MEMORY.md` (or any file you point it at): open questions, next steps, and explicit non-goals.
- **`get_dependency_graph`** — TypeScript/JavaScript import graph. Without `target`, summarizes the project (most-imported modules, entrypoints). With `target`, returns one file's imports and the files that import it.
- **`append_to_memory`** — append markdown content to a curated section of `MEMORY.md` (open questions, next steps, session notes, decisions). Closed enum for sections; load-bearing ones must pre-exist; atomic write via tmp + rename. *(new in v0.2.0)*

On any tool, `path` is optional IF you've called `set_active_project` earlier in the session. Otherwise pass it explicitly. There is no silent `cwd` fallback.

More tools coming (see `ARCHITECTURE.md` for the roadmap).

## Requirements

- Node.js 20 or newer
- A project on your local filesystem (Git repo optional but recommended)

## Install

No install step needed for normal use. Your MCP client (Claude Desktop, Cursor, etc.) fetches and runs the server on demand via `npx`. The next section shows how to wire it in.

If you'd rather build from source (for development or to pin a specific commit):

```bash
git clone https://github.com/feralcarazp/project-memory-mcp.git
cd project-memory-mcp
npm install
npm run build
```

## Connect to Claude Desktop

> ⚠️ **Important — this is not installed by talking to Claude.** You don't paste the config into a chat. You edit a file on your computer and then restart the Claude Desktop app. If you paste the config block into a Claude conversation, Claude may respond politely but **nothing will get installed**. Follow the steps below.
>
> This guide is for the **Claude Desktop app** (the one you download and install). It does **not** work with claude.ai in a web browser — browser Claude only supports remote URL-based MCP servers, and this one runs locally.

### One-command install (recommended)

```bash
npx @feralcaraz/project-memory-mcp install
```

This edits `claude_desktop_config.json` for you — adding the `project-memory` entry under `mcpServers` and preserving anything else already in the file. A timestamped backup is written next to the config before any changes.

To remove it later:

```bash
npx @feralcaraz/project-memory-mcp uninstall
```

After install or uninstall, fully quit and reopen Claude Desktop to pick up the change.

### Manual install (fallback)

If you'd rather edit the config file by hand, here are the full step-by-step recipes for each OS.

#### macOS

1. **Install Node.js 20 or newer** if you haven't already. Download the LTS installer from [nodejs.org](https://nodejs.org). You can confirm it worked by opening the Terminal app and running `node --version` — you should see something like `v20.x` or higher.
2. **Install the Claude Desktop app** from [claude.ai/download](https://claude.ai/download) if you don't have it yet. Open it once so it creates its config folder.
3. **Open the Claude config file.** In Finder, press `Cmd + Shift + G` to open the "Go to Folder" prompt. Paste this exact path and press Enter:

   ```
   ~/Library/Application Support/Claude/
   ```

   You should see a file named `claude_desktop_config.json`. If it's not there, create an empty file with that exact name (including the `.json` extension).

4. **Open `claude_desktop_config.json` with a plain-text editor.** Right-click the file → Open With → TextEdit (or VS Code, Sublime, etc. — anything that edits plain text). Do **not** use Word, Pages, or Notes — those add invisible formatting and break the file.
5. **Paste the config below into the file.** If the file is empty, paste this exactly as shown. If the file already has content (an `mcpServers` block from another server), add the `"project-memory": { … }` entry inside it, separated by a comma.

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

6. **Save the file.** `Cmd + S`. Make sure the extension is still `.json` — TextEdit sometimes tries to append `.txt`. If it asks whether to save as rich text or plain text, choose plain text.
7. **Fully quit Claude Desktop.** Click the Claude icon in the menu bar → Quit, or press `Cmd + Q` inside the app. The red close button (top-left) is NOT enough — the app keeps running in the background.
8. **Reopen Claude Desktop.** It should now load the config on startup. If you see a small hammer/tool icon in the chat input area, click it — you should see `project-memory` listed with 6 tools. That means it worked.

#### Windows

1. Install Node.js 20 or newer from [nodejs.org](https://nodejs.org).
2. Install the Claude Desktop app from [claude.ai/download](https://claude.ai/download) and open it at least once.
3. Open File Explorer, paste `%APPDATA%\Claude\` into the address bar, and press Enter.
4. Open `claude_desktop_config.json` with Notepad (not Word). If the file doesn't exist, create it.
5. Paste the same JSON block as above.
6. Save the file. Confirm it's saved as `.json`, not `.json.txt`.
7. Right-click the Claude icon in the system tray → Quit. Wait a few seconds. Relaunch.

### Verify it worked

Open a new chat in Claude Desktop and try:

> Call `set_active_project` with `/absolute/path/to/my/project`, then `get_open_questions` and `get_dependency_graph`.

Replace the path with a real folder on your machine. If the three calls run and return markdown, you're done — that's ~700 tokens of full project orientation before any real work begins.

### Troubleshooting

- **The hammer icon doesn't show up / nothing happens.** The config file is probably malformed. Copy its full contents into [jsonlint.com](https://jsonlint.com) — it will pinpoint the typo. Most common cause: a missing comma when adding `project-memory` next to an existing MCP server.
- **Claude says it doesn't see a `project-memory` server.** You didn't fully quit the app. `Cmd + Q` on Mac, system-tray Quit on Windows. Restarting via the red close button is not enough.
- **`spawn npx ENOENT` or similar error.** Node isn't installed or isn't in your `PATH`. Run `which npx` (Mac) or `where npx` (Windows) in a terminal. If it prints nothing, reinstall Node from nodejs.org.
- **You see an old version even after updating.** `npx` caches packages. Force a refresh: in a terminal, run `npx clear-npx-cache` or delete the `~/.npm/_npx/` folder, then restart Claude Desktop.
- **It works, then stops working later.** Check Claude Desktop's MCP log: View → Developer → Open MCP Log (or in `~/Library/Logs/Claude/mcp*.log` on Mac). Errors show up there when a tool call fails.

## Connect to Claude Code

If you use [Claude Code](https://claude.com/claude-code) (the CLI), a single command wires it in at user scope (available in every project you open):

```bash
claude mcp add --scope user project-memory -- npx -y @feralcaraz/project-memory-mcp
```

Confirm it's live:

```bash
claude mcp list
```

You should see `project-memory` in the list. Start a new Claude Code session and the five tools become available. For project-scoped installs or other options, see the [Claude Code MCP docs](https://docs.claude.com/en/docs/claude-code/mcp).

## Connect to Cursor

Cursor supports MCP servers via a settings UI and a config file. Either works.

### Option A — Settings UI (recommended)

1. Open Cursor.
2. Go to **Cursor Settings → MCP** (or **Settings → Features → MCP**, depending on your Cursor version).
3. Click **+ Add new MCP server**.
4. Fill in:
   - **Name:** `project-memory`
   - **Command:** `npx`
   - **Args:** `-y @feralcaraz/project-memory-mcp`
5. Save. Cursor will spin up the server; if you see a green dot next to the entry, it's connected.

### Option B — Config file

Create or edit `~/.cursor/mcp.json` and add the same block you'd use for Claude Desktop:

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

Restart Cursor. Verify by opening Composer or Chat and asking it to list available tools — `project-memory` should appear.

If Cursor's UI or config path has moved, the canonical reference is [Cursor's MCP docs](https://docs.cursor.com/context/model-context-protocol).

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
