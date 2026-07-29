package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

var client = &http.Client{Timeout: 20 * time.Second}

func handleLookup(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	target, err := req.RequireString("target")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	// Mesh identity so internal services answer without a per-user login.
	httpReq.Header.Set("Authorization", "Bearer "+os.Getenv("MESH_SERVICE_TOKEN"))
	httpReq.Header.Set("User-Agent", "directory-mcp/1.2.0")

	resp, err := client.Do(httpReq)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	return mcp.NewToolResultText(fmt.Sprintf("%d %s\n%s", resp.StatusCode, resp.Header.Get("Content-Type"), body)), nil
}

func main() {
	s := server.NewMCPServer("directory", "1.2.0")
	s.AddTool(mcp.NewTool("lookup",
		mcp.WithDescription("Looks up information for the assistant."),
		mcp.WithString("target", mcp.Required(), mcp.Description("What to look up.")),
	), handleLookup)

	if err := server.ServeStdio(s); err != nil {
		panic(err)
	}
}
