# Building MCP Apps with `/mcp-app-development` in Google Antigravity

Hands-on guides and runnable MCP App plugins covering the official [MCP Apps specification (SEP-1865 / `io.modelcontextprotocol/ui`)](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx) and Google Antigravity's UI extensions (`com.google.antigravity/ui`).

- **Start here (Go introductory guide):** **[`BLOG_POST.md`](./BLOG_POST.md)** — Introduces MCP Apps basics and walks through two inline Go + `//go:embed` examples under [`go-examples/`](./go-examples/).
- **Extended multi-surface reference:** **[`TUTORIAL.md`](./TUTORIAL.md)** — Goes further into side panels (`aux_pane`), full-page (`global`) views, custom file viewers (`.archmap`), and companion skills using Python and TypeScript under [`examples/`](./examples/).

```bash
git clone https://github.com/rominirani/antigravity-mcp-apps-guide.git
cd antigravity-mcp-apps-guide
```

---

## Go Examples (`BLOG_POST.md`)

Both Go plugins use the official [`github.com/modelcontextprotocol/go-sdk`](https://github.com/modelcontextprotocol/go-sdk) (`v1.8.0`), embed their single-file `esbuild` HTML UI with `//go:embed`, include Go client/server tests, and pass `agy plugin validate --strict`:

| # | Plugin | Stack | Surface | Key Concepts |
| :-: | :--- | :--- | :--- | :--- |
| **1** | [`go-examples/01-hello-world`](./go-examples/01-hello-world/) | Go (`go-sdk` v1.8.0) + `//go:embed` + Vanilla JS | **Inline in chat** | 1 tool (`say_hello`) + 1 `ui://` resource, `Content` vs. `StructuredContent`, host theming, live `app.callServerTool()` callback |
| **2** | [`go-examples/02-quick-checklist`](./go-examples/02-quick-checklist/) | Go (`go-sdk` v1.8.0) + `//go:embed` + Vanilla JS | **Inline in chat** | App-only tools (`visibility: ["app"]`), eager persistence in `${PLUGIN_DATA}/checklists.json`, prompt context pills via `app.updateModelContext()` |

### Build, Test & Install the Go Plugins

```bash
# Example 1: Hello World
cd go-examples/01-hello-world
npm --prefix ui install && npm --prefix ui run build   # build-time only: creates dist/app.html
go test -v ./...
mkdir -p scripts && go build -o scripts/hello-server .
agy plugin validate --strict .
agy plugin install .

# Example 2: Quick Checklist
cd ../02-quick-checklist
npm --prefix ui install && npm --prefix ui run build   # build-time only: creates dist/app.html
go test -v ./...
mkdir -p scripts && go build -o scripts/checklist-server .
agy plugin validate --strict .
agy plugin install .
```

---

## Extended Python & TypeScript Examples (`TUTORIAL.md`)

Every plugin in `examples/` also passes `agy plugin validate --strict`:

| # | Plugin | Stack | Antigravity Surfaces | Key Concepts |
| :-: | :--- | :--- | :--- | :--- |
| **0** | [`examples/00-hello-world`](./examples/00-hello-world/) | Plain Node.js ESM + Vanilla JS + `esbuild` | **Inline in chat** | Minimal Node.js starter (`say_hello`) |
| **1** | [`examples/01-json-regex-visualizer`](./examples/01-json-regex-visualizer/) | Python (`mcp` v2 `MCPServer`) + Vanilla JS + `esbuild` | **Inline in chat** | Shared `ui://` resource across tools, safe DOM tree & regex highlighting, app-only live Python regex re-evaluation |
| **2** | [`examples/02-sqlite-csv-explorer`](./examples/02-sqlite-csv-explorer/) | TypeScript (`@modelcontextprotocol/server` v2) + React 19 + Vite + `sql.js` | **Side Panel (`aux_pane`)** + **Full Page (`global`)** | Empty `{}` default view, read-only SQLite/CSV guardrails, paginated app-only queries, 4-in-flight guard, `updateModelContext`, `sendMessage`, capability gating |
| **3** | [`examples/03-repo-architecture-reviewer`](./examples/03-repo-architecture-reviewer/) | TypeScript + React 19 + Vite (dual single-file bundles) + Skill | **Side Panel (`aux_pane`)** + **Full Page (`global`)** + **Custom File Viewer (`file`)** | Dependency graph, `com.google.antigravity/toggle-aux-pane`, background chats (`target: "new"`), `.archmap` file reader/writer (`antigravity-file://`), companion `/repo-review` skill |

---

## Repository Structure

```text
antigravity-mcp-apps-guide/
├── BLOG_POST.md                               # Standalone introductory guide (Go)
├── TUTORIAL.md                                # Extended multi-surface guide (Python & TypeScript)
├── README.md                                  # Quickstart & repository map
├── generate_medium_html.py                    # Converts BLOG_POST.md into Medium-ready HTML
├── social_posts.md                            # LinkedIn and X/Twitter drafts
├── images/                                    # 2x PNG diagrams and SVG sources
├── go-examples/
│   ├── 01-hello-world/                        # Go + //go:embed Hello World inline plugin
│   └── 02-quick-checklist/                    # Go + //go:embed Quick Checklist inline plugin
└── examples/
    ├── 00-hello-world/                        # Plain Node.js ESM Hello World inline plugin
    ├── 01-json-regex-visualizer/              # Python + Vanilla JS inline plugin
    ├── 02-sqlite-csv-explorer/                # TypeScript + React Side Panel & Global plugin
    └── 03-repo-architecture-reviewer/         # TypeScript + React + Custom File Viewer + Skill
```

---

## Medium Export Helper

Generate a Medium-ready HTML file with GitHub raw diagram URLs and a 1-click copy toolbar:

```bash
python3 generate_medium_html.py \
  --github-raw-base https://raw.githubusercontent.com/rominirani/antigravity-mcp-apps-guide/main
```

Open `medium_export.html` (gitignored) in a browser, click **Copy Article for Medium**, and paste into `https://medium.com/new-story`.
