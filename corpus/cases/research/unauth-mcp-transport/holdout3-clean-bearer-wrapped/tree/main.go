package main

import (
	"crypto/subtle"
	"net/http"
	"os"
)

// mcpHandler is the streamable-HTTP MCP endpoint (transport wiring elsewhere).
func mcpHandler(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte(`{"jsonrpc":"2.0","result":{}}`))
}

// requireBearer wraps a handler so no request reaches it without a valid token.
func requireBearer(next http.HandlerFunc) http.HandlerFunc {
	want := "Bearer " + os.Getenv("MCP_TOKEN")
	return func(w http.ResponseWriter, r *http.Request) {
		got := r.Header.Get("Authorization")
		if subtle.ConstantTimeCompare([]byte(got), []byte(want)) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

func main() {
	mux := http.NewServeMux()
	// Bound to 0.0.0.0 (looks public), but the handler is bearer-gated, so
	// reaching the port is not enough to drive the agent.
	mux.HandleFunc("/mcp", requireBearer(mcpHandler))
	http.ListenAndServe("0.0.0.0:8080", mux)
}
