import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import { useCallback, useEffect, useRef, useState } from "react";

interface TableSchema {
  name: string;
  rowCount: number;
  columns: Array<{ name: string; type: string }>;
}

interface DatasetState {
  id: string;
  label: string;
  sourceKind: "built-in" | "csv" | "sqlite";
  tables: TableSchema[];
  defaultSql: string;
}

interface QueryPageResult {
  columns: string[];
  rows: Array<Array<string | number | null>>;
  totalRows: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  durationMs: number;
  sql: string;
  error?: string;
}

interface SavedBookmark {
  id: string;
  name: string;
  sql: string;
  createdAt: string;
}

interface InitialPayload {
  title?: string;
  dataset?: DatasetState;
  initialResult?: QueryPageResult;
  bookmarks?: SavedBookmark[];
  error?: string;
}

const MAX_IN_FLIGHT = 4;

export function App() {
  const [hostContext, setHostContext] = useState<McpUiHostContext | null>(null);
  const [title, setTitle] = useState("SQLite & CSV Explorer");
  const [dataset, setDataset] = useState<DatasetState | null>(null);
  const [sql, setSql] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [queryResult, setQueryResult] = useState<QueryPageResult | null>(null);
  const [bookmarks, setBookmarks] = useState<SavedBookmark[]>([]);
  const [bookmarkName, setBookmarkName] = useState("");
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [contextAttached, setContextAttached] = useState(false);
  const [inFlight, setInFlight] = useState(0);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const inFlightRef = useRef(0);

  const { app, isConnected, error } = useApp({
    appInfo: { name: "SQLite & CSV Explorer", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (instance) => {
      instance.ontoolinput = () => {
        setErrorBanner(null);
      };
      instance.ontoolresult = (result) => {
        const payload = (result.structuredContent ?? {}) as InitialPayload;
        if (payload.error) {
          setErrorBanner(payload.error);
          return;
        }
        if (payload.title) setTitle(payload.title);
        if (payload.dataset) setDataset(payload.dataset);
        if (payload.initialResult) {
          setQueryResult(payload.initialResult);
          setSql(payload.initialResult.sql);
          setSelectedRows(new Set());
        }
        if (payload.bookmarks) setBookmarks(payload.bookmarks);
        setErrorBanner(null);
      };
      instance.ontoolcancelled = ({ reason }) => {
        setErrorBanner(`Tool call cancelled${reason ? `: ${reason}` : "."}`);
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

  // Automatically synchronizes host theme & CSS variables on connect and live updates.
  useHostStyles(app, hostContext);

  const caps = app?.getHostCapabilities();
  const canCallTools = Boolean(caps?.serverTools);
  const canSendMessage = Boolean(caps?.message);
  const canUpdateContext = Boolean(caps?.updateModelContext);

  /** Respect Antigravity's cap of 4 concurrent `tools/call` requests per view. */
  const callToolSafely = useCallback(
    async (name: string, args: Record<string, unknown>) => {
      if (!app || !canCallTools) {
        throw new Error("Server tool calls are unavailable on this host.");
      }
      if (inFlightRef.current >= MAX_IN_FLIGHT) {
        throw new Error(
          `Already running ${MAX_IN_FLIGHT} requests. Wait a moment and retry.`
        );
      }
      inFlightRef.current += 1;
      setInFlight(inFlightRef.current);
      try {
        return await app.callServerTool({ name, arguments: args });
      } finally {
        inFlightRef.current -= 1;
        setInFlight(inFlightRef.current);
      }
    },
    [app, canCallTools]
  );

  const executeQuery = useCallback(
    async (queryText: string, page = 1, nextPageSize = pageSize) => {
      setErrorBanner(null);
      setStatusBanner(null);
      try {
        const res = await callToolSafely("app_run_query", {
          sql: queryText,
          page,
          pageSize: nextPageSize,
        });
        const data = (res.structuredContent ?? {}) as QueryPageResult;
        if (res.isError || data.error) {
          setErrorBanner(data.error || "Query failed.");
          return;
        }
        setQueryResult(data);
        setSelectedRows(new Set());
      } catch (err) {
        setErrorBanner(
          err instanceof Error ? err.message : "Failed to run SQL query."
        );
      }
    },
    [callToolSafely, pageSize]
  );

  const handleSaveBookmark = useCallback(async () => {
    if (!bookmarkName.trim() || !sql.trim()) return;
    setErrorBanner(null);
    try {
      const res = await callToolSafely("app_save_bookmark", {
        name: bookmarkName.trim(),
        sql,
      });
      const data = (res.structuredContent ?? {}) as {
        bookmarks?: SavedBookmark[];
        error?: string;
      };
      if (res.isError || data.error) {
        setErrorBanner(data.error || "Could not save bookmark.");
        return;
      }
      if (data.bookmarks) setBookmarks(data.bookmarks);
      setBookmarkName("");
      setStatusBanner("Saved query bookmark eagerly to ${PLUGIN_DATA}.");
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : "Could not save bookmark."
      );
    }
  }, [bookmarkName, callToolSafely, sql]);

  const handleDeleteBookmark = useCallback(
    async (id: string) => {
      try {
        const res = await callToolSafely("app_delete_bookmark", { id });
        const data = (res.structuredContent ?? {}) as {
          bookmarks?: SavedBookmark[];
        };
        if (data.bookmarks) setBookmarks(data.bookmarks);
      } catch (err) {
        setErrorBanner(
          err instanceof Error ? err.message : "Could not delete bookmark."
        );
      }
    },
    [callToolSafely]
  );

  /** Attach selected rows (or query preview) as a context pill for the user's next message. */
  const handleAttachContext = useCallback(async () => {
    if (!app || !canUpdateContext || !queryResult) return;
    const chosenIndices =
      selectedRows.size > 0
        ? Array.from(selectedRows).sort((a, b) => a - b)
        : queryResult.rows.slice(0, 10).map((_, idx) => idx);

    const pickedRows = chosenIndices
      .map((idx) => queryResult.rows[idx])
      .filter(Boolean)
      .map((row) =>
        Object.fromEntries(queryResult.columns.map((col, i) => [col, row[i]]))
      );

    const contextSummary = [
      `Dataset: ${title}`,
      `SQL: ${queryResult.sql}`,
      `Selected rows (${pickedRows.length} of ${queryResult.totalRows} total):`,
      JSON.stringify(pickedRows, null, 2),
    ].join("\n");

    await app.updateModelContext({
      content: [{ type: "text", text: contextSummary }],
    });
    setContextAttached(true);
    setStatusBanner(
      `Attached ${pickedRows.length} row(s) as context for your next message.`
    );
  }, [app, canUpdateContext, queryResult, selectedRows, title]);

  const handleClearContext = useCallback(async () => {
    if (!app || !canUpdateContext) return;
    await app.updateModelContext({ content: [] });
    setContextAttached(false);
    setStatusBanner("Cleared attached model context.");
  }, [app, canUpdateContext]);

  const handleAskAgent = useCallback(async () => {
    if (!app || !canSendMessage || !queryResult) return;
    const prompt = [
      `Please analyze these SQL results from "${title}" and suggest any anomalies or query optimizations:`,
      `\`\`\`sql\n${queryResult.sql}\n\`\`\``,
      `Returned ${queryResult.totalRows} row(s) in ${queryResult.durationMs} ms. Columns: ${queryResult.columns.join(", ")}.`,
    ].join("\n\n");

    const res = await app.sendMessage({
      role: "user",
      content: [{ type: "text", text: prompt }],
    });
    if (res.isError) {
      setErrorBanner("Host declined sending the message to chat.");
    } else {
      setStatusBanner("Sent query summary to the conversation.");
    }
  }, [app, canSendMessage, queryResult, title]);

  const toggleRow = (idx: number) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

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

  const totalPages = queryResult
    ? Math.max(1, Math.ceil(queryResult.totalRows / queryResult.pageSize))
    : 1;

  return (
    <div className="shell">
      <header className="header">
        <div>
          <h1 className="title">{title}</h1>
          <div className="subtitle">
            {canSendMessage || canUpdateContext
              ? "Side Panel Mode · Connected to conversation"
              : "Full-Page Global Mode · Standalone workspace view"}
          </div>
        </div>
        <div className="header-badges">
          <span className="pill">Read-only SQL</span>
          {inFlight > 0 && (
            <span className="pill pill-info">
              Running {inFlight}/{MAX_IN_FLIGHT}
            </span>
          )}
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <section className="panel">
            <h2 className="panel-title">Tables</h2>
            {dataset?.tables.length ? (
              <ul className="schema-list">
                {dataset.tables.map((t) => (
                  <li key={t.name} className="schema-item">
                    <button
                      type="button"
                      className="table-btn"
                      onClick={() => {
                        const nextSql = `SELECT * FROM "${t.name.replace(/"/g, '""')}"`;
                        setSql(nextSql);
                        executeQuery(nextSql, 1);
                      }}
                    >
                      <span>{t.name}</span>
                      <span className="muted">{t.rowCount}</span>
                    </button>
                    <div className="col-list">
                      {t.columns.map((c) => (
                        <span key={c.name} className="col-tag">
                          {c.name}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Waiting for schema...</p>
            )}
          </section>

          <section className="panel">
            <h2 className="panel-title">Saved Queries</h2>
            <div className="bookmark-form">
              <input
                type="text"
                className="input"
                placeholder="Bookmark name..."
                value={bookmarkName}
                onChange={(e) => setBookmarkName(e.target.value)}
              />
              <button
                type="button"
                className="btn"
                onClick={handleSaveBookmark}
                disabled={!bookmarkName.trim() || !sql.trim()}
              >
                Save
              </button>
            </div>
            <ul className="bookmark-list">
              {bookmarks.map((b) => (
                <li key={b.id} className="bookmark-item">
                  <button
                    type="button"
                    className="bookmark-load"
                    onClick={() => {
                      setSql(b.sql);
                      executeQuery(b.sql, 1);
                    }}
                  >
                    {b.name}
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Delete bookmark ${b.name}`}
                    onClick={() => handleDeleteBookmark(b.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <main className="workspace">
          <section className="panel">
            <div className="editor-header">
              <label htmlFor="sql-editor" className="panel-title">
                SQL Query
              </label>
              <div className="toolbar">
                <select
                  aria-label="Rows per page"
                  className="select"
                  value={pageSize}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setPageSize(next);
                    if (sql.trim()) executeQuery(sql, 1, next);
                  }}
                >
                  <option value={10}>10 / page</option>
                  <option value={25}>25 / page</option>
                  <option value={50}>50 / page</option>
                  <option value={100}>100 / page</option>
                </select>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => executeQuery(sql, 1)}
                  disabled={!sql.trim() || !canCallTools}
                >
                  Run Query
                </button>
              </div>
            </div>

            <textarea
              id="sql-editor"
              className="sql-editor"
              rows={4}
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  executeQuery(sql, 1);
                }
              }}
              placeholder="SELECT * FROM services ORDER BY p95_ms DESC"
            />

            {/* Conversation capabilities are automatically hidden in Global view */}
            {(canUpdateContext || canSendMessage) && (
              <div className="conversation-actions">
                {canUpdateContext && (
                  <>
                    <button
                      type="button"
                      className="btn"
                      onClick={handleAttachContext}
                      disabled={!queryResult}
                    >
                      {selectedRows.size > 0
                        ? `Attach ${selectedRows.size} Selected Row(s) to Prompt`
                        : "Attach Query Preview to Prompt"}
                    </button>
                    {contextAttached && (
                      <button
                        type="button"
                        className="btn"
                        onClick={handleClearContext}
                      >
                        Clear Context Pill
                      </button>
                    )}
                  </>
                )}
                {canSendMessage && (
                  <button
                    type="button"
                    className="btn"
                    onClick={handleAskAgent}
                    disabled={!queryResult}
                  >
                    Ask Agent to Analyze Query
                  </button>
                )}
              </div>
            )}
          </section>

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

          <section className="panel results-panel">
            <div className="results-meta">
              {queryResult ? (
                <span>
                  {queryResult.totalRows.toLocaleString()} row(s) ·{" "}
                  {queryResult.durationMs} ms · Page {queryResult.page} of{" "}
                  {totalPages}
                </span>
              ) : (
                <span>No results yet.</span>
              )}

              {queryResult && totalPages > 1 && (
                <div className="pager">
                  <button
                    type="button"
                    className="btn"
                    disabled={queryResult.page <= 1}
                    onClick={() => executeQuery(queryResult.sql, queryResult.page - 1)}
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={!queryResult.hasMore}
                    onClick={() => executeQuery(queryResult.sql, queryResult.page + 1)}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>

            {queryResult && queryResult.columns.length > 0 ? (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="check-col">✓</th>
                      {queryResult.columns.map((col) => (
                        <th key={col}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {queryResult.rows.map((row, rIdx) => (
                      <tr
                        key={rIdx}
                        className={selectedRows.has(rIdx) ? "row-selected" : ""}
                      >
                        <td className="check-col">
                          <input
                            type="checkbox"
                            aria-label={`Select row ${rIdx + 1}`}
                            checked={selectedRows.has(rIdx)}
                            onChange={() => toggleRow(rIdx)}
                          />
                        </td>
                        {row.map((cell, cIdx) => (
                          <td key={cIdx}>
                            {cell === null ? (
                              <span className="null-val">NULL</span>
                            ) : (
                              String(cell)
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">
                Run a read-only SELECT query to inspect rows.
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
