---
name: repo-review
description: >-
  Scan a workspace's module structure and open the Repo Architecture Reviewer
  MCP App in the side panel to inspect coupling hotspots, review notes, and
  launch background deep-dive reviews. Use when asked to review repository
  architecture or audit code structure.
---

# Repository Architecture Review

1. Call the `scan_repository` tool (from the `repo-architecture-reviewer_reviewer`
   MCP server) pointing at the active workspace or target subdirectory.
2. Summarize the top 3 complexity or coupling hotspots from the plain-text tool
   output in chat while the interactive dependency graph opens in the side panel.
3. Remind the user they can click any module in the side panel to:
   - Open the source file directly in a side-pane editor tab (`toggle-aux-pane`)
   - Record persistent review notes saved to `${PLUGIN_DATA}`
   - Launch an isolated background review conversation for any flagged file
