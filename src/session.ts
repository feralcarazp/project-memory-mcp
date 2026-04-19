/**
 * Session-scoped state for the MCP server process.
 *
 * "Session" here means one running MCP server subprocess. A client (Claude
 * Desktop, Cursor, etc.) launches exactly one subprocess per workspace, so
 * module-level state is a legitimate representation: there's no tenancy,
 * no concurrency beyond serial JSON-RPC requests, and no durability story
 * to worry about. When the client shuts down the process, the state dies
 * with it — which is exactly what we want.
 *
 * The only thing we cache today is the *active project path*. ADR-004
 * deferred this until there was more than one tool in the server; with
 * four tools shipped, repeating `path` on every call is genuine friction.
 *
 * See ADR-012 for the full rationale.
 */
import { statSync } from "node:fs";
import { basename, resolve } from "node:path";

interface ActiveProject {
  /** Absolute, resolved root of the active project. */
  root: string;
  /** Folder name — a cheap display label. */
  name: string;
}

let activeProject: ActiveProject | undefined;

/**
 * Mark `path` as the active project for the rest of this server session.
 *
 * Validates that the path exists and is a directory. Returns the resolved
 * project metadata on success. Throws a clear error on failure so the
 * caller (usually the MCP tool adapter) can surface it verbatim.
 */
export function setActiveProject(path: string): ActiveProject {
  const root = resolve(path);

  let s;
  try {
    s = statSync(root);
  } catch (err) {
    throw new Error(
      `Cannot set active project: path does not exist: ${root}`,
      { cause: err },
    );
  }
  if (!s.isDirectory()) {
    throw new Error(
      `Cannot set active project: path is not a directory: ${root}`,
    );
  }

  activeProject = { root, name: basename(root) };
  return activeProject;
}

/** Current active project, or `undefined` if none has been set. */
export function getActiveProject(): ActiveProject | undefined {
  return activeProject;
}

/**
 * Reset the cache. Exposed for tests; not wired to any tool yet. If we
 * ever add a `clear_active_project` tool, it would call this.
 */
export function clearActiveProject(): void {
  activeProject = undefined;
}

/**
 * Helper used by every tool that takes an optional `path` argument:
 * returns the explicit path if one was provided, otherwise falls back
 * to the cached active project, otherwise throws with a message the
 * MCP client can show to the user.
 *
 * We intentionally do NOT mutate the cache when an explicit path is
 * passed. That lets the caller run one-off queries against a different
 * project without losing the session's active context.
 */
export function resolveTargetPath(explicit?: string): string {
  if (explicit && explicit.length > 0) {
    return resolve(explicit);
  }
  const active = getActiveProject();
  if (active) return active.root;
  throw new Error(
    "No path provided and no active project set. " +
      "Pass `path` explicitly, or call `set_active_project` first.",
  );
}
