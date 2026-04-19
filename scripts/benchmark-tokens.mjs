#!/usr/bin/env node
/**
 * Token-footprint benchmark for Project Memory MCP.
 *
 * What this measures
 * ------------------
 * Both tools return markdown in the `text` field of an MCP `content` block.
 * That text is what gets inlined into the model's context. This script
 * renders each tool's output against a handful of fixtures and prints the
 * character and token counts, so we can:
 *
 *   1. Catch regressions where a formatting change makes responses 2× longer.
 *   2. Decide sensible defaults (e.g. is `limit: 10` the right default, or
 *      should it be 20?).
 *   3. Set realistic upper bounds (hotspotLimit, etc.) grounded in numbers.
 *
 * Tokenization
 * ------------
 * We don't use Anthropic's tokenizer directly — their newer models tokenize
 * server-side and don't ship a local tokenizer. We try the following in
 * order and use the first one that loads:
 *
 *   - `gpt-tokenizer` (cl100k_base) — close enough for trend analysis.
 *   - `js-tiktoken`   (cl100k_base) — same.
 *   - chars / 4       — Anthropic's long-standing rule of thumb.
 *
 * None of these give an exact Claude token count; they're all decent
 * proxies for comparing responses against each other, which is the point
 * of a benchmark.
 *
 * Running
 * -------
 *   npm run build   # benchmark imports from dist/
 *   node scripts/benchmark-tokens.mjs
 *
 * Optionally pass one or more paths to add them as fixtures:
 *   node scripts/benchmark-tokens.mjs ~/code/some-repo ~/code/another-repo
 */

import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { simpleGit } from "simple-git";

import { getProjectContext } from "../dist/context/project.js";
import { getRecentChanges } from "../dist/context/changes.js";
import { getOpenQuestions } from "../dist/context/questions.js";
import { getDependencyGraph } from "../dist/context/deps.js";
import { formatProjectContext } from "../dist/tools/get_project_context.js";
import { formatRecentChanges } from "../dist/tools/list_recent_changes.js";
import { formatOpenQuestions } from "../dist/tools/get_open_questions.js";
import { formatDependencyGraph } from "../dist/tools/get_dependency_graph.js";

// --- Tokenizer selection ----------------------------------------------------

async function loadTokenizer() {
  try {
    const mod = await import("gpt-tokenizer");
    return {
      name: "gpt-tokenizer (cl100k_base)",
      count: (s) => mod.encode(s).length,
    };
  } catch {
    /* fall through */
  }
  try {
    const { getEncoding } = await import("js-tiktoken");
    const enc = getEncoding("cl100k_base");
    return { name: "js-tiktoken (cl100k_base)", count: (s) => enc.encode(s).length };
  } catch {
    /* fall through */
  }
  return {
    name: "approx (chars / 4)",
    count: (s) => Math.round(s.length / 4),
  };
}

// --- Fixture builders -------------------------------------------------------

/**
 * Build a temp repo with a predictable history so the numbers are
 * reproducible across machines. Returns the repo path.
 */
async function buildFixture({ label, commits, files }) {
  const dir = await mkdtemp(join(tmpdir(), `pm-mcp-bench-${label}-`));
  const git = simpleGit({ baseDir: dir });
  await git.init();
  await git.addConfig("user.email", "bench@example.com");
  await git.addConfig("user.name", "Bench");

  // A minimal package.json so get_project_context has something to show.
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify(
      { name: `fixture-${label}`, description: `Benchmark fixture: ${label}.` },
      null,
      2,
    ),
  );
  await writeFile(join(dir, "README.md"), `# fixture-${label}\n`);
  await writeFile(join(dir, "tsconfig.json"), "{}\n");
  await git.add(".");
  await git.commit("chore: bootstrap");

  for (let i = 0; i < commits; i++) {
    const fileIdx = i % files;
    const filePath = join(dir, `src-${fileIdx}.ts`);
    await writeFile(filePath, `export const v${i} = ${i};\n`);
    await git.add(filePath);
    await git.commit(`feat: change #${i}`);
  }

  return dir;
}

// --- Measurement ------------------------------------------------------------

function pad(s, width, align = "left") {
  const str = String(s);
  if (str.length >= width) return str;
  const gap = " ".repeat(width - str.length);
  return align === "right" ? gap + str : str + gap;
}

function formatInt(n) {
  return n.toLocaleString("en-US");
}

async function measure(label, text, tokenizer) {
  const chars = text.length;
  const tokens = tokenizer.count(text);
  return { label, chars, tokens };
}

async function run() {
  const tokenizer = await loadTokenizer();
  const extraPaths = process.argv.slice(2).map((p) => resolve(p));

  // Build reproducible fixtures in parallel.
  const fixtureSpecs = [
    { label: "empty", commits: 0, files: 0 },
    { label: "tiny", commits: 5, files: 3 },
    { label: "medium", commits: 50, files: 20 },
    { label: "large", commits: 200, files: 50 },
  ];
  const fixtures = [];
  for (const spec of fixtureSpecs) {
    const path = await buildFixture(spec);
    fixtures.push({ ...spec, path, synthetic: true });
  }

  // Also include each user-supplied path.
  for (const p of extraPaths) {
    fixtures.push({ label: basename(p), path: p, synthetic: false });
  }

  const rows = [];

  try {
    for (const f of fixtures) {
      // get_project_context — one size, one number.
      const ctx = await getProjectContext(f.path);
      rows.push({
        fixture: f.label,
        tool: "get_project_context",
        variant: "default",
        ...(await measure("ctx", formatProjectContext(ctx), tokenizer)),
      });

      // list_recent_changes — sweep a few limits.
      for (const limit of [10, 50, 200]) {
        const res = await getRecentChanges({ root: f.path, limit });
        rows.push({
          fixture: f.label,
          tool: "list_recent_changes",
          variant: `limit=${limit}`,
          ...(await measure("changes", formatRecentChanges(res), tokenizer)),
        });
      }

      // get_open_questions — only meaningful when the fixture actually
      // has a MEMORY.md. Synthetic fixtures don't; the project itself
      // (or any user-supplied path pointing at a real repo) does.
      try {
        const oq = await getOpenQuestions({ root: f.path });
        rows.push({
          fixture: f.label,
          tool: "get_open_questions",
          variant: "default",
          ...(await measure("questions", formatOpenQuestions(oq), tokenizer)),
        });
      } catch {
        // No MEMORY.md — skip this fixture for get_open_questions.
      }

      // get_dependency_graph — aggregate mode only. Targeted mode is
      // per-file so it varies more with inputs than with project size.
      try {
        const dg = await getDependencyGraph({ root: f.path });
        rows.push({
          fixture: f.label,
          tool: "get_dependency_graph",
          variant: "aggregate",
          ...(await measure("deps", formatDependencyGraph(dg), tokenizer)),
        });
      } catch {
        // getDependencyGraph throws on non-directory roots; synthetic
        // fixtures always have src/, so this is rare.
      }
    }
  } finally {
    // Clean up synthetic fixtures. User-supplied paths are never touched.
    for (const f of fixtures) {
      if (f.synthetic) await rm(f.path, { recursive: true, force: true });
    }
  }

  // --- Render a markdown table ---------------------------------------------

  const headers = ["fixture", "tool", "variant", "chars", "tokens"];
  const widths = {
    fixture: Math.max(7, ...rows.map((r) => r.fixture.length)),
    tool: Math.max(4, ...rows.map((r) => r.tool.length)),
    variant: Math.max(7, ...rows.map((r) => r.variant.length)),
    chars: Math.max(5, ...rows.map((r) => formatInt(r.chars).length)),
    tokens: Math.max(6, ...rows.map((r) => formatInt(r.tokens).length)),
  };

  const header = `| ${pad("fixture", widths.fixture)} | ${pad("tool", widths.tool)} | ${pad("variant", widths.variant)} | ${pad("chars", widths.chars, "right")} | ${pad("tokens", widths.tokens, "right")} |`;
  const sep = `| ${"-".repeat(widths.fixture)} | ${"-".repeat(widths.tool)} | ${"-".repeat(widths.variant)} | ${"-".repeat(widths.chars)} | ${"-".repeat(widths.tokens)} |`;

  console.log(`# Token benchmark — ${new Date().toISOString().slice(0, 10)}`);
  console.log("");
  console.log(`**Tokenizer:** ${tokenizer.name}`);
  console.log("");
  console.log(header);
  console.log(sep);
  for (const r of rows) {
    console.log(
      `| ${pad(r.fixture, widths.fixture)} | ${pad(r.tool, widths.tool)} | ${pad(r.variant, widths.variant)} | ${pad(formatInt(r.chars), widths.chars, "right")} | ${pad(formatInt(r.tokens), widths.tokens, "right")} |`,
    );
  }
}

// Run only when invoked directly (not when imported).
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  run().catch((err) => {
    process.stderr.write(`benchmark failed: ${err?.stack ?? err}\n`);
    process.exit(1);
  });
}
