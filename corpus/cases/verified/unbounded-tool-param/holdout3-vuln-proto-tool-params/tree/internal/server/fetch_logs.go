package server

import (
	"context"
	"fmt"
	"io"
	"net/http"

	toolsv1 "example.com/agent/gen/tools/v1"
)

// ToolServer implements tools.v1.ToolService.
type ToolServer struct {
	client *http.Client
}

func New(client *http.Client) *ToolServer {
	return &ToolServer{client: client}
}

func (s *ToolServer) FetchLogs(
	ctx context.Context,
	req *toolsv1.FetchLogsRequest,
) (*toolsv1.FetchLogsResponse, error) {
	url := fmt.Sprintf(
		"http://%s:9200/logs?glob=%s&minutes=%d",
		req.GetHost(), req.GetPattern(), req.GetWindowMinutes(),
	)

	hreq, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}

	resp, err := s.client.Do(hreq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, req.GetByteLimit()))
	if err != nil {
		return nil, err
	}

	return &toolsv1.FetchLogsResponse{
		Body:      body,
		Truncated: int64(len(body)) == req.GetByteLimit(),
	}, nil
}
