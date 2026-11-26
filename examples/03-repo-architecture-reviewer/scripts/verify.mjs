import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, "..");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "dist", "server", "index.js")],
  env: {
    ...process.env,
    PLUGIN_DATA: path.join(projectDir, ".verify-plugin-data"),
  },
});

const client = new Client({ name: "verify-ex3", version: "1.0.0" });
await client.connect(transport);

try {
  const { tools } = await client.listTools();
  console.log("=== TOOLS ===");
  for (const t of tools) {
    console.log(`- ${t.name}: _meta=${JSON.stringify(t._meta)}`);
  }

  const scanTool = tools.find((t) => t.name === "scan_repository");
  const fileTool = tools.find((t) => t.name === "open_archmap_file");
  assert.ok(scanTool?._meta?.["com.google.antigravity/ui"]);
  assert.deepEqual(
    fileTool?._meta?.["com.google.antigravity/ui"]?.entrypoints?.[0]?.extensions,
    [".archmap"]
  );

  // Verify BOTH single-file HTML bundles
  for (const uri of [
    "ui://repo-architecture-reviewer/reviewer.html",
    "ui://repo-architecture-reviewer/archmap-viewer.html",
  ]) {
    const res = await client.readResource({ uri });
    const html = res.contents[0];
    assert.equal(html.mimeType, "text/html;profile=mcp-app");
    assert.ok("text" in html && html.text.length > 5000);
    console.log(
      `=== RESOURCE ${uri} ===\nmimeType=${html.mimeType} | size=${html.text.length.toLocaleString()} bytes | csp=${JSON.stringify(html._meta?.ui?.csp ?? null)}`
    );
  }

  // 1. Test empty `{}` entrypoint launch scanning this directory
  const scanRes = await client.callTool({
    name: "scan_repository",
    arguments: { target_dir: projectDir },
  });
  console.log("\n=== scan_repository ===");
  console.log(scanRes.content[0].text);
  const scanData = scanRes.structuredContent;
  assert.ok(scanData.totalFiles >= 5);
  assert.ok(scanData.edges.length >= 2);

  // 2. Test app-only file snippet loader
  const firstFile = scanData.files[0];
  const snippetRes = await client.callTool({
    name: "app_get_file_snippet",
    arguments: {
      workspace_root: scanData.workspaceRoot,
      relative_path: firstFile.relativePath,
    },
  });
  console.log(`\n=== app_get_file_snippet (${firstFile.relativePath}) ===`);
  console.log(snippetRes.content[0].text);
  assert.ok(snippetRes.structuredContent.snippet.length > 0);

  // 3. Test path traversal defense on app_get_file_snippet
  const blocked = await client.callTool({
    name: "app_get_file_snippet",
    arguments: {
      workspace_root: scanData.workspaceRoot,
      relative_path: "../../etc/passwd",
    },
  });
  console.log("\n=== Path traversal guard ===");
  console.log(`isError=${blocked.isError} | message=${blocked.content[0].text}`);
  assert.equal(blocked.isError, true);

  // 4. Test eager review note persistence in PLUGIN_DATA
  const savedNote = await client.callTool({
    name: "app_save_review_note",
    arguments: {
      workspace_key: scanData.workspaceKey,
      relative_path: firstFile.relativePath,
      status: "approved",
      note: "Clean separation between MCP server and React UI.",
    },
  });
  assert.equal(
    savedNote.structuredContent.notes[firstFile.relativePath].status,
    "approved"
  );

  // 5. Test host-invoked custom file viewer tool payload
  const archRes = await client.callTool({
    name: "open_archmap_file",
    arguments: {
      file: {
        name: "sample.archmap",
        resourceUri: "antigravity-file://demo-uuid/sample.archmap",
      },
    },
  });
  console.log("\n=== open_archmap_file ===");
  console.log(archRes.content[0].text);
  assert.equal(
    archRes.structuredContent.file.resourceUri,
    "antigravity-file://demo-uuid/sample.archmap"
  );

  console.log("\nALL EXAMPLE 3 CHECKS PASSED!");
} finally {
  await client.close();
}
