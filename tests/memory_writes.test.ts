import { describe, it, expect } from "vitest";
import { promises as fs, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendToMemory } from "../src/context/memory_writes.js";

async function setupProject(initialMemory: string): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "pm-test-"));
  await fs.writeFile(join(root, "MEMORY.md"), initialMemory, "utf8");
  return root;
}

describe("appendToMemory", () => {
  it("appends a bullet to an existing Open questions section", async () => {
    const root = await setupProject(
      `# Project\n\n## Open questions\n\n- First q\n`,
    );
    const result = await appendToMemory({
      root,
      section: "open-questions",
      content: "- Second q",
    });
    expect(result.skipped).toBe(false);
    expect(result.bytesAdded).toBeGreaterThan(0);
    const after = await fs.readFile(join(root, "MEMORY.md"), "utf8");
    expect(after).toContain("- First q\n- Second q");
  });

  it("skips when the new bullet matches the last line in section", async () => {
    const root = await setupProject(
      `# X\n\n## Open questions\n\n- Dup\n`,
    );
    const result = await appendToMemory({
      root,
      section: "open-questions",
      content: "- Dup",
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/duplicate/);
    expect(result.bytesAdded).toBe(0);
  });

  it("creates the Session notes section when missing", async () => {
    const root = await setupProject(
      `# X\n\n## Open questions\n\n- Q\n`,
    );
    const result = await appendToMemory({
      root,
      section: "session-notes",
      content: "Today we shipped v0.2.0.",
    });
    expect(result.skipped).toBe(false);
    const after = await fs.readFile(join(root, "MEMORY.md"), "utf8");
    expect(after).toContain("## Session notes");
    expect(after).toContain("Today we shipped v0.2.0.");
  });

  it("refuses to create load-bearing sections when missing", async () => {
    const root = await setupProject(`# Empty project\n`);
    await expect(
      appendToMemory({
        root,
        section: "open-questions",
        content: "- nope",
      }),
    ).rejects.toThrow(/Open questions/);
  });

  it("throws a clear error when MEMORY.md doesn't exist", async () => {
    const root = mkdtempSync(join(tmpdir(), "pm-test-"));
    await expect(
      appendToMemory({
        root,
        section: "open-questions",
        content: "- x",
      }),
    ).rejects.toThrow(/Memory file not found/);
  });

  it("matches section titles case-insensitively", async () => {
    const root = await setupProject(
      `# X\n\n## OPEN QUESTIONS\n\n- a\n`,
    );
    const result = await appendToMemory({
      root,
      section: "open-questions",
      content: "- b",
    });
    expect(result.skipped).toBe(false);
  });

  it("inserts between last body line and next H2", async () => {
    const root = await setupProject(
      `# X\n\n## Open questions\n\n- a\n\n## Next steps\n\n- z\n`,
    );
    await appendToMemory({
      root,
      section: "open-questions",
      content: "- b",
    });
    const after = await fs.readFile(join(root, "MEMORY.md"), "utf8");
    const qIdx = after.indexOf("## Open questions");
    const sIdx = after.indexOf("## Next steps");
    const between = after.slice(qIdx, sIdx);
    expect(between).toContain("- a");
    expect(between).toContain("- b");
    expect(between.indexOf("- b")).toBeGreaterThan(between.indexOf("- a"));
  });

  it("writes atomically (no stray .tmp file left behind)", async () => {
    const root = await setupProject(
      `# X\n\n## Open questions\n\n- a\n`,
    );
    await appendToMemory({
      root,
      section: "open-questions",
      content: "- b",
    });
    const entries = await fs.readdir(root);
    expect(entries.some((f) => f.endsWith(".tmp"))).toBe(false);
  });
});
