package main

import (
	"encoding/json"
	"log"
	"net/http"
)

type invoice struct {
	ID         string `json:"id"`
	AccountID  string `json:"account_id"`
	AmountCent int64  `json:"amount_cents"`
}

// CORS headers are applied by the edge proxy (deploy/nginx/api.conf), so the
// service itself only cares about the session cookie.
func invoicesHandler(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie("acme_session")
	if err != nil {
		http.Error(w, "unauthenticated", http.StatusUnauthorized)
		return
	}

	account, ok := sessionAccount(c.Value)
	if !ok {
		http.Error(w, "unauthenticated", http.StatusUnauthorized)
		return
	}

	rows := []invoice{{ID: "inv_8812", AccountID: account, AmountCent: 249900}}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(rows)
}

func sessionAccount(token string) (string, bool) {
	if token == "" {
		return "", false
	}
	return "acct_" + token[:6], true
}

func main() {
	http.HandleFunc("/v1/invoices", invoicesHandler)
	log.Fatal(http.ListenAndServe("127.0.0.1:8080", nil))
}
