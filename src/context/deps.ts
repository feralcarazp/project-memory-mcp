import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

/**
 * Project-wide dependency graph over TypeScript/JavaScript source files,
 * built from regex-scanned imports.
 *
 * Scope (v1): finds relative and bare imports in `.ts`, `.tsx`, `.js`,
 * `.jsx`, `.mjs`, and `.cjs` files. Resolves relative imports to actual
 * files; leaves bare specifiers (`react`, `@scope/pkg`) unresolved but
 * counts them so we can rank the most-used external modules.
 *
 * Known limitations (documented in ADR-011):
 * - Regex, not AST. String literals containing `from "..."` or `require(...)`
 *   inside unusual contexts (e.g. inside backtick templates) may false-
 *   positive. Comments are stripped, so those false positives are already
 *   handled. Fenced strings inside JSDoc remain an edge case.
 * - TypeScript path aliases from `tsconfig.json` are not resolved. A bare
 *   specifier that would resolve via `paths` is treated as external.
 * - No Python / Go / Rust yet.
 * - Dynamic specifiers (`import(someVariable)`) are unknowable without
 *   type information; we skip them.
 */

export interface DependencyGraph {
  /** Absolute, resolved project root. */
  root: string;
  /** Number of source files we successfully scanned. */
  scanned: number;
  /**
   * Only present when the caller specified a `target`. Contains the
   * file's imports and the files that import it, both as paths relative
   * to `root`.
   */
  target?: {
    /** Relative path of the focused file. */
    file: string;
    /**
     * Out-edges: one entry per import specifier in the file.
     * `kind` distinguishes between resolved internal files, unresolved
     * internal specs (the spec was relative but we couldn't find the
     * target file), and bare external modules.
     */
    imports: Array<{
      spec: string;
      kind: "internal" | "external" | "unresolved";
      resolved?: string;
    }>;
    /** In-edges: relative paths of files that import this one. */
    importedBy: string[];
  };
  /**
   * Top-N most-imported modules (internal files + external packages).
   * Present regardless of `target`, but most useful in aggregate mode.
   */
  mostImported: Array<{ module: string; count: number; kind: "internal" | "external" }>;
  /**
   * Source files that nothing else imports. Usually entrypoints or
   * (occasionally) dead code. Capped at `limit`.
   */
  entrypoints: string[];
}

export interface DependencyGraphOptions {
  /** Absolute path to the project root. */
  root: string;
  /**
   * Path to a single file, relative to `root`. If set, the returned
   * graph's `target` field is populated with that file's imports and
   * reverse imports.
   */
  target?: string;
  /** Top-N cap for `mostImported` and `entrypoints`. Default 10. */
  limit?: number;
}

const DEFAULT_LIMIT = 10;
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const RESOLVABLE_EXTENSIONS = [...SOURCE_EXTENSIONS, ".json"];
const IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  ".next",
  ".turbo",
  "coverage",
  ".vitest-cache",
]);
/**
 * File-name patterns for tool-generated noise that happens to have a
 * source extension. Kept in sync with `src/context/project.ts`'s
 * IGNORED_PATTERNS — they're the same class of thing.
 */
const IGNORED_FILE_PATTERNS: RegExp[] = [
  /\.timestamp-\d+.*\.m?js$/i, // vitest.config.ts.timestamp-xxxx.mjs
  /\.tsbuildinfo$/,
];

/**
 * TypeScript-under-ESM convention: source files import each other using
 * the compiled extension (`./foo.js`), even though the source on disk is
 * `./foo.ts`. To resolve those imports to real source files we need to
 * try the TS equivalent when the JS spec doesn't hit.
 */
const JS_TO_TS_FALLBACK: Record<string, string[]> = {
  ".js": [".ts", ".tsx"],
  ".jsx": [".tsx"],
  ".mjs": [".mts", ".ts"],
  ".cjs": [".cts", ".ts"],
};

export async function getDependencyGraph(
  opts: DependencyGraphOptions,
): Promise<DependencyGraph> {
  const root = resolve(opts.root);
  const limit = opts.limit ?? DEFAULT_LIMIT;

  const rootStat = await stat(root).catch(() => null);
  if (!rootStat?.isDirectory()) {
    throw new Error(`Not a directory: ${root}`);
  }

  // 1. Walk the source tree.
  const sourceFiles = await walkSources(root);

  // 2. Parse every file and build both directions of the graph.
  //
  // The "from" side of each edge is always a relative path under `root`.
  // The "to" side is either a resolved relative path (internal) or a
  // bare specifier (external).
  const outgoing = new Map<
    string,
    Array<{ spec: string; kind: "internal" | "external" | "unresolved"; resolved?: string }>
  >();
  const incoming = new Map<string, Set<string>>();
  const importCounts = new Map<
    string,
    { count: number; kind: "internal" | "external" }
  >();

  const sourceFileSet = new Set(sourceFiles);

  for (const absFile of sourceFiles) {
    const relFile = relative(root, absFile);
    let src: string;
    try {
      src = await readFile(absFile, "utf8");
    } catch {
      // Unreadable for some reason — skip. Don't let one file break the
      // whole graph.
      continue;
    }
    const specs = extractImportSpecs(src);
    const edges: Array<{
      spec: string;
      kind: "internal" | "external" | "unresolved";
      resolved?: string;
    }> = [];

    for (const spec of specs) {
      if (isRelativeSpec(spec)) {
        const resolvedAbs = await resolveRelative(absFile, spec, sourceFileSet);
        if (resolvedAbs) {
          const resolvedRel = relative(root, resolvedAbs);
          edges.push({ spec, kind: "internal", resolved: resolvedRel });
          addToSet(incoming, resolvedRel, relFile);
          bump(importCounts, resolvedRel, "internal");
        } else {
          edges.push({ spec, kind: "unresolved" });
        }
      } else {
        edges.push({ spec, kind: "external" });
        bump(importCounts, spec, "external");
      }
    }

    outgoing.set(relFile, edges);
  }

  // 3. Aggregate views.
  const mostImported = [...importCounts.entries()]
    .map(([module, v]) => ({ module, count: v.count, kind: v.kind }))
    .sort(
      (a, b) => b.count - a.count || a.module.localeCompare(b.module),
    )
    .slice(0, limit);

  const entrypoints = [...sourceFiles]
    .map((f) => relative(root, f))
    .filter((f) => !(incoming.get(f)?.size))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, limit);

  // 4. Optional targeted view.
  let target: DependencyGraph["target"];
  if (opts.target) {
    // Normalize the target to the same relative-path shape we used above.
    const absTarget = resolve(root, opts.target);
    const relTarget = relative(root, absTarget);
    if (!outgoing.has(relTarget)) {
      throw new Error(
        `Target file not found among scanned sources: ${opts.target} (resolved to ${relTarget})`,
      );
    }
    target = {
      file: relTarget,
      imports: outgoing.get(relTarget) ?? [],
      importedBy: [...(incoming.get(relTarget) ?? [])].sort((a, b) =>
        a.localeCompare(b),
      ),
    };
  }

  return {
    root,
    scanned: sourceFiles.length,
    target,
    mostImported,
    entrypoints,
  };
}

// --- Helpers ---------------------------------------------------------------

function isRelativeSpec(spec: string): boolean {
  return spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/");
}

function addToSet<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(value);
}

function bump(
  counts: Map<string, { count: number; kind: "internal" | "external" }>,
  key: string,
  kind: "internal" | "external",
): void {
  const existing = counts.get(key);
  if (existing) {
    existing.count += 1;
  } else {
    counts.set(key, { count: 1, kind });
  }
}

/** Walk the source tree, skipping ignored directories. */
async function walkSources(root: string): Promise<string[]> {
  const out: string[] = [];
  await walk(root);
  return out;

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith(".") && entry.name !== "." && entry.name !== "..") {
        // Skip dotfiles/dotdirs unconditionally: they're rarely source,
        // and the ones that are (e.g. `.eslintrc.cjs`) aren't something
        // a dependency graph helps with.
        continue;
      }
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (
        entry.isFile() &&
        SOURCE_EXTENSIONS.some((e) => entry.name.endsWith(e)) &&
        !IGNORED_FILE_PATTERNS.some((re) => re.test(entry.name))
      ) {
        out.push(abs);
      }
    }
  }
}

/**
 * Resolve a relative import spec to an absolute file path.
 *
 * Tries the spec as-is and with each source extension; if the spec
 * resolves to a directory, tries `/index.<ext>` for each ext. Restricts
 * matches to paths we actually scanned — that way a stale relative
 * import pointing into node_modules or a compiled /dist file doesn't
 * pollute the graph.
 */
async function resolveRelative(
  fromFile: string,
  spec: string,
  scanned: Set<string>,
): Promise<string | null> {
  const base = resolve(dirname(fromFile), spec);

  const candidates: string[] = [base];
  for (const ext of RESOLVABLE_EXTENSIONS) candidates.push(base + ext);
  for (const ext of SOURCE_EXTENSIONS) candidates.push(join(base, "index" + ext));

  // TypeScript ESM convention: `import "./foo.js"` when the source on
  // disk is `./foo.ts`. If the spec ends in a JS-family extension, try
  // the TS equivalents too. Also apply the same trick to the index-file
  // forms (`./foo/index.js` → `./foo/index.ts`).
  const jsExtMatch = Object.keys(JS_TO_TS_FALLBACK).find((ext) =>
    base.endsWith(ext),
  );
  if (jsExtMatch) {
    const stripped = base.slice(0, -jsExtMatch.length);
    for (const tsExt of JS_TO_TS_FALLBACK[jsExtMatch]) {
      candidates.push(stripped + tsExt);
    }
  }

  for (const c of candidates) {
    const s = await stat(c).catch(() => null);
    if (s?.isFile() && scanned.has(c)) return c;
  }
  // Not accepting matches outside the scanned set on purpose — keeps
  // the graph restricted to files we actually know about.
  return null;
}

/**
 * Pull every `import`-like module specifier out of a TypeScript/JavaScript
 * source file. Order is not guaranteed; duplicates are de-duped.
 *
 * Handles:
 * - `import "./foo"` (side-effect only)
 * - `import x from "./foo"` / `import { x } from "./foo"` / `import * as ns from "./foo"`
 * - `import type { x } from "./foo"`
 * - `export { x } from "./foo"` / `export * from "./foo"` / `export type ... from "./foo"`
 * - `require("./foo")` (CommonJS)
 * - `import("./foo")` (dynamic)
 *
 * Comments (line and block) are stripped up-front to avoid false
 * positives for code that discusses imports in prose.
 */
export function extractImportSpecs(source: string): string[] {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  const specs = new Set<string>();

  // Anything followed by `from "<spec>"` — covers ES static imports,
  // all export-from forms, and TypeScript's `import type ... from`.
  const fromRx = /\bfrom\s+['"]([^'"\n]+)['"]/g;
  for (const m of stripped.matchAll(fromRx)) specs.add(m[1]);

  // Dynamic imports and CommonJS require, both `X("<spec>")` shapes.
  const callRx = /\b(?:import|require)\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;
  for (const m of stripped.matchAll(callRx)) specs.add(m[1]);

  // Side-effect ES import without a binding: `import "<spec>";`.
  const sideRx = /^\s*import\s+['"]([^'"\n]+)['"]\s*;?\s*$/gm;
  for (const m of stripped.matchAll(sideRx)) specs.add(m[1]);

  return [...specs];
}
