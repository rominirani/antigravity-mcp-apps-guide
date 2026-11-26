// Example 2 (Go): Interactive Inline Quick Checklist MCP App.
//
// Builds directly on Hello World by introducing three practical patterns while
// staying inline in chat:
//  1. App-only tools (`visibility: ["app"]`) hidden from the LLM.
//  2. Eager server-side persistence in `${PLUGIN_DATA}` (since iframe storage
//     is ephemeral and Antigravity does not send `ui/resource-teardown`).
//  3. Attaching current UI state to the user's next prompt via
//     `app.updateModelContext()`.
package main

import (
	"context"
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const (
	appURI      = "ui://quick-checklist/app.html"
	appMIMEType = "text/html;profile=mcp-app"
	maxItems    = 50
)

var safeIDPattern = regexp.MustCompile(`^[a-z0-9-]+$`)

//go:embed dist/app.html
var embeddedAppHTML string

type ChecklistItem struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Done  bool   `json:"done"`
}

type Checklist struct {
	ID        string          `json:"id"`
	Title     string          `json:"title"`
	Items     []ChecklistItem `json:"items"`
	DoneCount int             `json:"doneCount"`
	Total     int             `json:"total"`
	UpdatedAt string          `json:"updatedAt"`
}

type CreateChecklistInput struct {
	Title string   `json:"title" jsonschema:"Heading for the checklist (e.g. Release Preflight)"`
	Items []string `json:"items" jsonschema:"Initial list of checklist item labels"`
}

type ToggleItemInput struct {
	ChecklistID string `json:"checklistId" jsonschema:"Checklist ID"`
	ItemID      string `json:"itemId" jsonschema:"Item ID to toggle"`
}

type AddItemInput struct {
	ChecklistID string `json:"checklistId" jsonschema:"Checklist ID"`
	Label       string `json:"label" jsonschema:"Text for the new checklist item"`
}

// checklistStore persists checklists eagerly to ${PLUGIN_DATA}/checklists.json.
type checklistStore struct {
	mu      sync.Mutex
	dataDir string
	lists   map[string]*Checklist
}

func newChecklistStore(dataDir string) *checklistStore {
	s := &checklistStore{
		dataDir: dataDir,
		lists:   make(map[string]*Checklist),
	}
	s.loadFromDisk()
	return s
}

func (s *checklistStore) filePath() string {
	return filepath.Join(s.dataDir, "checklists.json")
}

func (s *checklistStore) loadFromDisk() {
	raw, err := os.ReadFile(s.filePath())
	if err != nil {
		return
	}
	var loaded map[string]*Checklist
	if err := json.Unmarshal(raw, &loaded); err == nil && loaded != nil {
		s.lists = loaded
	}
}

func (s *checklistStore) saveLocked() error {
	if err := os.MkdirAll(s.dataDir, 0o700); err != nil {
		return fmt.Errorf("create plugin data dir: %w", err)
	}
	encoded, err := json.MarshalIndent(s.lists, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal checklists: %w", err)
	}
	tmpPath := s.filePath() + ".tmp"
	if err := os.WriteFile(tmpPath, encoded, 0o600); err != nil {
		return fmt.Errorf("write temp checklist file: %w", err)
	}
	if err := os.Rename(tmpPath, s.filePath()); err != nil {
		return fmt.Errorf("commit checklist file: %w", err)
	}
	return nil
}

func randomID(prefix string) string {
	var b [6]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("%s-%d", prefix, time.Now().UnixNano())
	}
	return prefix + "-" + hex.EncodeToString(b[:])
}

func recomputeCounts(c *Checklist) {
	done := 0
	for _, it := range c.Items {
		if it.Done {
			done++
		}
	}
	c.DoneCount = done
	c.Total = len(c.Items)
	c.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
}

func cloneChecklist(c *Checklist) Checklist {
	itemsCopy := make([]ChecklistItem, len(c.Items))
	copy(itemsCopy, c.Items)
	return Checklist{
		ID:        c.ID,
		Title:     c.Title,
		Items:     itemsCopy,
		DoneCount: c.DoneCount,
		Total:     c.Total,
		UpdatedAt: c.UpdatedAt,
	}
}

func (s *checklistStore) Create(title string, rawItems []string) (Checklist, error) {
	cleanTitle := strings.TrimSpace(title)
	if cleanTitle == "" {
		cleanTitle = "Checklist"
	}
	if len(cleanTitle) > 120 {
		cleanTitle = cleanTitle[:120]
	}

	items := make([]ChecklistItem, 0, len(rawItems))
	for _, label := range rawItems {
		trimmed := strings.TrimSpace(label)
		if trimmed == "" {
			continue
		}
		if len(trimmed) > 200 {
			trimmed = trimmed[:200]
		}
		items = append(items, ChecklistItem{
			ID:    randomID("item"),
			Label: trimmed,
			Done:  false,
		})
		if len(items) >= maxItems {
			break
		}
	}
	if len(items) == 0 {
		return Checklist{}, errors.New("at least one non-empty checklist item is required")
	}

	c := &Checklist{
		ID:    randomID("list"),
		Title: cleanTitle,
		Items: items,
	}
	recomputeCounts(c)

	s.mu.Lock()
	defer s.mu.Unlock()
	s.lists[c.ID] = c
	if err := s.saveLocked(); err != nil {
		return Checklist{}, err
	}
	return cloneChecklist(c), nil
}

func (s *checklistStore) Toggle(checklistID, itemID string) (Checklist, error) {
	if !safeIDPattern.MatchString(checklistID) || !safeIDPattern.MatchString(itemID) {
		return Checklist{}, errors.New("invalid checklist or item identifier")
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.lists[checklistID]
	if !ok {
		return Checklist{}, fmt.Errorf("checklist %q not found", checklistID)
	}
	found := false
	for i := range c.Items {
		if c.Items[i].ID == itemID {
			c.Items[i].Done = !c.Items[i].Done
			found = true
			break
		}
	}
	if !found {
		return Checklist{}, fmt.Errorf("item %q not found", itemID)
	}
	recomputeCounts(c)
	if err := s.saveLocked(); err != nil {
		return Checklist{}, err
	}
	return cloneChecklist(c), nil
}

func (s *checklistStore) AddItem(checklistID, label string) (Checklist, error) {
	if !safeIDPattern.MatchString(checklistID) {
		return Checklist{}, errors.New("invalid checklist identifier")
	}
	trimmed := strings.TrimSpace(label)
	if trimmed == "" {
		return Checklist{}, errors.New("item label cannot be empty")
	}
	if len(trimmed) > 200 {
		trimmed = trimmed[:200]
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.lists[checklistID]
	if !ok {
		return Checklist{}, fmt.Errorf("checklist %q not found", checklistID)
	}
	if len(c.Items) >= maxItems {
		return Checklist{}, fmt.Errorf("checklist reached maximum of %d items", maxItems)
	}
	c.Items = append(c.Items, ChecklistItem{
		ID:    randomID("item"),
		Label: trimmed,
		Done:  false,
	})
	recomputeCounts(c)
	if err := s.saveLocked(); err != nil {
		return Checklist{}, err
	}
	return cloneChecklist(c), nil
}

func formatChecklistSummary(c Checklist) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Checklist: %s (%d/%d complete)\n", c.Title, c.DoneCount, c.Total)
	for _, it := range c.Items {
		box := "[ ]"
		if it.Done {
			box = "[x]"
		}
		fmt.Fprintf(&b, "- %s %s\n", box, it.Label)
	}
	return strings.TrimRight(b.String(), "\n")
}

func loadAppHTML() (string, error) {
	if override := strings.TrimSpace(os.Getenv("CHECKLIST_APP_HTML")); override != "" {
		clean := filepath.Clean(override)
		if strings.EqualFold(filepath.Ext(clean), ".html") {
			data, err := os.ReadFile(clean)
			if err != nil {
				return "", fmt.Errorf("read CHECKLIST_APP_HTML: %w", err)
			}
			return string(data), nil
		}
	}
	return embeddedAppHTML, nil
}

func newChecklistServer(dataDir string) *mcp.Server {
	store := newChecklistStore(dataDir)

	server := mcp.NewServer(&mcp.Implementation{
		Name:    "quick-checklist-go",
		Version: "1.0.0",
	}, nil)

	// 1. Register the embedded single-file HTML UI resource.
	server.AddResource(&mcp.Resource{
		URI:         appURI,
		Name:        "Quick Checklist Card",
		Description: "Interactive inline checklist with persistent toggles and prompt context attachment.",
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

	// 2. Model-callable tool: creates a checklist and renders it inline.
	mcp.AddTool(server, &mcp.Tool{
		Name:        "create_checklist",
		Title:       "Create Checklist",
		Description: "Create an interactive checklist rendered inline in the conversation (e.g., for PR reviews or release preflight steps).",
		Meta: mcp.Meta{
			"ui": map[string]any{
				"resourceUri": appURI,
			},
		},
	}, func(ctx context.Context, req *mcp.CallToolRequest, input CreateChecklistInput) (*mcp.CallToolResult, Checklist, error) {
		c, err := store.Create(input.Title, input.Items)
		if err != nil {
			return nil, Checklist{}, err
		}
		res := &mcp.CallToolResult{
			Content: []mcp.Content{
				&mcp.TextContent{Text: formatChecklistSummary(c)},
			},
		}
		return res, c, nil
	})

	// 3. App-only tool: toggles an item and persists immediately to ${PLUGIN_DATA}.
	//    Hidden from the LLM in UI hosts via visibility: ["app"].
	mcp.AddTool(server, &mcp.Tool{
		Name:        "app_toggle_item",
		Title:       "Toggle Checklist Item (App Only)",
		Description: "Toggle a checklist item's completion state from the checklist UI.",
		Meta: mcp.Meta{
			"ui": map[string]any{
				"visibility": []string{"app"},
			},
		},
	}, func(ctx context.Context, req *mcp.CallToolRequest, input ToggleItemInput) (*mcp.CallToolResult, Checklist, error) {
		c, err := store.Toggle(input.ChecklistID, input.ItemID)
		if err != nil {
			return nil, Checklist{}, err
		}
		res := &mcp.CallToolResult{
			Content: []mcp.Content{
				&mcp.TextContent{Text: formatChecklistSummary(c)},
			},
		}
		return res, c, nil
	})

	// 4. App-only tool: appends a new item from the UI input box.
	mcp.AddTool(server, &mcp.Tool{
		Name:        "app_add_item",
		Title:       "Add Checklist Item (App Only)",
		Description: "Append a new item to an existing checklist from the UI.",
		Meta: mcp.Meta{
			"ui": map[string]any{
				"visibility": []string{"app"},
			},
		},
	}, func(ctx context.Context, req *mcp.CallToolRequest, input AddItemInput) (*mcp.CallToolResult, Checklist, error) {
		c, err := store.AddItem(input.ChecklistID, input.Label)
		if err != nil {
			return nil, Checklist{}, err
		}
		res := &mcp.CallToolResult{
			Content: []mcp.Content{
				&mcp.TextContent{Text: formatChecklistSummary(c)},
			},
		}
		return res, c, nil
	})

	return server
}

func main() {
	dataDir := strings.TrimSpace(os.Getenv("PLUGIN_DATA"))
	if dataDir == "" {
		dataDir = ".plugin-data"
	}
	server := newChecklistServer(dataDir)
	if err := server.Run(context.Background(), &mcp.StdioTransport{}); err != nil {
		log.Fatal(err)
	}
}
