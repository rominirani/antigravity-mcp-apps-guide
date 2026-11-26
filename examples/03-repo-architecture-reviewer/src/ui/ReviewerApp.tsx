import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";

interface ScannedFile {
  relativePath: string;
  fileUri: string;
  extension: string;
  lines: number;
  bytes: number;
  imports: string[];
  complexityScore: number;
  group: string;
}

interface DependencyEdge {
  from: string;
  to: string;
}

interface ReviewNote {
  status: "unreviewed" | "approved" | "needs_changes";
  note: string;
  updatedAt: string;
}

interface RepoScanPayload {
  workspaceRoot?: string;
  workspaceKey?: string;
  scannedAt?: string;
  totalFiles?: number;
  totalLines?: number;
  truncated?: boolean;
  files?: ScannedFile[];
  edges?: DependencyEdge[];
  notes?: Record<string, ReviewNote>;
  focusFile?: string | null;
  error?: string;
}

interface FileSnippetPayload {
  relativePath?: string;
  lines?: number;
  snippet?: string;
  truncated?: boolean;
  error?: string;
}

const GenericActionResponseSchema = z
  .object({
    isError: z.boolean().optional(),
  })
  .passthrough();

const BackgroundMessageResponseSchema = z
  .object({
    isError: z.boolean().optional(),
    _meta: z
      .object({
        "com.google.antigravity/message": z
          .object({
            conversationId: z.string().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export function ReviewerApp() {
  const [hostContext, setHostContext] = useState<McpUiHostContext | null>(null);
  const [scan, setScan] = useState<RepoScanPayload | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [filterText, setFilterText] = useState("");
  const [snippet, setSnippet] = useState<FileSnippetPayload | null>(null);
  const [notes, setNotes] = useState<Record<string, ReviewNote>>({});
  const [draftStatus, setDraftStatus] =
    useState<ReviewNote["status"]>("unreviewed");
  const [draftNote, setDraftNote] = useState("");
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [lastBgConversationId, setLastBgConversationId] = useState<string | null>(
    null
  );

  const { app, isConnected, error } = useApp({
    appInfo: { name: "Repo Architecture Reviewer", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (instance) => {
      instance.ontoolinput = () => {
        setErrorBanner(null);
      };
      instance.ontoolresult = (result) => {
        const payload = (result.structuredContent ?? {}) as RepoScanPayload;
        if (payload.error) {
          setErrorBanner(payload.error);
          return;
        }
        setScan(payload);
        setNotes(payload.notes ?? {});
        const initialFile =
          payload.focusFile ?? payload.files?.[0]?.relativePath ?? null;
        setSelectedPath(initialFile);
        setSnippet(null);
        setErrorBanner(null);
      };
      instance.onhostcontextchanged = (ctx) => {
        setHostContext((prev) => ({ ...(prev ?? {}), ...ctx }));
      };
    },
  });

  useEffect(() => {
    if (app && isConnected) {
      setHostContext(app.getHostContext() ?? null);
    }
  }, [app, isConnected]);

  useHostStyles(app, hostContext);

  const caps = app?.getHostCapabilities();
  const canCallTools = Boolean(caps?.serverTools);
  const canSendMessage = Boolean(caps?.message);
  const canOpenLinks = Boolean(caps?.openLinks);

  const files = scan?.files ?? [];
  const edges = scan?.edges ?? [];

  const filteredFiles = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return files;
    return files.filter(
      (f) =>
        f.relativePath.toLowerCase().includes(q) ||
        f.group.toLowerCase().includes(q)
    );
  }, [files, filterText]);

  const selectedFile = useMemo(
    () => files.find((f) => f.relativePath === selectedPath) ?? null,
    [files, selectedPath]
  );

  // Sync draft editor when user clicks a different file.
  useEffect(() => {
    if (!selectedPath) return;
    const existing = notes[selectedPath];
    setDraftStatus(existing?.status ?? "unreviewed");
    setDraftNote(existing?.note ?? "");
    setSnippet(null);
  }, [selectedPath, notes]);

  // Antigravity Extension #1: Open local file directly in Antigravity's side pane.
  const handleOpenInSidePane = useCallback(
    async (file: ScannedFile) => {
      if (!app) return;
      setErrorBanner(null);
      try {
        const res = await app.request(
          {
            method: "com.google.antigravity/toggle-aux-pane",
            params: { tabType: "fileView", uri: file.fileUri },
          },
          GenericActionResponseSchema
        );
        if (res.isError) {
          setStatusBanner(
            "Side-pane file view is unavailable on this surface (e.g., Global view). Use Preview Snippet below instead."
          );
        } else {
          setStatusBanner(`Opened ${file.relativePath} in Antigravity side pane.`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("-32601") || msg.toLowerCase().includes("method not found")) {
          setStatusBanner(
            "This MCP host does not implement com.google.antigravity/toggle-aux-pane (-32601). Falling back to inline snippet."
          );
        } else {
          setErrorBanner(`Could not open file in side pane: ${msg}`);
        }
      }
    },
    [app]
  );

  // App-only tool: load code snippet on demand (avoids exceeding 1 MiB trajectory cap).
  const handleLoadSnippet = useCallback(
    async (file: ScannedFile) => {
      if (!app || !canCallTools || !scan?.workspaceRoot) return;
      setErrorBanner(null);
      try {
        const res = await app.callServerTool({
          name: "app_get_file_snippet",
          arguments: {
            workspace_root: scan.workspaceRoot,
            relative_path: file.relativePath,
          },
        });
        const data = (res.structuredContent ?? {}) as FileSnippetPayload;
        if (res.isError || data.error) {
          setErrorBanner(data.error || "Could not load snippet.");
          return;
        }
        setSnippet(data);
      } catch (err) {
        setErrorBanner(
          err instanceof Error ? err.message : "Failed to load file snippet."
        );
      }
    },
    [app, canCallTools, scan?.workspaceRoot]
  );

  // App-only tool: eagerly persist review notes (Antigravity never sends teardown).
  const handleSaveNote = useCallback(async () => {
    if (!app || !canCallTools || !scan?.workspaceKey || !selectedFile) return;
    setErrorBanner(null);
    try {
      const res = await app.callServerTool({
        name: "app_save_review_note",
        arguments: {
          workspace_key: scan.workspaceKey,
          relative_path: selectedFile.relativePath,
          status: draftStatus,
          note: draftNote,
        },
      });
      const data = (res.structuredContent ?? {}) as {
        notes?: Record<string, ReviewNote>;
        error?: string;
      };
      if (res.isError || data.error) {
        setErrorBanner(data.error || "Failed to save note.");
        return;
      }
      if (data.notes) setNotes(data.notes);
      setStatusBanner(
        `Saved review note for ${selectedFile.relativePath} to \${PLUGIN_DATA}.`
      );
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : "Failed to save note."
      );
    }
  }, [app, canCallTools, draftNote, draftStatus, scan?.workspaceKey, selectedFile]);

  // Antigravity Extension #2: Start a new background review conversation in the same project.
  const handleSpawnBackgroundReview = useCallback(
    async (file: ScannedFile) => {
      if (!app || !canSendMessage) return;
      setErrorBanner(null);
      const reviewPrompt = [
        `Perform a focused architecture and security review of \`${file.relativePath}\`.`,
        `Metrics from Repo Architecture Reviewer: ${file.lines} lines, ${file.imports.length} imports, complexity score ${file.complexityScore}.`,
        draftNote.trim() ? `Reviewer note: ${draftNote.trim()}` : "",
        "Identify coupling smells, boundary violations, and concrete refactor steps.",
      ]
        .filter(Boolean)
        .join("\n\n");

      try {
        // Use app.request("ui/message", ...) so Antigravity's `_meta` extension
        // passes cleanly under strict TypeScript (ext-apps v2 omits `_meta` on
        // the typed `sendMessage` params signature).
        const res = await app.request(
          {
            method: "ui/message",
            params: {
              role: "user",
              content: [{ type: "text", text: reviewPrompt }],
              _meta: {
                "com.google.antigravity/message": {
                  target: "new",
                },
              },
            },
          },
          BackgroundMessageResponseSchema
        );
        if (res.isError) {
          setErrorBanner("Host declined spawning a background conversation.");
          return;
        }
        const convId =
          res._meta?.["com.google.antigravity/message"]?.conversationId;
        setLastBgConversationId(convId ?? null);
        setStatusBanner(
          convId
            ? `Started background review conversation (${convId}) for ${file.relativePath}.`
            : `Sent review prompt for ${file.relativePath}.`
        );
      } catch (err) {
        setErrorBanner(
          err instanceof Error
            ? err.message
            : "Failed to start background review conversation."
        );
      }
    },
    [app, canSendMessage, draftNote]
  );

  const handleOpenDocs = useCallback(async () => {
    if (!app || !canOpenLinks) return;
    await app.openLink({
      url: "https://antigravity.google/docs/mcp-apps",
    });
  }, [app, canOpenLinks]);

  // Lay out top 16 modules in a clean circular SVG dependency graph.
  const graphNodes = useMemo(() => {
    const subset = files.slice(0, 16);
    const cx = 230;
    const cy = 120;
    const rx = 185;
    const ry = 88;
    return subset.map((f, idx) => {
      const angle = (2 * Math.PI * idx) / Math.max(1, subset.length) - Math.PI / 2;
      return {
        file: f,
        x: cx + rx * Math.cos(angle),
        y: cy + ry * Math.sin(angle),
      };
    });
  }, [files]);

  const nodePosByPath = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const n of graphNodes) {
      map.set(n.file.relativePath, { x: n.x, y: n.y });
    }
    return map;
  }, [graphNodes]);

  if (error) {
    return (
      <div className="shell">
        <div className="banner banner-error">
          Failed to connect to MCP host: {error.message}
        </div>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="shell">
        <div className="empty-state">Connecting to Antigravity MCP host...</div>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="header">
        <div>
          <h1 className="title">Repo Architecture Reviewer</h1>
          <div className="subtitle">
            {scan?.workspaceRoot
              ? `${scan.workspaceRoot} · ${scan.totalFiles ?? 0} files · ${scan.totalLines?.toLocaleString() ?? 0} lines · ${edges.length} internal edges`
              : "Waiting for scan_repository result..."}
          </div>
        </div>
        <div className="toolbar">
          {canOpenLinks && (
            <button type="button" className="btn" onClick={handleOpenDocs}>
              MCP Apps Docs ↗
            </button>
          )}
        </div>
      </header>

      {errorBanner && (
        <div className="banner banner-error" role="alert">
          {errorBanner}
        </div>
      )}
      {statusBanner && (
        <div className="banner banner-success" role="status">
          {statusBanner}
        </div>
      )}

      <div className="reviewer-grid">
        <section className="panel graph-panel">
          <div className="panel-header">
            <h2 className="panel-title">Module Dependency Graph (Top 16 Hotspots)</h2>
            <span className="muted">Click any node to inspect</span>
          </div>
          <svg
            viewBox="0 0 460 240"
            className="dep-svg"
            role="img"
            aria-label="Repository internal import graph"
          >
            {edges.map((edge, idx) => {
              const a = nodePosByPath.get(edge.from);
              const b = nodePosByPath.get(edge.to);
              if (!a || !b) return null;
              const highlighted =
                edge.from === selectedPath || edge.to === selectedPath;
              return (
                <line
                  key={`${edge.from}->${edge.to}-${idx}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  className={highlighted ? "edge-line edge-active" : "edge-line"}
                />
              );
            })}
            {graphNodes.map(({ file, x, y }) => {
              const isSelected = file.relativePath === selectedPath;
              const noteStatus = notes[file.relativePath]?.status ?? "unreviewed";
              const shortName = file.relativePath.split("/").pop() ?? file.relativePath;
              return (
                <g
                  key={file.relativePath}
                  transform={`translate(${x}, ${y})`}
                  className="graph-node"
                  onClick={() => setSelectedPath(file.relativePath)}
                >
                  <circle
                    r={isSelected ? 11 : 8}
                    className={`node-dot status-${noteStatus} ${isSelected ? "node-selected" : ""}`}
                  />
                  <text y={21} textAnchor="middle" className="node-label">
                    {shortName.length > 18 ? `${shortName.slice(0, 16)}…` : shortName}
                  </text>
                </g>
              );
            })}
          </svg>

          <div className="filter-row">
            <input
              type="search"
              className="input"
              placeholder="Filter scanned files by path or folder..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
          </div>

          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Score</th>
                  <th>Lines</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredFiles.map((f) => {
                  const st = notes[f.relativePath]?.status ?? "unreviewed";
                  return (
                    <tr
                      key={f.relativePath}
                      className={
                        f.relativePath === selectedPath ? "row-selected" : ""
                      }
                      onClick={() => setSelectedPath(f.relativePath)}
                    >
                      <td className="mono">{f.relativePath}</td>
                      <td>{f.complexityScore}</td>
                      <td>{f.lines}</td>
                      <td>
                        <span className={`status-pill status-${st}`}>{st}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="panel detail-panel">
          {selectedFile ? (
            <>
              <h2 className="panel-title">Selected Module</h2>
              <div className="mono detail-path">{selectedFile.relativePath}</div>
              <div className="stats-row">
                <span className="pill">Score {selectedFile.complexityScore}</span>
                <span className="pill">{selectedFile.lines} lines</span>
                <span className="pill">{selectedFile.imports.length} imports</span>
              </div>

              <div className="action-stack">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleOpenInSidePane(selectedFile)}
                >
                  Open File in Antigravity Side Pane
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={!canCallTools}
                  onClick={() => handleLoadSnippet(selectedFile)}
                >
                  Preview Snippet (App-Only Tool)
                </button>
                {canSendMessage && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => handleSpawnBackgroundReview(selectedFile)}
                  >
                    Spawn Background Review Chat
                  </button>
                )}
              </div>

              {lastBgConversationId && (
                <div className="muted small">
                  Last background conversation ID: <code>{lastBgConversationId}</code>
                </div>
              )}

              <div className="note-box">
                <label htmlFor="review-status" className="panel-title">
                  Persistent Review Note
                </label>
                <select
                  id="review-status"
                  className="select"
                  value={draftStatus}
                  onChange={(e) =>
                    setDraftStatus(e.target.value as ReviewNote["status"])
                  }
                >
                  <option value="unreviewed">Unreviewed</option>
                  <option value="approved">Approved</option>
                  <option value="needs_changes">Needs Changes</option>
                </select>
                <textarea
                  className="textarea"
                  rows={3}
                  placeholder="Record architectural notes (saved eagerly to ${PLUGIN_DATA})..."
                  value={draftNote}
                  onChange={(e) => setDraftNote(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!canCallTools}
                  onClick={handleSaveNote}
                >
                  Save Review Note
                </button>
              </div>

              {snippet?.snippet && (
                <div className="snippet-box">
                  <div className="panel-title">
                    Snippet ({snippet.lines} lines
                    {snippet.truncated ? ", showing first 120" : ""})
                  </div>
                  <pre className="code-pre">{snippet.snippet}</pre>
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">
              Select a module from the graph or table to inspect it.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
