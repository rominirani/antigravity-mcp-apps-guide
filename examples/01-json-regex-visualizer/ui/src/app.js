/**
 * Vanilla JS MCP App frontend for Example 1 (JSON & Regex Visualizer).
 *
 * Key MCP Apps patterns demonstrated:
 * 1. Always use `@modelcontextprotocol/ext-apps` (`App`) rather than
 *    hand-writing `window.parent.postMessage` JSON-RPC plumbing.
 * 2. Register ALL handlers (`ontoolinput`, `ontoolresult`, `ontoolcancelled`,
 *    `onhostcontextchanged`) BEFORE calling `await app.connect()`.
 * 3. Apply host theme & CSS variables both right after `connect()` AND inside
 *    `onhostcontextchanged` so light/dark switches update live.
 * 4. Security: ZERO `innerHTML` usage. Every DOM node is built using
 *    `document.createElement`, `textContent`, and `replaceChildren`.
 */

import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";

const root = document.getElementById("root");
const app = new App({ name: "JSON & Regex Visualizer", version: "1.0.0" }, {});

let currentPayload = null;
let jsonFilter = "";
let jsonExpandOverride = null; // null = default depth, true = expand all, false = collapse all
let statusMessage = "";

/** Helper to create an element cleanly without innerHTML. */
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "className") {
      node.className = value;
    } else if (key === "textContent") {
      node.textContent = value;
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value !== undefined && value !== null) {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    if (typeof child === "string") {
      node.appendChild(document.createTextNode(child));
    } else {
      node.appendChild(child);
    }
  }
  return node;
}

function applyHostContext(ctx) {
  if (!ctx) return;
  if (ctx.theme) {
    applyDocumentTheme(ctx.theme);
  }
  if (ctx.styles && ctx.styles.variables) {
    applyHostStyleVariables(ctx.styles.variables);
  }
}

function showStatus(msg) {
  statusMessage = msg;
  render();
  if (msg) {
    window.setTimeout(() => {
      if (statusMessage === msg) {
        statusMessage = "";
        render();
      }
    }, 2500);
  }
}

async function copyText(text, label) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      showStatus(`Copied ${label}: ${text}`);
      return;
    }
  } catch {
    // Clipboard permission may be restricted inside sandboxed iframes.
  }
  showStatus(`${label}: ${text}`);
}

function matchesFilter(key, value, needle) {
  if (!needle) return false;
  const lower = needle.toLowerCase();
  if (key !== null && String(key).toLowerCase().includes(lower)) return true;
  if (value !== null && typeof value !== "object") {
    return String(value).toLowerCase().includes(lower);
  }
  return false;
}

function subtreeHasMatch(key, value, needle) {
  if (!needle) return true;
  if (matchesFilter(key, value, needle)) return true;
  if (Array.isArray(value)) {
    return value.some((item, i) => subtreeHasMatch(String(i), item, needle));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).some(([k, v]) => subtreeHasMatch(k, v, needle));
  }
  return false;
}

function buildJsonTree(key, value, jsonPath, depth, defaultExpandDepth) {
  const needle = jsonFilter.trim();
  if (needle && !subtreeHasMatch(key, value, needle)) {
    return null;
  }

  const isContainer = value !== null && typeof value === "object";
  const wrapper = el("div", {
    className: depth === 0 ? "tree-root" : "tree-node",
  });

  const line = el("div", {
    className: matchesFilter(key, value, needle)
      ? "tree-line matched"
      : "tree-line",
  });

  if (!isContainer) {
    line.appendChild(el("span", { className: "toggle-btn", textContent: "" }));
    if (key !== null) {
      line.appendChild(
        el("span", {
          className: "json-key",
          textContent: `${key}:`,
          title: `Click to copy path ${jsonPath}`,
          onClick: () => copyText(jsonPath, "JSONPath"),
        })
      );
    }

    let valClass = "json-null";
    let display = "null";
    if (typeof value === "string") {
      valClass = "json-string";
      display = JSON.stringify(value);
    } else if (typeof value === "number") {
      valClass = "json-number";
      display = String(value);
    } else if (typeof value === "boolean") {
      valClass = "json-boolean";
      display = String(value);
    }

    line.appendChild(
      el("span", {
        className: valClass,
        textContent: display,
        title: `Click to copy value`,
        onClick: () => copyText(display, "Value"),
      })
    );
    wrapper.appendChild(line);
    return wrapper;
  }

  const isArray = Array.isArray(value);
  const entries = isArray
    ? value.map((v, i) => [String(i), v])
    : Object.entries(value);

  let expanded =
    needle.length > 0
      ? true
      : jsonExpandOverride !== null
        ? jsonExpandOverride
        : depth < defaultExpandDepth;

  const childrenBox = el("div");
  const toggleBtn = el("button", {
    className: "toggle-btn",
    type: "button",
    "aria-label": expanded ? "Collapse node" : "Expand node",
    textContent: expanded ? "▼" : "▶",
  });

  function renderChildren() {
    childrenBox.replaceChildren();
    toggleBtn.textContent = expanded ? "▼" : "▶";
    toggleBtn.setAttribute(
      "aria-label",
      expanded ? "Collapse node" : "Expand node"
    );
    if (!expanded) return;
    for (const [childKey, childVal] of entries) {
      const childPath = isArray
        ? `${jsonPath}[${childKey}]`
        : /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(childKey)
          ? `${jsonPath}.${childKey}`
          : `${jsonPath}[${JSON.stringify(childKey)}]`;
      const childEl = buildJsonTree(
        childKey,
        childVal,
        childPath,
        depth + 1,
        defaultExpandDepth
      );
      if (childEl) childrenBox.appendChild(childEl);
    }
  }

  toggleBtn.addEventListener("click", () => {
    expanded = !expanded;
    renderChildren();
  });

  line.appendChild(toggleBtn);
  if (key !== null) {
    line.appendChild(
      el("span", {
        className: "json-key",
        textContent: `${key}:`,
        title: `Click to copy path ${jsonPath}`,
        onClick: () => copyText(jsonPath, "JSONPath"),
      })
    );
  }
  line.appendChild(
    el("span", {
      className: "json-meta",
      textContent: isArray
        ? `[${entries.length} item${entries.length === 1 ? "" : "s"}]`
        : `{${entries.length} key${entries.length === 1 ? "" : "s"}}`,
    })
  );

  wrapper.appendChild(line);
  renderChildren();
  wrapper.appendChild(childrenBox);
  return wrapper;
}

function renderJsonView(payload) {
  const stats = payload.stats || {};
  const header = el("div", { className: "header" }, [
    el("div", { className: "title-row" }, [
      el("span", { className: "badge", textContent: "JSON" }),
      el("h1", { className: "title", textContent: payload.title || "JSON Payload" }),
    ]),
    el("div", { className: "stats-bar" }, [
      el("span", { className: "stat-chip", textContent: `${payload.byteSize ?? 0} B` }),
      el("span", { className: "stat-chip", textContent: `depth ${stats.maxDepth ?? 0}` }),
      el("span", { className: "stat-chip", textContent: `${stats.totalKeys ?? 0} keys` }),
      el("span", { className: "stat-chip", textContent: `${stats.arrays ?? 0} arrays` }),
    ]),
  ]);

  const searchInput = el("input", {
    className: "input search-input",
    type: "search",
    placeholder: "Filter keys or values... (click any key to copy JSONPath)",
    value: jsonFilter,
  });
  searchInput.addEventListener("input", (event) => {
    jsonFilter = event.target.value;
    renderTreeOnly();
  });

  const toolbar = el("div", { className: "toolbar" }, [
    searchInput,
    el("button", {
      className: "btn",
      type: "button",
      textContent: "Expand All",
      onClick: () => {
        jsonExpandOverride = true;
        renderTreeOnly();
      },
    }),
    el("button", {
      className: "btn",
      type: "button",
      textContent: "Collapse",
      onClick: () => {
        jsonExpandOverride = false;
        renderTreeOnly();
      },
    }),
  ]);

  const treeContainer = el("div", { className: "tree-container" });

  function renderTreeOnly() {
    treeContainer.replaceChildren();
    const tree = buildJsonTree(
      null,
      payload.data,
      "$",
      0,
      payload.expandDepth ?? 2
    );
    if (tree) {
      treeContainer.appendChild(tree);
    } else {
      treeContainer.appendChild(
        el("div", {
          className: "loading-state",
          textContent: `No keys or values match "${jsonFilter}".`,
        })
      );
    }
  }

  renderTreeOnly();

  const items = [header, toolbar];
  if (statusMessage) {
    items.push(el("div", { className: "status-banner", textContent: statusMessage }));
  }
  items.push(treeContainer);
  return items;
}

function buildHighlightedText(sampleText, matches) {
  const container = el("div", { className: "highlight-box" });
  if (!matches || matches.length === 0) {
    container.textContent = sampleText;
    return container;
  }

  let cursor = 0;
  for (const m of matches) {
    if (m.start < cursor) continue;
    if (m.start > cursor) {
      container.appendChild(
        document.createTextNode(sampleText.slice(cursor, m.start))
      );
    }
    const matchedSlice = sampleText.slice(m.start, m.end);
    const mark = el("mark", {
      className: "regex-mark",
      title: `Match #${m.index} (${m.start}..${m.end})`,
      textContent: matchedSlice || "∅",
    });
    container.appendChild(mark);
    cursor = m.end;
  }
  if (cursor < sampleText.length) {
    container.appendChild(document.createTextNode(sampleText.slice(cursor)));
  }
  return container;
}

function renderRegexView(payload) {
  const caps = app.getHostCapabilities();
  const canCallTools = Boolean(caps && caps.serverTools);

  const header = el("div", { className: "header" }, [
    el("div", { className: "title-row" }, [
      el("span", { className: "badge", textContent: "Regex" }),
      el("h1", {
        className: "title",
        textContent: payload.title || "Python Regex Tester",
      }),
    ]),
    el("div", { className: "stats-bar" }, [
      el("span", {
        className: "stat-chip",
        textContent: `${payload.matchCount ?? 0} match${payload.matchCount === 1 ? "" : "es"}`,
      }),
      el("span", {
        className: "stat-chip",
        textContent: `${payload.groupCount ?? 0} group${payload.groupCount === 1 ? "" : "s"}`,
      }),
      el("span", {
        className: "stat-chip",
        textContent: `flags: /${payload.flags || "-"}/`,
      }),
    ]),
  ]);

  let draftPattern = payload.pattern || "";
  let draftFlags = payload.flags || "";
  const draftText = payload.sampleText || "";

  const patternInput = el("input", {
    className: "input",
    type: "text",
    value: draftPattern,
    placeholder: "Python regex pattern...",
    "aria-label": "Regular expression pattern",
  });
  patternInput.addEventListener("input", (e) => {
    draftPattern = e.target.value;
  });

  const flagNames = ["i", "m", "s", "x"];
  const flagsRow = el("div", { className: "flags-row" });

  async function reEvaluate() {
    if (!canCallTools) return;
    try {
      const res = await app.callServerTool({
        name: "app_test_regex",
        arguments: {
          pattern: draftPattern,
          sample_text: draftText,
          flags: draftFlags,
        },
      });
      if (res && res.structuredContent) {
        currentPayload = {
          ...res.structuredContent,
          title: payload.title || "Python Regex Tester",
        };
        render();
      }
    } catch {
      showStatus("Could not re-evaluate regex on server.");
    }
  }

  for (const flag of flagNames) {
    const active = draftFlags.includes(flag);
    const btn = el("button", {
      className: active ? "flag-btn active" : "flag-btn",
      type: "button",
      title: `Toggle flag '${flag}'`,
      textContent: flag,
      onClick: () => {
        draftFlags = draftFlags.includes(flag)
          ? draftFlags.replace(flag, "")
          : draftFlags + flag;
        reEvaluate();
      },
    });
    flagsRow.appendChild(btn);
  }

  const controls = el("div", { className: "regex-controls" }, [
    patternInput,
    flagsRow,
    canCallTools
      ? el("button", {
          className: "btn btn-primary",
          type: "button",
          textContent: "Re-test",
          onClick: reEvaluate,
        })
      : null,
  ]);

  patternInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      reEvaluate();
    }
  });

  const items = [header, controls];
  if (!payload.ok && payload.error) {
    items.push(el("div", { className: "error-banner", textContent: payload.error }));
    return items;
  }

  items.push(buildHighlightedText(draftText, payload.matches || []));

  if (payload.matches && payload.matches.length > 0) {
    const tbody = el("tbody");
    for (const m of payload.matches.slice(0, 50)) {
      const groupSummary =
        m.namedGroups && Object.keys(m.namedGroups).length > 0
          ? JSON.stringify(m.namedGroups)
          : m.groups && m.groups.length > 0
            ? JSON.stringify(m.groups)
            : "—";
      tbody.appendChild(
        el("tr", {}, [
          el("td", { textContent: `#${m.index}` }),
          el("td", { textContent: `${m.start}..${m.end}` }),
          el("td", { textContent: m.value }),
          el("td", { textContent: groupSummary }),
        ])
      );
    }
    const table = el("table", { className: "match-table" }, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", { textContent: "Match" }),
          el("th", { textContent: "Span" }),
          el("th", { textContent: "Text" }),
          el("th", { textContent: "Capture Groups" }),
        ]),
      ]),
      tbody,
    ]);
    items.push(table);
  }

  return items;
}

function render() {
  root.replaceChildren();
  if (!currentPayload) {
    root.appendChild(
      el("div", {
        className: "loading-state",
        textContent: "Waiting for tool result...",
      })
    );
    return;
  }

  if (currentPayload.mode === "json") {
    if (!currentPayload.ok) {
      root.appendChild(
        el("div", {
          className: "error-banner",
          textContent: currentPayload.error || "Failed to parse JSON.",
        })
      );
      return;
    }
    for (const node of renderJsonView(currentPayload)) {
      root.appendChild(node);
    }
  } else if (currentPayload.mode === "regex") {
    for (const node of renderRegexView(currentPayload)) {
      root.appendChild(node);
    }
  } else {
    root.appendChild(
      el("div", {
        className: "loading-state",
        textContent: "Unsupported tool result payload.",
      })
    );
  }
}

// 1. Register ALL notification handlers BEFORE calling app.connect().
app.ontoolinput = ({ arguments: args }) => {
  root.replaceChildren(
    el("div", {
      className: "loading-state",
      textContent: `Running tool${args && args.title ? ` (${args.title})` : ""}...`,
    })
  );
};

app.ontoolresult = (result) => {
  jsonFilter = "";
  jsonExpandOverride = null;
  if (result && result.structuredContent) {
    currentPayload = result.structuredContent;
  } else {
    currentPayload = {
      mode: "json",
      ok: false,
      error: "Tool did not return structuredContent.",
    };
  }
  render();
};

app.ontoolcancelled = ({ reason }) => {
  root.replaceChildren(
    el("div", {
      className: "error-banner",
      textContent: `Tool cancelled${reason ? `: ${reason}` : "."}`,
    })
  );
};

app.onhostcontextchanged = (ctx) => {
  applyHostContext(ctx);
};

// 2. Connect to the host over JSON-RPC / postMessage and apply initial theme.
app
  .connect()
  .then(() => {
    applyHostContext(app.getHostContext());
    render();
  })
  .catch(() => {
    root.replaceChildren(
      el("div", {
        className: "error-banner",
        textContent:
          "Unable to connect to an MCP Apps host. Open this HTML inside Antigravity or an MCP Apps host.",
      })
    );
  });
