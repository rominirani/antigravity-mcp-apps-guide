/**
 * Vanilla JS frontend for Go Example 2 (Quick Checklist).
 *
 * Demonstrates:
 *  - Calling visibility:["app"] server tools (`app_toggle_item`, `app_add_item`)
 *  - Updating model context via `app.updateModelContext()` on explicit user click
 *  - Capability gating via `app.getHostCapabilities()`
 *  - Safe DOM construction (zero innerHTML)
 */

import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";

const titleEl = document.getElementById("title");
const progressEl = document.getElementById("progress");
const listEl = document.getElementById("items");
const addForm = document.getElementById("add-form");
const newItemInput = document.getElementById("new-item-input");
const attachBtn = document.getElementById("attach-btn");
const clearCtxBtn = document.getElementById("clear-ctx-btn");
const statusEl = document.getElementById("status");

const app = new App({ name: "Quick Checklist", version: "1.0.0" }, {});

let checklist = null;
let contextAttached = false;
let busy = false;

function applyTheme(ctx) {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
}

function setStatus(message, isError = false) {
  statusEl.textContent = message || "";
  statusEl.hidden = !message;
  statusEl.className = isError ? "status error" : "status";
}

function render() {
  if (!checklist) {
    titleEl.textContent = "Waiting for checklist...";
    progressEl.textContent = "";
    listEl.replaceChildren();
    return;
  }

  titleEl.textContent = checklist.title;
  progressEl.textContent = `${checklist.doneCount} / ${checklist.total} done`;

  listEl.replaceChildren();
  for (const item of checklist.items || []) {
    const li = document.createElement("li");
    li.className = item.done ? "item done" : "item";

    const label = document.createElement("label");
    label.className = "item-label";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(item.done);
    checkbox.disabled = busy;
    checkbox.addEventListener("change", () => toggleItem(item.id));

    const span = document.createElement("span");
    span.textContent = item.label;

    label.appendChild(checkbox);
    label.appendChild(span);
    li.appendChild(label);
    listEl.appendChild(li);
  }

  clearCtxBtn.hidden = !contextAttached;
}

async function toggleItem(itemId) {
  if (!checklist || busy) return;
  busy = true;
  setStatus("");
  render();
  try {
    const res = await app.callServerTool({
      name: "app_toggle_item",
      arguments: { checklistId: checklist.id, itemId },
    });
    if (res?.structuredContent) {
      checklist = res.structuredContent;
    }
  } catch (err) {
    setStatus(err?.message || "Could not toggle item.", true);
  } finally {
    busy = false;
    render();
  }
}

addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const label = newItemInput.value.trim();
  if (!checklist || !label || busy) return;
  busy = true;
  setStatus("");
  render();
  try {
    const res = await app.callServerTool({
      name: "app_add_item",
      arguments: { checklistId: checklist.id, label },
    });
    if (res?.structuredContent) {
      checklist = res.structuredContent;
      newItemInput.value = "";
    }
  } catch (err) {
    setStatus(err?.message || "Could not add item.", true);
  } finally {
    busy = false;
    render();
  }
});

attachBtn.addEventListener("click", async () => {
  if (!checklist) return;
  const remaining = (checklist.items || [])
    .filter((i) => !i.done)
    .map((i) => `- [ ] ${i.label}`);
  const completed = (checklist.items || [])
    .filter((i) => i.done)
    .map((i) => `- [x] ${i.label}`);

  const summary = [
    `Checklist: ${checklist.title} (${checklist.doneCount}/${checklist.total} complete)`,
    remaining.length ? `Remaining:\n${remaining.join("\n")}` : "All items complete.",
    completed.length ? `Completed:\n${completed.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    await app.updateModelContext({
      content: [{ type: "text", text: summary }],
    });
    contextAttached = true;
    setStatus("Attached checklist state as context for your next message.");
    render();
  } catch (err) {
    setStatus(err?.message || "Host rejected context update.", true);
  }
});

clearCtxBtn.addEventListener("click", async () => {
  try {
    await app.updateModelContext({ content: [] });
    contextAttached = false;
    setStatus("Cleared attached context.");
    render();
  } catch (err) {
    setStatus(err?.message || "Could not clear context.", true);
  }
});

// 1. Register handlers BEFORE app.connect().
app.ontoolinput = ({ arguments: args }) => {
  if (args?.title) {
    titleEl.textContent = `Creating "${args.title}"...`;
  }
};

app.ontoolresult = (result) => {
  if (result?.structuredContent) {
    checklist = result.structuredContent;
    setStatus("");
    render();
  }
};

app.onhostcontextchanged = applyTheme;

// 2. Connect, sync initial host theme, and gate optional capabilities.
await app.connect();
applyTheme(app.getHostContext());

const caps = app.getHostCapabilities();
if (!caps?.serverTools) {
  addForm.hidden = true;
}
if (!caps?.updateModelContext) {
  attachBtn.hidden = true;
  clearCtxBtn.hidden = true;
}
render();
