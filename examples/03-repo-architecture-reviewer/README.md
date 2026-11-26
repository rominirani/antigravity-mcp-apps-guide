# Example 3: Live Repo Architecture & File Reviewer (TypeScript + Vite/React + Antigravity Extensions)

An Antigravity plugin bundling an MCP server, two single-file React MCP App UIs, and a companion Agent Skill (`/repo-review`).

## What It Demonstrates

- **`aux_pane` + `global` entrypoints** (`scan_repository`) with live in-place updates when the agent re-calls the tool
- **Custom File Viewer & Editor (`type: "file"`, `extensions: [".archmap"]`)** via a separate host-invoked tool (`open_archmap_file`) that reads opaque `antigravity-file://` URIs via `resources/read` and saves local edits via `com.google.antigravity/resources/write`
- **Opening workspace files directly in Antigravity's side pane** via `com.google.antigravity/toggle-aux-pane` with graceful `-32601` fallback for non-Antigravity hosts
- **Spawning parallel background review conversations** via `app.sendMessage()` with `_meta: { "com.google.antigravity/message": { "target": "new" } }`
- **Explicit `_meta.ui.csp` and `prefersBorder`** resource configuration
- **Eager persistence** of per-file review notes under `${PLUGIN_DATA}`
- **Full Antigravity plugin packaging** (`plugin.json`, `mcp_config.json`, `assets/logo.svg`, and `skills/repo-review/SKILL.md`) passing `agy plugin validate --strict`

## Build & Verify

```bash
npm install
npm run build
npm run verify
agy plugin validate --strict .
```
