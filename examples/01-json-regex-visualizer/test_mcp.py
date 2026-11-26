"""End-to-end stdio MCP protocol verification script for Example 1."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

from mcp import Client
from mcp.client.stdio import StdioServerParameters


async def main() -> None:
    project_dir = Path(__file__).resolve().parent
    server_params = StdioServerParameters(
        command=sys.executable,
        args=[str(project_dir / "server.py")],
    )

    async with Client(server_params) as client:
        tools = await client.list_tools()
        print("=== TOOLS ===")
        for t in tools.tools:
            print(f"- {t.name}: meta={t.meta}")

        resources = await client.list_resources()
        print("\n=== RESOURCES ===")
        for r in resources.resources:
            print(f"- {r.uri} ({r.mime_type}) meta={r.meta}")

        html_res = await client.read_resource("ui://json-regex-visualizer/app.html")
        html_content = html_res.contents[0]
        html_len = len(html_content.text)
        print(
            f"\n=== UI RESOURCE ===\n"
            f"mimeType={html_content.mime_type} | size={html_len:,} bytes "
            f"| has_doctype={'<!DOCTYPE html>' in html_content.text}"
        )
        assert html_content.mime_type == "text/html;profile=mcp-app"
        assert html_len > 1000 and html_len < 10 * 1024 * 1024

        sample_json = json.dumps(
            {
                "service": "checkout-api",
                "version": "2.4.1",
                "healthy": True,
                "endpoints": [
                    {"path": "/v1/orders", "p95_ms": 42.5},
                    {"path": "/v1/refunds", "p95_ms": 118.2},
                ],
            }
        )
        json_result = await client.call_tool(
            "inspect_json",
            {"json_text": sample_json, "title": "Checkout Health"},
        )
        print("\n=== inspect_json (plain-text content for LLM/CLI) ===")
        print(json_result.content[0].text)
        assert json_result.structured_content["mode"] == "json"
        assert json_result.structured_content["stats"]["totalKeys"] == 8

        regex_result = await client.call_tool(
            "test_regex",
            {
                "pattern": r"(?P<level>ERROR|WARN)\s+(?P<code_id>[A-Z]+-\d+):\s+(?P<msg>.+)",
                "sample_text": (
                    "INFO  SYS-001: boot ok\n"
                    "WARN  DB-408: query exceeded 250ms\n"
                    "ERROR AUTH-401: expired session token\n"
                ),
                "flags": "m",
                "title": "Service Log Matcher",
            },
        )
        print("\n=== test_regex (plain-text content for LLM/CLI) ===")
        print(regex_result.content[0].text)
        assert regex_result.structured_content["matchCount"] == 2
        assert regex_result.structured_content["matches"][1]["namedGroups"]["code_id"] == "AUTH-401"

        app_only_result = await client.call_tool(
            "app_test_regex",
            {
                "pattern": r"\d+ms",
                "sample_text": "latency 42ms and 118ms",
            },
        )
        print("\n=== app_test_regex (app-only helper) ===")
        print(app_only_result.content[0].text)
        assert app_only_result.structured_content["matchCount"] == 2

        print("\nALL EXAMPLE 1 CHECKS PASSED!")


if __name__ == "__main__":
    asyncio.run(main())
