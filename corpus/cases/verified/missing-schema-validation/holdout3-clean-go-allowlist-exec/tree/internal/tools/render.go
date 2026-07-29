package tools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strconv"
	"time"
)

type renderArgs struct {
	Format string `json:"format"`
	Pages  int    `json:"pages"`
}

// The only command lines this process can ever execute.
var renderers = map[string][]string{
	"pdf":  {"/usr/bin/weasyprint", "--format", "pdf"},
	"png":  {"/usr/bin/weasyprint", "--format", "png"},
	"html": {"/usr/bin/tidy", "-quiet"},
}

// Render runs the render_document tool. Both fields are validated before any
// of them influence the process that gets spawned.
func Render(ctx context.Context, body io.Reader) ([]byte, error) {
	dec := json.NewDecoder(io.LimitReader(body, 1<<16))
	dec.DisallowUnknownFields()

	var a renderArgs
	if err := dec.Decode(&a); err != nil {
		return nil, fmt.Errorf("bad tool arguments: %w", err)
	}
	if a.Pages < 1 || a.Pages > 200 {
		return nil, errors.New("pages must be between 1 and 200")
	}

	base, ok := renderers[a.Format]
	if !ok {
		return nil, errors.New("unsupported format")
	}

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	argv := append([]string{}, base[1:]...)
	argv = append(argv, "--pages", strconv.Itoa(a.Pages))

	return exec.CommandContext(ctx, base[0], argv...).Output()
}
