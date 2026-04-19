# Memory

> Running log of state that doesn't belong in code. Current priorities, open questions, next steps, and anything else future-us will want to re-read at the top of a session.

## Last session

**Date:** 2026-04-19 (fourth slice)
**Summary:** Shipped tool #5 — `set_active_project`. Fulfills ADR-004's deferred "Future direction" clause. `path` is now optional on every tool; the fallback order is explicit `path` → cached active project → clear error. No `cwd` fallback, ever.

**Done (this slice):**
- **`set_active_project` (ADR-012):** new MCP tool. Validates the path (`statSync`: must exist, must be a directory), caches it in `src/session.ts`, and returns the same markdown as `get_project_context` so the caller immediately sees what the server detected.
- **`src/session.ts`:** module-level singleton. Exports `setActiveProject`, `getActiveProject`, `clearActiveProject`, and the key helper `resolveTargetPath(explicit?)` used by every tool adapter.
- **Four existing tools:** `path` is now `z.string().min(1).optional()` on all of them; adapters call `resolveTargetPath(path)` before passing to the domain function. Explicit `path` wins and does NOT mutate the cache — one-off queries against another project don't clobber the session's active context.
- **`tests/session.test.ts`:** 9 tests covering set/clear/overwrite, explicit-vs-cache precedence, bad paths (nonexistent, is-a-file), and the no-path-and-no-cache error message.
- **Suite:** 46/46 green (was 37/37 — added 9 session tests, no regressions).
- **End-to-end verified via stdio smoke test:** `set_active_project` → `list_recent_changes` (no path) → `get_dependency_graph` (no path) all work; the cache is used.

### Last session

**Date:** 2026-04-19 (third slice)
**Summary:** Shipped tool #4 — `get_dependency_graph`. Regex-based v1 over TS/JS. Also fixed two bugs the tool's own dogfood surfaced (before I'd even finished the feature).

**Done (this slice):**
- **`get_dependency_graph` (ADR-011):** walks `.ts/.tsx/.js/.jsx/.mjs/.cjs`, strips comments, regex-extracts ES imports + export-from + dynamic import + CJS require. Resolves relative specs to real files; marks bare specifiers as external. Two modes: aggregate (most-imported + entrypoints) or targeted (one file's in- and out-edges).
- **Two bugs found by dogfooding the tool on this very repo:**
  - `vitest.config.ts.timestamp-*.mjs` noise files were being scanned as source. Added the pattern to `IGNORED_FILE_PATTERNS`, mirroring what `get_project_context` already does. Covered by regression test.
  - TS-under-ESM convention: `import "./foo.js"` where the source on disk is `./foo.ts` was coming back as `unresolved`. Added a JS→TS extension fallback to the resolver. Covered by regression test.
- **`src/context/deps.ts`, `src/tools/get_dependency_graph.ts`, `tests/deps.test.ts`** — 13 new tests, all green. Total suite 37/37.
- Wired into `src/index.ts` and the benchmark. Stdio smoke-test shows all four tools registered.
- **Benchmark takeaway:** aggregate-mode `get_dependency_graph` stays under 250 tokens regardless of project size (it caps at `limit=10` by default). On this repo: 218 tokens. It's the cheapest tool in the toolkit.

**Done (earlier slices, same session):**
- **Tool #3 — `get_open_questions` (ADR-010):** parses H2 sections out of `MEMORY.md`; meta-dogfood.
- **Bug fixes in `getRecentChanges` (ADR-009):** empty repo / merges / quotePath.
- **CI:** `.github/workflows/ci.yml` on Node 20 & 22 × ubuntu/macOS.
- **Token benchmark:** `scripts/benchmark-tokens.mjs` and `npm run benchmark:tokens`, with `gpt-tokenizer` as a devDep.

**Done (earlier in the day, same session):**
- **Bug fixes in `getRecentChanges` (ADR-009):** empty repo no longer throws; `--no-merges` on `git log` so merge commits don't pollute hotspots; `-c core.quotePath=off` so non-ASCII filenames come through verbatim. Each fix is covered by a regression test.
- **CI:** `.github/workflows/ci.yml` runs typecheck + build + test on Node 20 & 22, on ubuntu-latest and macos-latest. Concurrency group cancels in-flight runs on the same ref.
- **Token benchmark:** `scripts/benchmark-tokens.mjs` and `npm run benchmark:tokens`. Builds reproducible fixtures, auto-detects `gpt-tokenizer` → `js-tiktoken` → chars/4.
- **Small refactor:** `formatProjectContext` / `formatRecentChanges` / `formatOpenQuestions` all exported so the benchmark renders the exact same markdown the MCP clients receive.

**Baseline token numbers (gpt-tokenizer cl100k_base, 2026-04-19, fourth slice):**

| fixture | tool                 | variant   | tokens |
| ------- | -------------------- | --------- | ------ |
| empty   | get_project_context  | default   |     83 |
| empty   | list_recent_changes  | limit=10  |     73 |
| empty   | get_dependency_graph | aggregate |     49 |
| tiny    | get_project_context  | default   |    113 |
| tiny    | list_recent_changes  | limit=10  |    249 |
| medium  | get_project_context  | default   |    246 |
| medium  | list_recent_changes  | limit=10  |    411 |
| medium  | list_recent_changes  | limit=50  |  1,548 |
| large   | get_project_context  | default   |    485 |
| large   | list_recent_changes  | limit=10  |    411 |
| large   | list_recent_changes  | limit=50  |  1,543 |
| large   | list_recent_changes  | limit=200 |  5,780 |
| self    | get_project_context  | default   |    202 |
| self    | list_recent_changes  | limit=10  |    158 |
| self    | get_open_questions   | default   |    552 |
| self    | get_dependency_graph | aggregate |    222 |

Drift from previous slice is within noise (±5 tokens on the fixtures). The `self` row grew slightly as MEMORY.md grew and a fifth tool landed.

Takeaways:
- `list_recent_changes` with `limit: 10` stays under 500 tokens on any size project.
- `limit: 200` on a large repo crosses 5k — worth flagging if we ever add a "summarize everything" default.
- `get_open_questions` on our own MEMORY.md is ~550 tokens. Cheap and dense.
- `get_dependency_graph` aggregate mode is the cheapest tool in the kit (~220 tokens on this repo; capped at `limit=10`).
- Combined `set_active_project + get_open_questions + get_dependency_graph` on this repo is ~750 tokens total — the "full session orientation" pattern we want users to adopt. (The numbers above don't have a standalone row for `set_active_project` because its output is just `get_project_context`'s markdown plus a one-line header; budget ~210 tokens.)

## Current state

- **Week in plan:** Week 1 of 12. Five tools shipped + CI + benchmark + 46 tests. Well ahead of the S1–3 target.
- **Tests:** 46/46 passing locally. CI hasn't run against a real GitHub remote yet — will validate on first push.
- **On Fer's Mac:** tool #1 verified live. Tools #2–#5 all built but still need a local rebuild + Claude Desktop restart.
- **Git init on Fer's Mac:** still pending (sandbox couldn't commit on Claude's side — Fer does it locally, see SETUP.md step 4).
- **Ergonomic note:** the session now has a proper opener. `set_active_project(path)` → `get_open_questions()` → `get_dependency_graph()` is 3 calls, ~750 tokens total, zero repeated path arguments.

## Next steps (suggested, in order)

1. **Fer:** sync, `npm install`, `npm run build`, restart Claude Desktop. Then open next session with `set_active_project(path)` → `get_open_questions()` → `get_dependency_graph()` — that's three calls, zero repeated paths, ~750 tokens of full orientation before any work starts. Real test of the premise.
2. Commit. Suggested grouping, each green under CI:
   - (a) `fix: harden getRecentChanges against empty repos, merges, and quoted paths` (ADR-009)
   - (b) `chore(ci): add GitHub Actions workflow`
   - (c) `chore: add token benchmark harness`
   - (d) `feat: add get_open_questions tool` (ADR-010)
   - (e) `feat: add get_dependency_graph tool` (ADR-011)
   - (f) `feat: add set_active_project tool + session cache` (ADR-012)
3. Publish the repo publicly on GitHub so CI actually runs.
4. Tool #6 — best candidates now:
   - `summarize_file`: the tree-sitter one. Would be our biggest scope jump yet. Good chance it pays for itself when the summary is < 200 tokens per file.
   - `search_project`: semantic + keyword search across code and docs. Needs an indexing story; bigger than it sounds.
   - Either way, the next tool is a meaningful jump in scope — no easy wins left in the four-tools-that-are-just-parsing-structured-text category.

## Open questions

- Naming for npm publish: `project-memory-mcp` is descriptive but long. Defer until soft launch.
- Should `get_open_questions` also parse `DECISIONS.md`'s `**Revisit when:**` markers? Would need a separate parser (ADR-010 punted). Wait until we have a concrete case.
- Should `get_dependency_graph` ever resolve `tsconfig.json` `paths` aliases? ADR-011 says no for v1. Revisit when a dogfooder bumps into it.
- Should the benchmark be part of CI as a regression guard on token counts? Still leaning local-only until we have more data points.
- Should the active-project cache persist across server restarts (e.g. `~/.config/project-memory-mcp/session.json`)? ADR-012 said no on day one — revisit after a few weeks of real use if people keep re-setting the same project.
- Tool #6 direction — `summarize_file` (tree-sitter) vs. `search_project` (indexing). Both are big scope jumps; neither is "free".

## Things we are NOT doing yet

- No HTTP transport (stdio only).
- No tree-sitter integration yet.
- No npm publish.
- No structured ADR parsing in `get_open_questions`.
- No `tsconfig.json` `paths` resolution in `get_dependency_graph`.
- No Python / Go / Rust support in `get_dependency_graph` — regex stays TS/JS-only.
- Token benchmark not yet in CI.
- No Windows coverage in CI.
- No persistence for the active-project cache — one set per MCP subprocess lifetime. Claude Desktop restart = cache gone. Deliberate; see ADR-012.
- No multi-project cache. Exactly one active project at a time.
- No `cwd` fallback. Ever. Fallback chain is explicit `path` → active project → loud error.
