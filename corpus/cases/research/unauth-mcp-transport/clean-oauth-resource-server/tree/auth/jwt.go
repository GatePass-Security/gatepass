package auth

import (
	"encoding/json"
	"net/http"
	"os"
	"slices"
	"strings"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
)

var jwks, _ = keyfunc.NewDefault([]string{os.Getenv("OIDC_JWKS_URL")})

type claims struct {
	Scope string `json:"scope"`
	jwt.RegisteredClaims
}

// RequireScope rejects any request whose bearer token is absent, unverifiable,
// expired, issued for another audience, or missing the named scope.
func RequireScope(scope string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")

		var c claims
		token, err := jwt.ParseWithClaims(raw, &c, jwks.Keyfunc,
			jwt.WithAudience("tickets-mcp"),
			jwt.WithIssuer(os.Getenv("OIDC_ISSUER")),
			jwt.WithValidMethods([]string{"RS256", "ES256"}),
		)
		if err != nil || !token.Valid || !slices.Contains(strings.Fields(c.Scope), scope) {
			w.Header().Set("WWW-Authenticate",
				`Bearer resource_metadata="/.well-known/oauth-protected-resource"`)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ProtectedResourceMetadata implements RFC 9728 discovery for this resource.
func ProtectedResourceMetadata(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"resource":              "https://tickets.example.com/mcp",
		"authorization_servers": []string{os.Getenv("OIDC_ISSUER")},
		"scopes_supported":      []string{"mcp:invoke"},
		"bearer_methods_supported": []string{"header"},
	})
}
