import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getOpenQuestions } from "../src/context/questions.js";

/**
 * Tests use real files in real temp dirs, like the other suites. The
 * parser is pure, but the tool signature is "read a file from disk" —
 * testing the whole path keeps us honest about edge cases like missing
 * files.
 */
describe("getOpenQuestions", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "pm-mcp-questions-"));
  });

  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it("extracts the three default sections from MEMORY.md", async () => {
    await writeFile(
      join(tmp, "MEMORY.md"),
      [
        "# Memory",
        "",
        "Prelude paragraph that should be ignored.",
        "",
        "## Last session",
        "",
        "- Some completed item",
        "",
        "## Open questions",
        "",
        "- Should we ship on Friday?",
        "- What do we call the CLI flag?",
        "",
        "## Next steps",
        "",
        "1. Ship the fix",
        "2. Open a PR",
        "",
        "## Things we are NOT doing yet",
        "",
        "- No npm publish",
        "- No Windows support",
        "",
      ].join("\n"),
    );

    const res = await getOpenQuestions({ root: tmp });
    expect(res.sections.map((s) => s.title)).toEqual([
      "Open questions",
      "Next steps",
      "Things we are NOT doing yet",
    ]);
    expect(res.sections[0].items).toEqual([
      "Should we ship on Friday?",
      "What do we call the CLI flag?",
    ]);
    expect(res.sections[1].items).toEqual(["Ship the fix", "Open a PR"]);
    expect(res.sections[2].items).toEqual(["No npm publish", "No Windows support"]);
  });

  it("matches section headings case-insensitively and tolerates suffixes", async () => {
    // Real MEMORY.md in this repo uses "Next steps (suggested, in order)".
    // The parser should still catch it.
    await writeFile(
      join(tmp, "MEMORY.md"),
      [
        "## NEXT STEPS (suggested, in order)",
        "",
        "- Do the thing",
        "",
        "## open Questions",
        "",
        "- Is this case-insensitive?",
      ].join("\n"),
    );

    const res = await getOpenQuestions({ root: tmp });
    const titles = res.sections.map((s) => s.title);
    expect(titles).toContain("NEXT STEPS (suggested, in order)");
    expect(titles).toContain("open Questions");
  });

  it("returns an empty sections array when none of the wanted sections are present", async () => {
    await writeFile(
      join(tmp, "MEMORY.md"),
      ["# Empty", "", "## Something else", "", "- not a match"].join("\n"),
    );
    const res = await getOpenQuestions({ root: tmp });
    expect(res.sections).toEqual([]);
  });

  it("accepts a custom `sections` filter", async () => {
    await writeFile(
      join(tmp, "MEMORY.md"),
      [
        "## Done",
        "- a",
        "- b",
        "## Risks",
        "- regression risk",
        "## Open questions",
        "- will this be asked?",
      ].join("\n"),
    );

    const res = await getOpenQuestions({
      root: tmp,
      sections: ["Risks"],
    });
    expect(res.sections).toHaveLength(1);
    expect(res.sections[0].title).toBe("Risks");
    expect(res.sections[0].items).toEqual(["regression risk"]);
  });

  it("accepts a custom `file` name (e.g. DECISIONS.md)", async () => {
    await writeFile(
      join(tmp, "DECISIONS.md"),
      ["## Open questions", "- why not?"].join("\n"),
    );
    const res = await getOpenQuestions({ root: tmp, file: "DECISIONS.md" });
    expect(res.sections).toHaveLength(1);
    expect(res.sections[0].items).toEqual(["why not?"]);
    expect(res.source.endsWith("DECISIONS.md")).toBe(true);
  });

  it("flattens nested bullets with a '↳' marker", async () => {
    await writeFile(
      join(tmp, "MEMORY.md"),
      [
        "## Open questions",
        "- Top-level question",
        "  - nested detail",
        "  - another nested detail",
        "- Second top-level",
      ].join("\n"),
    );
    const res = await getOpenQuestions({ root: tmp });
    expect(res.sections[0].items).toEqual([
      "Top-level question",
      "↳ nested detail",
      "↳ another nested detail",
      "Second top-level",
    ]);
  });

  it("ignores sub-headings (H3+) inside a matched section", async () => {
    await writeFile(
      join(tmp, "MEMORY.md"),
      [
        "## Open questions",
        "- first",
        "### Subtopic",
        "- second",
        "## Next steps",
        "- do it",
      ].join("\n"),
    );
    const res = await getOpenQuestions({ root: tmp });
    // Both items in "Open questions" should be captured — the H3 doesn't
    // close the section.
    expect(res.sections[0].title).toBe("Open questions");
    expect(res.sections[0].items).toEqual(["first", "second"]);
    expect(res.sections[1].title).toBe("Next steps");
  });

  it("throws a clear error when the file does not exist", async () => {
    await expect(getOpenQuestions({ root: tmp })).rejects.toThrow(
      /Cannot read MEMORY\.md/,
    );
  });

  it("throws when the root is not a directory", async () => {
    await expect(
      getOpenQuestions({ root: join(tmp, "does-not-exist") }),
    ).rejects.toThrow(/Not a directory/);
  });
});
