# Go Example 1: Hello World MCP App

A minimal Go MCP App using the official [MCP Go SDK](https://github.com/modelcontextprotocol/go-sdk) (`v1.8.0`) and `//go:embed` to bundle the server and single-file Vanilla JS UI into one binary.

## Build & Verify

```bash
# 1. Build-time only: bundle ui/app.js + @modelcontextprotocol/ext-apps into dist/app.html
npm --prefix ui install
npm --prefix ui run build

# 2. Fetch Go dependencies, run tests, and compile the standalone binary
go mod tidy
go test -v ./...
go build -o scripts/hello-server .

# 3. Validate as an Antigravity plugin
agy plugin validate --strict .
```
