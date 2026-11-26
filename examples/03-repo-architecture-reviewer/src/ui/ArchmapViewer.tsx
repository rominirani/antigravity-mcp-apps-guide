/**
 * Antigravity Custom File Viewer & Editor for `.archmap` files.
 *
 * Demonstrates Antigravity's `type: "file"` entrypoint protocol:
 * 1. Antigravity invokes `open_archmap_file` with an opaque per-view URI:
 *    `{ file: { name: "sample.archmap", resourceUri: "antigravity-file://<uuid>/sample.archmap" } }`
 * 2. The iframe reads the file via standard MCP `resources/read` (`app.readServerResource`).
 *    Antigravity intercepts `antigravity-file://` URIs and answers directly with a
 *    base64 `blob` (up to 10 MiB) without exposing raw host filesystem paths.
 * 3. Saving edits checks `hostContext["com.google.antigravity/resources"]?.write`
 *    and sends `com.google.antigravity/resources/write` with `{ uri, text }`.
 */

import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

interface ArchNode {
  id: string;
  label: string;
  layer: string;
  status: "healthy" | "warning" | "critical";
  owner: string;
}

interface ArchEdge {
  from: string;
  to: string;
  protocol: string;
}

interface ArchMapDocument {
  schemaVersion: string;
  project: string;
  updatedAt?: string;
  nodes: ArchNode[];
  edges: ArchEdge[];
}

const WriteResultSchema = z
  .object({
    isError: z.boolean().optional(),
  })
  .passthrough();

function decodeBase64Utf8(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

export function ArchmapViewer() {
  const [hostContext, setHostContext] = useState<McpUiHostContext | null>(null);
  const [fileName, setFileName] = useState("sample.archmap");
  const [fileResourceUri, setFileResourceUri] = useState<string | null>(null);
  const [doc, setDoc] = useState<ArchMapDocument | null>(null);
  const [dirty, setDirty] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const { app, isConnected, error } = useApp({
    appInfo: { name: "Architecture Map Viewer", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (instance) => {
      instance.ontoolinput = ({ arguments: args }) => {
        const fileArg = (
          args as { file?: { name?: string; resourceUri?: string } } | undefined
        )?.file;
        if (fileArg?.name) setFileName(fileArg.name);
        if (fileArg?.resourceUri) setFileResourceUri(fileArg.resourceUri);
      };
      instance.ontoolresult = (result) => {
        const fileArg = (
          result.structuredContent as
            | { file?: { name?: string; resourceUri?: string } }
            | undefined
        )?.file;
        if (fileArg?.name) setFileName(fileArg.name);
        if (fileArg?.resourceUri) setFileResourceUri(fileArg.resourceUri);
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

  // Read opaque `antigravity-file://` URI directly from Antigravity via `resources/read`.
  useEffect(() => {
    if (!app || !isConnected || !fileResourceUri) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await app.readServerResource({ uri: fileResourceUri });
        if (cancelled) return;
        const first = res.contents?.[0];
        if (!first) {
          setErrorBanner("Host returned empty file contents.");
          return;
        }
        const rawText =
          "text" in first && typeof first.text === "string"
            ? first.text
            : "blob" in first && typeof first.blob === "string"
              ? decodeBase64Utf8(first.blob)
              : "";
        const parsed = JSON.parse(rawText) as ArchMapDocument;
        setDoc(parsed);
        setDirty(false);
        setErrorBanner(null);
      } catch (err) {
        if (!cancelled) {
          setErrorBanner(
            err instanceof Error
              ? `Failed to read .archmap file: ${err.message}`
              : "Failed to read .archmap file."
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [app, isConnected, fileResourceUri]);

  const antigravityResources = (
    hostContext as Record<string, { write?: boolean } | undefined> | null
  )?.["com.google.antigravity/resources"];
  const canWrite = Boolean(antigravityResources?.write && fileResourceUri);

  const cycleNodeStatus = (nodeId: string) => {
    if (!doc) return;
    const order: ArchNode["status"][] = ["healthy", "warning", "critical"];
    setDoc({
      ...doc,
      updatedAt: new Date().toISOString(),
      nodes: doc.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, status: order[(order.indexOf(n.status) + 1) % order.length] }
          : n
      ),
    });
    setDirty(true);
    setStatusBanner(null);
  };

  const handleSave = useCallback(async () => {
    if (!app || !canWrite || !fileResourceUri || !doc) return;
    setErrorBanner(null);
    try {
      const res = await app.request(
        {
          method: "com.google.antigravity/resources/write",
          params: {
            uri: fileResourceUri,
            text: `${JSON.stringify(doc, null, 2)}\n`,
          },
        },
        WriteResultSchema
      );
      if (res.isError) {
        setErrorBanner("Host declined writing changes to disk.");
        return;
      }
      setDirty(false);
      setStatusBanner(`Saved ${fileName} directly via Antigravity file bridge.`);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : "Failed to save .archmap file."
      );
    }
  }, [app, canWrite, doc, fileName, fileResourceUri]);

  if (error) {
    return (
      <div className="shell">
        <div className="banner banner-error">{error.message}</div>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="header">
        <div>
          <h1 className="title">{doc?.project || fileName}</h1>
          <div className="subtitle">
            Custom File Viewer ({fileName}) ·{" "}
            {canWrite ? "Read & Write enabled" : "Read-only mode"}
          </div>
        </div>
        {canWrite && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={!dirty}
            onClick={handleSave}
          >
            {dirty ? "Save Changes" : "Saved"}
          </button>
        )}
      </header>

      {errorBanner && <div className="banner banner-error">{errorBanner}</div>}
      {statusBanner && <div className="banner banner-success">{statusBanner}</div>}

      {doc ? (
        <div className="panel">
          <h2 className="panel-title">Services &amp; Health Status (click status to cycle)</h2>
          <div className="arch-cards">
            {doc.nodes.map((node) => (
              <div key={node.id} className="arch-card">
                <div className="arch-card-top">
                  <strong>{node.label}</strong>
                  <button
                    type="button"
                    className={`status-pill status-${node.status}`}
                    onClick={() => cycleNodeStatus(node.id)}
                  >
                    {node.status}
                  </button>
                </div>
                <div className="muted small">
                  layer: {node.layer} · owner: {node.owner}
                </div>
              </div>
            ))}
          </div>

          <h2 className="panel-title" style={{ marginTop: 14 }}>
            Connections ({doc.edges.length})
          </h2>
          <ul className="edge-list">
            {doc.edges.map((e, i) => (
              <li key={`${e.from}-${e.to}-${i}`} className="mono">
                {e.from} ──[{e.protocol}]──▶ {e.to}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="empty-state">
          Open a <code>.archmap</code> file in Antigravity to inspect and edit its service topology.
        </div>
      )}
    </div>
  );
}
