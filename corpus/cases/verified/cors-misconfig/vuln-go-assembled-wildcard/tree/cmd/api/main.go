package main

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/acme/orders/internal/httpx"
)

func me(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("acme_session")
	if err != nil {
		http.Error(w, "not signed in", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"session": cookie.Value,
		"plan":    "enterprise",
	})
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/me", me)

	log.Println("listening on :8080")
	log.Fatal(http.ListenAndServe(":8080", httpx.CORS(mux)))
}
