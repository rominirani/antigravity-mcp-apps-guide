import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(__dirname, "server.mjs")],
});

const client = new Client({ name: "verify-hello", version: "1.0.0" });
await client.connect(transport);

try {
  const { tools } = await client.listTools();
  console.log("=== TOOLS ===");
  for (const t of tools) {
    console.log(`- ${t.name}: _meta=${JSON.stringify(t._meta)}`);
  }
  assert.equal(tools[0]._meta?.ui?.resourceUri, "ui://hello-world/app.html");

  const res = await client.readResource({ uri: "ui://hello-world/app.html" });
  const html = res.contents[0];
  assert.equal(html.mimeType, "text/html;profile=mcp-app");
  console.log(
    `=== RESOURCE ===\nmimeType=${html.mimeType} | size=${html.text.length.toLocaleString()} bytes`
  );

  const first = await client.callTool({
    name: "say_hello",
    arguments: { name: "Ada" },
  });
  console.log("\n=== Call #1 (from agent) ===");
  console.log(first.content[0].text);
  assert.equal(first.structuredContent.pingCount, 1);

  const second = await client.callTool({
    name: "say_hello",
    arguments: { name: "Ada" },
  });
  console.log("=== Call #2 (simulating 'Ping Server Again' button click) ===");
  console.log(second.content[0].text);
  assert.equal(second.structuredContent.pingCount, 2);

  console.log("\nALL EXAMPLE 0 CHECKS PASSED!");
} finally {
  await client.close();
}
