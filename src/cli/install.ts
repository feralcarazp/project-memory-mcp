/**
 * `project-memory-mcp install` / `uninstall` — CLI subcommands.
 *
 * Design goals:
 * - Paranoically defensive around the user's config file. Any time we
 *   touch it, we first write a timestamped backup. Any parse/serialize
 *   error aborts before the real file changes.
 * - Preserve all other mcpServers entries. We only touch our own key.
 * - Atomic writes via tmp + rename — if the process dies mid-write,
 *   the original file is untouched.
 * - Idempotent: re-running `install` updates in place, doesn't duplicate.
 * - Clear, actionable output. No stack traces for recoverable errors.
 *
 * Stdout vs stderr: these CLI handlers run BEFORE the MCP server boots,
 * so stdout is safe to use for user-facing messages. The server path in
 * index.ts is the one that must stay silent on stdout.
 */

import { promises as fs } from "node:fs";
import { claudeDesktopConfigPath, claudeDesktopConfigDir } from "./paths.js";

const SERVER_KEY = "project-memory";
const PACKAGE_NAME = "@feralcaraz/project-memory-mcp";

interface ClaudeDesktopConfig {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CliOptions {
  /** Override config path — used by tests, never set in production. */
  configPath?: string;
  /** Override config dir check — used by tests. */
  configDir?: string;
}

function serverEntry(): Record<string, unknown> {
  return {
    command: "npx",
    args: ["-y", PACKAGE_NAME],
  };
}

function timestamp(): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    now.getFullYear() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    "-" +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  );
}

async function atomicWrite(path: string, data: string): Promise<void> {
  const tmp = `${path}.tmp`;
  await fs.writeFile(tmp, data, "utf8");
  await fs.rename(tmp, path);
}

export async function runInstall(
  _args: string[],
  opts: CliOptions = {},
): Promise<void> {
  const configPath = opts.configPath ?? claudeDesktopConfigPath();
  const configDir = opts.configDir ?? claudeDesktopConfigDir();

  try {
    await fs.stat(configDir);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      throw new Error(
        `Claude Desktop config directory not found:\n  ${configDir}\n\n` +
          `Is Claude Desktop installed? Download it from https://claude.ai/download, ` +
          `run it once (so it creates the config folder), then re-run this installer.`,
      );
    }
    throw err;
  }

  let existing: string | null = null;
  try {
    existing = await fs.readFile(configPath, "utf8");
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== "ENOENT") throw err;
  }

  let config: ClaudeDesktopConfig;
  let backupPath: string | null = null;

  if (existing !== null) {
    backupPath = `${configPath}.bak-${timestamp()}`;
    await fs.writeFile(backupPath, existing, "utf8");

    try {
      config = JSON.parse(existing) as ClaudeDesktopConfig;
    } catch {
      throw new Error(
        `Your Claude Desktop config contains invalid JSON:\n  ${configPath}\n\n` +
          `Backup saved at:\n  ${backupPath}\n\n` +
          `Please fix the JSON manually (check for trailing commas, unclosed braces) ` +
          `then re-run this installer — or use the manual recipe in the README.`,
      );
    }
  } else {
    config = {};
  }

  if (!config.mcpServers || typeof config.mcpServers !== "object") {
    config.mcpServers = {};
  }
  const servers = config.mcpServers as Record<string, unknown>;
  const wasPresent = Object.prototype.hasOwnProperty.call(servers, SERVER_KEY);
  servers[SERVER_KEY] = serverEntry();

  const serialized = JSON.stringify(config, null, 2) + "\n";

  try {
    JSON.parse(serialized);
  } catch {
    throw new Error(
      "Internal error: the config we were about to write is not valid JSON. " +
        "No changes made. Please file an issue with details of your existing config.",
    );
  }

  await atomicWrite(configPath, serialized);

  const lines = [
    wasPresent
      ? `Updated project-memory entry in:`
      : `Installed project-memory into:`,
    `  ${configPath}`,
    ``,
  ];
  if (backupPath) {
    lines.push(`Backup of your previous config:`, `  ${backupPath}`, ``);
  }
  lines.push(
    `Next: fully quit Claude Desktop (Cmd+Q on macOS, Alt+F4 on Windows) ` +
      `and reopen it. project-memory should appear in the tools menu within ` +
      `a few seconds.`,
  );

  process.stdout.write(lines.join("\n") + "\n");
}

export async function runUninstall(
  _args: string[],
  opts: CliOptions = {},
): Promise<void> {
  const configPath = opts.configPath ?? claudeDesktopConfigPath();

  let existing: string;
  try {
    existing = await fs.readFile(configPath, "utf8");
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      process.stdout.write(
        "No Claude Desktop config found — nothing to uninstall.\n",
      );
      return;
    }
    throw err;
  }

  const backupPath = `${configPath}.bak-${timestamp()}`;
  await fs.writeFile(backupPath, existing, "utf8");

  let config: ClaudeDesktopConfig;
  try {
    config = JSON.parse(existing) as ClaudeDesktopConfig;
  } catch {
    throw new Error(
      `Config file at ${configPath} is not valid JSON. ` +
        `Backup saved at ${backupPath}. Fix the JSON manually, then retry.`,
    );
  }

  if (
    !config.mcpServers ||
    typeof config.mcpServers !== "object" ||
    !Object.prototype.hasOwnProperty.call(config.mcpServers, SERVER_KEY)
  ) {
    process.stdout.write(
      "project-memory not found in config — nothing to remove.\n",
    );
    return;
  }

  const servers = config.mcpServers as Record<string, unknown>;
  delete servers[SERVER_KEY];

  if (Object.keys(servers).length === 0) {
    delete config.mcpServers;
  }

  const serialized = JSON.stringify(config, null, 2) + "\n";
  await atomicWrite(configPath, serialized);

  process.stdout.write(
    [
      `Removed project-memory from:`,
      `  ${configPath}`,
      ``,
      `Backup: ${backupPath}`,
      ``,
      `Fully quit and reopen Claude Desktop to finalize.`,
    ].join("\n") + "\n",
  );
}

export function printUsage(): void {
  process.stdout.write(
    [
      "Usage: project-memory-mcp [command]",
      "",
      "Commands:",
      "  (no command)  Run the MCP server over stdio (invoked by Claude Desktop).",
      "  install       Add project-memory to your Claude Desktop config.",
      "  uninstall     Remove project-memory from your Claude Desktop config.",
      "  --help, -h    Show this message.",
      "",
      `Config location (detected): ${claudeDesktopConfigPath()}`,
      "",
    ].join("\n"),
  );
}
