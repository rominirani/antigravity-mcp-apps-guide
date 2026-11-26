/**
 * Example 2: Interactive SQLite & CSV Data Explorer MCP Server (TypeScript v2).
 *
 * Antigravity MCP App capabilities demonstrated:
 * - Side Panel (`aux_pane`) + Full Page (`global`) entrypoints under
 *   `_meta["com.google.antigravity/ui"]`.
 * - Empty `{}` entrypoint launch support (boots with built-in sample SQLite DB).
 * - App-only tools (`visibility: ["app"]`) for interactive read-only SQL
 *   execution, pagination (bypassing the 1 MiB trajectory result cap), and
 *   eager bookmark persistence in `${PLUGIN_DATA}`.
 * - Fast UI hot-reload override via `SQLITE_EXPLORER_APP_HTML`.
 */

import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import {
  McpServer,
  type CallToolResult,
  type ReadResourceResult,
} from "@modelcontextprotocol/server";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ExplorerEngine } from "./db.js";

export const APP_URI = "ui://sqlite-csv-explorer/app.html";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_HTML_PATH = path.join(PROJECT_ROOT, "dist", "app.html");

export function createServer(): McpServer {
  const dataDir =
    process.env.PLUGIN_DATA || path.join(PROJECT_ROOT, ".plugin-data");
  const allowedRoots = Array.from(
    new Set([process.cwd(), PROJECT_ROOT, ...(process.env.PLUGIN_ROOT ? [process.env.PLUGIN_ROOT] : [])])
  );
  const engine = new ExplorerEngine(dataDir, allowedRoots);

  const server = new McpServer({
    name: "sqlite-csv-explorer",
    version: "1.0.0",
  });

  // 1. Register the self-contained HTML UI resource.
  registerAppResource(
    server,
    "SQLite & CSV Explorer UI",
    APP_URI,
    {
      description:
        "Interactive read-only SQLite and CSV query workbench with pagination, saved queries, and model context attachment.",
      mimeType: RESOURCE_MIME_TYPE,
      _meta: {
        ui: {
          prefersBorder: false,
        },
      },
    },
    async (): Promise<ReadResourceResult> => {
      const override = process.env.SQLITE_EXPLORER_APP_HTML;
      const htmlPath =
        override && override.endsWith(".html")
          ? path.resolve(override)
          : DEFAULT_HTML_PATH;
      const html = await fs.readFile(htmlPath, "utf-8");
      return {
        contents: [
          {
            uri: APP_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            _meta: {
              ui: {
                prefersBorder: false,
              },
            },
          },
        ],
      };
    }
  );

  // 2. Primary tool: Side Pane (`aux_pane`) + Full Page (`global`) entrypoints.
  //    Every argument is optional because manual launches pass `{}`.
  registerAppTool(
    server,
    "explore_data",
    {
      title: "SQLite & CSV Explorer",
      description:
        "Open the interactive SQLite & CSV Data Explorer in the side panel or full page. " +
        "Optionally load a workspace .csv, .sqlite, or .db file and run an initial read-only SQL query. " +
        "Calling with empty arguments `{}` opens the built-in DevOps Services & Incidents sample database.",
      inputSchema: z.object({
        source_path: z
          .string()
          .optional()
          .describe("Optional relative or workspace path to a .csv, .sqlite, or .db file."),
        initial_sql: z
          .string()
          .optional()
          .describe("Optional read-only SELECT query to run immediately on load."),
        title: z
          .string()
          .optional()
          .describe("Optional custom heading shown in the explorer header."),
      }),
      _meta: {
        ui: {
          resourceUri: APP_URI,
        },
        "com.google.antigravity/ui": {
          entrypoints: [
            { type: "aux_pane", title: "SQLite & CSV Explorer" },
            { type: "global", title: "SQLite & CSV Explorer" },
          ],
        },
      },
    },
    async (args): Promise<CallToolResult> => {
      try {
        const dataset = args.source_path
          ? await engine.loadFromFile(args.source_path)
          : await engine.loadBuiltIn();

        const sqlToRun = args.initial_sql?.trim() || dataset.defaultSql;
        const pageResult = await engine.runQuery(sqlToRun, 1, 25);
        const bookmarks = await engine.listBookmarks();

        const tableSummary = dataset.tables
          .map((t) => `${t.name} (${t.rowCount} rows)`)
          .join(", ");

        const textLines = [
          `Opened ${args.title || dataset.label}`,
          `Tables: ${tableSummary}`,
          `Initial query (${pageResult.durationMs} ms): ${pageResult.totalRows} total rows (showing ${pageResult.rows.length})`,
          `SQL: ${pageResult.sql}`,
        ];

        return {
          content: [{ type: "text", text: textLines.join("\n") }],
          structuredContent: {
            title: args.title || dataset.label,
            dataset,
            initialResult: pageResult,
            bookmarks,
          },
        };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to initialize explorer.";
        return {
          isError: true,
          content: [{ type: "text", text: `Explorer error: ${message}` }],
          structuredContent: { error: message },
        };
      }
    }
  );

  // 3. App-only tool: Run paginated read-only SQL queries.
  //    Hidden from the model (`visibility: ["app"]`) and bypasses the 1 MiB
  //    trajectory step limit for large datasets.
  registerAppTool(
    server,
    "app_run_query",
    {
      title: "Run Paginated Query (App Only)",
      description:
        "Execute a read-only SELECT query with server-side pagination from the Explorer UI.",
      inputSchema: z.object({
        sql: z.string().min(1),
        page: z.number().int().min(1).optional().default(1),
        pageSize: z.number().int().min(1).max(100).optional().default(25),
      }),
      _meta: {
        ui: {
          visibility: ["app"],
        },
      },
    },
    async ({ sql, page, pageSize }): Promise<CallToolResult> => {
      try {
        const pageResult = await engine.runQuery(sql, page, pageSize);
        return {
          content: [
            {
              type: "text",
              text: `Returned ${pageResult.rows.length} of ${pageResult.totalRows} rows in ${pageResult.durationMs} ms.`,
            },
          ],
          structuredContent: { ...pageResult },
        };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "SQL execution failed.";
        return {
          isError: true,
          content: [{ type: "text", text: message }],
          structuredContent: { error: message },
        };
      }
    }
  );

  // 4. App-only tool: Eagerly save a SQL bookmark into `${PLUGIN_DATA}`.
  registerAppTool(
    server,
    "app_save_bookmark",
    {
      title: "Save SQL Bookmark (App Only)",
      description: "Persist a named read-only SQL bookmark to ${PLUGIN_DATA}.",
      inputSchema: z.object({
        name: z.string().min(1).max(80),
        sql: z.string().min(1),
      }),
      _meta: {
        ui: {
          visibility: ["app"],
        },
      },
    },
    async ({ name, sql }): Promise<CallToolResult> => {
      try {
        const bookmarks = await engine.saveBookmark(name, sql);
        return {
          content: [{ type: "text", text: `Saved bookmark "${name}".` }],
          structuredContent: { bookmarks },
        };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to save bookmark.";
        return {
          isError: true,
          content: [{ type: "text", text: message }],
          structuredContent: { error: message },
        };
      }
    }
  );

  // 5. App-only tool: Delete a saved SQL bookmark from `${PLUGIN_DATA}`.
  registerAppTool(
    server,
    "app_delete_bookmark",
    {
      title: "Delete SQL Bookmark (App Only)",
      description: "Delete a saved SQL bookmark by ID.",
      inputSchema: z.object({
        id: z.string().min(1),
      }),
      _meta: {
        ui: {
          visibility: ["app"],
        },
      },
    },
    async ({ id }): Promise<CallToolResult> => {
      const bookmarks = await engine.deleteBookmark(id);
      return {
        content: [{ type: "text", text: `Deleted bookmark ${id}.` }],
        structuredContent: { bookmarks },
      };
    }
  );

  return server;
}
