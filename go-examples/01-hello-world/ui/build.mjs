/**
 * Bundles ui/app.js + @modelcontextprotocol/ext-apps into ../dist/app.html
 * so Go's `//go:embed dist/app.html` bakes the UI into the server binary.
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
    <title>Hello MCP App</title>
    <style>
      body {
        margin: 0;
        padding: 14px;
        background: var(--color-background-primary, #ffffff);
        color: var(--color-text-primary, #1f2328);
        font-family: var(--font-sans, system-ui, -apple-system, sans-serif);
      }
      .card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 14px;
        border-radius: 10px;
        background: var(--color-background-secondary, #f6f8fa);
        border: 1px solid var(--color-border-primary, #d0d7de);
      }
      h1 { margin: 0; font-size: 16px; }
      p { margin: 4px 0 0; font-size: 12px; color: var(--color-text-secondary, #57606a); }
      button {
        padding: 6px 12px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        border: 1px solid var(--color-border-info, #54aeff);
        background: var(--color-background-info, #ddf4ff);
        color: var(--color-text-info, #0969da);
      }
      button:disabled { opacity: 0.5; cursor: wait; }
    </style>
  </head>
  <body>
    <main class="card">
      <div>
        <h1 id="greeting">Connecting to MCP host...</h1>
        <p id="meta">Waiting for say_hello result</p>
      </div>
      <button id="refresh-btn" type="button">Ping Server Again</button>
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
