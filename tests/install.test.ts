import { describe, it, expect } from "vitest";
import { promises as fs, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInstall, runUninstall } from "../src/cli/install.js";

function mktmp(): { dir: string; config: string } {
  const dir = mkdtempSync(join(tmpdir(), "pm-install-"));
  return { dir, config: join(dir, "claude_desktop_config.json") };
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(path, "utf8"));
}

describe("runInstall", () => {
  it("creates a new config with project-memory when none exists", async () => {
    const { dir, config } = mktmp();
    await runInstall([], { configPath: config, configDir: dir });
    const c = await readJson(config);
    const servers = c.mcpServers as Record<string, unknown>;
    expect(servers).toBeDefined();
    expect(servers["project-memory"]).toEqual({
      command: "npx",
      args: ["-y", "@feralcaraz/project-memory-mcp"],
    });
  });

  it("preserves other mcpServers when adding project-memory", async () => {
    const { dir, config } = mktmp();
    await fs.writeFile(
      config,
      JSON.stringify(
        {
          mcpServers: {
            filesystem: { command: "npx", args: ["-y", "some-fs-mcp"] },
          },
          otherKey: { preserved: true },
        },
        null,
        2,
      ),
    );
    await runInstall([], { configPath: config, configDir: dir });
    const c = await readJson(config);
    const servers = c.mcpServers as Record<string, unknown>;
    expect(servers.filesystem).toBeDefined();
    expect(servers["project-memory"]).toBeDefined();
    expect(c.otherKey).toEqual({ preserved: true });
  });

  it("updates in place on reinstall (no duplicates)", async () => {
    const { dir, config } = mktmp();
    await runInstall([], { configPath: config, configDir: dir });
    await runInstall([], { configPath: config, configDir: dir });
    const c = await readJson(config);
    const servers = c.mcpServers as Record<string, unknown>;
    expect(Object.keys(servers).filter((k) => k === "project-memory")).toHaveLength(1);
  });

  it("writes a timestamped backup when modifying existing config", async () => {
    const { dir, config } = mktmp();
    await fs.writeFile(config, JSON.stringify({ mcpServers: {} }));
    await runInstall([], { configPath: config, configDir: dir });
    const entries = await fs.readdir(dir);
    expect(entries.some((f) => f.includes(".bak-"))).toBe(true);
  });

  it("aborts with clear error on malformed JSON, leaving original untouched", async () => {
    const { dir, config } = mktmp();
    const bad = "{ this is not valid json";
    await fs.writeFile(config, bad);
    await expect(
      runInstall([], { configPath: config, configDir: dir }),
    ).rejects.toThrow(/invalid JSON/);
    expect(await fs.readFile(config, "utf8")).toBe(bad);
    const entries = await fs.readdir(dir);
    expect(entries.some((f) => f.includes(".bak-"))).toBe(true);
  });

  it("errors helpfully when Claude Desktop config dir doesn't exist", async () => {
    const missing = join(tmpdir(), `pm-install-missing-${Date.now()}`);
    await expect(
      runInstall([], {
        configPath: join(missing, "claude_desktop_config.json"),
        configDir: missing,
      }),
    ).rejects.toThrow(/Claude Desktop config directory not found/);
  });

  it("leaves no stray .tmp files after a successful install", async () => {
    const { dir, config } = mktmp();
    await runInstall([], { configPath: config, configDir: dir });
    const entries = await fs.readdir(dir);
    expect(entries.some((f) => f.endsWith(".tmp"))).toBe(false);
  });
});

describe("runUninstall", () => {
  it("removes project-memory and preserves other mcpServers", async () => {
    const { dir, config } = mktmp();
    await fs.writeFile(
      config,
      JSON.stringify({
        mcpServers: {
          "project-memory": {
            command: "npx",
            args: ["-y", "@feralcaraz/project-memory-mcp"],
          },
          filesystem: { command: "npx", args: ["-y", "some-fs-mcp"] },
        },
      }),
    );
    await runUninstall([], { configPath: config });
    const c = await readJson(config);
    const servers = c.mcpServers as Record<string, unknown>;
    expect(servers["project-memory"]).toBeUndefined();
    expect(servers.filesystem).toBeDefined();
  });

  it("drops the mcpServers key entirely when it becomes empty", async () => {
    const { dir, config } = mktmp();
    await fs.writeFile(
      config,
      JSON.stringify({
        mcpServers: {
          "project-memory": { command: "npx", args: [] },
        },
        otherKey: "keep-me",
      }),
    );
    await runUninstall([], { configPath: config });
    const c = await readJson(config);
    expect(c.mcpServers).toBeUndefined();
    expect(c.otherKey).toBe("keep-me");
  });

  it("is a no-op when project-memory is not installed", async () => {
    const { dir, config } = mktmp();
    await fs.writeFile(config, JSON.stringify({ mcpServers: {} }));
    await runUninstall([], { configPath: config });
    const c = await readJson(config);
    expect(c.mcpServers).toEqual({});
  });

  it("is a no-op when the config file doesn't exist", async () => {
    const fakeConfig = join(tmpdir(), `pm-no-config-${Date.now()}.json`);
    await expect(
      runUninstall([], { configPath: fakeConfig }),
    ).resolves.toBeUndefined();
  });
});
