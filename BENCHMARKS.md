# Benchmarks

## TL;DR

Orienting a fresh Claude session on this project using Project Memory MCP takes **1,288 tokens**. Giving Claude the same level of orientation by pasting the raw project docs takes **10,556 tokens**.

**88% fewer tokens. 8.2× cheaper. Every new chat.**

## The "opener" test

The "opener" is the first exchange of a new chat with an AI coding assistant — the moment where it has to get oriented in your project before it can do anything useful. Before Project Memory, the natural way to orient the agent was to paste the key docs of the repo. This benchmark compares both approaches on this same repo.

Both scenarios target the same outcome: the assistant finishes the opener knowing what the project is, what's in flight, what's been decided, and how the code is structured.

## Scenario A — with Project Memory

A single opener that calls three MCP tools:

| Call | Tokens |
|---|---:|
| `set_active_project` | 248 |
| `get_open_questions` | 808 |
| `get_dependency_graph` | 232 |
| **Total** | **1,288** |

## Scenario B — without the tool (raw files)

Pasting the files a developer would typically share to give the agent the same context:

| File | Tokens |
|---|---:|
| `MEMORY.md` | 4,033 |
| `DECISIONS.md` | 3,759 |
| `ARCHITECTURE.md` | 1,210 |
| `README.md` | 953 |
| `package.json` | 408 |
| `git log` (last 10 commits) | 193 |
| **Total** | **10,556** |

## Why it saves so much

Two reasons:

1. **Curation over dump.** `get_open_questions` extracts only the live sections of `MEMORY.md` (Open questions, Next steps, NOT doing) instead of shipping the whole file. Same pattern for the dep graph and project context.
2. **Structure over prose.** A machine-readable summary of imports and entrypoints is denser than raw source files.

## Reproducing

1. Clone this repo and connect Project Memory MCP to your Claude Desktop (see `README.md`).
2. In a new Claude Desktop chat, run the opener:

   > Call `set_active_project` with the full path to this repo, then `get_open_questions` and `get_dependency_graph`.

3. Compare the token cost against pasting the files in the Scenario B table by hand.

See also `scripts/benchmark-tokens.mjs` for the scriptable version.

## Caveats

- Measured on this repo (`@feralcaraz/project-memory-mcp` itself), April 2026.
- Exact numbers vary by project. The savings scale with how much your `MEMORY.md` and `DECISIONS.md` actually have in them — bare-bones repos save less; well-documented ones save more.
- The "up to 88%" phrasing in the README refers to this measured run. On similarly documented projects we expect a band of roughly 70–90%.
