package main

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"
)

// envKey maps an integration name such as "stripe-prod" onto CRED_STRIPE_PROD.
func envKey(name string) string {
	return "CRED_" + strings.ToUpper(strings.ReplaceAll(name, "-", "_"))
}

func handleGetCredential(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	name, err := req.RequireString("name")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	value := os.Getenv(envKey(name))
	if value == "" {
		return mcp.NewToolResultError(fmt.Sprintf("no credential stored for %q", name)), nil
	}
	return mcp.NewToolResultText(value), nil
}
