# Decisions log

> Architecture Decision Records (ADRs), lightweight. Each entry captures what we decided, when, why, and what alternatives we considered. The goal is future-us (and anyone reading the repo) can understand why the code is shaped the way it is.

---

## 2026-04-17 · ADR-001 · TypeScript + ESM + Node 20+

**Decision:** TypeScript source, ESM (`"type": "module"`), minimum Node 20.

**Why:**
- The MCP SDK is TypeScript-first and ships ESM.
- ESM is the default going forward; CommonJS is legacy.
- Node 20 is the current LTS, and gives us stable `node:` protocol imports, global `fetch`, and top-level await.

**Alternatives considered:** CommonJS + older Node (more compatible with old toolchains, but the MCP ecosystem is new — optimizing for legacy doesn't buy us anything).

---

## 2026-04-17 · ADR-002 · stdio transport first (HTTP later, maybe)

**Decision:** Ship only the stdio transport initially.

**Why:** Claude Desktop, Cursor, and Claude Code all launch MCP servers as local subprocesses over stdio. Covering that case captures ~100% of the target user on day one. HTTP/SSE only becomes relevant for hosted/multi-tenant scenarios — not where we're going yet.

**Revisit when:** someone explicitly wants to host this on a server or share one instance across many projects.

---

## 2026-04-17 · ADR-003 · Split `tools/` from `context/`

**Decision:** Tools are thin adapters; all domain logic lives in `context/` as pure functions.

**Why:**
- Tools become easy to add: two small files per tool.
- Domain logic is testable without spinning up the MCP SDK.
- If we ever expose the same functionality over a different transport (HTTP, CLI), we re-export the same functions.

**Alternatives considered:** put logic directly inside the tool handlers (faster to write the first tool, but grows into a mess once you have 8 tools).

---

## 2026-04-17 · ADR-004 · Tools take an explicit `path` argument

**Decision:** Every tool that operates on a project requires an explicit `path` parameter. No implicit `cwd` lookup.

**Why:** Claude Desktop launches the server from its own working directory, not the user's project folder. Relying on `cwd` would give silently-wrong answers. Making `path` explicit forces the caller to be unambiguous — painful for the user in the short term, correct in the long term.

**Future direction:** a `set_active_project` tool could cache a path for the session, so the user only has to specify it once per conversation. Deferred until we have more than one tool.

---

## 2026-04-17 · ADR-005 · `simple-git` over `isomorphic-git`

**Decision:** Use `simple-git` for Git operations.

**Why:** `simple-git` is a thin wrapper around the `git` CLI — it inherits every behavior of the user's own `git` install (hooks, config, signing, worktrees). `isomorphic-git` is a pure-JS reimplementation; it works in browsers but has historically lagged on edge cases.

**Tradeoff:** `simple-git` requires `git` on the user's PATH. That's a reasonable assumption for developer tooling.

---

## 2026-04-17 · ADR-007 · `list_recent_changes` returns hotspots, not just commits

**Decision:** The tool returns both the commit list and a "hotspots" ranking (top files by number of times touched in the range).

**Why:** Raw commit lists are low-signal for an LLM that's trying to orient itself in a new project. "The last 20 commits touched mostly `src/auth/session.ts`" is more useful than 20 commit messages. Hotspots compress the same information into a cheaper, more actionable shape.

**Tradeoff:** more work per call (we parse `--name-only`), but rarely more than milliseconds for any reasonable range. Worth it.

---

## 2026-04-17 · ADR-008 · Raw `git log` parsing instead of `simple-git.log()`

**Decision:** Use `git.raw(["log", "--name-only", "--pretty=format:..."])` and parse the output ourselves, rather than `simple-git`'s higher-level `log()`.

**Why:** `simple-git.log()` doesn't cleanly expose the list of files per commit. We'd have to make one extra `git show` per commit, which is O(N) subprocess calls. A single `log --name-only` call is O(1) subprocess regardless of commit count.

**Tradeoff:** we own the parser. We use a `__COMMIT__` marker as record separator so the parser is tolerant to weird commit messages (multi-line, blank lines in body). Covered by tests.

---

## 2026-04-17 · ADR-006 · Real I/O in tests, no fs/git mocks

**Decision:** Tests create real temp directories and initialize real Git repos with `simple-git`.

**Why:** The code under test is I/O glue. Mocks would mostly verify the mocks match the implementation — they'd catch few real bugs. Temp-dir tests run in under a second and exercise the real code paths.

**Revisit when:** a test becomes slow (> ~1s) or flaky. Then we extract the problematic logic into a pure function and test that instead.

---

## 2026-04-19 · ADR-009 · Defensive `git log` invocation

**Decision:** `getRecentChanges` invokes `git log` with three specific hardening measures. Grouping them in one ADR because they're all the same underlying idea — "don't trust git's defaults to match what an LLM consumer needs."

**The three measures:**

1. **Pre-check for an empty repo** via `git rev-list --all -n 1`. `git log` errors out on an unborn branch ("your current branch does not have any commits yet"); we return `{ commits: [], hotspots: [] }` instead. An empty repo is a valid state, not an exception.
2. **`--no-merges`** on the log. Merge commits "touch" every file they bring in, double-counting changes in the hotspot ranking without adding signal. The real work happened in the merged-in commits, which we already see.
3. **`-c core.quotePath=off`** on the log. Git's default quotes non-ASCII paths and octal-escapes the bytes (`café.ts` → `"caf\303\251.ts"`). That breaks any downstream consumer treating hotspot paths as real filesystem paths.

**Why one ADR, not three:** each fix is small and obvious on its own. Grouped, they tell the more interesting story — when you shell out to `git`, the defaults optimize for terminal humans, not programmatic consumers, and you have to explicitly opt out.

**Alternatives considered:** `-c log.showSignature=false` and `--encoding=UTF-8` were considered as belt-and-suspenders, but showed no behavioral difference in our test matrix. Added a regression test per bug.

**Why we didn't hit these earlier:** Tool #2 was exercised on a mature repo with no merges and ASCII filenames. The bugs only surface on freshly-init'd repos, long-lived repos with a merge workflow, or repos with non-English contributors — none of which Fer's first dogfooding covered.

---

## 2026-04-19 · ADR-010 · Docs as structured data (MEMORY.md is a contract)

**Decision:** `get_open_questions` parses H2 sections out of `MEMORY.md` (by default) and treats them as queryable data. By shipping this tool, we're establishing that the memory file isn't just prose — certain sections (`## Open questions`, `## Next steps`, `## Things we are NOT doing yet`) are a small, informal schema.

**Why:**
- The whole point of this project is reducing the "re-explain the project every session" tax. A tool that surfaces only the live parts of the memory file is more valuable than one that dumps the whole thing and lets the LLM skim.
- Meta-dogfood: project-memory-mcp now uses itself to orient at the start of a session. If the tool is useful here, it's useful everywhere; if it isn't, we'll feel the pain first.
- We picked this over `summarize_file` (tree-sitter) as tool #3 because the cost-per-value ratio is better: one afternoon of parser work vs. a multi-session tree-sitter integration that adds a native dep.

**What's in the schema (loose, informal):**
- H2 headings are the primary structure. H3+ are body.
- Bullet lists (`-`, `*`, `+`, `1.`) inside a wanted section are items; nested bullets get flattened with a `↳` marker.
- The default "wanted" sections are: `Open questions`, `Next steps`, `NOT doing`. Matching is case-insensitive substring, so `"Next steps (suggested, in order)"` matches.

**What we deliberately did NOT do:**
- No CommonMark AST. A line-by-line parser is enough and we don't have to manage a dependency. Revisit if we ever need to support fenced code blocks or inline-formatted bullets meaningfully.
- No DECISIONS.md-specific extraction (ADR status, `**Revisit when:**` triggers). The file is a harder schema — each entry has a half-dozen bold labels — and we don't have a use case yet that justifies a second parser path. Callers can point `get_open_questions` at `DECISIONS.md` via the `file` param today; structured ADR parsing can be its own ADR if we ever need it.

**Tradeoff:** by treating section names as a schema, any doc reorganization that changes those names also breaks the tool. That's real but acceptable — the schema is tiny (three heading strings) and documented in the tool's input schema, so future-us (or a contributor) will spot the coupling immediately.

---

## 2026-04-19 · ADR-011 · Regex-first dependency extraction (tree-sitter later)

**Decision:** `get_dependency_graph` finds imports via regex over comment-stripped source, not via an AST parser. v1 targets TypeScript and JavaScript only (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`).

**Why:**
- An import graph is useful *today*. Tree-sitter gives us better fidelity but drags in native bindings, per-language grammars, and a build-step story we don't need yet. A ~40-line regex pass covers the overwhelmingly common syntaxes (ES static imports, `export ... from`, dynamic `import()`, CJS `require()`) with zero new dependencies.
- The cost of being wrong is low: a false negative ("didn't find an import") means one missing edge in a tool that's already only a summary; a false positive is more likely to surface as a visibly odd entry the caller will notice. Stripping comments first removes the most common false-positive source.
- Regex keeps the tool fast enough that we can scan the whole tree every call without caching.

**What this tool covers:**
- ES static: `import x from "..."`, `import { x } from "..."`, `import * as ns from "..."`, `import "..."`, `import type ... from "..."`.
- Export-from: `export { x } from "..."`, `export * from "..."`, `export type ... from "..."`.
- Dynamic: `import("...")`.
- CommonJS: `require("...")`.
- Comment-stripping: line and block comments are removed before regex scanning, so code that discusses imports in prose doesn't false-positive.

**What this tool deliberately does NOT cover (yet):**
- Non-literal specifiers: `import(dynamicVar)` and `require(dynamicVar)` are skipped. The target can't be known without evaluating the program.
- TypeScript `paths` aliases from `tsconfig.json`: a bare specifier that would resolve via `paths` is treated as external. Supporting aliases means resolving them correctly — deferred.
- Python, Go, Rust: out of scope for v1. When we add them we'll pick per-language parsers rather than trying to extend the regex.
- Backtick template literals that happen to contain `from "..."` inside them are rare in practice and not worth the regex complexity; they'd false-positive. Documented here so we remember.

**Resolver conventions (implementation notes, learned while dogfooding):**
- Ignored directories mirror those used in `get_project_context` — `node_modules`, `dist`, `build`, `.git`, `.next`, `.turbo`, `coverage`, `.vitest-cache`.
- Ignored file patterns (`vitest.config.ts.timestamp-*.mjs`, `*.tsbuildinfo`) are also reused. These are tool-generated noise with source extensions.
- **TS-under-ESM convention:** `import "./foo.js"` when the source on disk is `./foo.ts` is now the standard emit shape. The resolver falls back to `.ts`/`.tsx` when a `.js`/`.jsx` spec doesn't hit the scanned set. Same for `.mjs`/`.cjs` → `.mts`/`.cts`/`.ts`.

**Upgrade path:** when we add `summarize_file` (which does need an AST), we'll already have tree-sitter as a dependency. At that point swapping `extractImportSpecs` for a tree-sitter query is a scoped change — the tool's public API (`DependencyGraph`) wouldn't move.

**Revisit when:** a user hits a case where the regex gets the wrong answer and it matters. Until then the simpler tool wins.

---

## 2026-04-19 · ADR-012 · Session-scoped active project (fulfilling ADR-004's deferred clause)

**Decision:** Add a `set_active_project` tool that caches a project path in the MCP process's in-memory state. Make `path` optional on every existing tool; when omitted, the tools resolve against the cached path. When nothing is cached and no explicit path is passed, tools throw a clear error pointing the caller at `set_active_project`.

**Why now:**
- ADR-004 said "`set_active_project` could cache a path for the session; deferred until we have more than one tool." We have four tools — soon five — and repeating the absolute project path on every call is real friction. The ergonomic cost that ADR-004 dismissed is now visible in every dogfood session.
- Meta-dogfood: the session-opener pattern we want users to adopt is "call `set_active_project`, then everything else." That only works if everything else actually honors the cache.

**What we kept from ADR-004:**
- No `process.cwd()` fallback, ever. Claude Desktop's cwd is still not the user's project folder — that hasn't changed. The fallback order is **explicit `path` → cached active project → error**. There is no third fallback; we'd rather fail loudly than invent a root.
- Explicit `path` still overrides the cache for that single call, and does **not** mutate the cached value. That lets a caller run a one-off query against a different project without losing their session's active context. (The alternative — "explicit path also updates the cache" — would have been a footgun: two ways to mutate shared state is one too many.)

**Implementation shape:**
- `src/session.ts` owns module-level singleton state. One MCP subprocess = one session, so no tenancy or concurrency concerns. `resolveTargetPath(explicit?)` is the single helper every tool uses.
- `setActiveProject` does real I/O validation (`statSync`): the path must exist and be a directory. This runs at tool-call time, not at cache-read time, so errors are reported by the tool the user actually invoked rather than surfacing later from some unrelated call.
- The `set_active_project` adapter composes: it stashes the path and returns the same markdown as `get_project_context`. Two birds: the caller confirms the path, and the LLM immediately sees what the server detected.

**What this tool deliberately does NOT do:**
- No persistence across server restarts. When Claude Desktop restarts the subprocess, the cache is empty. We could persist to `~/.config/project-memory-mcp/session.json` or similar, but that introduces cross-client collisions (two clients pointing at two different projects would fight over the file). Forcing an explicit `set_active_project` per session is cheap and avoids the whole class of bugs.
- No multi-project cache. Exactly one active project at a time. A project-list abstraction would be feature creep for a tool whose whole job is "stop re-explaining myself."
- No automatic detection ("set active to the Git repo enclosing this file"). Magic that sometimes gets it wrong is worse than a one-line tool call.

**Tradeoffs:**
- The `path` schema on every existing tool is now `z.string().min(1).optional()`. A caller who still passes `path` on every call gets identical behavior to before. A caller who omits it after `set_active_project` gets the cache. A caller who omits it with no cache gets an instructive error message. All three paths are tested.
- ADR-004's "explicit path" rule is slightly weakened on paper. But the property that mattered — "no silent `cwd` fallback" — is preserved. The rule is now "explicit-or-explicitly-cached", which is still safe and strictly more ergonomic.

**Revisit when:** we need the cache to survive restarts, or when someone needs to work with two projects in the same session. Both are plausible but not pressing.

