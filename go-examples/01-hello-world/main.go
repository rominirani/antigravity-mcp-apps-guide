// Example 1 (Go): Minimal Hello World MCP App.
//
// Combines the official MCP Go SDK (github.com/modelcontextprotocol/go-sdk)
// with `//go:embed` so the server and its bundled single-file HTML UI ship as
// a single executable binary.
package main

import (
	"context"
	_ "embed"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const (
	appURI      = "ui://hello-world/app.html"
	appMIMEType = "text/html;profile=mcp-app"
)

//go:embed dist/app.html
var embeddedAppHTML string

// HelloInput defines the arguments accepted by the say_hello tool.
type HelloInput struct {
	Name string `json:"name,omitempty" jsonschema:"Name of the person to greet (defaults to Developer)"`
}

// HelloOutput is serialized into CallToolResult.StructuredContent for the UI.
type HelloOutput struct {
	Name       string `json:"name"`
	Greeting   string `json:"greeting"`
	ServerTime string `json:"serverTime"`
	PingCount  int64  `json:"pingCount"`
}

func loadAppHTML() (string, error) {
	// Optional fast UI iteration override: set HELLO_APP_HTML to a local .html
	// file so closing and reopening the view picks up edits without recompiling.
	if override := strings.TrimSpace(os.Getenv("HELLO_APP_HTML")); override != "" {
		clean := filepath.Clean(override)
		if strings.EqualFold(filepath.Ext(clean), ".html") {
			data, err := os.ReadFile(clean)
			if err != nil {
				return "", fmt.Errorf("read HELLO_APP_HTML: %w", err)
			}
			return string(data), nil
		}
	}
	return embeddedAppHTML, nil
}

func newHelloServer() *mcp.Server {
	var pingCount atomic.Int64

	server := mcp.NewServer(&mcp.Implementation{
		Name:    "hello-mcp-app",
		Version: "1.0.0",
	}, nil)

	// 1. Register the self-contained HTML UI as a ui:// resource.
	server.AddResource(&mcp.Resource{
		URI:         appURI,
		Name:        "Hello World Card",
		Description: "Minimal inline greeting and server clock MCP App.",
		MIMEType:    appMIMEType,
		Meta: mcp.Meta{
			"ui": map[string]any{"prefersBorder": true},
		},
	}, func(ctx context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
		html, err := loadAppHTML()
		if err != nil {
			return nil, err
		}
		return &mcp.ReadResourceResult{
			Contents: []*mcp.ResourceContents{
				{
					URI:      appURI,
					MIMEType: appMIMEType,
					Text:     html,
					Meta: mcp.Meta{
						"ui": map[string]any{"prefersBorder": true},
					},
				},
			},
		}, nil
	})

	// 2. Register one tool and point _meta.ui.resourceUri at the resource above.
	mcp.AddTool(server, &mcp.Tool{
		Name:        "say_hello",
		Title:       "Say Hello",
		Description: "Greet someone by name and render an interactive inline greeting card with a live server clock.",
		Meta: mcp.Meta{
			"ui": map[string]any{
				"resourceUri": appURI,
			},
		},
	}, func(ctx context.Context, req *mcp.CallToolRequest, input HelloInput) (*mcp.CallToolResult, HelloOutput, error) {
		name := strings.TrimSpace(input.Name)
		if name == "" {
			name = "Developer"
		}
		if len(name) > 80 {
			name = name[:80]
		}

		count := pingCount.Add(1)
		now := time.Now().UTC().Format(time.RFC3339Nano)
		greeting := fmt.Sprintf("Hello, %s!", name)

		out := HelloOutput{
			Name:       name,
			Greeting:   greeting,
			ServerTime: now,
			PingCount:  count,
		}

		// Plain-text Content is read by the LLM and CLI hosts (such as `agy`);
		// out is automatically serialized into StructuredContent for the iframe.
		result := &mcp.CallToolResult{
			Content: []mcp.Content{
				&mcp.TextContent{
					Text: fmt.Sprintf("%s (Server time: %s, call #%d)", greeting, now, count),
				},
			},
		}
		return result, out, nil
	})

	return server
}

func main() {
	server := newHelloServer()
	if err := server.Run(context.Background(), &mcp.StdioTransport{}); err != nil {
		log.Fatal(err)
	}
}
