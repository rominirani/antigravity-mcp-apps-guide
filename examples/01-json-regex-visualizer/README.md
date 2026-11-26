# Example 1: Inline JSON & Regex Visualizer (Python + Vanilla JS)

An inline MCP App built with the **Python MCP SDK v2** (`mcp>=2.0.0`) and **Vanilla JavaScript** bundled into a single self-contained HTML document via `esbuild` + `@modelcontextprotocol/ext-apps`.

## What It Demonstrates

- Serving a single-file `ui://json-regex-visualizer/app.html` resource (`text/html;profile=mcp-app`)
- Pointing two model-callable tools (`inspect_json`, `test_regex`) at the same UI resource via `_meta.ui.resourceUri`
- Returning both plain-text `content` (for the model and CLI fallback) and `structuredContent` (for the interactive UI)
- Exposing a `visibility: ["app"]` helper (`app_test_regex`) for interactive live regex re-testing via `app.callServerTool()`
- Host theme synchronization via `applyDocumentTheme()` and `applyHostStyleVariables()`
- Fast UI iteration using `JSON_REGEX_APP_HTML=/path/to/app.html`

## Build & Verify

```bash
# 1. Build the single-file HTML bundle (dist/app.html)
cd ui && npm install && npm run build && cd ..

# 2. Create a local Python virtualenv and install mcp
python3 -m venv .venv
.venv/bin/pip install "mcp>=2.0.0"
.venv/bin/pip freeze > requirements.txt

# 3. Run the end-to-end stdio MCP verification test
.venv/bin/python test_mcp.py

# 4. Validate as an Antigravity plugin
agy plugin validate --strict .
```
