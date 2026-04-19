import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getDependencyGraph,
  extractImportSpecs,
} from "../src/context/deps.js";

/**
 * Real files in a real temp dir — consistent with the other suites.
 * The graph is a pure function of the filesystem; no git involved.
 */
describe("extractImportSpecs (unit)", () => {
  it("pulls import specs from every supported syntax", () => {
    const source = `
      import "./side-effect";
      import foo from "./default";
      import { bar } from "./named";
      import * as ns from "./namespace";
      import type { T } from "./type-only";
      export { x } from "./re-export";
      export * from "./re-export-star";
      export type { T2 } from "./re-export-type";
      const a = require("./cjs");
      const b = await import("./dynamic");
      import pkg from "some-package";
    `;
    const specs = extractImportSpecs(source).sort();
    expect(specs).toEqual(
      [
        "./cjs",
        "./default",
        "./dynamic",
        "./named",
        "./namespace",
        "./re-export",
        "./re-export-star",
        "./re-export-type",
        "./side-effect",
        "./type-only",
        "some-package",
      ].sort(),
    );
  });

  it("ignores imports that only appear inside comments", () => {
    const source = `
      // import "./fake-line-comment";
      /*
       * import "./fake-block-comment";
       * require("./another-fake");
       */
      import real from "./actually-imported";
    `;
    const specs = extractImportSpecs(source);
    expect(specs).toEqual(["./actually-imported"]);
  });

  it("deduplicates repeated specs", () => {
    const source = `
      import a from "./dup";
      import b from "./dup";
    `;
    expect(extractImportSpecs(source)).toEqual(["./dup"]);
  });
});

describe("getDependencyGraph (integration)", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "pm-mcp-deps-"));

    // A small synthetic project:
    //
    //   src/index.ts
    //     └─ imports ./a and ./b/index.ts and external "zod"
    //   src/a.ts
    //     └─ imports ./b (resolves to ./b/index.ts) and external "zod"
    //   src/b/index.ts
    //     └─ imports ./util (no extension) → ./b/util.ts
    //   src/b/util.ts
    //     └─ no imports
    //   src/orphan.ts
    //     └─ nothing imports it, but it imports external "chalk"
    //   src/broken.ts
    //     └─ imports ./does-not-exist (unresolved)
    await mkdir(join(tmp, "src", "b"), { recursive: true });
    await writeFile(
      join(tmp, "src", "index.ts"),
      [
        'import { a } from "./a";',
        'import { b } from "./b";',
        'import { z } from "zod";',
        "export const x = a + b + z;",
      ].join("\n"),
    );
    await writeFile(
      join(tmp, "src", "a.ts"),
      [
        'import { b } from "./b";',
        'import { z } from "zod";',
        "export const a = b + z;",
      ].join("\n"),
    );
    await writeFile(
      join(tmp, "src", "b", "index.ts"),
      ['import { util } from "./util";', "export const b = util;"].join("\n"),
    );
    await writeFile(
      join(tmp, "src", "b", "util.ts"),
      ["export const util = 42;"].join("\n"),
    );
    await writeFile(
      join(tmp, "src", "orphan.ts"),
      ['import chalk from "chalk";', "export default chalk;"].join("\n"),
    );
    await writeFile(
      join(tmp, "src", "broken.ts"),
      ['import { missing } from "./does-not-exist";', "export { missing };"].join("\n"),
    );
  });

  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it("scans every supported source file", async () => {
    const g = await getDependencyGraph({ root: tmp });
    expect(g.scanned).toBe(6); // index, a, b/index, b/util, orphan, broken
  });

  it("ranks most-imported modules across internal + external", async () => {
    const g = await getDependencyGraph({ root: tmp });
    const top = g.mostImported.map((m) => ({ module: m.module, count: m.count }));
    // zod is imported twice (index, a). b/index is imported twice (index, a).
    // Everything else is imported once.
    expect(top).toContainEqual({ module: "zod", count: 2 });
    expect(top).toContainEqual({
      module: "src/b/index.ts",
      count: 2,
    });
  });

  it("identifies entrypoints (files nothing else imports)", async () => {
    const g = await getDependencyGraph({ root: tmp });
    // index.ts, orphan.ts, broken.ts are never imported.
    // src/a.ts IS imported (by src/index.ts), so it shouldn't appear.
    expect(g.entrypoints).toEqual(
      expect.arrayContaining([
        "src/index.ts",
        "src/orphan.ts",
        "src/broken.ts",
      ]),
    );
    expect(g.entrypoints).not.toContain("src/a.ts");
  });

  it("populates a targeted view for a single file", async () => {
    const g = await getDependencyGraph({
      root: tmp,
      target: "src/a.ts",
    });
    expect(g.target).toBeDefined();
    expect(g.target!.file).toBe("src/a.ts");

    const specs = g.target!.imports.map((i) => i.spec).sort();
    expect(specs).toEqual(["./b", "zod"]);

    const kinds = new Map(g.target!.imports.map((i) => [i.spec, i.kind]));
    expect(kinds.get("./b")).toBe("internal");
    expect(kinds.get("zod")).toBe("external");

    // ./b should resolve to src/b/index.ts.
    const internalImport = g.target!.imports.find((i) => i.spec === "./b")!;
    expect(internalImport.resolved).toBe("src/b/index.ts");

    // a.ts is imported only by index.ts.
    expect(g.target!.importedBy).toEqual(["src/index.ts"]);
  });

  it("marks unresolvable relative imports as `unresolved`", async () => {
    const g = await getDependencyGraph({
      root: tmp,
      target: "src/broken.ts",
    });
    const entry = g.target!.imports.find((i) => i.spec === "./does-not-exist");
    expect(entry).toBeDefined();
    expect(entry!.kind).toBe("unresolved");
    expect(entry!.resolved).toBeUndefined();
  });

  it("throws a clear error when the target is outside the scanned set", async () => {
    await expect(
      getDependencyGraph({ root: tmp, target: "src/not-a-real-file.ts" }),
    ).rejects.toThrow(/Target file not found/);
  });

  it("respects `limit` on aggregate output", async () => {
    const g = await getDependencyGraph({ root: tmp, limit: 1 });
    expect(g.mostImported).toHaveLength(1);
    expect(g.entrypoints).toHaveLength(1);
  });

  it("skips ignored directories (node_modules, dist, etc.)", async () => {
    // Drop a fake node_modules with a TS file to verify it's ignored.
    await mkdir(join(tmp, "node_modules", "fake"), { recursive: true });
    await writeFile(
      join(tmp, "node_modules", "fake", "index.ts"),
      'import "./should-not-appear";\n',
    );

    const g = await getDependencyGraph({ root: tmp });
    expect(g.scanned).toBe(6); // unchanged
    expect(g.entrypoints.some((e) => e.startsWith("node_modules/"))).toBe(false);
  });

  // --- Regression tests for bugs found while dogfooding v1 ------------------

  it("ignores vitest.config.ts.timestamp-*.mjs noise files", async () => {
    // Drop a handful of fake vitest timestamps at the project root. These
    // are ephemeral tool output and shouldn't count as source.
    await writeFile(
      join(tmp, "vitest.config.ts.timestamp-1234-abc.mjs"),
      'import "./src/index.ts";\n',
    );
    await writeFile(
      join(tmp, "vitest.config.ts.timestamp-5678-def.js"),
      'import "./src/index.ts";\n',
    );

    const g = await getDependencyGraph({ root: tmp });
    // Still just the 6 real sources we set up in beforeEach.
    expect(g.scanned).toBe(6);
    expect(
      g.entrypoints.some((e) => e.includes(".timestamp-")),
    ).toBe(false);
  });

  it("resolves TypeScript ESM .js imports to their .ts source", async () => {
    // Real-world idiom: `import { x } from "./foo.js"` where ./foo is
    // actually a .ts file on disk. The resolver must try the .ts
    // extension even though the spec says .js.
    await writeFile(
      join(tmp, "src", "esm-caller.ts"),
      ['import { util } from "./b/util.js";', "export const y = util;"].join("\n"),
    );

    const g = await getDependencyGraph({
      root: tmp,
      target: "src/esm-caller.ts",
    });
    const imp = g.target!.imports[0];
    expect(imp.spec).toBe("./b/util.js");
    expect(imp.kind).toBe("internal");
    expect(imp.resolved).toBe("src/b/util.ts");
  });
});
