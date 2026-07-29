package agent

import (
	"context"
	"log"
)

// Step is one turn returned by the model.
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

// Run drives the model and tool calls until the model reports it is finished.
func Run(m Model, tools map[string]ToolFunc, goal string) error {
	ctx := context.Background()
	state := goal

	for {
		step, err := m.Next(ctx, state)
		if err != nil {
			return err
		}
		if step.Done {
			return nil
		}

		tool, ok := tools[step.ToolName]
		if !ok {
			log.Printf("agent: unknown tool %q", step.ToolName)
			state = step.Next
			continue
		}

		out, err := tool(ctx, step.ToolArgs)
		if err != nil {
			log.Printf("agent: tool %s failed: %v", step.ToolName, err)
			out = "tool error: " + err.Error()
		}
		state = step.Next + "\n" + out
	}
}
