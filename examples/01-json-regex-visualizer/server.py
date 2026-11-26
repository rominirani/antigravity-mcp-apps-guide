"""Example 1: Inline JSON & Regex Visualizer MCP App (Python MCP SDK v2).

Demonstrates the core MCP Apps specification (SEP-1865 / io.modelcontextprotocol/ui):
- A single self-contained `ui://` HTML resource served with MIME type
  `text/html;profile=mcp-app`.
- Multiple model-callable tools (`inspect_json`, `test_regex`) pointing at the
  same UI resource via `_meta.ui.resourceUri`.
- Returning BOTH plain-text `content` (for the LLM and CLI fallback) and
  `structuredContent` (for the interactive UI iframe).
- An app-only helper tool (`app_test_regex`) with `visibility: ["app"]` so the
  inline widget can live-evaluate Python regex edits via `app.callServerTool()`.
- Environment-variable override (`JSON_REGEX_APP_HTML`) for rapid UI iteration.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

from mcp import types
from mcp.server import MCPServer

APP_URI = "ui://json-regex-visualizer/app.html"
MIME_TYPE = "text/html;profile=mcp-app"

# Safety limits to guard against oversized inputs or catastrophic backtracking.
MAX_JSON_BYTES = 100_000
MAX_REGEX_TEXT_BYTES = 50_000
MAX_PATTERN_CHARS = 500
MAX_MATCHES = 500
MAX_TREE_DEPTH = 32

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_HTML_PATH = BASE_DIR / "dist" / "app.html"

mcp = MCPServer("json-regex-visualizer")

# Metadata helpers matching the MCP Apps spec (SEP-1865).
INLINE_UI_META: dict[str, Any] = {
    "ui": {
        "resourceUri": APP_URI,
    }
}

APP_ONLY_META: dict[str, Any] = {
    "ui": {
        "visibility": ["app"],
    }
}


def _compute_json_stats(value: Any, depth: int = 0) -> dict[str, Any]:
    """Compute summary statistics over a parsed JSON value without recursion blowups."""
    counts = {
        "objects": 0,
        "arrays": 0,
        "strings": 0,
        "numbers": 0,
        "booleans": 0,
        "nulls": 0,
        "totalKeys": 0,
        "maxDepth": depth,
    }

    def walk(node: Any, current_depth: int) -> None:
        if current_depth > counts["maxDepth"]:
            counts["maxDepth"] = current_depth
        if current_depth > MAX_TREE_DEPTH:
            return
        if isinstance(node, dict):
            counts["objects"] += 1
            counts["totalKeys"] += len(node)
            for child in node.values():
                walk(child, current_depth + 1)
        elif isinstance(node, list):
            counts["arrays"] += 1
            for item in node:
                walk(item, current_depth + 1)
        elif isinstance(node, bool):
            counts["booleans"] += 1
        elif isinstance(node, (int, float)):
            counts["numbers"] += 1
        elif isinstance(node, str):
            counts["strings"] += 1
        elif node is None:
            counts["nulls"] += 1

    walk(value, 0)
    return counts


def _parse_flags(flags_str: str) -> tuple[int, str]:
    """Parse allowlisted Python regex flags (i, m, s, x)."""
    flag_map = {
        "i": re.IGNORECASE,
        "m": re.MULTILINE,
        "s": re.DOTALL,
        "x": re.VERBOSE,
    }
    bitmask = 0
    normalized: list[str] = []
    for ch in flags_str.lower():
        if ch in flag_map and ch not in normalized:
            bitmask |= flag_map[ch]
            normalized.append(ch)
    return bitmask, "".join(normalized)


def _evaluate_regex(
    pattern: str, sample_text: str, flags: str = ""
) -> dict[str, Any]:
    """Safely evaluate a Python regular expression and return structured spans."""
    if len(pattern) > MAX_PATTERN_CHARS:
        return {
            "ok": False,
            "error": f"Pattern exceeds maximum length of {MAX_PATTERN_CHARS} characters.",
        }
    if len(sample_text.encode("utf-8")) > MAX_REGEX_TEXT_BYTES:
        return {
            "ok": False,
            "error": f"Sample text exceeds maximum size of {MAX_REGEX_TEXT_BYTES} bytes.",
        }

    bitmask, normalized_flags = _parse_flags(flags)
    try:
        compiled = re.compile(pattern, bitmask)
    except re.error as exc:
        return {
            "ok": False,
            "error": f"Invalid regular expression: {exc}",
            "pattern": pattern,
            "flags": normalized_flags,
        }

    matches: list[dict[str, Any]] = []
    truncated = False
    for idx, match in enumerate(compiled.finditer(sample_text)):
        if idx >= MAX_MATCHES:
            truncated = True
            break
        start, end = match.span()
        matches.append(
            {
                "index": idx,
                "start": start,
                "end": end,
                "value": match.group(0),
                "groups": [
                    g if g is not None else None for g in match.groups()
                ],
                "namedGroups": {
                    k: v for k, v in match.groupdict().items()
                },
            }
        )

    return {
        "ok": True,
        "pattern": pattern,
        "flags": normalized_flags,
        "sampleText": sample_text,
        "matchCount": len(matches),
        "truncated": truncated,
        "groupCount": compiled.groups,
        "namedGroupNames": list(compiled.groupindex.keys()),
        "matches": matches,
    }


@mcp.resource(
    APP_URI,
    name="JSON & Regex Visualizer UI",
    description="Self-contained interactive inline HTML app for exploring JSON payloads and testing Python regular expressions.",
    mime_type=MIME_TYPE,
    meta={"ui": {"prefersBorder": True}},
)
def visualizer_app_html() -> str:
    """Serve the bundled single-file HTML document.

    For fast UI iteration, set JSON_REGEX_APP_HTML to a local HTML path so
    reopening the inline card picks up edits without restarting the server.
    """
    override = os.environ.get("JSON_REGEX_APP_HTML")
    if override:
        candidate = Path(override).resolve()
        # Keep override constrained to readable .html files.
        if candidate.is_file() and candidate.suffix.lower() == ".html":
            return candidate.read_text(encoding="utf-8")

    if not DEFAULT_HTML_PATH.is_file():
        raise FileNotFoundError(
            f"Bundled UI not found at {DEFAULT_HTML_PATH}. Run `npm run build` in ui/."
        )
    return DEFAULT_HTML_PATH.read_text(encoding="utf-8")


@mcp.tool(
    name="inspect_json",
    title="Inspect JSON",
    description=(
        "Parse and visualize a JSON string as an interactive, searchable tree "
        "with JSONPath copy and schema statistics inline in the conversation."
    ),
    meta=INLINE_UI_META,
)
def inspect_json(
    json_text: str,
    title: str = "JSON Payload",
    expand_depth: int = 2,
) -> types.CallToolResult:
    """Inspect a JSON document and render it inline."""
    raw_bytes = len(json_text.encode("utf-8"))
    if raw_bytes > MAX_JSON_BYTES:
        message = f"JSON input is {raw_bytes:,} bytes, exceeding the {MAX_JSON_BYTES:,}-byte limit."
        return types.CallToolResult(
            content=[types.TextContent(type="text", text=message)],
            structured_content={"mode": "json", "ok": False, "title": title, "error": message},
            is_error=True,
        )

    try:
        parsed = json.loads(json_text)
    except json.JSONDecodeError as exc:
        message = f"Invalid JSON at line {exc.lineno}, column {exc.colno}: {exc.msg}"
        return types.CallToolResult(
            content=[types.TextContent(type="text", text=message)],
            structured_content={"mode": "json", "ok": False, "title": title, "error": message},
            is_error=True,
        )

    stats = _compute_json_stats(parsed)
    clamped_depth = max(0, min(expand_depth, 8))
    root_type = type(parsed).__name__

    # Plain-text summary for the LLM and CLI fallback (never dumps huge payloads blindly).
    summary_lines = [
        f"JSON Inspection: {title}",
        f"- Root type: {root_type} | Size: {raw_bytes:,} bytes | Max depth: {stats['maxDepth']}",
        (
            f"- Nodes: {stats['objects']} objects ({stats['totalKeys']} keys), "
            f"{stats['arrays']} arrays, {stats['strings']} strings, "
            f"{stats['numbers']} numbers, {stats['booleans']} booleans, {stats['nulls']} nulls"
        ),
    ]
    if isinstance(parsed, dict):
        top_keys = ", ".join(list(parsed.keys())[:10])
        suffix = " ..." if len(parsed) > 10 else ""
        summary_lines.append(f"- Top-level keys ({len(parsed)}): {top_keys}{suffix}")
    elif isinstance(parsed, list):
        summary_lines.append(f"- Top-level array length: {len(parsed)}")

    return types.CallToolResult(
        content=[types.TextContent(type="text", text="\n".join(summary_lines))],
        structured_content={
            "mode": "json",
            "ok": True,
            "title": title,
            "expandDepth": clamped_depth,
            "byteSize": raw_bytes,
            "stats": stats,
            "data": parsed,
        },
    )


@mcp.tool(
    name="test_regex",
    title="Test Regex",
    description=(
        "Test a Python regular expression against sample text and display "
        "highlighted matches, spans, and capture groups inline in the conversation."
    ),
    meta=INLINE_UI_META,
)
def test_regex(
    pattern: str,
    sample_text: str,
    flags: str = "",
    title: str = "Python Regex Tester",
) -> types.CallToolResult:
    """Evaluate a Python regex and render highlighted matches inline."""
    result = _evaluate_regex(pattern, sample_text, flags)
    if not result["ok"]:
        return types.CallToolResult(
            content=[types.TextContent(type="text", text=result["error"])],
            structured_content={"mode": "regex", "title": title, **result},
            is_error=True,
        )

    matches = result["matches"]
    lines = [
        f"Regex Test: {title}",
        f"- Pattern: /{result['pattern']}/{result['flags']}",
        f"- Matches: {result['matchCount']}"
        + (" (truncated at 500)" if result["truncated"] else ""),
    ]
    for m in matches[:10]:
        groups_desc = f" | groups={m['groups']}" if m["groups"] else ""
        lines.append(
            f"  [{m['index']}] ({m['start']}..{m['end']}): {m['value']!r}{groups_desc}"
        )
    if len(matches) > 10:
        lines.append(f"  ... and {len(matches) - 10} more match(es)")

    return types.CallToolResult(
        content=[types.TextContent(type="text", text="\n".join(lines))],
        structured_content={"mode": "regex", "title": title, **result},
    )


@mcp.tool(
    name="app_test_regex",
    title="Live Regex Evaluation (App Only)",
    description="Re-evaluate a Python regular expression interactively from the MCP App UI.",
    meta=APP_ONLY_META,
)
def app_test_regex(
    pattern: str,
    sample_text: str,
    flags: str = "",
) -> types.CallToolResult:
    """App-only tool hidden from the model; called via app.callServerTool()."""
    result = _evaluate_regex(pattern, sample_text, flags)
    text = (
        f"Matched {result['matchCount']} time(s)."
        if result["ok"]
        else result["error"]
    )
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=text)],
        structured_content={"mode": "regex", **result},
        is_error=not result["ok"],
    )


if __name__ == "__main__":
    mcp.run(transport="stdio")
