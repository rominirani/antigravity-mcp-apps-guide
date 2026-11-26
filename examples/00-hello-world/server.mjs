/**
 * Example 0: The simplest complete MCP App ("Hello World").
 *
 * 1 UI resource (`ui://hello-world/app.html`) + 1 tool (`say_hello`).
 * Demonstrates inline rendering, `content` vs `structuredContent`, and
 * interactive UI-to-server callbacks via `app.callServerTool()`.
 */

import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const APP_URI = "ui://hello-world/app.html";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.join(__dirname, "dist", "app.html");

const server = new McpServer({ name: "hello-mcp-app", version: "1.0.0" });
let pingCount = 0;

// 1. Register the single-file HTML document as a `ui://` resource.
registerAppResource(
  server,
  "Hello World Card",
  APP_URI,
  {
    description: "Minimal inline greeting and server clock MCP App.",
    mimeType: RESOURCE_MIME_TYPE,
    _meta: { ui: { prefersBorder: true } },
  },
  async () => {
    const html = await fs.readFile(HTML_PATH, "utf-8");
    return {
      contents: [
        {
          uri: APP_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: html,
          _meta: { ui: { prefersBorder: true } },
        },
      ],
    };
  }
);

// 2. Register ONE tool and point `_meta.ui.resourceUri` at the resource above.
registerAppTool(
  server,
  "say_hello",
  {
    title: "Say Hello",
    description:
      "Greet someone by name and display an interactive inline greeting card with a live server clock.",
    inputSchema: z.object({
      name: z.string().max(80).optional().default("Developer"),
    }),
    _meta: {
      ui: { resourceUri: APP_URI },
    },
  },
  async ({ name }) => {
    pingCount += 1;
    const cleanName = name.trim() || "Developer";
    const serverTime = new Date().toISOString();
    const greeting = `Hello, ${cleanName}!`;

    return {
      // Plain-text `content` for the LLM and CLI fallback (e.g., `agy`)
      content: [
        {
          type: "text",
          text: `${greeting} (Server time: ${serverTime}, call #${pingCount})`,
        },
      ],
      // Structured JSON consumed by the sandboxed UI iframe (`ontoolresult`)
      structuredContent: {
        name: cleanName,
        greeting,
        serverTime,
        pingCount,
      },
    };
  }
);

await server.connect(new StdioServerTransport());
