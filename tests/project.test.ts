import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import { getProjectContext } from "../src/context/project.js";

/**
 * These tests hit real directories and a real (local) git repo rather than
 * mocking fs/git. The surface area under test is thin I/O glue — mocks would
 * mostly test that the mocks match the implementation, which is not useful.
 */
describe("getProjectContext", () => {
  let tmp: string;

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), "pm-mcp-test-"));

    await writeFile(
      join(tmp, "package.json"),
      JSON.stringify({ name: "sample-pkg", description: "A sample package" }),
    );
    await writeFile(join(tmp, "tsconfig.json"), "{}");
    await writeFile(join(tmp, "README.md"), "# sample");
    await mkdir(join(tmp, "src"));
    await writeFile(join(tmp, "src", "index.ts"), "export {};");
    await mkdir(join(tmp, "node_modules")); // should be hidden from topLevel

    const git = simpleGit({ baseDir: tmp });
    await git.init();
    await git.addConfig("user.email", "test@example.com");
    await git.addConfig("user.name", "Test User");
    await git.add(".");
    await git.commit("initial commit");
  });

  afterAll(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it("reads name and description from package.json", async () => {
    const ctx = await getProjectContext(tmp);
    expect(ctx.name).toBe("sample-pkg");
    expect(ctx.description).toBe("A sample package");
  });

  it("detects language signals from the file tree", async () => {
    const ctx = await getProjectContext(tmp);
    expect(ctx.languages).toContain("TypeScript");
    expect(ctx.languages).toContain("JavaScript/TypeScript (npm)");
  });

  it("filters noise from topLevel and sorts dirs first", async () => {
    const ctx = await getProjectContext(tmp);
    const names = ctx.topLevel.map((e) => e.name);
    expect(names).not.toContain("node_modules");
    expect(names).not.toContain(".git");

    const firstFileIndex = ctx.topLevel.findIndex((e) => e.type === "file");
    const lastDirIndex = ctx.topLevel.map((e) => e.type).lastIndexOf("dir");
    if (firstFileIndex !== -1 && lastDirIndex !== -1) {
      expect(lastDirIndex).toBeLessThan(firstFileIndex);
    }
  });

  it("returns git metadata with short hash and clean state", async () => {
    const ctx = await getProjectContext(tmp);
    expect(ctx.git).toBeDefined();
    expect(ctx.git?.lastCommit.message).toContain("initial commit");
    expect(ctx.git?.lastCommit.hash).toHaveLength(7);
    expect(ctx.git?.isDirty).toBe(false);
  });

  it("throws a clear error if the path is not a directory", async () => {
    await expect(getProjectContext(join(tmp, "README.md"))).rejects.toThrow(
      /Not a directory/,
    );
  });
});
