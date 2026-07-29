package main

import (
	"encoding/json"
	"log"
	"net/http"

	"example.com/accounts-api/internal/httpx"
)

type apiToken struct {
	Label  string `json:"label"`
	Secret string `json:"secret"`
}

// lookupTokens is a stand-in for the tokens table.
func lookupTokens(session string) []apiToken {
	if session == "" {
		return nil
	}
	return []apiToken{
		{Label: "ci-runner", Secret: "fake-token-not-real-aaaa1111"},
		{Label: "laptop", Secret: "fake-token-not-real-bbbb2222"},
	}
}

// tokensHandler returns the signed-in user's long-lived API tokens. The only
// authentication is the "sid" session cookie, which the browser attaches to
// cross-origin requests automatically when credentials are allowed.
func tokensHandler(w http.ResponseWriter, r *http.Request) {
	sid, err := r.Cookie("sid")
	if err != nil {
		http.Error(w, "not signed in", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(lookupTokens(sid.Value)); err != nil {
		log.Printf("encode tokens: %v", err)
	}
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/account/tokens", tokensHandler)

	log.Println("accounts-api listening on :8080")
	log.Fatal(http.ListenAndServe(":8080", httpx.WithCORS(mux)))
}
