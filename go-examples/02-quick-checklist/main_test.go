package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestQuickChecklistMCPApp(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()

	serverTransport, clientTransport := mcp.NewInMemoryTransports()
	server := newChecklistServer(dataDir)
	serverSession, err := server.Connect(ctx, serverTransport, nil)
	if err != nil {
		t.Fatalf("server connect: %v", err)
	}
	defer serverSession.Close()

	client := mcp.NewClient(&mcp.Implementation{Name: "test-client", Version: "1.0.0"}, nil)
	session, err := client.Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatalf("client connect: %v", err)
	}
	defer session.Close()

	// 1. Verify tool metadata (resourceUri on create_checklist, visibility:["app"] on helpers)
	toolsRes, err := session.ListTools(ctx, nil)
	if err != nil {
		t.Fatalf("ListTools: %v", err)
	}
	toolMap := make(map[string]*mcp.Tool)
	for _, tool := range toolsRes.Tools {
		toolMap[tool.Name] = tool
	}
	createUI, _ := toolMap["create_checklist"].Meta["ui"].(map[string]any)
	if createUI["resourceUri"] != appURI {
		t.Fatalf("expected resourceUri=%q, got %v", appURI, createUI)
	}
	toggleUI, _ := toolMap["app_toggle_item"].Meta["ui"].(map[string]any)
	if vis, ok := toggleUI["visibility"].([]any); !ok || len(vis) != 1 || vis[0] != "app" {
		t.Fatalf("expected app_toggle_item visibility=[\"app\"], got %#v", toggleUI["visibility"])
	}

	// 2. Verify embedded HTML resource
	readRes, err := session.ReadResource(ctx, &mcp.ReadResourceParams{URI: appURI})
	if err != nil {
		t.Fatalf("ReadResource: %v", err)
	}
	if readRes.Contents[0].MIMEType != appMIMEType {
		t.Fatalf("unexpected mimeType: %q", readRes.Contents[0].MIMEType)
	}
	t.Logf("UI resource verified: mimeType=%s size=%d bytes", readRes.Contents[0].MIMEType, len(readRes.Contents[0].Text))

	decodeChecklist := func(res *mcp.CallToolResult) Checklist {
		t.Helper()
		raw, err := json.Marshal(res.StructuredContent)
		if err != nil {
			t.Fatalf("marshal structuredContent: %v", err)
		}
		var out Checklist
		if err := json.Unmarshal(raw, &out); err != nil {
			t.Fatalf("unmarshal Checklist: %v", err)
		}
		return out
	}

	// 3. Create checklist (simulating agent call)
	createRes, err := session.CallTool(ctx, &mcp.CallToolParams{
		Name: "create_checklist",
		Arguments: map[string]any{
			"title": "PR Review Checklist",
			"items": []string{"Run go test ./...", "Check error handling", "Verify plugin manifest"},
		},
	})
	if err != nil {
		t.Fatalf("create_checklist: %v", err)
	}
	created := decodeChecklist(createRes)
	if created.Total != 3 || created.DoneCount != 0 {
		t.Fatalf("expected 0/3 done, got %d/%d", created.DoneCount, created.Total)
	}
	t.Logf("Created:\n%s", createRes.Content[0].(*mcp.TextContent).Text)

	// 4. Toggle first item via app-only tool
	toggleRes, err := session.CallTool(ctx, &mcp.CallToolParams{
		Name: "app_toggle_item",
		Arguments: map[string]any{
			"checklistId": created.ID,
			"itemId":      created.Items[0].ID,
		},
	})
	if err != nil {
		t.Fatalf("app_toggle_item: %v", err)
	}
	toggled := decodeChecklist(toggleRes)
	if toggled.DoneCount != 1 || !toggled.Items[0].Done {
		t.Fatalf("expected 1/3 done after toggle, got %d/%d", toggled.DoneCount, toggled.Total)
	}

	// 5. Add a 4th item via app-only tool
	addRes, err := session.CallTool(ctx, &mcp.CallToolParams{
		Name: "app_add_item",
		Arguments: map[string]any{
			"checklistId": created.ID,
			"label":       "Update CHANGELOG.md",
		},
	})
	if err != nil {
		t.Fatalf("app_add_item: %v", err)
	}
	added := decodeChecklist(addRes)
	if added.Total != 4 || added.DoneCount != 1 {
		t.Fatalf("expected 1/4 after add, got %d/%d", added.DoneCount, added.Total)
	}
	t.Logf("After UI edits:\n%s", addRes.Content[0].(*mcp.TextContent).Text)

	// 6. Verify eager persistence on disk in PLUGIN_DATA
	persisted, err := os.ReadFile(filepath.Join(dataDir, "checklists.json"))
	if err != nil {
		t.Fatalf("expected persisted checklists.json: %v", err)
	}
	if !strings.Contains(string(persisted), "Update CHANGELOG.md") {
		t.Fatalf("persisted file missing newly added item")
	}
}
