"""Reviewer-gated agent runner.

There is no step limit here on purpose: the operator standing at the approval
queue is the bound. Nothing reaches a tool without a fresh, per-call ticket.
"""

from dataclasses import dataclass, field

from .approvals import ApprovalDenied, ApprovalStore


@dataclass
class Run:
    run_id: str
    goal: str
    transcript: list = field(default_factory=list)


def execute(run: Run, planner, tools, approvals: ApprovalStore) -> str:
    while True:
        step = planner.next_action(run.goal, run.transcript)

        if step.is_final:
            return step.text

        try:
            # Blocks until a human approves this exact tool + arguments pair.
            ticket = approvals.request(
                run_id=run.run_id,
                tool=step.tool,
                arguments=step.arguments,
            )
        except ApprovalDenied as exc:
            return f"halted: operator declined the next tool call ({exc})"

        observation = tools.invoke(step.tool, step.arguments, ticket=ticket)
        run.transcript.append(observation)
