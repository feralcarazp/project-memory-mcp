# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-04-20

### Fixed
- Executable bit missing on `dist/index.js` in the published tarball — caused `npx @feralcaraz/project-memory-mcp` to fail with `sh: project-memory-mcp: command not found`. Added a `postbuild` step (`chmod +x dist/index.js`) so the bit is always set after `tsc`. Local `node dist/index.js` already worked; only the npx bin shim was affected.

## [0.2.0] - 2026-04-20

Theme: the brain that writes back + one-command install.

### Added
- `append_to_memory` tool — write-side companion to the read tools. Appends markdown content to a curated section of `MEMORY.md` (`open-questions`, `next-steps`, `session-notes`, `decisions-made`). Sections are a closed enum in this release for predictability. Load-bearing sections (open questions, next steps) must pre-exist; the other two are auto-created on first use. Writes are atomic via tmp-file + rename, and trivial duplicates (same line as the last non-blank in the section) are skipped idempotently.
- `install` / `uninstall` CLI subcommands — `npx @feralcaraz/project-memory-mcp install` now edits `claude_desktop_config.json` for you, adding the `project-memory` entry under `mcpServers` while preserving any other servers already configured. A timestamped backup is written before any change. `uninstall` reverses the operation, dropping an empty `mcpServers` key if we were the only entry.

### Changed
- `SERVER_VERSION` bumped to `0.2.0` and now matches `package.json` (previously drifted).
- README: new "One-command install" block as the recommended path; the manual step-by-step recipes are preserved as a fallback. Tool count in the verify step bumped from 5 to 6.

### Internal
- 19 new unit tests covering `memory_writes` helpers and the `install` CLI (config creation, preservation of other servers, idempotent reinstall, timestamped backup, malformed-JSON abort, uninstall variants). Total suite now ~65 tests across 7 files.
- `.gitignore`: `*.bak*` pattern added so config backups written by the installer don't leak into git.

## [0.1.2] - 2026-04

### Added
- Badges, richer keywords, multi-client install docs (Cursor, Claude Code).
- `BENCHMARKS.md` with the "opener test" showing ~88% fewer tokens when the tools warm up context vs. a blind file dump.
- `MEMORY.md` as the project's self-documenting knowledge base (the server uses itself on itself).

### Fixed
- Tagline, demo assets, early-stage warnings.

## [0.1.0] - 2026-04

### Added
- Initial public release. Five read-side tools: `set_active_project`, `get_project_context`, `list_recent_changes`, `get_open_questions`, `get_dependency_graph`.
- MCP server over stdio, published as `@feralcaraz/project-memory-mcp` on npm.

[0.2.1]: https://github.com/feralcarazp/project-memory-mcp/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/feralcarazp/project-memory-mcp/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/feralcarazp/project-memory-mcp/releases/tag/v0.1.2
[0.1.0]: https://github.com/feralcarazp/project-memory-mcp/releases/tag/v0.1.0
