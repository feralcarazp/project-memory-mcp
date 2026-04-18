# Memory

> Running log of state that doesn't belong in code. Current priorities, open questions, next steps, and anything else future-us will want to re-read at the top of a session.

## Last session

**Date:** 2026-04-17
**Summary:** Kickoff. Full scaffolding, first tool shipped and end-to-end verified in Claude Desktop/Cowork, second tool shipped (still pending E2E verification on Fer's machine).

**Done:**
- Stack confirmed: TypeScript + Node 20, ESM, @modelcontextprotocol/sdk v1.29, simple-git, zod, Vitest.
- Project structure: `src/{index,tools,context}`, `tests/`.
- `get_project_context` — implemented, tested (5/5), verified live on Fer's Mac.
- `list_recent_changes` — implemented, tested (7/7), commits + hotspots ranking.
- MCP server boots over stdio. Claude Desktop/Cowork loads it via `~/Library/Application Support/Claude/claude_desktop_config.json`.
- Docs vivos: README, ARCHITECTURE (roadmap updated), DECISIONS (ADRs 001–008), MEMORY, TESTING, DEBUGGING, SETUP.

## Current state

- **Week in plan:** Week 1 of 12. Two tools shipped on day 1. Ahead of the S1–3 target.
- **On Fer's Mac:** tool #1 verified live. Tool #2 built in this session; needs a local rebuild + Claude Desktop restart to go live on Fer's machine.
- **Git init on Fer's Mac:** still pending (sandbox couldn't commit on Claude's side — Fer does it locally, see SETUP.md step 4).

## Next steps (suggested, in order)

1. **Fer:** `git pull`-style sync — bring the new files from Cowork to the local project folder, run `npm run build`, restart Claude Desktop, prove `list_recent_changes` works end-to-end on one of his repos.
2. Commit: initial scaffold + `list_recent_changes`. Two commits is cleaner than one monster commit — tells the story.
3. Publish the repo publicly on GitHub.
4. Third tool: TBD. Candidates: `summarize_file` (AST via tree-sitter — starts to differentiate from "glorified git wrapper"), or `get_open_questions` (reads our own MEMORY.md / DECISIONS.md — meta-dogfood).
5. Start using Project Memory MCP at the start of each new session ("dogfood at the door").

## Open questions

- Naming for npm publish: `project-memory-mcp` is descriptive but long. Defer until soft launch.
- `summarize_file` vs. `get_open_questions` for tool #3 — depends on whether we want to go deeper into code understanding (AST) or deeper into project memory patterns (docs). Decide next session, after dogfooding tool #2 for a day.

## Things we are NOT doing yet

- No HTTP transport (stdio only).
- No tree-sitter integration yet.
- No npm publish.
- No CI yet (comes before public launch).
