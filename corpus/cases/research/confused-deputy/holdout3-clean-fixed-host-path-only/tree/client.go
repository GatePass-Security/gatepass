package billing

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
)

// The internal token is attached, but only ever to a hardcoded host. The caller
// supplies just a resource id, which is validated to be a plain identifier and
// used as a single path segment. The caller cannot influence the destination
// host, so the credential cannot be redirected.
const baseURL = "https://billing.internal.example"

var idRe = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,40}$`)

func GetInvoice(id string) (string, error) {
	if !idRe.MatchString(id) {
		return "", fmt.Errorf("invalid invoice id")
	}
	url := fmt.Sprintf("%s/invoices/%s", baseURL, id)
	req, _ := http.NewRequest(http.MethodGet, url, nil)
	req.Header.Set("X-Internal-Token", os.Getenv("INTERNAL_SERVICE_TOKEN"))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return string(body), nil
}
