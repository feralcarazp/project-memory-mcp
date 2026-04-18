# Debugging

> Practical recipes for when the server misbehaves. Add to this file every time we hit a new failure mode.

## Golden rule: never log to stdout

`stdout` is the JSON-RPC channel. Any stray `console.log` corrupts it and the client stops responding. Always use `process.stderr.write(...)` (or `console.error`) for logs.

## Where Claude Desktop shows MCP logs

- macOS: `~/Library/Logs/Claude/mcp*.log`
- Windows: `%APPDATA%\Claude\logs\mcp*.log`

Inside Claude Desktop, the MCP panel also surfaces per-server stderr in real time. That's usually faster than tailing files.

## Smoke test the server manually

You can drive the server directly from a shell without Claude Desktop. Useful when something is wrong and you want to isolate whether it's the server or the client.

```bash
# Initialize + list tools
(
  sleep 0.3
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
  sleep 0.2
  printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  sleep 0.2
  printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
  sleep 0.5
) | node dist/index.js
```

Expected output: two JSON responses on stdout — `initialize` and `tools/list` — and one `[project-memory-mcp] v... ready over stdio` line on stderr.

## Common failure modes

### "tsc: not found" when running `npm run build`

Your `node_modules/.bin` isn't on PATH, or the install didn't complete. Re-run `npm install`. If still broken: `rm -rf node_modules package-lock.json && npm install`.

### Claude Desktop doesn't see the server

- Confirm the JSON in `claude_desktop_config.json` is valid (no trailing commas; absolute path to `dist/index.js`).
- Fully quit Claude Desktop (menu → Quit, not just close the window) and reopen. Claude Desktop only reads the config at startup.
- Check the log file (path above) — the SDK prints a clear error if the command fails.

### Tool call returns "Not a directory"

The `path` argument must point to a directory, not a file. Pass an absolute path to a project root.

### Tool call silently returns nothing / client hangs

Almost always: something in the server is writing to stdout. Check all non-SDK code for stray `console.log` or `process.stdout.write`.
