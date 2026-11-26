# Social Posts — MCP Apps & `/mcp-app-development` in Go

## LinkedIn Post

If you have built MCP servers before, you have probably hit the point where returning plain text or JSON into a chat gets awkward—checking off items, refreshing live state, or picking rows to attach to your next prompt shouldn't require a new LLM turn every time.

The MCP Apps extension (SEP-1865 / `io.modelcontextprotocol/ui`) lets an MCP tool point at a `ui://` HTML resource rendered inside a sandboxed iframe, with bidirectional JSON-RPC over `postMessage`.

In Google Antigravity, the built-in `/mcp-app-development` command loads the host rules, CSP constraints, theming tokens, and plugin packaging details straight into the agent's context.

I put together a practical introduction using **Go** (`github.com/modelcontextprotocol/go-sdk` v1.8.0) and `//go:embed`—so each MCP server and its single-file HTML bundle compile down to a single executable binary:

1. **Hello World (`01-hello-world`)**: One `say_hello` tool, one embedded `ui://` resource, host Light/Dark theming, and a button calling `app.callServerTool()` directly back into the Go server.
2. **Quick Checklist (`02-quick-checklist`)**: Adds app-only tools (`visibility: ["app"]`), eager persistence in `${PLUGIN_DATA}` (since iframe storage is ephemeral and Antigravity doesn't send teardown events), and `app.updateModelContext()` to attach remaining items as a context pill on your next prompt.

One useful packaging catch along the way: Antigravity expands `${PLUGIN_ROOT}` in `args`, `env`, and `cwd`—not in `command`—so launching a compiled Go binary in `mcp_config.json` via `"command": "env"` and `"args": ["${PLUGIN_ROOT}/scripts/<binary>"]` passes `agy plugin validate --strict` cleanly.

Read the full walkthrough and grab both runnable Go examples here:
- Article: <MEDIUM_POST_URL>
- Code: https://github.com/rominirani/antigravity-mcp-apps-guide

#MCP #ModelContextProtocol #GoLang #GoogleAntigravity #AIAgents #DeveloperTools

---

## X / Twitter Thread

**1/** Plain-text MCP tools work well until a human needs to click, toggle, or inspect structured output without triggering a new LLM round trip every time.

I wrote a beginner-friendly guide to MCP Apps (SEP-1865) and `/mcp-app-development` in Google Antigravity—using Go and `//go:embed`.

Link: <MEDIUM_POST_URL>

**2/** How MCP Apps work in 4 pieces:
- Serve an HTML doc at a `ui://` URI (`text/html;profile=mcp-app`)
- Link a tool via `_meta.ui.resourceUri`
- Return both plain-text `content` (for the LLM + CLI) and `structuredContent` (for the iframe)
- Use `@modelcontextprotocol/ext-apps` for the `postMessage` JSON-RPC bridge

**3/** Go + `//go:embed` is a great fit for local MCP App plugins: bundle your Vanilla JS + CSS into one HTML file with `esbuild` (satisfying default-deny CSP), embed `dist/app.html` in `main.go`, and ship a single binary.

**4/** The post walks through two runnable Go examples (with `go test` + `agy plugin validate --strict`):
1. `01-hello-world`: 1 tool + 1 embedded card + `app.callServerTool()` refresh button
2. `02-quick-checklist`: `visibility: ["app"]` tools, eager `${PLUGIN_DATA}` saves, and `app.updateModelContext()` pills

**5/** Quick Go plugin tip from testing with `agy plugin validate --strict`:
Antigravity expands `${PLUGIN_ROOT}` in `args`, `env`, and `cwd`—not `command`.
Launch compiled binaries with:
`"command": "env", "args": ["${PLUGIN_ROOT}/scripts/hello-server"]`

Code + guide: https://github.com/rominirani/antigravity-mcp-apps-guide
