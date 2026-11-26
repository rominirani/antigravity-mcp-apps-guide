/**
 * Example 3: Live Repo Architecture & File Reviewer MCP Server (TypeScript v2).
 *
 * Antigravity MCP App power extensions demonstrated:
 * 1. `aux_pane` + `global` entrypoints (`scan_repository`) for interactive
 *    architecture exploration & repeat in-place agent updates.
 * 2. Separate host-invoked Custom File Viewer (`open_archmap_file`) using
 *    `{ type: "file", extensions: [".archmap"] }` (unconditionally hidden from
 *    the model; receives `antigravity-file://` opaque resourceUri).
 * 3. App-only tools (`visibility: ["app"]`) for on-demand file snippets
 *    (keeping trajectory results well under 1 MiB) and eager review note
 *    persistence in `${PLUGIN_DATA}`.
 * 4. Explicit `_meta.ui.csp` and `prefersBorder` declarations on UI resources.
 */
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE, } from "@modelcontextprotocol/ext-apps/server";
import { McpServer, } from "@modelcontextprotocol/server";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { RepoScanner } from "./scanner.js";
export const REVIEWER_URI = "ui://repo-architecture-reviewer/reviewer.html";
export const ARCHMAP_URI = "ui://repo-architecture-reviewer/archmap-viewer.html";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
async function readUiBundle(envOverrideKey, defaultFileName) {
    const override = process.env[envOverrideKey];
    const filePath = override && override.endsWith(".html")
        ? path.resolve(override)
        : path.join(PROJECT_ROOT, "dist", defaultFileName);
    return fs.readFile(filePath, "utf-8");
}
export function createServer() {
    const dataDir = process.env.PLUGIN_DATA || path.join(PROJECT_ROOT, ".plugin-data");
    const scanner = new RepoScanner(dataDir, process.cwd());
    const server = new McpServer({
        name: "repo-architecture-reviewer",
        version: "1.0.0",
    });
    // Resource 1: Main Repo Architecture Reviewer UI (explicit strict CSP).
    registerAppResource(server, "Repo Architecture Reviewer UI", REVIEWER_URI, {
        description: "Interactive dependency graph, file complexity table, side-pane file opener, and background review launcher.",
        mimeType: RESOURCE_MIME_TYPE,
        _meta: {
            ui: {
                prefersBorder: false,
                csp: {
                    connectDomains: [],
                    resourceDomains: [],
                },
            },
        },
    }, async () => ({
        contents: [
            {
                uri: REVIEWER_URI,
                mimeType: RESOURCE_MIME_TYPE,
                text: await readUiBundle("REPO_REVIEWER_APP_HTML", "reviewer.html"),
                _meta: {
                    ui: {
                        prefersBorder: false,
                        csp: {
                            connectDomains: [],
                            resourceDomains: [],
                        },
                    },
                },
            },
        ],
    }));
    // Resource 2: Custom `.archmap` File Viewer & Editor UI.
    registerAppResource(server, "Architecture Map File Viewer UI", ARCHMAP_URI, {
        description: "Custom Antigravity file viewer and editor for .archmap JSON architecture topology files.",
        mimeType: RESOURCE_MIME_TYPE,
        _meta: {
            ui: {
                prefersBorder: false,
            },
        },
    }, async () => ({
        contents: [
            {
                uri: ARCHMAP_URI,
                mimeType: RESOURCE_MIME_TYPE,
                text: await readUiBundle("ARCHMAP_VIEWER_APP_HTML", "archmap-viewer.html"),
                _meta: {
                    ui: {
                        prefersBorder: false,
                    },
                },
            },
        ],
    }));
    // Tool 1: Main scanner with `aux_pane` + `global` entrypoints.
    // All arguments optional so empty `{}` menu/sidebar launches work seamlessly.
    registerAppTool(server, "scan_repository", {
        title: "Repo Architecture Reviewer",
        description: "Scan a workspace directory to build an interactive module dependency graph, " +
            "compute complexity hotspots, open workspace files in the side pane, and launch " +
            "isolated background review conversations. Calling again updates the open side pane in place.",
        inputSchema: z.object({
            target_dir: z
                .string()
                .optional()
                .describe("Optional path to scan (defaults to current working directory)."),
            focus_file: z
                .string()
                .optional()
                .describe("Optional relative file path to pre-select in the viewer."),
        }),
        _meta: {
            ui: {
                resourceUri: REVIEWER_URI,
            },
            "com.google.antigravity/ui": {
                entrypoints: [
                    { type: "aux_pane", title: "Architecture Reviewer" },
                    { type: "global", title: "Architecture Reviewer" },
                ],
            },
        },
    }, async (args) => {
        try {
            const scan = await scanner.scanWorkspace(args.target_dir);
            const topHotspots = scan.files.slice(0, 5);
            const textLines = [
                `Architecture Scan: ${scan.workspaceRoot}`,
                `- Files scanned: ${scan.totalFiles}${scan.truncated ? " (capped at 120)" : ""} | Total lines: ${scan.totalLines.toLocaleString()} | Internal edges: ${scan.edges.length}`,
                "- Top complexity hotspots:",
                ...topHotspots.map((f) => `  * ${f.relativePath} (score=${f.complexityScore}, lines=${f.lines}, imports=${f.imports.length})`),
            ];
            return {
                content: [{ type: "text", text: textLines.join("\n") }],
                structuredContent: {
                    ...scan,
                    focusFile: args.focus_file ?? topHotspots[0]?.relativePath ?? null,
                },
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : "Failed to scan repository.";
            return {
                isError: true,
                content: [{ type: "text", text: `Scan error: ${message}` }],
                structuredContent: { error: message },
            };
        }
    });
    // Tool 2: Separate host-invoked Custom File Viewer for `.archmap` files.
    // Always hidden from the model regardless of `visibility`.
    registerAppTool(server, "open_archmap_file", {
        title: "Architecture Map Viewer",
        description: "Host-invoked custom file viewer for .archmap architecture topology files.",
        inputSchema: z.object({
            file: z
                .object({
                name: z.string(),
                resourceUri: z.string(),
            })
                .optional(),
        }),
        _meta: {
            ui: {
                resourceUri: ARCHMAP_URI,
            },
            "com.google.antigravity/ui": {
                entrypoints: [
                    {
                        type: "file",
                        title: "Architecture Map Viewer",
                        extensions: [".archmap"],
                    },
                ],
            },
        },
    }, async (args) => {
        const fileInfo = args.file ?? {
            name: "untitled.archmap",
            resourceUri: "",
        };
        return {
            content: [
                {
                    type: "text",
                    text: `Opened architecture map viewer for ${fileInfo.name}.`,
                },
            ],
            structuredContent: {
                file: fileInfo,
            },
        };
    });
    // Tool 3 (App-Only): Fetch code snippet on demand (keeps trajectory result small).
    registerAppTool(server, "app_get_file_snippet", {
        title: "Read File Snippet (App Only)",
        description: "Read up to 120 lines of a scanned workspace file for inline preview.",
        inputSchema: z.object({
            workspace_root: z.string().min(1),
            relative_path: z.string().min(1),
        }),
        _meta: {
            ui: {
                visibility: ["app"],
            },
        },
    }, async ({ workspace_root, relative_path }) => {
        try {
            const data = await scanner.readFileSnippet(workspace_root, relative_path);
            return {
                content: [
                    {
                        type: "text",
                        text: `Loaded ${data.relativePath} (${data.lines} lines).`,
                    },
                ],
                structuredContent: { ...data },
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : "Failed to load file snippet.";
            return {
                isError: true,
                content: [{ type: "text", text: message }],
                structuredContent: { error: message },
            };
        }
    });
    // Tool 4 (App-Only): Eagerly persist a review note to `${PLUGIN_DATA}`.
    registerAppTool(server, "app_save_review_note", {
        title: "Save Review Note (App Only)",
        description: "Persist a review status and note for a file under ${PLUGIN_DATA}.",
        inputSchema: z.object({
            workspace_key: z.string().regex(/^[a-f0-9]{16}$/),
            relative_path: z.string().min(1),
            status: z.enum(["unreviewed", "approved", "needs_changes"]),
            note: z.string().max(1000),
        }),
        _meta: {
            ui: {
                visibility: ["app"],
            },
        },
    }, async ({ workspace_key, relative_path, status, note }) => {
        try {
            const notes = await scanner.saveNote(workspace_key, relative_path, status, note);
            return {
                content: [
                    {
                        type: "text",
                        text: `Saved review status (${status}) for ${relative_path}.`,
                    },
                ],
                structuredContent: { notes },
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : "Failed to save review note.";
            return {
                isError: true,
                content: [{ type: "text", text: message }],
                structuredContent: { error: message },
            };
        }
    });
    return server;
}
