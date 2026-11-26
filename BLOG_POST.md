<!--
Suggested Titles:
1. Getting Started with MCP Apps and /mcp-app-development in Google Antigravity (in Go)
2. Building Interactive Tool UIs with MCP Apps, Go, and Google Antigravity
3. A Practical Introduction to MCP Apps (SEP-1865) Using Go and /mcp-app-development
-->

# Getting Started with MCP Apps and `/mcp-app-development` in Google Antigravity

![MCP Apps in Google Antigravity — Overview Infographic](images/00_mcp_apps_hero_infographic.png)
*MCP Apps in Google Antigravity at a glance: how tools pair with ui:// views, what /mcp-app-development scaffolds, the two Go examples in this guide, and key rules to keep in mind.*

> **No prior MCP Apps experience required.** This guide walks through the basics of the MCP Apps specification (SEP-1865), how the `/mcp-app-development` command works in Google Antigravity, and how to scaffold, inspect, and install two inline MCP Apps in **Go**—starting with a small Hello World card and expanding it into an interactive checklist.

---

## What We Will Cover

1. **[Why MCP Apps Exist](#1-why-mcp-apps-exist)** — Where text-only MCP tools run into friction, and how MCP Apps compare to plain tools and `/generative_ui`.
2. **[MCP Apps Basics](#2-mcp-apps-basics)** — The four-part mental model behind every MCP App.
3. **[Using `/mcp-app-development` in Antigravity](#3-using-mcp-app-development-in-antigravity)** — How the slash command scaffolds an MCP App for you, why Go is a nice fit, and what to have installed first.
4. **[Example 1: Hello World in Go](#4-example-1-hello-world-in-go)** — Scaffolding your first inline greeting card with a live button that calls back into your Go server.
5. **[Example 2: Interactive Quick Checklist](#5-example-2-interactive-quick-checklist)** — Adding UI-only actions, server-side persistence, and a button that attaches checklist progress to your next prompt.
6. **[Packaging & Iterating as an Antigravity Plugin](#6-packaging--iterating-as-an-antigravity-plugin)** — One Go-specific plugin config quirk to watch for and a quick edit-rebuild loop.
7. **[Common Issues & Things to Try](#7-common-issues--things-to-try)** — A short troubleshooting table and a few small ideas to experiment with next.
8. **[Going Deeper: Suggested Reading Order](#8-going-deeper-suggested-reading-order)** — Where to read next, in order, when you are ready to explore the rest of the MCP Apps standard.

---

## 1. Why MCP Apps Exist

If you have used the [Model Context Protocol (MCP)](https://modelcontextprotocol.io), you know it lets AI agents call **tools** and read **resources** exposed by local or remote servers. By default, every tool returns text (or JSON text) into the chat.

Text works well for many tasks, but it becomes awkward whenever a human needs to inspect or manipulate data directly:

- Reading large JSON payloads or checklists in plain text clutters the conversation and spends context tokens on formatting.
- Small actions—like clicking a refresh button or checking off three items—shouldn't require a new LLM turn each time.
- Selecting specific items to send back to the agent is faster in a small interactive card than by copy-pasting text.

### MCP Tools vs. MCP Apps vs. `/generative_ui`

In Google Antigravity, you have three main ways to present tool output or interactive UIs to a user. Before writing code, it helps to separate them by two simple questions: **does the view need to talk to a live MCP server**, and **do you want to reuse it across conversations?**

- **Plain MCP Tools** are the right default when text output is enough—running a CLI check, fetching a short summary, or automating headless steps.
- **Generative UI (`/generative_ui`)** is useful when you want the model to sketch a one-off diagram, chart, or visual walkthrough on the fly for the current chat without standing up an MCP server.
- **MCP Apps (`/mcp-app-development`)** sit in the middle: deterministic, reusable UIs backed by a real MCP server that you can package and install as a plugin.

| Option | Backed by an MCP Server? | Reusable Across Chats? | Best Fit |
| :--- | :--- | :--- | :--- |
| **Plain MCP Tool** | Yes | Yes | Headless actions, CLI workflows, text summaries |
| **MCP App (`/mcp-app-development`)** | **Yes** | **Yes** (installable plugin) | Reusable interactive cards, checklists, viewers, and tool UIs backed by live server logic |
| **Generative UI (`/generative_ui`)** | No | Single conversation | One-off diagrams, charts, or quick prototypes generated on the spot |

The architectural difference between a plain MCP tool and an MCP App comes down to where the user interacts. With a plain tool, every follow-up action goes back through the LLM, which has to invoke the server again and rewrite the response. With an MCP App, Antigravity mounts a sandboxed HTML iframe that talks to your MCP server through the host—so clicks and toggles happen directly against the server, while the LLM receives a concise text summary (and any context the user explicitly chooses to attach):

![Plain MCP Tool vs. MCP App (SEP-1865)](images/01_plain_mcp_vs_mcp_app.png)
*Figure 1: Plain-text MCP tools require a new LLM turn for every interaction, while MCP Apps render a sandboxed UI iframe that communicates with your server through the host.*

---

## 2. MCP Apps Basics

**MCP Apps** is an open extension to MCP ([SEP-1865](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx), maintained in [`modelcontextprotocol/ext-apps`](https://github.com/modelcontextprotocol/ext-apps)). If a client doesn't support UI views—such as the Antigravity CLI (`agy`)—your tools still run normally and fall back to plain text.

When you use `/mcp-app-development`, Antigravity handles the wire-level details for you. You only need a high-level mental model of four moving parts:

1. **The UI lives separately from tool output**: Your MCP server exposes an HTML page at a `ui://` URI and links your tool to it. Antigravity loads that HTML on demand, so UI markup never clutters the chat history.
2. **Every tool call returns text for the model and data for the UI**: Plain text goes to the LLM (and CLI clients like `agy`), while structured JSON goes straight to the interactive card.
3. **The UI runs in a sandboxed iframe**: Using the official `@modelcontextprotocol/ext-apps` helper library, the card receives tool results, matches Antigravity's Light/Dark theme, and can call tools back on your MCP server without starting another LLM turn.
4. **Bundle into one HTML file, and keep state on the server**: Because the sandbox blocks external network scripts and discards browser storage when closed, the frontend is bundled into a single HTML file and any persistent state lives on your server.

Here is how those pieces interact at runtime:

![MCP App Lifecycle in Three Stages](images/02_mcp_app_lifecycle.png)
*Figure 2: The three stages of an MCP App lifecycle—initial render, direct UI-to-server callbacks, and optional messages or context updates back to the agent.*

---

## 3. Using `/mcp-app-development` in Antigravity

In the **Antigravity App** (`v2.34.0+`), `/mcp-app-development` is a built-in slash command backed by an Agent Skill. Prefixing your prompt with `/mcp-app-development` loads Antigravity's MCP Apps guidance into the agent's context—so you can describe *what* you want to build in plain language while the agent handles the protocol details, single-file bundling, Light/Dark theming, and plugin files.

By default, an MCP App renders **inline** right inside the chat stream in place of a collapsed tool card and automatically resizes to fit its content. *(Antigravity also supports side panels, full-page sidebar apps, and custom file viewers—links to those are in Section 8 once you're comfortable with inline cards.)*

### Why Go Works Well for MCP Apps

Go is a clean fit for local MCP App plugins:

1. **Official Go SDK**: [`github.com/modelcontextprotocol/go-sdk`](https://github.com/modelcontextprotocol/go-sdk) infers tool input schemas straight from Go structs and automatically serializes your output struct for the UI.
2. **Single-binary packaging with `//go:embed`**: Once the frontend is bundled into a single HTML file, `//go:embed` bakes it straight into your compiled Go binary—so end users don't need Node.js or Python installed at runtime.

### Prerequisites

Before running `/mcp-app-development`, make sure the following tools are installed on the machine running Antigravity so the agent can bundle, compile, and test what it generates:

- **Google Antigravity App (`v2.34.0+`)** and the **`agy` CLI** — provides `/mcp-app-development`, renders inline MCP Apps, and validates/installs local plugins.
- **Go (`1.24+`)** — compiles and tests the Go MCP servers. *(If you ask `/mcp-app-development` for a Node/TypeScript or Python server instead, install that runtime instead of Go.)*
- **Node.js (`20+`) and `npm` (build-time only)** — needed on your development machine even for a Go MCP App so the generated build step (typically Vite + `vite-plugin-singlefile` or `esbuild`) can bundle your frontend code and `@modelcontextprotocol/ext-apps` into one self-contained HTML file. Once `go build` embeds that HTML into the binary, Node.js is not required at runtime.

*(Python is not needed for the Go examples in this post.)*

---

## 4. Example 1: Hello World in Go

Let's start with the simplest useful MCP App: **1 tool (`say_hello`)** linked to **1 embedded `ui://` HTML view**.

When the agent calls `say_hello(name="Ada")`, Antigravity renders a themed greeting card inline showing the server timestamp and call count. Clicking **Ping Server Again** inside the card calls `say_hello` directly on the Go server, updating the timestamp and count without another LLM turn.

![Example 1: Hello World in Go](images/03_go_hello_world_flow.png)
*Figure 3: Go Example 1 embeds the single-file HTML UI into one Go binary and handles Ping Server Again callbacks via app.callServerTool().*

### Step 1: Scaffold the App with `/mcp-app-development`

Create an empty folder (for example, `hello-mcp-app/`) and open it as a project in the **Antigravity App**. Type `/` in the chat box, choose **`mcp-app-development`**, and describe what you want in plain language:

```text
/mcp-app-development Build a simple Hello World MCP App in Go packaged as an Antigravity plugin. Add a say_hello tool that takes an optional name and renders an inline greeting card showing the server time, a call counter, and a "Ping Server Again" button that refreshes from the server.
```

Notice you don't need to mention `ui://` URIs, MIME types, bundlers, or plugin manifest keys—the `/mcp-app-development` skill supplies those conventions automatically.

As it runs, Antigravity will scaffold the Go server, a frontend project (usually TypeScript with Vite + `vite-plugin-singlefile`, or Vanilla JS with `esbuild`), Go tests, `plugin.json`, and `mcp_config.json`—and will typically run the build, tests, and `agy plugin validate --strict .` for you. Exact folder layouts vary from run to run (for example, a standard `cmd/` + `internal/` Go layout with a `Makefile`, or a flatter single-file `main.go`), which is completely expected.

### Step 2: What to Verify in the Generated Go Server

Rather than expecting a specific filename, look inside the generated Go server code (for example `internal/server/server.go` or `main.go`) and confirm the three MCP Apps wiring points are in place:

```go
// 1. Embed the compiled single-file HTML bundle inside the Go binary.
//go:embed dist/index.html
var embeddedAppHTML string

// 2. Expose it as a ui:// resource with the MCP App MIME type.
server.AddResource(&mcp.Resource{
	URI:      appURI, // e.g., "ui://hello-world/card.html"
	MIMEType: "text/html;profile=mcp-app",
}, readAppHTMLHandler)

// 3. Link say_hello to that resource via _meta.ui.resourceUri.
mcp.AddTool(server, &mcp.Tool{
	Name: "say_hello",
	Meta: mcp.Meta{"ui": map[string]any{"resourceUri": appURI}},
}, sayHelloHandler)
```

Inside the tool handler, `CallToolResult.Content` provides the short plain-text summary for the LLM and CLI clients, while the returned Go output struct is serialized automatically into `structuredContent` for the iframe.

### Step 3: What to Verify in the Generated Frontend

Next, look inside the generated frontend entry file (typically `ui/src/main.ts` or `ui/app.js`). Regardless of whether Antigravity chose TypeScript with Vite or Vanilla JS with `esbuild`, the MCP Apps bridge follows the same three-step sequence:

```ts
import { App, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";

const app = new App({ name: "Hello MCP App", version: "1.0.0" }, {});

// 1. Register tool & theme listeners BEFORE calling app.connect().
app.addEventListener("toolresult", (result) => render(result.structuredContent));
app.addEventListener("hostcontextchanged", applyTheme);

// 2. Call back into the Go server directly on button click.
refreshBtn.addEventListener("click", async () => {
  const result = await app.callServerTool({ name: "say_hello", arguments: { name: currentName } });
  render(result.structuredContent);
});

// 3. Complete the handshake and sync the host's Light/Dark theme.
await app.connect();
applyTheme(app.getHostContext());
```

*(Depending on the SDK style Antigravity picks, you may see `app.ontoolresult = ...` instead of `app.addEventListener("toolresult", ...)`—both work identically. Also check that DOM updates use `textContent` rather than `innerHTML` so user input is never interpreted as HTML.)*

### Step 4: Validate, Install & Try It in Antigravity

In most runs, `/mcp-app-development` builds the single-file UI, compiles the Go binary, and runs the tests for you (often exposing `make build` / `make test` in a generated `Makefile`). From the project folder, confirm strict plugin validation and install the plugin locally:

```bash
agy plugin validate --strict .
agy plugin install .
```

Then open a chat in the **Antigravity App** and ask:

```text
Greet Ada using the say_hello tool.
```

You should see the inline greeting card appear directly in chat, and clicking **Ping Server Again** increments the server call counter without triggering another LLM turn.

---

## 5. Example 2: Interactive Quick Checklist

Once Hello World makes sense, a natural next question is: *how do I build an inline UI that manages real state and feeds updates back into my conversation?*

Example 2 stays on the same **Go + `//go:embed`** pattern and adds **three capabilities**:

1. **UI-only tools (`visibility: ["app"]`)**: The model only sees `create_checklist`. Actions like toggling, adding, removing, or reloading items stay hidden from the model while remaining callable directly from the card.
2. **Server-side persistence (`PLUGIN_DATA`)**: Because browser storage in the iframe isn't permanent, the Go server writes every change immediately to Antigravity's per-plugin data directory (`PLUGIN_DATA`).
3. **Attaching UI state to your next prompt (`updateModelContext`)**: Clicking **Attach Remaining Items to Prompt** puts a context pill on your next chat message so the agent knows which checklist items are done and which remain.

![Example 2: Quick Checklist Architecture](images/04_go_quick_checklist_flow.png)
*Figure 4: Go Example 2 adds visibility:["app"] helper tools, eager persistence to PLUGIN_DATA, and prompt context pills via app.updateModelContext().*

### Step 1: Scaffold Quick Checklist with `/mcp-app-development`

Open a fresh empty folder (for example, `quick-checklist/`) in the **Antigravity App** and describe the app naturally:

```text
/mcp-app-development Build an inline checklist MCP App in Go packaged as an Antigravity plugin. Let the agent create a checklist with a title and items; inside the card, let me check off items, add new ones, keep my progress across restarts, and click a button to attach the remaining items to my next chat prompt.
```

Antigravity will typically generate one model-facing `create_checklist` tool, several `app_*` UI-only helper tools (for toggling, adding, removing, and reloading persisted checklist state after a restart), disk persistence under `PLUGIN_DATA`, and the bundled interactive UI.

### Step 2: What to Verify in the Generated Go Server

In the generated Go server code, look for the split between the model-facing tool (`resourceUri`) and the UI-only helper tools (`visibility: ["app"]`):

```go
// Visible to the model: creates a checklist and opens the inline card.
mcp.AddTool(server, &mcp.Tool{
	Name: "create_checklist",
	Meta: mcp.Meta{"ui": map[string]any{"resourceUri": appURI}},
}, createHandler)

// Hidden from the model in UI hosts; callable only from the checklist card.
mcp.AddTool(server, &mcp.Tool{
	Name: "app_toggle_item", // exact helper names vary per run
	Meta: mcp.Meta{"ui": map[string]any{"visibility": []string{"app"}}},
}, toggleHandler)
```

Also verify that the server reads Antigravity's persistent data directory—either via `os.Getenv("PLUGIN_DATA")` or a `--data-dir=${PLUGIN_DATA}` flag passed from `mcp_config.json`—and saves edits to disk immediately on every change.

### Step 3: What to Verify in the Generated Frontend

In the generated UI code, look for the click handler that calls `app.updateModelContext()` with a plain-text summary of remaining items (and passes an empty `content: []` array to clear it), gated on `app.getHostCapabilities()?.updateModelContext`:

```ts
attachBtn.addEventListener("click", async () => {
  await app.updateModelContext({
    content: [{ type: "text", text: formatRemainingSummary(checklist) }],
  });
});

clearBtn.addEventListener("click", () => app.updateModelContext({ content: [] }));
```

*(One subtle detail you may notice in the generated UI: because the sandbox's default CSP blocks `<form>` submissions, the input row typically uses a plain container with a `<button type="button">` and an `Enter` key listener rather than a `<form>` tag.)*

### Step 4: Validate, Install & Try It in Antigravity

Once Antigravity finishes building and testing the generated project, validate and install it from the project folder:

```bash
agy plugin validate --strict .
agy plugin install .
```

Then try it in an Antigravity App conversation:

```text
Create a PR review checklist for this repository using create_checklist.
```

Check off a couple of items in the inline card, click the button to attach remaining items, and send a follow-up message—you will see the attached checklist summary appear as a context pill on your prompt.

---

## 6. Packaging & Iterating as an Antigravity Plugin

`/mcp-app-development` generates `plugin.json` and `mcp_config.json` for you, and `agy plugin validate --strict .` checks them before install. Below are the one Go-specific config quirk to watch for and a quick loop for iterating on changes.

### Launching a Compiled Go Binary in `mcp_config.json`

Antigravity expands `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` inside `args`, `env`, and `cwd`—not inside `command`. If `mcp_config.json` puts `"command": "${PLUGIN_ROOT}/bin/my-server"`, `agy plugin validate --strict` flags a warning.

To keep strict validation clean, launch your compiled Go binary through `args`—either with a small executable shell wrapper (using `exec` so stdio passes straight through) or via `"command": "env"`:

```json
{
  "mcpServers": {
    "hello": {
      "command": "bash",
      "args": ["${PLUGIN_ROOT}/scripts/launch.sh"]
    }
  }
}
```

### Quick Edit-Rebuild Loop

- **Editing the UI**: Re-run the generated UI build command (for example `make build`, or `npm run build` inside `ui/`). Many generated servers also support an environment variable override (such as `HELLO_APP_HTML`) pointing directly at the built HTML file on disk—when set, closing and reopening the card picks up UI edits without recompiling Go or restarting the server.
- **Editing Go server code**: Recompile the binary (for example `make build` or `go build`), then restart the server from **Customizations > Installed > \<plugin\> > MCP > More actions (`⋮`) > Restart** in the Antigravity App.

---

## 7. Common Issues & Things to Try

### Quick Debugging Checklist

| Symptom | Likely Cause | Fix |
| :--- | :--- | :--- |
| **Error card instead of UI** | Wrong MIME type or missing UI resource. | Return `text/html;profile=mcp-app` from `server.AddResource`. |
| **Blank iframe** | `app.connect()` failed, or external scripts/styles were blocked by the sandbox. | Bundle JS and CSS inline into a single self-contained HTML file. |
| **Card stays stuck on "Connecting..."** | Event handlers were registered after `await app.connect()`. | Register `toolresult` / `ontoolresult` and `hostcontextchanged` before `app.connect()`. |
| **Button callback fails** | Tool is hidden from the UI or belongs to another server. | Set `visibility: ["app"]` (or omit `visibility`) on the same MCP server. |
| **Colors look wrong after Light/Dark toggle** | Host theme was only applied once at startup. | Apply host theme both after `connect()` and inside `hostcontextchanged`. |
| **`agy plugin validate --strict` warns on `command`** | `${PLUGIN_ROOT}` was placed in `command` instead of `args`. | Launch the binary through `args` (e.g., `"command": "bash"` with a launcher script, or `"command": "env"`). |

### Things to Try Next

1. **Extend your checklist card**: Ask `/mcp-app-development` inside your checklist folder to add filtering (*All / Remaining / Completed*) or a clear-completed button backed by an app-only tool.
2. **Send a follow-up prompt directly from the card**: Add an **Ask Agent About Remaining Items** button that uses `app.sendMessage()` to start a follow-up turn straight from the UI.
3. **Build a Go environment card**: Ask `/mcp-app-development` to scaffold a small Go plugin showing `runtime.Version()`, `runtime.GOOS`, and `go.mod` dependencies inside a searchable inline table.
4. **Scaffold a cron expression helper**:
   ```text
   /mcp-app-development Build an inline Go MCP App plugin that validates a cron expression, shows the next 5 run times, and lets me edit the expression live inside the card.
   ```

---

## 8. Going Deeper: Suggested Reading Order

We have only scratched the surface of the MCP Apps standard here—sticking to inline cards, single-file bundling, `visibility: ["app"]` helpers, and `app.updateModelContext()`. Beyond these basics, the standard covers streaming partial tool inputs, custom CSP and CORS domains, OAuth-backed remote servers, display modes, and Antigravity's side-panel, full-page, and custom file-viewer surfaces.

If you want to learn the full standard systematically, read the official documentation in this order:

### Step 1: Core Concepts & Official Quickstart

Start here to reinforce the mental model and see how the spec presents MCP Apps across hosts (Claude, ChatGPT, VS Code, and Antigravity):

1. **[MCP Apps Overview (`modelcontextprotocol.io`)](https://modelcontextprotocol.io/extensions/apps/overview)** — High-level introduction to why the extension exists, how hosts render views, and how graceful fallback works.
2. **[Build an MCP App (`modelcontextprotocol.io`)](https://modelcontextprotocol.io/extensions/apps/build)** & **[Official Quickstart (`docs/quickstart.md`)](https://github.com/modelcontextprotocol/ext-apps/blob/main/docs/quickstart.md)** — The official end-to-end starter walkthrough from the `ext-apps` maintainers.

### Step 2: Practical App Patterns, Security & Testing

Once you have built one or two small inline apps, read these guides before shipping anything larger:

3. **[Common Patterns (`docs/patterns.md`)](https://github.com/modelcontextprotocol/ext-apps/blob/main/docs/patterns.md)** — How to structure chunked loading, polling, streaming partial tool arguments (`ontoolinputpartial`), and state persistence.
4. **[CSP & CORS Guide (`docs/csp-cors.md`)](https://github.com/modelcontextprotocol/ext-apps/blob/main/docs/csp-cors.md)** — How iframe sandbox origins work, when (and when not) to allowlist `connectDomains` or `resourceDomains`, and why server-side `tools/call` is usually safer.
5. **[Testing MCP Apps (`docs/testing-mcp-apps.md`)](https://github.com/modelcontextprotocol/ext-apps/blob/main/docs/testing-mcp-apps.md)** & **[Official Examples Gallery (`ext-apps/examples`)](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples)** — How to run the reference `basic-host` locally and browse working examples in React, Vue, Svelte, Vanilla JS, and Python.
6. **[Authorization (`docs/authorization.md`)](https://github.com/modelcontextprotocol/ext-apps/blob/main/docs/authorization.md)** — Moving from local `stdio` servers to authenticated remote Streamable HTTP MCP App servers.

### Step 3: Google Antigravity Surfaces & Plugin Packaging

When you are ready to go beyond inline cards inside Antigravity:

7. **[Google Antigravity — MCP Apps](https://antigravity.google/docs/mcp-apps)** — Covers Antigravity's extra UI surfaces (side panel tabs, full-page sidebar views, and custom file viewers), background conversations, and exact host limits.
8. **[Google Antigravity — Build Plugins](https://antigravity.google/docs/build-plugins)** & **[`/mcp-app-development` Command](https://antigravity.google/docs/commands/mcp-app-development)** — Packaging MCP Apps alongside skills, rules, and hooks, validating with `agy plugin validate --strict`, and distributing plugins.

### Step 4: The Formal Specification & SDK References

Keep these bookmarked when you need exact wire schemas, method signatures, or error codes:

9. **[SEP-1865 Formal Specification (`specification/2026-01-26/apps.mdx`)](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)** — The normative JSON-RPC 2.0 specification for every message, notification, capability flag, and display mode.
10. **[`@modelcontextprotocol/ext-apps` API Reference](https://apps.extensions.modelcontextprotocol.io/api/)** (and **[Migrating to v2](https://github.com/modelcontextprotocol/ext-apps/blob/main/docs/migrate-to-2.md)**) — Complete frontend SDK reference for `App`, React hooks, theming helpers, and `downloadFile()`.
11. **[MCP Go SDK (`pkg.go.dev/github.com/modelcontextprotocol/go-sdk/mcp`)](https://pkg.go.dev/github.com/modelcontextprotocol/go-sdk/mcp)** — Go API docs for `AddTool`, `AddResource`, `Meta`, `StructuredContent`, and transports.
