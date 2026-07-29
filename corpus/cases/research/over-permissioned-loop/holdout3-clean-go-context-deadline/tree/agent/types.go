package agent

import "context"

// Step is one decision from the planner.
type Step struct {
	Final bool
	Text  string
	Tool  string
	Input map[string]any
}

// Planner returns the next step plus the USD cost of producing it.
type Planner interface {
	Next(ctx context.Context, transcript []string) (Step, float64, error)
}

// Tools executes a named tool. Implementations must respect ctx cancellation.
type Tools interface {
	Invoke(ctx context.Context, name string, input map[string]any) (string, error)
}
