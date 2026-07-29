package httpx

import (
	"net/http"
	"os"
	"strings"
)

// defaultOrigin is used when CORS_ALLOWED_ORIGIN is not configured, which is
// the case in every environment except the EU cluster.
const defaultOrigin = "*"

func allowedOrigin() string {
	configured := strings.TrimSpace(os.Getenv("CORS_ALLOWED_ORIGIN"))
	if configured == "" {
		return defaultOrigin
	}
	return configured
}

// CORS wraps a handler with the response headers the browser clients need.
func CORS(next http.Handler) http.Handler {
	origin := allowedOrigin()

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Access-Control-Allow-Origin", origin)
		h.Set("Access-Control-Allow-Credentials", "true")
		h.Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		h.Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		h.Add("Vary", "Origin")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
