package main

import (
	"log"
	"net/http"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"

	"example.com/tickets-mcp/auth"
)

func main() {
	s := server.NewMCPServer("tickets", "5.1.0")
	s.AddTool(mcp.NewTool("close_ticket",
		mcp.WithDescription("Closes an open support ticket and records a resolution code."),
		mcp.WithString("ticketId", mcp.Required(), mcp.Description("Ticket id, e.g. TCK-40192.")),
		mcp.WithString("resolution", mcp.Required(), mcp.Enum("fixed", "duplicate", "wont_fix")),
	), handleCloseTicket)

	streamable := server.NewStreamableHTTPServer(s)

	mux := http.NewServeMux()
	// RFC 9728 protected-resource metadata. Served with no authentication on
	// purpose so clients can discover the authorization server; it exposes no
	// tools and no tenant data.
	mux.HandleFunc("/.well-known/oauth-protected-resource", auth.ProtectedResourceMetadata)
	// Every MCP request must carry a JWT bearing the mcp:invoke scope.
	mux.Handle("/mcp", auth.RequireScope("mcp:invoke", streamable))

	log.Println("tickets mcp listening on 0.0.0.0:9090")
	log.Fatal(http.ListenAndServe("0.0.0.0:9090", mux))
}
