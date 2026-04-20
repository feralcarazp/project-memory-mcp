/**
 * Cross-platform locator for Claude Desktop's config file.
 *
 * Paths come from Anthropic's docs:
 *   macOS:   ~/Library/Application Support/Claude/claude_desktop_config.json
 *   Windows: %APPDATA%/Claude/claude_desktop_config.json
 *   Linux:   $XDG_CONFIG_HOME/Claude/  (default: ~/.config/Claude/)
 *
 * We detect via `process.platform` — the most reliable Node signal.
 * Tests override the path explicitly via InstallOptions.configPath, so
 * nothing here ever touches the user's real config during `npm test`.
 */

import { homedir, platform } from "node:os";
import { join } from "node:path";

export function claudeDesktopConfigDir(): string {
  const plat = platform();
  const home = homedir();

  switch (plat) {
    case "darwin":
      return join(home, "Library", "Application Support", "Claude");
    case "win32":
      return process.env.APPDATA
        ? join(process.env.APPDATA, "Claude")
        : join(home, "AppData", "Roaming", "Claude");
    case "linux":
      return process.env.XDG_CONFIG_HOME
        ? join(process.env.XDG_CONFIG_HOME, "Claude")
        : join(home, ".config", "Claude");
    default:
      throw new Error(
        `Unsupported platform: ${plat}. Expected darwin, win32, or linux.`,
      );
  }
}

export function claudeDesktopConfigPath(): string {
  return join(claudeDesktopConfigDir(), "claude_desktop_config.json");
}
