# Example 0: Hello World MCP App (Plain JavaScript)

A minimal MCP App: **one tool (`say_hello`)** and **one `ui://` resource (`ui://hello-world/app.html`)** with no UI frameworks or TypeScript build step.

## What It Demonstrates

- Registering a `ui://` HTML resource (`text/html;profile=mcp-app`) with `registerAppResource`
- Linking a tool to that UI via `_meta.ui.resourceUri` with `registerAppTool`
- Returning both plain-text `content` (LLM & CLI fallback) and `structuredContent` (for the iframe)
- Receiving `ontoolinput` / `ontoolresult` and syncing host theme tokens (`applyDocumentTheme`, `applyHostStyleVariables`)
- Making a live UI-to-server callback via `app.callServerTool()` when clicking **Ping Server Again**

## Build & Verify

```bash
npm install
npm run build
npm run verify
agy plugin validate --strict .
```
