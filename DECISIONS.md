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
