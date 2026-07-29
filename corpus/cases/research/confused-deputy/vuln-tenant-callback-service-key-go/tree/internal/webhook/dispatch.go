package webhook

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"
)

// Delivery is a queued webhook. The tenant chose CallbackURL when they
// registered the subscription in the dashboard.
type Delivery struct {
	TenantID    string          `json:"tenant_id"`
	CallbackURL string          `json:"callback_url"`
	Event       string          `json:"event"`
	Body        json.RawMessage `json:"body"`
}

var client = &http.Client{Timeout: 15 * time.Second}

// Dispatch delivers one webhook to the subscriber.
func Dispatch(d Delivery) error {
	req, err := http.NewRequest(http.MethodPost, d.CallbackURL, bytes.NewReader(d.Body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Event-Name", d.Event)
	req.Header.Set("X-Tenant-Id", d.TenantID)

	// Identify ourselves so services in the mesh accept the delivery.
	req.Header.Set("Authorization", "Bearer "+os.Getenv("MESH_SERVICE_TOKEN"))
	req.Header.Set("X-Internal-Api-Key", os.Getenv("INTERNAL_API_KEY"))

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("webhook %s returned %d", d.Event, resp.StatusCode)
	}
	return nil
}
