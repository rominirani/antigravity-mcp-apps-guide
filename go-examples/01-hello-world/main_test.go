package main

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestHelloMCPApp(t *testing.T) {
	ctx := context.Background()
	serverTransport, clientTransport := mcp.NewInMemoryTransports()

	server := newHelloServer()
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

	// 1. Verify tool metadata links to ui://hello-world/app.html
	toolsRes, err := session.ListTools(ctx, nil)
	if err != nil {
		t.Fatalf("ListTools: %v", err)
	}
	if len(toolsRes.Tools) != 1 || toolsRes.Tools[0].Name != "say_hello" {
		t.Fatalf("unexpected tools: %+v", toolsRes.Tools)
	}
	uiMeta, _ := toolsRes.Tools[0].Meta["ui"].(map[string]any)
	if uiMeta["resourceUri"] != appURI {
		t.Fatalf("expected resourceUri=%q, got %v", appURI, toolsRes.Tools[0].Meta)
	}

	// 2. Verify UI resource serves text/html;profile=mcp-app under 10 MiB
	readRes, err := session.ReadResource(ctx, &mcp.ReadResourceParams{URI: appURI})
	if err != nil {
		t.Fatalf("ReadResource: %v", err)
	}
	if len(readRes.Contents) != 1 {
		t.Fatalf("expected 1 resource content, got %d", len(readRes.Contents))
	}
	html := readRes.Contents[0]
	if html.MIMEType != appMIMEType {
		t.Fatalf("expected mimeType=%q, got %q", appMIMEType, html.MIMEType)
	}
	if !strings.Contains(html.Text, "<!DOCTYPE html>") || len(html.Text) < 1000 {
		t.Fatalf("unexpected HTML payload length: %d", len(html.Text))
	}
	t.Logf("UI resource verified: mimeType=%s size=%d bytes", html.MIMEType, len(html.Text))

	// 3. Call say_hello twice (simulating initial agent call + interactive button click)
	for wantCount := int64(1); wantCount <= 2; wantCount++ {
		callRes, err := session.CallTool(ctx, &mcp.CallToolParams{
			Name:      "say_hello",
			Arguments: map[string]any{"name": "Ada"},
		})
		if err != nil {
			t.Fatalf("CallTool #%d: %v", wantCount, err)
		}
		textBlock, ok := callRes.Content[0].(*mcp.TextContent)
		if !ok || !strings.Contains(textBlock.Text, "Hello, Ada!") {
			t.Fatalf("unexpected text content: %+v", callRes.Content)
		}
		raw, err := json.Marshal(callRes.StructuredContent)
		if err != nil {
			t.Fatalf("marshal structuredContent: %v", err)
		}
		var out HelloOutput
		if err := json.Unmarshal(raw, &out); err != nil {
			t.Fatalf("unmarshal HelloOutput: %v", err)
		}
		if out.PingCount != wantCount {
			t.Fatalf("expected pingCount=%d, got %d", wantCount, out.PingCount)
		}
		t.Logf("Call #%d text: %s", wantCount, textBlock.Text)
	}
}
