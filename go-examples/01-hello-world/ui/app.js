/**
 * Vanilla JS frontend for Go Example 1 (Hello World).
 *
 * Uses @modelcontextprotocol/ext-apps directly with safe DOM updates
 * (textContent only, no innerHTML).
 */

import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";

const greetingEl = document.getElementById("greeting");
const metaEl = document.getElementById("meta");
const refreshBtn = document.getElementById("refresh-btn");

let currentName = "Developer";
const app = new App({ name: "Hello MCP App", version: "1.0.0" }, {});

function applyTheme(ctx) {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
}

function render(data) {
  if (!data) return;
  currentName = data.name || currentName;
  greetingEl.textContent = data.greeting || `Hello, ${currentName}!`;
  metaEl.textContent = `Server time: ${data.serverTime} · Server call #${data.pingCount}`;
}

// 1. Register handlers BEFORE calling app.connect().
app.ontoolinput = ({ arguments: args }) => {
  if (args?.name) currentName = String(args.name);
  greetingEl.textContent = `Saying hello to ${currentName}...`;
};

app.ontoolresult = (result) => {
  render(result?.structuredContent);
};

app.onhostcontextchanged = applyTheme;

// 2. Call back into the Go MCP server directly from the iframe.
refreshBtn.addEventListener("click", async () => {
  refreshBtn.disabled = true;
  try {
    const result = await app.callServerTool({
      name: "say_hello",
      arguments: { name: currentName },
    });
    render(result?.structuredContent);
  } finally {
    refreshBtn.disabled = false;
  }
});

// 3. Complete the ui/initialize handshake and sync initial host theme.
await app.connect();
applyTheme(app.getHostContext());

if (!app.getHostCapabilities()?.serverTools) {
  refreshBtn.hidden = true;
}
