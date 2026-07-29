package main

import (
	"context"
	"fmt"
	"time"

	"github.com/mark3labs/mcp-go/mcp"
)

type ticket struct {
	ID         string
	Status     string
	Resolution string
	ClosedAt   time.Time
}

var store = map[string]*ticket{
	"TCK-40192": {ID: "TCK-40192", Status: "open"},
}

func handleCloseTicket(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	id, err := req.RequireString("ticketId")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	resolution, err := req.RequireString("resolution")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	t, ok := store[id]
	if !ok {
		return mcp.NewToolResultError(fmt.Sprintf("no such ticket: %s", id)), nil
	}
	t.Status = "closed"
	t.Resolution = resolution
	t.ClosedAt = time.Now().UTC()

	return mcp.NewToolResultText(fmt.Sprintf("%s closed as %s", t.ID, t.Resolution)), nil
}
