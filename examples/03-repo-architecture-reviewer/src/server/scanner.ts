/**
 * Safe workspace architecture scanner & persistent review notes store.
 *
 * Security invariants enforced:
 * 1. Canonicalizes target directories with `fs.realpath` and verifies every
 *    file read stays strictly inside the resolved workspace boundary
 *    (`realPath.startsWith(realRoot + path.sep)`).
 * 2. Caps scanned file count (120) and individual file size (256 KiB).
 * 3. Hashes workspace keys with SHA-256 before writing review notes under
 *    `${PLUGIN_DATA}` so filenames are strictly safe hex strings.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".venv",
  "venv",
  "dist",
  "build",
  "coverage",
  ".next",
  "__pycache__",
  ".plugin-data",
]);

const SKIP_FILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
]);

const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".css",
  ".json",
  ".md",
]);

const MAX_FILES = 120;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_SNIPPET_LINES = 120;

export interface ScannedFile {
  relativePath: string;
  fileUri: string;
  extension: string;
  lines: number;
  bytes: number;
  imports: string[];
  complexityScore: number;
  group: string;
}

export interface DependencyEdge {
  from: string;
  to: string;
}

export interface ReviewNote {
  status: "unreviewed" | "approved" | "needs_changes";
  note: string;
  updatedAt: string;
}

export interface RepoScanResult {
  workspaceRoot: string;
  workspaceKey: string;
  scannedAt: string;
  totalFiles: number;
  totalLines: number;
  truncated: boolean;
  files: ScannedFile[];
  edges: DependencyEdge[];
  notes: Record<string, ReviewNote>;
}

function hashWorkspaceKey(realRoot: string): string {
  return crypto.createHash("sha256").update(realRoot).digest("hex").slice(0, 16);
}

function extractImports(content: string, ext: string): string[] {
  const found = new Set<string>();
  if (ext === ".py") {
    const pyRe = /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm;
    let m: RegExpExecArray | null;
    while ((m = pyRe.exec(content)) !== null) {
      const target = m[1] || m[2];
      if (target) found.add(target);
    }
  } else if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
    const jsRe =
      /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = jsRe.exec(content)) !== null) {
      const target = m[1] || m[2];
      if (target) found.add(target);
    }
  }
  return Array.from(found);
}

/** Lightweight structural complexity heuristic (branch points + lines + fan-out). */
function computeComplexity(content: string, lines: number, importCount: number): number {
  const branchMatches = content.match(
    /\b(if|else\s+if|for|while|switch|case|catch|elif|except|\?\?|\?\.)\b/g
  );
  const branches = branchMatches ? branchMatches.length : 0;
  return Math.round(branches * 2 + importCount * 3 + lines / 25);
}

function resolveRelativeEdge(
  fromRel: string,
  specifier: string,
  knownRelSet: Set<string>
): string | null {
  if (!specifier.startsWith(".")) return null;
  const fromDir = path.posix.dirname(fromRel);
  const stripped = specifier.replace(/\.(js|mjs|cjs)$/, "");
  const base = path.posix.normalize(path.posix.join(fromDir, stripped));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
  ];
  for (const c of candidates) {
    if (knownRelSet.has(c) && c !== fromRel) {
      return c;
    }
  }
  return null;
}

export class RepoScanner {
  private readonly dataDir: string;
  private readonly defaultRoot: string;

  constructor(dataDir: string, defaultRoot: string) {
    this.dataDir = dataDir;
    this.defaultRoot = defaultRoot;
  }

  private notesFile(workspaceKey: string): string {
    if (!/^[a-f0-9]{16}$/.test(workspaceKey)) {
      throw new Error("Invalid workspace key format.");
    }
    return path.join(this.dataDir, `review-notes-${workspaceKey}.json`);
  }

  async loadNotes(workspaceKey: string): Promise<Record<string, ReviewNote>> {
    try {
      const raw = await fs.readFile(this.notesFile(workspaceKey), "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, ReviewNote>;
      }
    } catch {
      // No notes saved yet for this workspace.
    }
    return {};
  }

  async saveNote(
    workspaceKey: string,
    relativePath: string,
    status: ReviewNote["status"],
    note: string
  ): Promise<Record<string, ReviewNote>> {
    const cleanRel = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!cleanRel || cleanRel.includes("..")) {
      throw new Error("Invalid relative file path.");
    }
    const existing = await this.loadNotes(workspaceKey);
    existing[cleanRel] = {
      status,
      note: note.trim().slice(0, 1000),
      updatedAt: new Date().toISOString(),
    };
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.writeFile(
      this.notesFile(workspaceKey),
      JSON.stringify(existing, null, 2),
      "utf-8"
    );
    return existing;
  }

  async scanWorkspace(targetDir?: string): Promise<RepoScanResult> {
    const rawRoot = targetDir?.trim()
      ? path.resolve(this.defaultRoot, targetDir.trim())
      : this.defaultRoot;
    const realRoot = await fs.realpath(rawRoot);
    const rootStat = await fs.stat(realRoot);
    if (!rootStat.isDirectory()) {
      throw new Error("Target path must be a directory.");
    }

    const files: ScannedFile[] = [];
    let truncated = false;

    const walk = async (dir: string): Promise<void> => {
      if (files.length >= MAX_FILES) {
        truncated = true;
        return;
      }
      const entries = await fs.readdir(dir, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));

      for (const entry of entries) {
        if (files.length >= MAX_FILES) {
          truncated = true;
          return;
        }
        if (entry.name.startsWith(".") && entry.name !== ".archmap") {
          if (SKIP_DIRS.has(entry.name)) continue;
        }
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue;
          await walk(fullPath);
        } else if (entry.isFile()) {
          if (SKIP_FILES.has(entry.name)) continue;
          const ext = path.extname(entry.name).toLowerCase();
          if (!CODE_EXTENSIONS.has(ext)) continue;

          const realFile = await fs.realpath(fullPath);
          if (
            realFile !== realRoot &&
            !realFile.startsWith(realRoot + path.sep)
          ) {
            continue; // Prevent symlink escapes outside root
          }
          const stat = await fs.stat(realFile);
          if (stat.size > MAX_FILE_BYTES) continue;

          const content = await fs.readFile(realFile, "utf-8");
          const lines = content.split(/\r?\n/).length;
          const imports = extractImports(content, ext);
          const relPosix = path
            .relative(realRoot, realFile)
            .split(path.sep)
            .join("/");
          const topGroup = relPosix.includes("/")
            ? relPosix.split("/")[0]
            : "(root)";

          files.push({
            relativePath: relPosix,
            fileUri: pathToFileURL(realFile).href,
            extension: ext,
            lines,
            bytes: stat.size,
            imports,
            complexityScore: computeComplexity(content, lines, imports.length),
            group: topGroup,
          });
        }
      }
    };

    await walk(realRoot);
    files.sort((a, b) => b.complexityScore - a.complexityScore);

    const knownRelSet = new Set(files.map((f) => f.relativePath));
    const edges: DependencyEdge[] = [];
    for (const file of files) {
      for (const spec of file.imports) {
        const target = resolveRelativeEdge(file.relativePath, spec, knownRelSet);
        if (target) {
          edges.push({ from: file.relativePath, to: target });
        }
      }
    }

    const workspaceKey = hashWorkspaceKey(realRoot);
    const notes = await this.loadNotes(workspaceKey);
    const totalLines = files.reduce((sum, f) => sum + f.lines, 0);

    return {
      workspaceRoot: realRoot,
      workspaceKey,
      scannedAt: new Date().toISOString(),
      totalFiles: files.length,
      totalLines,
      truncated,
      files,
      edges,
      notes,
    };
  }

  async readFileSnippet(
    workspaceRoot: string,
    relativePath: string
  ): Promise<{ relativePath: string; lines: number; snippet: string; truncated: boolean }> {
    const realRoot = await fs.realpath(workspaceRoot);
    const normalizedRel = relativePath.replace(/\\/g, "/");
    if (path.isAbsolute(normalizedRel) || normalizedRel.includes("..")) {
      throw new Error("Invalid relative file path.");
    }
    const candidate = path.resolve(realRoot, normalizedRel);
    const realFile = await fs.realpath(candidate);
    if (!realFile.startsWith(realRoot + path.sep)) {
      throw new Error("File access denied: path escapes scanned workspace root.");
    }
    const stat = await fs.stat(realFile);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
      throw new Error("File is unavailable or exceeds 256 KiB snippet cap.");
    }
    const text = await fs.readFile(realFile, "utf-8");
    const allLines = text.split(/\r?\n/);
    const truncated = allLines.length > MAX_SNIPPET_LINES;
    return {
      relativePath: normalizedRel,
      lines: allLines.length,
      snippet: allLines.slice(0, MAX_SNIPPET_LINES).join("\n"),
      truncated,
    };
  }
}
