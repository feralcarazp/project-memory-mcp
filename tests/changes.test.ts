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
});
