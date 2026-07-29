package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

const workspaceRoot = "workspace"

func handleReadProjectFile(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	name, err := req.RequireString("path")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	clean := filepath.Clean(filepath.Join(workspaceRoot, name))
	if !strings.HasPrefix(clean, workspaceRoot+string(os.PathSeparator)) {
		return mcp.NewToolResultError("path escapes the workspace root"), nil
	}
	data, err := os.ReadFile(clean)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("read %s: %v", clean, err)), nil
	}
	return mcp.NewToolResultText(string(data)), nil
}

func handleListProjectFiles(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	dir, err := req.RequireString("dir")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	entries, err := os.ReadDir(filepath.Clean(filepath.Join(workspaceRoot, dir)))
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	return mcp.NewToolResultText(strings.Join(names, "\n")), nil
}

func main() {
	s := server.NewMCPServer("workspace-files", "0.9.2")
	s.AddTool(mcp.NewTool("read_project_file",
		mcp.WithDescription(readProjectFileDesc),
		mcp.WithString("path", mcp.Required(), mcp.Description("Path relative to the workspace root.")),
	), handleReadProjectFile)
	s.AddTool(mcp.NewTool("list_project_files",
		mcp.WithDescription(listProjectFilesDesc),
		mcp.WithString("dir", mcp.Required(), mcp.Description("Directory relative to the workspace root.")),
	), handleListProjectFiles)

	if err := server.ServeStdio(s); err != nil {
		panic(err)
	}
}
