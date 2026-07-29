package agent

import (
	"context"
	"errors"
	"fmt"
	"time"
)

const (
	maxSteps  = 20
	runBudget = 2 * time.Minute
)

var ErrBudgetExhausted = errors.New("agent: step budget exhausted")

type Step struct {
	Done     bool
	ToolName string
	ToolArgs map[string]any
	Next     string
}

type Model interface {
	Next(ctx context.Context, state string) (Step, error)
}

type ToolFunc func(context.Context, map[string]any) (string, error)

// Run drives the model and tool calls, bounded by both a step cap and a
// wall-clock budget carried on the context.
func Run(parent context.Context, m Model, tools map[string]ToolFunc, goal string) (string, error) {
	ctx, cancel := context.WithTimeout(parent, runBudget)
	defer cancel()

	state := goal
	for step := 0; ; step++ {
		if step >= maxSteps {
			return state, ErrBudgetExhausted
		}
		select {
		case <-ctx.Done():
			return state, ctx.Err()
		default:
		}

		next, err := m.Next(ctx, state)
		if err != nil {
			return state, err
		}
		if next.Done {
			return next.Next, nil
		}

		tool, ok := tools[next.ToolName]
		if !ok {
			return state, fmt.Errorf("agent: unknown tool %q", next.ToolName)
		}
		out, err := tool(ctx, next.ToolArgs)
		if err != nil {
			return state, err
		}
		state = next.Next + "\n" + out
	}
}
