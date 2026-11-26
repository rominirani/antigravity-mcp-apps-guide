# Go Example 2: Quick Checklist MCP App

An inline Go MCP App that builds on Hello World by adding app-only tools (`visibility: ["app"]`), eager server-side persistence in `${PLUGIN_DATA}`, and `app.updateModelContext()` for attaching checklist progress to the user's next prompt.

## Build & Verify

```bash
# 1. Bundle the single-file HTML UI into dist/app.html
(cd ui && npm install && npm run build)

# 2. Fetch Go dependencies, run tests, and compile the standalone binary
go mod tidy
go test -v ./...
go build -o scripts/checklist-server .

# 3. Validate as an Antigravity plugin
agy plugin validate --strict .
```
