/**
 * Single-file HTML bundler for Example 1 (Vanilla JS + esbuild).
 *
 * Antigravity enforces a strict default-deny CSP (`default-src 'none'`), so
 * external `<script src>` or `<link rel="stylesheet">` tags are blocked.
 * This script bundles `@modelcontextprotocol/ext-apps` + `src/app.js` with
 * esbuild and inlines both CSS and JS into `../dist/app.html`.
 */
import * as esbuild from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "..", "dist");

await fs.mkdir(outDir, { recursive: true });

const jsResult = await esbuild.build({
  entryPoints: [path.join(__dirname, "src", "app.js")],
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2022"],
  write: false,
});

const bundledJs = jsResult.outputFiles[0].text;
const css = await fs.readFile(path.join(__dirname, "src", "styles.css"), "utf-8");
const template = await fs.readFile(path.join(__dirname, "template.html"), "utf-8");

// Prevent accidental `</script>` termination inside inlined JS.
const safeJs = bundledJs.replace(/<\/script>/gi, "<\\/script>");
const safeCss = css.replace(/<\/style>/gi, "<\\/style>");

const html = template
  .replace("/* __INLINE_CSS__ */", () => safeCss)
  .replace("/* __INLINE_JS__ */", () => safeJs);

const outFile = path.join(outDir, "app.html");
await fs.writeFile(outFile, html, "utf-8");

const sizeKb = (Buffer.byteLength(html, "utf-8") / 1024).toFixed(1);
console.log(`Built single-file MCP App bundle: ${outFile} (${sizeKb} KiB)`);
