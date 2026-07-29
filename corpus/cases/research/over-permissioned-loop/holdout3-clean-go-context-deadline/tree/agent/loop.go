package agent

import (
	"context"
	"errors"
	"time"
)

// ErrBudget is returned when the run has spent its allowance.
var ErrBudget = errors.New("agent: model spend budget exhausted")

type budget struct {
	maxUSD   float64
	spentUSD float64
}

func (b *budget) charge(usd float64) error {
	b.spentUSD += usd
	if b.spentUSD >= b.maxUSD {
		return ErrBudget
	}
	return nil
}

// Run drives the agent until it answers, the wall-clock deadline passes, or
// the spend ceiling is hit. There is deliberately no step counter: cheap
// steps should not be penalised, expensive ones already are.
func Run(parent context.Context, p Planner, t Tools, goal string) (string, error) {
	ctx, cancel := context.WithTimeout(parent, 4*time.Minute)
	defer cancel()

	b := &budget{maxUSD: 2.00}
	transcript := []string{goal}

	for {
		if err := ctx.Err(); err != nil {
			return "", err
		}

		step, cost, err := p.Next(ctx, transcript)
		if err != nil {
			return "", err
		}
		if err := b.charge(cost); err != nil {
			return "", err
		}
		if step.Final {
			return step.Text, nil
		}

		obs, err := t.Invoke(ctx, step.Tool, step.Input)
		if err != nil {
			return "", err
		}
		transcript = append(transcript, obs)
	}
}
