import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import { getRecentChanges } from "../src/context/changes.js";

/**
 * Same philosophy as project.test.ts: real temp repo, real commits, no mocks.
 * Git is I/O — mocking it would just make us match our own assumptions.
 */
describe("getRecentChanges", () => {
  let tmp: string;
  let git: SimpleGit;

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), "pm-mcp-changes-"));
    git = simpleGit({ baseDir: tmp });
    await git.init();
    await git.addConfig("user.email", "test@example.com");
    await git.addConfig("user.name", "Test User");

    // Commit A — touches two files
    await writeFile(join(tmp, "a.ts"), "1");
    await writeFile(join(tmp, "b.ts"), "1");
    await git.add(".");
    await git.commit("feat: a and b");

    // Commit B — touches a.ts (again) and c.ts
    await writeFile(join(tmp, "a.ts"), "2");
    await writeFile(join(tmp, "c.ts"), "1");
    await git.add(".");
    await git.commit("fix: a and c");

    // Commit C — touches only a.ts
    await writeFile(join(tmp, "a.ts"), "3");
    await git.add(".");
    await git.commit("refactor: a again");
  });

  afterAll(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it("returns all commits newest-first with short hashes", async () => {
    const res = await getRecentChanges({ root: tmp, limit: 10 });
    expect(res.commits).toHaveLength(3);
    expect(res.commits[0].message).toContain("refactor: a again");
    expect(res.commits[2].message).toContain("feat: a and b");
    for (const c of res.commits) {
      expect(c.hash).toHaveLength(7);
      expect(c.author).toBe("Test User");
    }
  });

  it("respects `limit`", async () => {
    const res = await getRecentChanges({ root: tmp, limit: 2 });
    expect(res.commits).toHaveLength(2);
    expect(res.range).toEqual({ type: "count", value: 2 });
  });

  it("computes hotspots: a.ts should be the top", async () => {
    const res = await getRecentChanges({ root: tmp, limit: 10 });
    expect(res.hotspots[0]).toEqual({ path: "a.ts", changes: 3 });
    // b.ts and c.ts each touched once
    const rest = res.hotspots.slice(1).map((h) => h.path).sort();
    expect(rest).toEqual(["b.ts", "c.ts"]);
  });

  it("counts filesChanged per commit correctly", async () => {
    const res = await getRecentChanges({ root: tmp, limit: 10 });
    // newest first: C (1 file), B (2 files), A (2 files)
    expect(res.commits.map((c) => c.filesChanged)).toEqual([1, 2, 2]);
  });

  it("supports `since` and ignores `limit` when set", async () => {
    // 'since: 1970' → everything
    const res = await getRecentChanges({
      root: tmp,
      since: "1970-01-01",
      limit: 1, // should be ignored
    });
    expect(res.commits).toHaveLength(3);
    expect(res.range).toEqual({ type: "since", value: "1970-01-01" });
  });

  it("throws if the path is not a Git repo", async () => {
    const nonRepo = await mkdtemp(join(tmpdir(), "pm-mcp-nonrepo-"));
    try {
      await expect(getRecentChanges({ root: nonRepo })).rejects.toThrow(
        /Not a Git repository/,
      );
    } finally {
      await rm(nonRepo, { recursive: true, force: true });
    }
  });

  it("caps hotspots with `hotspotLimit`", async () => {
    const res = await getRecentChanges({ root: tmp, limit: 10, hotspotLimit: 1 });
    expect(res.hotspots).toHaveLength(1);
    expect(res.hotspots[0].path).toBe("a.ts");
  });

  // --- Regression tests for the three bugs found on 2026-04-18 ---------------

  it("returns an empty result on a repo with zero commits", async () => {
    // Regression: `git log` on a freshly-init'd repo exits non-zero because
    // HEAD doesn't point at anything yet. That shouldn't bubble up as an
    // error — an empty repo is a valid state, just with nothing to show.
    const empty = await mkdtemp(join(tmpdir(), "pm-mcp-empty-"));
    try {
      const emptyGit = simpleGit({ baseDir: empty });
      await emptyGit.init();
      await emptyGit.addConfig("user.email", "test@example.com");
      await emptyGit.addConfig("user.name", "Test User");

      const res = await getRecentChanges({ root: empty, limit: 10 });
      expect(res.commits).toEqual([]);
      expect(res.hotspots).toEqual([]);
      expect(res.range).toEqual({ type: "count", value: 10 });
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it("excludes merge commits from the log and from hotspots", async () => {
    // Regression: without `--no-merges`, a merge commit double-counts every
    // file it brings in, polluting the hotspot ranking for no useful signal.
    const mergeTmp = await mkdtemp(join(tmpdir(), "pm-mcp-merge-"));
    try {
      const g = simpleGit({ baseDir: mergeTmp });
      await g.init();
      // Force a stable default branch name so the test doesn't depend on
      // the user's global `init.defaultBranch` setting.
      await g.raw(["symbolic-ref", "HEAD", "refs/heads/main"]);
      await g.addConfig("user.email", "test@example.com");
      await g.addConfig("user.name", "Test User");

      // Baseline commit on main.
      await writeFile(join(mergeTmp, "base.ts"), "1");
      await g.add(".");
      await g.commit("chore: base");

      // Diverge: feature branch touches feature.ts.
      await g.checkoutLocalBranch("feature");
      await writeFile(join(mergeTmp, "feature.ts"), "1");
      await g.add(".");
      await g.commit("feat: feature");

      // Meanwhile, main touches main.ts.
      await g.checkout("main");
      await writeFile(join(mergeTmp, "main.ts"), "1");
      await g.add(".");
      await g.commit("feat: main");

      // Force a real merge commit (not fast-forward).
      await g.merge(["--no-ff", "feature", "-m", "merge: feature into main"]);

      const res = await getRecentChanges({ root: mergeTmp, limit: 10 });

      // Merge subject should not appear in the commit list.
      const subjects = res.commits.map((c) => c.message);
      expect(subjects.some((s) => s.startsWith("merge:"))).toBe(false);

      // Three real commits: base, feature, main.
      expect(res.commits).toHaveLength(3);

      // Each real file was touched once by a real commit. If the merge
      // commit had leaked through, feature.ts or main.ts would show up
      // with `changes: 2`.
      for (const h of res.hotspots) {
        expect(h.changes).toBe(1);
      }
    } finally {
      await rm(mergeTmp, { recursive: true, force: true });
    }
  });

  it("returns non-ASCII filenames verbatim (no octal-escape quoting)", async () => {
    // Regression: git's default `core.quotePath=true` wraps non-ASCII paths
    // in quotes and octal-escapes the bytes, e.g. `café.ts` becomes
    // `"caf\303\251.ts"`. That breaks any downstream consumer that treats
    // hotspot paths as real paths. We pass `-c core.quotePath=off` to fix it.
    const utf8Tmp = await mkdtemp(join(tmpdir(), "pm-mcp-utf8-"));
    try {
      const g = simpleGit({ baseDir: utf8Tmp });
      await g.init();
      await g.addConfig("user.email", "test@example.com");
      await g.addConfig("user.name", "Test User");

      const unicodeName = "café.ts";
      await writeFile(join(utf8Tmp, unicodeName), "1");
      await g.add(".");
      await g.commit("feat: unicode filename");

      const res = await getRecentChanges({ root: utf8Tmp, limit: 10 });
      expect(res.hotspots).toHaveLength(1);
      expect(res.hotspots[0].path).toBe(unicodeName);
      // Explicitly: no quoting artifacts.
      expect(res.hotspots[0].path).not.toMatch(/^"/);
      expect(res.hotspots[0].path).not.toMatch(/\\\d{3}/);
    } finally {
      await rm(utf8Tmp, { recursive: true, force: true });
    }
  });
});
