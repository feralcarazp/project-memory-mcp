# Testing

## Philosophy

- **Real I/O over mocks** for the `context/` layer. Mocks would mostly assert that the mock matches the implementation.
- **Unit tests per pure function** in `context/`. If a function grows too large to test cleanly, it's probably doing too much — split it.
- **Smoke tests via the MCP protocol** for the end-to-end server. See `DEBUGGING.md` for manual smoke test snippets.
- **Fast.** If a test takes longer than ~1 second, something is wrong. Temp-dir tests with a local Git init should run well under that.

## How to run

```bash
npm test                    # single run
npm run test:watch          # interactive watch mode
npm run typecheck           # tsc --noEmit — also part of the CI signal
```

## What to test per tool

When adding a new tool:

1. **Context function (in `context/`):**
   - Happy path: returns the expected shape.
   - Edge case: inputs with noise (empty folders, missing Git, malformed config files).
   - Error path: bad input → clear error, no crash.
2. **MCP registration (in `tools/`):** usually covered by the smoke test; explicit unit tests only when formatting logic gets non-trivial.

## Test layout

```
tests/
└── project.test.ts         Mirrors src/context/project.ts
```

Mirror the source layout — if there's `src/context/git.ts`, there's `tests/git.test.ts`. This makes the coverage story obvious at a glance.

## Fixtures

When a fixture gets reused across tests, move it to `tests/fixtures/`. Until then, inline setup in `beforeAll` is simpler and more readable.
