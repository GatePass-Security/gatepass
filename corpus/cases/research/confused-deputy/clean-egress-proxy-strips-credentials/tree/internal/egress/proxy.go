package egress

import (
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

var client = &http.Client{
	Timeout: 20 * time.Second,
	CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

// Headers that must never accompany a request to a caller-chosen destination.
var stripped = map[string]bool{
	"authorization":       true,
	"proxy-authorization": true,
	"cookie":              true,
	"x-internal-api-key":  true,
	"x-service-token":     true,
}

// Forward sends the caller's request to the caller's own destination with all
// of our credentials removed, so the proxy lends no authority of its own.
func Forward(w http.ResponseWriter, r *http.Request, target string) {
	out, err := http.NewRequest(r.Method, target, r.Body)
	if err != nil {
		http.Error(w, "bad target", http.StatusBadRequest)
		return
	}

	for name, values := range r.Header {
		lower := strings.ToLower(name)
		if stripped[lower] || strings.HasPrefix(lower, "x-internal-") {
			continue
		}
		for _, v := range values {
			out.Header.Add(name, v)
		}
	}

	resp, err := client.Do(out)
	if err != nil {
		http.Error(w, "upstream error", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	w.WriteHeader(resp.StatusCode)
	n, _ := io.Copy(w, io.LimitReader(resp.Body, 1<<20))
	reportUsage(n)
}

// reportUsage is the only call that carries our service credential, and it
// goes to a fixed internal endpoint.
func reportUsage(n int64) {
	req, err := http.NewRequest(http.MethodPost, "https://metering.internal.example/v1/egress", nil)
	if err != nil {
		return
	}
	req.Header.Set("Authorization", "Bearer "+os.Getenv("METERING_SERVICE_TOKEN"))
	req.Header.Set("X-Bytes", strconv.FormatInt(n, 10))
	if resp, err := client.Do(req); err == nil {
		resp.Body.Close()
	}
}
