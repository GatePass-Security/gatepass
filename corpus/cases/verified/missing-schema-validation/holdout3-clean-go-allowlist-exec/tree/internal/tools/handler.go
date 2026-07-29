package tools

import (
	"net/http"
)

// Handler wires the render_document tool onto an HTTP route.
func Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("POST /tools/render_document", func(w http.ResponseWriter, r *http.Request) {
		out, err := Render(r.Context(), r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusUnprocessableEntity)
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write(out)
	})

	return mux
}
