# Memory

> Running log of state that doesn't belong in code. Current priorities, open questions, next steps, and anything else future-us will want to re-read at the top of a session.

## Last session

**Date:** 2026-04-19 (seventh slice — first external user + docs for non-devs)
**Summary:** Fer's brother attempted the first external install. It failed, and the failure mode itself is the finding: he pasted the MCP config block into a Claude chat expecting auto-installation instead of editing `claude_desktop_config.json` manually. That's not a user error — that's a reasonable expectation in 2026 and a clear gap in our onboarding. Shipped v0.1.1 (docs-only patch) rewriting the "Connect to Claude Desktop" section as a literal step-by-step recipe for non-devs.

**Done (this slice):**
- **First external install attempt: scenario A.** Brother pasted the config JSON as a message in a Claude Desktop chat. Claude (the model) responded generically with "this looks like a Claude Desktop config, I'm running in Claude.ai web" — which was itself confused, but the root cause was that the install flow is not conversational: you have to edit a file on disk and fully relaunch the app. He never got to run a tool, so we have no usage feedback yet. Also: the "old chat information was lost" moment is the exact pain this project addresses — lived experience of the problem without recognizing it as such.
- **README: install section rewritten for non-devs.** New warning up front — "this is NOT installed by talking to Claude." Step-by-step recipe for macOS (Cmd+Shift+G, TextEdit, Cmd+Q-not-X) and Windows. Explicit "how to verify it worked" section and a troubleshooting block for the five most likely failures (malformed JSON, didn't fully quit, missing Node/PATH, cached npx, runtime errors via MCP log). No code changes, no API changes.
- **Version bump: 0.1.0 → 0.1.1.** Docs-only patch. Not republished to npm — `npx` users get the existing tarball; GitHub/npm website auto-render the updated README.

**Insights worth keeping:**
1. **The MCP install flow is a UX cliff for non-devs, and it's not our problem alone — it's ecosystem-wide.** Anyone who lives in conversational AI will instinctively try to install by chatting. The README is now our first line of defense; longer term this is one of the most interesting distribution problems in the space.
2. **Claude Desktop's silent failure is brutal.** Malformed JSON = no error, just nothing shows up. Adding the jsonlint.com hint in troubleshooting is the cheapest fix I could give.
3. **Input for tool #6 / future distribution:** the very first person outside my head that tried to install hit a wall before running a single tool. Whatever tool #6 is, "make the install step dumber" has to stay on the radar. Possibly worth shipping a one-command installer later (`npx @feralcaraz/project-memory-mcp install` that edits the config file for you — but that's a whole ADR of its own).

### Previous slice (2026-04-19, sixth — npm publish)
**Summary:** Shipped v0.1.0 to npm. The project is now `npx -y`-installable for any MCP client, worldwide. Along the way, three npm-ecosystem incidents taught us how the registry actually behaves.

**Done (this slice):**
- **`@feralcaraz/project-memory-mcp@0.1.0` live on npm.** Published with `publishConfig.access=public` (required because scoped packages default to private). Package is 28.5kB, 47 files, tarball includes `dist/` + `README.md` + `LICENSE` + `package.json` — nothing else (verified via `npm publish --dry-run`).
- **Authentication: granular access token with bypass-2FA.** npm now requires 2FA for all publishes and only offers WebAuthn/security-key as the TOTP replacement — no authenticator-app option. Workaround: security key for account 2FA + granular access token for CLI publishes. Token has `publish + bypass-2fa + all-packages + read/write + no orgs`, stored in `~/.npmrc` under `//registry.npmjs.org/:_authToken=…`. Rotated once mid-flow after the token string was accidentally pasted into a chat log — the revoke-and-regenerate cycle is ~3 minutes in the npm web UI, so a leaked token is cheap to recover from as long as you notice fast.
- **README: dual install paths.** Primary: `npx -y @feralcaraz/project-memory-mcp` (the headline use case). Secondary: clone + `npm run build` (for devs). Claude Desktop config shown with both forms.
- **Commit + tag + push.** `658ba51` on main. Tag `v0.1.0` pushed. Repo now matches the published version bit-for-bit.

**Three npm-ecosystem incidents worth remembering:**
1. **Unpublished names are permanently reserved.** `project-memory-mcp` (unscoped) was unpublished on 2026-03-29 — likely a prior experiment of our own. Result: `npm publish` with that name returns `Cannot publish over previously published version` even though `npm view` 404s. The name can never be reclaimed. npm's anti-"left-pad" policy. Pivoted to scoped `@feralcaraz/project-memory-mcp`, which is always available under our own scope. **Lesson:** when reserving a package name, publish `0.0.1` and leave it. Never unpublish during setup.
2. **Publish confirmation does NOT mean registry propagation.** The `+ @scope/pkg@version` line in `npm publish` output is the *upload* confirmation. The read endpoint (`npm view`, website) can lag by seconds to a couple of minutes. Don't panic on an immediate-post-publish 404; wait 60s and retry. We thought we had a scope-registry misconfig; turned out to be plain propagation lag.
3. **The first 2FA error can hide a successful upload.** An early `npm publish` attempt that errored with `403 Two-factor authentication required` had actually uploaded the version before the auth check rejected it. When we tried to republish the same version, we got `Cannot publish over previously published version 0.1.0` — the telltale sign that a "failed" publish wasn't actually fully failed. Always consider a publish half-successful after an auth failure.

### Previous slice (2026-04-19, fifth)

**Summary:** Closed the weekly loop. Five clean commits packaged via script, pushed to GitHub, CI green on the first matrix run, and the opener dogfood in a live Claude Desktop session validated the project's whole premise.

**Done (this slice):**
- **Commits shipped.** The five-commit plan ran cleanly through `scripts/commit-session.sh` after resolving two small incidents: a stale `.git/index.lock` on Fer's Mac (same class of issue the sandbox had), and a `@rollup/rollup-darwin-arm64` missing-optional-dep caused by the sandbox writing a Linux-side `package-lock.json`. Fix was the canonical `rm -rf node_modules package-lock.json && npm install`. Lesson: when the dev-side sandbox isn't the same OS as the user's machine, regenerate the lockfile locally before the first commit.
- **Push + CI green on first run.** `feralcarazp/project-memory-mcp` public on GitHub. CI matrix (Node 20 & 22 × ubuntu-latest & macos-latest) passed in 22s on commit `a14f54e`. Four deprecation warnings about `actions/checkout@v4` and `actions/setup-node@v4` internally running on Node 20 — cosmetic, unrelated to our test matrix, bump to `@v5` whenever GitHub ships it.
- **Opener dogfood: premise validated.** Fresh Claude Desktop session, three tool calls (`set_active_project` → `get_open_questions` → `get_dependency_graph`), ~750 tokens total. Claude identified stack, file count (18), ADR count (up to 012), last commit hash (`a14f54e`), all five open questions, and proposed a coherent next step. Zero re-explanation typed by Fer. The "open a new session cold" scenario now works.
- **Loop-closing insight (this very update is the example):** the tool is only as fresh as the file it reads. Claude's "next steps" suggestion referenced operational work (sync, commits, push) that was already done — because MEMORY.md hadn't been updated to reflect post-push state. Fix: update MEMORY.md at session close, not session start, from now on. Updating it at the start means the previous session's work has already been "lost" for one run.

**Cleanup:** removed `scripts/commit-session.sh` (its job is done and keeping it in the repo confuses future readers).

### Previous slice (2026-04-19, fourth)

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

- **Week in plan:** Week 1 of 12. Five tools shipped + CI + benchmark + 46 tests + 6 commits pushed + CI green + dogfood validated + published to npm + **first external install attempt (failed at onboarding UX) + docs rewritten for non-devs**. Well ahead of the S1–3 target on features, starting to feel the distribution edge.
- **Tests:** 46/46 passing locally. CI green on the matrix (Node 20 & 22 × ubuntu/macos).
- **Repo:** `feralcarazp/project-memory-mcp` public on GitHub. Tagged `v0.1.0` for the npm release, `v0.1.1` for the docs patch.
- **npm:** `@feralcaraz/project-memory-mcp@0.1.0` live at `https://www.npmjs.com/package/@feralcaraz/project-memory-mcp`. `v0.1.1` is a docs-only patch — not republished; `npx` still fetches the `0.1.0` tarball.
- **On Fer's Mac:** all 5 tools verified live via dogfood in a fresh Claude Desktop session.
- **External users:** 1 install attempt (hermano), 0 successful installs, 0 usage feedback. Blocker is onboarding, not the server.
- **Ergonomic note:** session opener is `set_active_project(path)` → `get_open_questions()` → `get_dependency_graph()` — 3 calls, ~750 tokens total.
- **Process discovery:** update `MEMORY.md` at session **close**, not session start.

## Next steps (suggested, in order)

1. **Unblock hermano's install and get the first real feedback.** Give him the v0.1.1 README, walk him through it once if needed, and capture: which tool he called first, what he expected vs. what he got, where he got confused. This is the single highest-leverage input for tool #6 and for distribution copy. Everything else on this list matters less until we have one successful external run.
2. **Outreach round: 5–10 friends who use Claude.** Copy the 1-a-1 template from the 90-day plan PDF. Priority is conversation and feedback, not announcement. The installer UX is the likeliest thing to break; treat each install as a mini user test.
3. **Tool #6 — strategic decision, informed by #1 and #2.** Two candidates, both meaningful scope jumps:
   - `summarize_file` (tree-sitter): AST-aware summary of a single file. Pays for itself if summary stays under ~200 tokens/file. Would be the first tool that needs a non-regex parser. 2–3 sessions.
   - `search_project` (semantic + keyword across code and docs): needs an indexing story. 3–5 sessions.
   - Leaning `summarize_file` first. But wait for user feedback before locking in — if hermano or the friends ask for something specific (e.g. "I wish it told me where to start"), that reframes the priority.
4. **Consider a one-command installer (ADR-worthy).** Something like `npx @feralcaraz/project-memory-mcp install` that edits `claude_desktop_config.json` for the user with a proper JSON-merge (respect existing servers), prints the path it wrote to, and tells them to quit-and-relaunch. Would collapse the README recipe into one terminal command. Not today; think about it after 3–5 more installs show whether the README fix is enough.
5. **Soft launch — deliberate, after #1 and #2.** Show HN / small Twitter thread with the `npx` line + config block. Goal: real bug reports, not stars.
6. **Housekeeping, low priority:**
   - Bump `actions/checkout` and `actions/setup-node` to `@v5` whenever GitHub ships it.
   - Consider moving the token benchmark into CI as a regression guard (still leaning no).
   - Regenerate the npm token before July expiration, narrower scope this time (`@feralcaraz/project-memory-mcp` only, not all packages).

## Open questions

- Should `get_open_questions` also parse `DECISIONS.md`'s `**Revisit when:**` markers? Would need a separate parser (ADR-010 punted). Wait until we have a concrete case.
- Should `get_dependency_graph` ever resolve `tsconfig.json` `paths` aliases? ADR-011 says no for v1. Revisit when a dogfooder bumps into it.
- Should the benchmark be part of CI as a regression guard on token counts? Still leaning local-only until we have more data points.
- Should the active-project cache persist across server restarts (e.g. `~/.config/project-memory-mcp/session.json`)? ADR-012 said no on day one — revisit after a few weeks of real use if people keep re-setting the same project.
- Tool #6 direction — `summarize_file` (tree-sitter) vs. `search_project` (indexing). Both are big scope jumps; leaning `summarize_file` first.
- Should we drop the `@feralcaraz` scope for a "neutral" scope (e.g. a project org on npm) before the soft launch, so future contributors don't feel the name is personal property? Defer until we have contributors.
- Should we ship a `npx @feralcaraz/project-memory-mcp install` subcommand that edits `claude_desktop_config.json` on the user's behalf (with safe JSON-merge)? First external install failed at this exact step — a one-command installer would make the README mostly irrelevant for the happy path. Defer until 3–5 more installs prove the README fix isn't enough.

## Things we are NOT doing yet

- No HTTP transport (stdio only).
- No tree-sitter integration yet.
- No structured ADR parsing in `get_open_questions`.
- No `tsconfig.json` `paths` resolution in `get_dependency_graph`.
- No Python / Go / Rust support in `get_dependency_graph` — regex stays TS/JS-only.
- Token benchmark not yet in CI.
- No Windows coverage in CI.
- No persistence for the active-project cache — one set per MCP subprocess lifetime. Claude Desktop restart = cache gone. Deliberate; see ADR-012.
- No multi-project cache. Exactly one active project at a time.
- No `cwd` fallback. Ever. Fallback chain is explicit `path` → active project → loud error.
