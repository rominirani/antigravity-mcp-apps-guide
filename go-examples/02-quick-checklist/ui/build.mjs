/**
 * Bundles ui/app.js + @modelcontextprotocol/ext-apps into ../dist/app.html
 * for Go's `//go:embed dist/app.html`.
 */
import * as esbuild from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "..", "dist");
await fs.mkdir(outDir, { recursive: true });

const built = await esbuild.build({
  entryPoints: [path.join(__dirname, "app.js")],
  bundle: true,
  minify: true,
  format: "esm",
  target: ["es2022"],
  write: false,
});

const safeJs = built.outputFiles[0].text.replace(/<\/script>/gi, "<\\/script>");

const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />
    <title>Quick Checklist</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 12px;
        background: var(--color-background-primary, #ffffff);
        color: var(--color-text-primary, #1f2328);
        font-family: var(--font-sans, system-ui, -apple-system, sans-serif);
        font-size: 13px;
      }
      .shell { display: flex; flex-direction: column; gap: 10px; }
      .header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 8px;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--color-border-primary, #d0d7de);
      }
      h1 { margin: 0; font-size: 15px; }
      .progress {
        font-size: 12px;
        padding: 2px 8px;
        border-radius: 999px;
        background: var(--color-background-secondary, #f6f8fa);
        color: var(--color-text-secondary, #57606a);
        border: 1px solid var(--color-border-secondary, #e5e7eb);
      }
      .items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
      .item {
        padding: 6px 8px;
        border-radius: 6px;
        background: var(--color-background-secondary, #f6f8fa);
        border: 1px solid var(--color-border-secondary, #e5e7eb);
      }
      .item.done span {
        text-decoration: line-through;
        color: var(--color-text-tertiary, #6e7781);
      }
      .item-label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
      .row { display: flex; gap: 6px; flex-wrap: wrap; }
      input[type="text"] {
        flex: 1 1 180px;
        padding: 6px 8px;
        border-radius: 6px;
        border: 1px solid var(--color-border-primary, #d0d7de);
        background: var(--color-background-primary, #ffffff);
        color: var(--color-text-primary, #1f2328);
        font-size: 12px;
      }
      button {
        padding: 6px 10px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        border: 1px solid var(--color-border-primary, #d0d7de);
        background: var(--color-background-secondary, #f6f8fa);
        color: var(--color-text-primary, #1f2328);
      }
      button.primary {
        border-color: var(--color-border-info, #54aeff);
        background: var(--color-background-info, #ddf4ff);
        color: var(--color-text-info, #0969da);
      }
      .status {
        font-size: 12px;
        padding: 6px 8px;
        border-radius: 6px;
        background: var(--color-background-success, #dafbe1);
        color: var(--color-text-success, #1a7f37);
        border: 1px solid var(--color-border-success, #4ac26b);
      }
      .status.error {
        background: var(--color-background-danger, #ffebe9);
        color: var(--color-text-danger, #cf222e);
        border-color: var(--color-border-danger, #ff8182);
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <header class="header">
        <h1 id="title">Connecting to MCP host...</h1>
        <span id="progress" class="progress"></span>
      </header>
      <ul id="items" class="items"></ul>
      <form id="add-form" class="row">
        <input id="new-item-input" type="text" placeholder="Add a checklist item..." maxlength="200" />
        <button type="submit" class="primary">Add</button>
      </form>
      <div class="row">
        <button id="attach-btn" type="button">Attach Remaining Items to Prompt</button>
        <button id="clear-ctx-btn" type="button" hidden>Clear Context</button>
      </div>
      <div id="status" class="status" hidden></div>
    </main>
    <script type="module">${safeJs}</script>
  </body>
</html>
`;

const outFile = path.join(outDir, "app.html");
await fs.writeFile(outFile, html, "utf-8");
console.log(
  `Built ${outFile} (${(Buffer.byteLength(html, "utf-8") / 1024).toFixed(1)} KiB)`
);
