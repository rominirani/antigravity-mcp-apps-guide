/**
 * Safe read-only SQLite + CSV data engine for Example 2.
 *
 * Security invariants enforced:
 * 1. User SQL is strictly validated to allow only single-statement read-only
 *    SELECT / WITH / EXPLAIN QUERY PLAN queries.
 * 2. Local CSV / SQLite files loaded from disk are verified against an allowed
 *    extension list (.csv, .sqlite, .db), capped at 10 MiB, and constrained
 *    inside an explicit root directory boundary (preventing `../` traversal).
 * 3. Bookmarks are persisted to `${PLUGIN_DATA}/bookmarks.json` with strict
 *    schema validation.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import initSqlJs from "sql.js";
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MiB
const ALLOWED_EXTENSIONS = new Set([".csv", ".sqlite", ".db"]);
const MAX_PAGE_SIZE = 100;
const MAX_BOOKMARKS = 50;
let sqlJsPromise = null;
async function getSqlJs() {
    if (!sqlJsPromise) {
        sqlJsPromise = initSqlJs();
    }
    return sqlJsPromise;
}
/**
 * Strip single-line and block SQL comments, then verify the query is a single
 * read-only SELECT / WITH / EXPLAIN QUERY PLAN statement.
 */
export function validateReadOnlySql(rawSql) {
    const trimmed = rawSql.trim().replace(/;+\s*$/, "");
    if (!trimmed) {
        throw new Error("SQL query cannot be empty.");
    }
    if (trimmed.length > 4000) {
        throw new Error("SQL query exceeds the 4,000-character limit.");
    }
    // Strip SQL comments and string literals before checking for forbidden tokens.
    const withoutComments = trimmed
        .replace(/--[^\n]*/g, " ")
        .replace(/\/\*[\s\S]*?\*\//g, " ");
    const withoutStrings = withoutComments
        .replace(/'(?:''|[^'])*'/g, "''")
        .replace(/"(?:""|[^"])*"/g, '""');
    if (withoutStrings.includes(";")) {
        throw new Error("Only a single SQL statement is permitted per execution.");
    }
    const leadingKeyword = withoutStrings.trim().split(/\s+/)[0]?.toUpperCase();
    if (leadingKeyword !== "SELECT" &&
        leadingKeyword !== "WITH" &&
        !withoutStrings.trim().toUpperCase().startsWith("EXPLAIN QUERY PLAN ")) {
        throw new Error("Only read-only SELECT, WITH, or EXPLAIN QUERY PLAN queries are permitted.");
    }
    const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|ATTACH|DETACH|VACUUM|PRAGMA|REINDEX|LOAD_EXTENSION|TRIGGER)\b/i;
    if (forbidden.test(withoutStrings)) {
        throw new Error("Write, schema-modification, and PRAGMA statements are blocked in read-only mode.");
    }
    return trimmed;
}
/** Parse RFC-4180-style CSV cleanly without external dependencies. */
function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    cell += '"';
                    i += 1;
                }
                else {
                    inQuotes = false;
                }
            }
            else {
                cell += ch;
            }
        }
        else if (ch === '"') {
            inQuotes = true;
        }
        else if (ch === ",") {
            row.push(cell);
            cell = "";
        }
        else if (ch === "\r" || ch === "\n") {
            if (ch === "\r" && text[i + 1] === "\n")
                i += 1;
            row.push(cell);
            cell = "";
            if (row.some((v) => v.length > 0)) {
                rows.push(row);
            }
            row = [];
        }
        else {
            cell += ch;
        }
    }
    if (cell.length > 0 || row.length > 0) {
        row.push(cell);
        if (row.some((v) => v.length > 0)) {
            rows.push(row);
        }
    }
    if (rows.length === 0) {
        throw new Error("CSV file contains no rows.");
    }
    const rawHeaders = rows[0];
    const used = new Set();
    const headers = rawHeaders.map((h, idx) => {
        const sanitized = h.trim().replace(/[^a-zA-Z0-9_]/g, "_") || `col_${idx + 1}`;
        const safeStart = /^[0-9]/.test(sanitized) ? `c_${sanitized}` : sanitized;
        let candidate = safeStart;
        let n = 2;
        while (used.has(candidate.toLowerCase())) {
            candidate = `${safeStart}_${n++}`;
        }
        used.add(candidate.toLowerCase());
        return candidate;
    });
    return { headers, rows: rows.slice(1) };
}
function coerceCell(raw) {
    const trimmed = raw.trim();
    if (trimmed === "")
        return null;
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
        const num = Number(trimmed);
        if (Number.isFinite(num))
            return num;
    }
    return trimmed;
}
/** Seed a realistic built-in sample database so empty `{}` launches shine immediately. */
function seedBuiltInDatabase(db) {
    db.run(`
    CREATE TABLE services (
      service_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      owner_team TEXT NOT NULL,
      tier TEXT NOT NULL,
      region TEXT NOT NULL,
      p95_ms REAL NOT NULL,
      error_rate REAL NOT NULL
    );

    CREATE TABLE deployments (
      deploy_id INTEGER PRIMARY KEY,
      service_id INTEGER NOT NULL,
      version TEXT NOT NULL,
      deployed_at TEXT NOT NULL,
      status TEXT NOT NULL,
      duration_sec INTEGER NOT NULL,
      FOREIGN KEY (service_id) REFERENCES services(service_id)
    );

    CREATE TABLE incidents (
      incident_id INTEGER PRIMARY KEY,
      service_id INTEGER NOT NULL,
      severity TEXT NOT NULL,
      summary TEXT NOT NULL,
      opened_at TEXT NOT NULL,
      resolved_minutes INTEGER NOT NULL,
      FOREIGN KEY (service_id) REFERENCES services(service_id)
    );
  `);
    const services = [
        [1, "auth-gateway", "identity", "tier-0", "us-east1", 24.5, 0.0018],
        [2, "checkout-api", "commerce", "tier-0", "us-east1", 184.2, 0.0245],
        [3, "search-index", "discovery", "tier-1", "eu-west1", 67.4, 0.0041],
        [4, "billing-worker", "payments", "tier-0", "us-central1", 92.8, 0.0032],
        [5, "notif-dispatcher", "messaging", "tier-2", "us-east1", 41.0, 0.0095],
        [6, "inventory-sync", "commerce", "tier-1", "eu-west1", 131.6, 0.0154],
        [7, "feature-flags", "platform", "tier-0", "global", 11.3, 0.0004],
        [8, "analytics-ingest", "data", "tier-2", "us-central1", 215.9, 0.0182],
    ];
    const insertService = db.prepare("INSERT INTO services VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const row of services) {
        insertService.run(row);
    }
    insertService.free();
    const insertDeploy = db.prepare("INSERT INTO deployments VALUES (?, ?, ?, ?, ?, ?)");
    const statuses = ["succeeded", "succeeded", "succeeded", "rolled_back", "canary"];
    for (let i = 1; i <= 32; i += 1) {
        const svcId = ((i - 1) % services.length) + 1;
        const day = String(1 + ((i * 2) % 24)).padStart(2, "0");
        insertDeploy.run([
            i,
            svcId,
            `v2.${Math.floor(i / 4)}.${i % 4}`,
            `2026-11-${day}T${String((i * 3) % 24).padStart(2, "0")}:15:00Z`,
            statuses[i % statuses.length],
            45 + (i * 19) % 240,
        ]);
    }
    insertDeploy.free();
    const incidents = [
        [101, 2, "SEV-1", "Checkout latency spike after connection pool saturation", "2026-11-18T14:20:00Z", 47],
        [102, 6, "SEV-2", "EU inventory cache stale keys during region failover", "2026-11-19T09:05:00Z", 82],
        [103, 2, "SEV-1", "Payment timeout cascade on retry storm", "2026-11-20T19:40:00Z", 34],
        [104, 8, "SEV-3", "Kafka consumer lag exceeded 15 minute SLO", "2026-11-21T03:12:00Z", 115],
        [105, 3, "SEV-2", "Shard rebalance elevated search p95 above 200ms", "2026-11-22T11:50:00Z", 29],
        [106, 5, "SEV-3", "Webhook retry queue backpressure on partner 429s", "2026-11-23T16:30:00Z", 64],
        [107, 4, "SEV-2", "Ledger reconciliation job lock contention", "2026-11-24T07:10:00Z", 52],
        [108, 1, "SEV-2", "JWKS key rotation cache miss burst", "2026-11-24T18:05:00Z", 18],
    ];
    const insertIncident = db.prepare("INSERT INTO incidents VALUES (?, ?, ?, ?, ?, ?)");
    for (const row of incidents) {
        insertIncident.run(row);
    }
    insertIncident.free();
}
function introspectTables(db) {
    const res = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    if (res.length === 0)
        return [];
    const tables = [];
    for (const row of res[0].values) {
        const tableName = String(row[0]);
        const safeIdent = `"${tableName.replace(/"/g, '""')}"`;
        const countRes = db.exec(`SELECT COUNT(*) FROM ${safeIdent}`);
        const rowCount = Number(countRes[0]?.values[0]?.[0] ?? 0);
        const colRes = db.exec(`PRAGMA table_info(${safeIdent})`);
        const columns = (colRes[0]?.values ?? []).map((c) => ({
            name: String(c[1]),
            type: String(c[2] || "TEXT"),
        }));
        tables.push({ name: tableName, rowCount, columns });
    }
    return tables;
}
export class ExplorerEngine {
    db = null;
    state = null;
    dataDir;
    allowedRoots;
    constructor(dataDir, allowedRoots) {
        this.dataDir = dataDir;
        this.allowedRoots = allowedRoots;
    }
    async ensureInitialized() {
        if (this.db && this.state)
            return;
        await this.loadBuiltIn();
    }
    async loadBuiltIn() {
        const SQL = await getSqlJs();
        if (this.db)
            this.db.close();
        const db = new SQL.Database();
        seedBuiltInDatabase(db);
        this.db = db;
        const tables = introspectTables(db);
        this.state = {
            id: "built-in-devops",
            label: "Built-in Sample: DevOps Services & Incidents (SQLite)",
            sourceKind: "built-in",
            tables,
            defaultSql: "SELECT s.name, s.owner_team, s.tier, s.p95_ms, s.error_rate, COUNT(i.incident_id) AS incident_count\n" +
                "FROM services s\n" +
                "LEFT JOIN incidents i ON s.service_id = i.service_id\n" +
                "GROUP BY s.service_id\n" +
                "ORDER BY s.p95_ms DESC",
        };
        return this.state;
    }
    async resolveSafeFilePath(inputPath) {
        const candidate = path.isAbsolute(inputPath)
            ? inputPath
            : path.resolve(this.allowedRoots[0], inputPath);
        const realCandidate = await fs.realpath(candidate);
        const allowedRealRoots = await Promise.all(this.allowedRoots.map(async (r) => {
            try {
                return await fs.realpath(r);
            }
            catch {
                return path.resolve(r);
            }
        }));
        const withinBoundary = allowedRealRoots.some((root) => realCandidate === root || realCandidate.startsWith(root + path.sep));
        if (!withinBoundary) {
            throw new Error("File access denied: path must reside inside the workspace or plugin directory.");
        }
        const ext = path.extname(realCandidate).toLowerCase();
        if (!ALLOWED_EXTENSIONS.has(ext)) {
            throw new Error(`Unsupported file extension '${ext}'. Allowed extensions: .csv, .sqlite, .db.`);
        }
        const stat = await fs.stat(realCandidate);
        if (!stat.isFile()) {
            throw new Error("Target path is not a regular file.");
        }
        if (stat.size > MAX_FILE_BYTES) {
            throw new Error(`File size (${stat.size} bytes) exceeds the 10 MiB safety cap.`);
        }
        return realCandidate;
    }
    async loadFromFile(sourcePath) {
        const safePath = await this.resolveSafeFilePath(sourcePath);
        const ext = path.extname(safePath).toLowerCase();
        const SQL = await getSqlJs();
        const fileName = path.basename(safePath);
        if (ext === ".csv") {
            const text = await fs.readFile(safePath, "utf-8");
            const { headers, rows } = parseCsv(text);
            const tableName = path
                .basename(fileName, ext)
                .replace(/[^a-zA-Z0-9_]/g, "_")
                .replace(/^[0-9]/, "t_$&") || "csv_data";
            if (this.db)
                this.db.close();
            const db = new SQL.Database();
            const colDefs = headers.map((h) => `"${h}"`).join(", ");
            db.run(`CREATE TABLE "${tableName}" (${colDefs});`);
            const placeholders = headers.map(() => "?").join(", ");
            const stmt = db.prepare(`INSERT INTO "${tableName}" VALUES (${placeholders})`);
            for (const r of rows) {
                const values = headers.map((_, idx) => coerceCell(r[idx] ?? ""));
                stmt.run(values);
            }
            stmt.free();
            this.db = db;
            const tables = introspectTables(db);
            this.state = {
                id: `csv-${crypto.createHash("sha256").update(safePath).digest("hex").slice(0, 8)}`,
                label: `CSV: ${fileName}`,
                sourceKind: "csv",
                tables,
                defaultSql: `SELECT * FROM "${tableName}"`,
            };
            return this.state;
        }
        const bytes = await fs.readFile(safePath);
        if (this.db)
            this.db.close();
        const db = new SQL.Database(new Uint8Array(bytes));
        this.db = db;
        const tables = introspectTables(db);
        const firstTable = tables[0]?.name;
        this.state = {
            id: `sqlite-${crypto.createHash("sha256").update(safePath).digest("hex").slice(0, 8)}`,
            label: `SQLite: ${fileName}`,
            sourceKind: "sqlite",
            tables,
            defaultSql: firstTable
                ? `SELECT * FROM "${firstTable.replace(/"/g, '""')}"`
                : "SELECT name FROM sqlite_master WHERE type='table'",
        };
        return this.state;
    }
    async getState() {
        await this.ensureInitialized();
        return this.state;
    }
    async runQuery(rawSql, page = 1, pageSize = 25) {
        await this.ensureInitialized();
        const safeSql = validateReadOnlySql(rawSql);
        const clampedPage = Math.max(1, Math.floor(page));
        const clampedPageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(pageSize)));
        const started = performance.now();
        const results = this.db.exec(safeSql);
        const durationMs = Number((performance.now() - started).toFixed(2));
        if (results.length === 0) {
            return {
                columns: [],
                rows: [],
                totalRows: 0,
                page: clampedPage,
                pageSize: clampedPageSize,
                hasMore: false,
                durationMs,
                sql: safeSql,
            };
        }
        const { columns, values } = results[0];
        const totalRows = values.length;
        const offset = (clampedPage - 1) * clampedPageSize;
        const slice = values.slice(offset, offset + clampedPageSize).map((row) => row.map((cell) => {
            if (cell === null || cell === undefined)
                return null;
            if (cell instanceof Uint8Array)
                return `<BLOB ${cell.byteLength} B>`;
            return cell;
        }));
        return {
            columns,
            rows: slice,
            totalRows,
            page: clampedPage,
            pageSize: clampedPageSize,
            hasMore: offset + slice.length < totalRows,
            durationMs,
            sql: safeSql,
        };
    }
    get bookmarksFile() {
        return path.join(this.dataDir, "bookmarks.json");
    }
    async listBookmarks() {
        try {
            const raw = await fs.readFile(this.bookmarksFile, "utf-8");
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return parsed.filter((item) => typeof item?.id === "string" &&
                    typeof item?.name === "string" &&
                    typeof item?.sql === "string");
            }
        }
        catch {
            // File may not exist on first launch; return default helpful queries.
        }
        return [
            {
                id: "preset-latency",
                name: "Services by p95 Latency",
                sql: "SELECT name, owner_team, tier, p95_ms, error_rate FROM services ORDER BY p95_ms DESC",
                createdAt: "2026-11-25T00:00:00Z",
            },
            {
                id: "preset-incidents",
                name: "SEV-1 & SEV-2 Incidents",
                sql: "SELECT i.incident_id, s.name AS service, i.severity, i.summary, i.resolved_minutes FROM incidents i JOIN services s ON i.service_id = s.service_id WHERE i.severity IN ('SEV-1', 'SEV-2') ORDER BY i.resolved_minutes DESC",
                createdAt: "2026-11-25T00:00:00Z",
            },
        ];
    }
    async saveBookmark(name, sql) {
        const safeSql = validateReadOnlySql(sql);
        const trimmedName = name.trim().slice(0, 80);
        if (!trimmedName) {
            throw new Error("Bookmark name cannot be empty.");
        }
        const existing = await this.listBookmarks();
        const next = [
            {
                id: crypto.randomUUID(),
                name: trimmedName,
                sql: safeSql,
                createdAt: new Date().toISOString(),
            },
            ...existing,
        ].slice(0, MAX_BOOKMARKS);
        await fs.mkdir(this.dataDir, { recursive: true });
        await fs.writeFile(this.bookmarksFile, JSON.stringify(next, null, 2), "utf-8");
        return next;
    }
    async deleteBookmark(id) {
        const existing = await this.listBookmarks();
        const next = existing.filter((b) => b.id !== id);
        await fs.mkdir(this.dataDir, { recursive: true });
        await fs.writeFile(this.bookmarksFile, JSON.stringify(next, null, 2), "utf-8");
        return next;
    }
}
