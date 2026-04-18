import { readdir, readFile, stat } from "node:fs/promises";
import { join, basename, resolve } from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";

/**
 * Shape of the context returned to the MCP client.
 * Kept small and deliberately curated — this is the first tool, and it
 * should be fast and information-dense, not a kitchen sink.
 */
export interface ProjectContext {
  /** Absolute, resolved root of the project. */
  root: string;
  /** Display name: package.json#name if present, otherwise the folder name. */
  name: string;
  /** Short description, if we can extract one. */
  description?: string;
  /** Primary language/framework signals detected from the file tree. */
  languages: string[];
  /** Top-level directories and files (filtered), for quick orientation. */
  topLevel: Array<{ name: string; type: "file" | "dir" }>;
  /** Git metadata, if the project is a Git repo. */
  git?: {
    branch: string;
    lastCommit: {
      hash: string;
      message: string;
      author: string;
      date: string;
    };
    isDirty: boolean;
  };
}

/** Entries we never want to show at the top level — noise. */
const IGNORED_ENTRIES = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  ".DS_Store",
  "coverage",
  ".next",
  ".turbo",
  ".vitest-cache",
]);

/** Tool-generated junk that isn't dotfile but still noise. */
const IGNORED_PATTERNS: RegExp[] = [
  /\.timestamp-\d+.*\.m?js$/i, // vitest.config.ts.timestamp-xxxx.mjs
  /\.tsbuildinfo$/,
];

/** Heuristics: file → language/ecosystem label. */
const LANGUAGE_SIGNALS: Array<{ file: string; label: string }> = [
  { file: "package.json", label: "JavaScript/TypeScript (npm)" },
  { file: "tsconfig.json", label: "TypeScript" },
  { file: "pyproject.toml", label: "Python" },
  { file: "requirements.txt", label: "Python" },
  { file: "Cargo.toml", label: "Rust" },
  { file: "go.mod", label: "Go" },
  { file: "pom.xml", label: "Java (Maven)" },
  { file: "build.gradle", label: "Java/Kotlin (Gradle)" },
  { file: "Gemfile", label: "Ruby" },
  { file: "composer.json", label: "PHP" },
];

export async function getProjectContext(
  rootInput: string,
): Promise<ProjectContext> {
  const root = resolve(rootInput);

  // Verify path exists and is a directory.
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) {
    throw new Error(`Not a directory: ${root}`);
  }

  const entries = await readdir(root, { withFileTypes: true });
  const visible = entries.filter(
    (e) =>
      !IGNORED_ENTRIES.has(e.name) &&
      !e.name.startsWith(".") &&
      !IGNORED_PATTERNS.some((re) => re.test(e.name)),
  );

  const topLevel = visible
    .map((e) => ({
      name: e.name,
      type: (e.isDirectory() ? "dir" : "file") as "file" | "dir",
    }))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  const fileNames = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));

  const languages = LANGUAGE_SIGNALS.filter((s) => fileNames.has(s.file)).map(
    (s) => s.label,
  );

  let name = basename(root);
  let description: string | undefined;
  if (fileNames.has("package.json")) {
    try {
      const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
      if (typeof pkg.name === "string" && pkg.name.length > 0) name = pkg.name;
      if (typeof pkg.description === "string" && pkg.description.length > 0) {
        description = pkg.description;
      }
    } catch {
      // Malformed package.json — fall back to defaults silently.
    }
  }

  const git = await readGitInfo(root);

  return {
    root,
    name,
    description,
    languages,
    topLevel,
    git,
  };
}

async function readGitInfo(root: string): Promise<ProjectContext["git"]> {
  const git: SimpleGit = simpleGit({ baseDir: root });
  try {
    const isRepo = await git.checkIsRepo();
    if (!isRepo) return undefined;

    const [log, status] = await Promise.all([git.log({ maxCount: 1 }), git.status()]);
    const latest = log.latest;
    if (!latest) return undefined;

    return {
      branch: status.current ?? "HEAD",
      lastCommit: {
        hash: latest.hash.slice(0, 7),
        message: latest.message,
        author: latest.author_name,
        date: latest.date,
      },
      isDirty: status.files.length > 0,
    };
  } catch {
    return undefined;
  }
}
