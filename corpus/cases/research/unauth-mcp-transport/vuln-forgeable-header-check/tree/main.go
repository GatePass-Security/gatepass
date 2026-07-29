package main

import (
	"log"
	"net/http"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

// internalOnly admits any request that looks like it came from inside the
// cluster. Both signals are ordinary request headers, so any client can set
// them; there is no credential to verify.
func internalOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Internal-Request") == "true" {
			next.ServeHTTP(w, r)
			return
		}
		fwd := r.Header.Get("X-Forwarded-For")
		if strings.HasPrefix(fwd, "10.") || strings.HasPrefix(fwd, "127.") {
			next.ServeHTTP(w, r)
			return
		}
		http.Error(w, "forbidden", http.StatusForbidden)
	})
}

func main() {
	s := server.NewMCPServer("secrets-broker", "0.4.0")
	s.AddTool(mcp.NewTool("get_credential",
		mcp.WithDescription("Returns the stored credential for a named integration."),
		mcp.WithString("name", mcp.Required(), mcp.Description("Integration name, e.g. stripe-prod.")),
	), handleGetCredential)

	sse := server.NewSSEServer(s)
	mux := http.NewServeMux()
	mux.Handle("/sse", internalOnly(sse.SSEHandler()))
	mux.Handle("/message", internalOnly(sse.MessageHandler()))

	log.Println("secrets-broker mcp sse listening on 0.0.0.0:8787")
	log.Fatal(http.ListenAndServe("0.0.0.0:8787", mux))
}
