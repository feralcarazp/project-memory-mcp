import { resolve } from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";

/**
 * Summary of recent changes in a Git repository.
 *
 * Returns both the raw commits and a "hotspots" ranking — the files touched
 * most in the range. Hotspots are the real value: telling an AI "the last 20
 * commits mostly touched src/auth/session.ts" is more useful than the list
 * of commits themselves.
 */
export interface RecentChanges {
  /** How we interpreted the range request. */
  range:
    | { type: "count"; value: number }
    | { type: "since"; value: string };
  /** The commits in the range, newest first. */
  commits: Array<{
    hash: string;
    date: string;
    author: string;
    message: string;
    filesChanged: number;
  }>;
  /** Files touched most often in this range, descending. */
  hotspots: Array<{ path: string; changes: number }>;
}

export interface RecentChangesOptions {
  /** Absolute path to the project root. Must be a Git repo. */
  root: string;
  /** Max number of commits to look at. Default 10. Capped at 200. */
  limit?: number;
  /**
   * ISO date string (e.g. "2026-04-10"). If provided, overrides `limit` and
   * returns every commit since that date.
   */
  since?: string;
  /** Max files to return in `hotspots`. Default 10. */
  hotspotLimit?: number;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 200;
const DEFAULT_HOTSPOT_LIMIT = 10;

export async function getRecentChanges(
  opts: RecentChangesOptions,
): Promise<RecentChanges> {
  const root = resolve(opts.root);
  const git: SimpleGit = simpleGit({ baseDir: root });

  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new Error(`Not a Git repository: ${root}`);
  }

  // Decide the range.
  const range: RecentChanges["range"] = opts.since
    ? { type: "since", value: opts.since }
    : { type: "count", value: Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT) };

  // A freshly-init'd repo has no commits yet. `git log` in that state exits
  // with "your current branch does not have any commits yet". That's a
  // valid state — treat it as "zero commits" rather than letting the error
  // bubble up.
  if (!(await hasAnyCommits(git))) {
    return { range, commits: [], hotspots: [] };
  }

  // Pull the commit log. `--name-only` gives us file lists per commit, which
  // we need for hotspot computation. `simple-git`'s `raw()` gives us tighter
  // control over format than the higher-level `log()`.
  //
  // Flags worth noting:
  // - `-c core.quotePath=off` — disables git's default behavior of wrapping
  //   non-ASCII paths in quotes and octal-escaping the bytes. Without it,
  //   `café.ts` comes back as `"caf\303\251.ts"`, which breaks any consumer
  //   that treats hotspot paths as real filesystem paths.
  // - `--no-merges` — merge commits "touch" every file they bring in, which
  //   double-counts changes in the hotspot ranking without adding signal.
  //   The real work happened in the merged-in commits; we already see those.
  const args = [
    "-c",
    "core.quotePath=off",
    "log",
    "--no-merges",
    "--name-only",
    "--pretty=format:__COMMIT__%n%H%n%aI%n%an%n%s",
  ];
  if (range.type === "since") {
    args.push(`--since=${range.value}`);
  } else {
    args.push(`-n`, String(range.value));
  }

  const raw = await git.raw(args);
  const parsed = parseLog(raw);

  // Build the hotspot ranking across all commits in range.
  const fileCounts = new Map<string, number>();
  for (const c of parsed) {
    for (const f of c.files) {
      fileCounts.set(f, (fileCounts.get(f) ?? 0) + 1);
    }
  }
  const hotspotLimit = opts.hotspotLimit ?? DEFAULT_HOTSPOT_LIMIT;
  const hotspots = [...fileCounts.entries()]
    .map(([path, changes]) => ({ path, changes }))
    .sort((a, b) => b.changes - a.changes || a.path.localeCompare(b.path))
    .slice(0, hotspotLimit);

  return {
    range,
    commits: parsed.map((c) => ({
      hash: c.hash.slice(0, 7),
      date: c.date,
      author: c.author,
      message: c.message,
      filesChanged: c.files.length,
    })),
    hotspots,
  };
}

/**
 * Does this repo have at least one commit reachable from any ref?
 *
 * `rev-parse HEAD` would work, but simple-git's error detection treats the
 * non-zero exit on an unborn branch as an unrecoverable error, which we
 * can't cleanly suppress. `rev-list --all -n 1` instead prints a single
 * commit hash when any commit exists and prints nothing (exit 0) on an
 * empty repo — no error path to work around.
 */
async function hasAnyCommits(git: SimpleGit): Promise<boolean> {
  const out = await git.raw(["rev-list", "--all", "-n", "1"]);
  return out.trim().length > 0;
}

interface ParsedCommit {
  hash: string;
  date: string;
  author: string;
  message: string;
  files: string[];
}

/**
 * Parse the output of `git log --name-only --pretty=format:__COMMIT__%n%H%n%aI%n%an%n%s`.
 *
 * Each commit block looks like:
 *   __COMMIT__
 *   <hash>
 *   <iso date>
 *   <author>
 *   <subject>
 *   <blank>
 *   <file1>
 *   <file2>
 *   ...
 *   <blank>
 *
 * The blank-line separator between file lists is sometimes absent (e.g. for
 * merge commits or the last commit), so we split on the `__COMMIT__` marker
 * rather than relying on whitespace.
 */
function parseLog(raw: string): ParsedCommit[] {
  if (!raw.trim()) return [];

  const blocks = raw
    .split(/^__COMMIT__\r?\n/m)
    .map((b) => b.trim())
    .filter(Boolean);

  const commits: ParsedCommit[] = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    if (lines.length < 4) continue;
    const [hash, date, author, message, ...rest] = lines;
    // `rest` may start with an empty line before the file list.
    const files = rest.map((l) => l.trim()).filter((l) => l.length > 0);
    commits.push({ hash, date, author, message, files });
  }
  return commits;
}
