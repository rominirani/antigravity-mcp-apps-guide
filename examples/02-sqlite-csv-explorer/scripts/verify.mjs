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

const client = new Client({ name: "verify-ex2", version: "1.0.0" });
await client.connect(transport);

try {
  const { tools } = await client.listTools();
  console.log("=== TOOLS ===");
  for (const t of tools) {
    console.log(`- ${t.name}: _meta=${JSON.stringify(t._meta)}`);
  }

  const exploreTool = tools.find((t) => t.name === "explore_data");
  assert.ok(exploreTool?._meta?.["com.google.antigravity/ui"]);

  const res = await client.readResource({
    uri: "ui://sqlite-csv-explorer/app.html",
  });
  const html = res.contents[0];
  assert.equal(html.mimeType, "text/html;profile=mcp-app");
  assert.ok("text" in html && html.text.length > 5000);
  console.log(
    `\n=== UI RESOURCE ===\nmimeType=${html.mimeType} | size=${html.text.length.toLocaleString()} bytes`
  );

  // 1. Test empty `{}` entrypoint launch (manual menu / sidebar launch).
  const emptyLaunch = await client.callTool({ name: "explore_data", arguments: {} });
  console.log("\n=== explore_data({}) ===");
  console.log(emptyLaunch.content[0].text);
  assert.equal(emptyLaunch.structuredContent.dataset.tables.length, 3);

  // 2. Test app-only paginated query tool.
  const page1 = await client.callTool({
    name: "app_run_query",
    arguments: {
      sql: "SELECT deploy_id, version, status FROM deployments ORDER BY deploy_id",
      page: 1,
      pageSize: 10,
    },
  });
  console.log("\n=== app_run_query (page 1/4) ===");
  console.log(page1.content[0].text);
  assert.equal(page1.structuredContent.rows.length, 10);
  assert.equal(page1.structuredContent.totalRows, 32);
  assert.equal(page1.structuredContent.hasMore, true);

  // 3. Test SQL write injection defense (MUST fail closed).
  const blocked = await client.callTool({
    name: "app_run_query",
    arguments: { sql: "DROP TABLE services;" },
  });
  console.log("\n=== SQL security guard (DROP TABLE) ===");
  console.log(`isError=${blocked.isError} | message=${blocked.content[0].text}`);
  assert.equal(blocked.isError, true);

  // 4. Test CSV loading from workspace file.
  const csvLaunch = await client.callTool({
    name: "explore_data",
    arguments: { source_path: path.join(projectDir, "sample-metrics.csv") },
  });
  console.log("\n=== explore_data(sample-metrics.csv) ===");
  console.log(csvLaunch.content[0].text);
  assert.equal(csvLaunch.structuredContent.initialResult.totalRows, 8);

  // 5. Test eager bookmark persistence in PLUGIN_DATA.
  const saved = await client.callTool({
    name: "app_save_bookmark",
    arguments: {
      name: "High Latency Check",
      sql: "SELECT * FROM sample_metrics WHERE p95_ms > 100",
    },
  });
  assert.ok(saved.structuredContent.bookmarks.some((b) => b.name === "High Latency Check"));

  console.log("\nALL EXAMPLE 2 CHECKS PASSED!");
} finally {
  await client.close();
}
