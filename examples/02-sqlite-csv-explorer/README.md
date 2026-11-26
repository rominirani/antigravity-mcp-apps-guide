# Example 2: Interactive SQLite & CSV Data Explorer (TypeScript + Vite/React)

A Side Panel (`aux_pane`) and Full-Page (`global`) MCP App built with `@modelcontextprotocol/server` v2, `@modelcontextprotocol/ext-apps` v2, React 19, Vite + `vite-plugin-singlefile`, and pure-WASM SQLite (`sql.js`).

## What It Demonstrates

- Antigravity `aux_pane` + `global` entrypoints via `_meta["com.google.antigravity/ui"]`
- Empty `{}` launch support (boots with a built-in DevOps Services & Incidents sample database)
- App-only tools (`visibility: ["app"]`) for paginated read-only SQL execution (bypassing the 1 MiB trajectory cap)
- Client-side concurrency guard respecting Antigravity's 4-in-flight `tools/call` limit
- Attaching selected rows to the user's next message via `app.updateModelContext()`
- Sending query analysis prompts to the conversation via `app.sendMessage()`
- Surface-aware capability gating via `app.getHostCapabilities()` (automatically hides conversation actions in Global view)
- Eager bookmark persistence in `${PLUGIN_DATA}` (since Antigravity never sends `ui/resource-teardown`)

## Build & Verify

```bash
npm install
npm run build
npm run verify
agy plugin validate --strict .
```
