import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  setActiveProject,
  getActiveProject,
  clearActiveProject,
  resolveTargetPath,
} from "../src/session.js";

/**
 * The session module is a process-level singleton. Every test here
 * starts by clearing it so state doesn't leak across cases.
 */
describe("session", () => {
  const leftovers: string[] = [];

  beforeEach(() => {
    clearActiveProject();
  });

  afterAll(async () => {
    for (const p of leftovers) {
      await rm(p, { recursive: true, force: true });
    }
  });

  async function makeTempDir(label: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), `pm-mcp-session-${label}-`));
    leftovers.push(dir);
    return dir;
  }

  it("starts with no active project", () => {
    expect(getActiveProject()).toBeUndefined();
  });

  it("setActiveProject resolves the path and caches it", async () => {
    const dir = await makeTempDir("a");
    const active = setActiveProject(dir);
    expect(active.root).toBe(resolve(dir));
    expect(active.name).toBe(dir.split("/").pop());
    expect(getActiveProject()).toEqual(active);
  });

  it("setActiveProject throws when the path does not exist", () => {
    expect(() => setActiveProject("/definitely/not/a/real/path-xyz-123")).toThrow(
      /does not exist/,
    );
    // And failure does not leave partial state behind.
    expect(getActiveProject()).toBeUndefined();
  });

  it("setActiveProject throws when the path is a file, not a directory", async () => {
    const dir = await makeTempDir("file");
    const filePath = join(dir, "not-a-dir.txt");
    await writeFile(filePath, "hello");
    expect(() => setActiveProject(filePath)).toThrow(/not a directory/);
  });

  it("resolveTargetPath prefers an explicit path over the cache", async () => {
    const cached = await makeTempDir("cached");
    const explicit = await makeTempDir("explicit");
    setActiveProject(cached);
    expect(resolveTargetPath(explicit)).toBe(resolve(explicit));
    // The cache is untouched — the one-off call shouldn't have mutated it.
    expect(getActiveProject()?.root).toBe(resolve(cached));
  });

  it("resolveTargetPath falls back to the active project when no path given", async () => {
    const cached = await makeTempDir("fallback");
    setActiveProject(cached);
    expect(resolveTargetPath()).toBe(resolve(cached));
    expect(resolveTargetPath(undefined)).toBe(resolve(cached));
    expect(resolveTargetPath("")).toBe(resolve(cached));
  });

  it("resolveTargetPath throws a helpful error when no path and no cache", () => {
    expect(() => resolveTargetPath()).toThrow(/set_active_project/);
    expect(() => resolveTargetPath()).toThrow(/No path provided/);
  });

  it("setActiveProject overwrites a previous active project", async () => {
    const a = await makeTempDir("overwrite-a");
    const b = await makeTempDir("overwrite-b");
    setActiveProject(a);
    setActiveProject(b);
    expect(getActiveProject()?.root).toBe(resolve(b));
  });

  it("clearActiveProject removes the cached value", async () => {
    const dir = await makeTempDir("clear");
    setActiveProject(dir);
    expect(getActiveProject()).toBeDefined();
    clearActiveProject();
    expect(getActiveProject()).toBeUndefined();
  });
});
