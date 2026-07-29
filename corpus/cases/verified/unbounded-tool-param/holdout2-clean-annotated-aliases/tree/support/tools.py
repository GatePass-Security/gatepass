"""Tools exposed to the support agent.

The parameter constraints live entirely in ``support.types``; the
``@validate_call`` decorator is what enforces them at call time.
"""

from __future__ import annotations

from pydantic import validate_call

from support import store
from support.types import AgentNote, CloseReason, RefundCents, TicketId


@validate_call
def close_ticket(ticket_id: TicketId, reason: CloseReason, note: AgentNote) -> str:
    """Close a support ticket with a reason code and a short note."""
    store.update_ticket(
        ticket_id,
        status="closed",
        reason=reason.value,
        note=note,
    )
    return f"{ticket_id} closed as {reason.value}"


@validate_call
def issue_refund(ticket_id: TicketId, amount_cents: RefundCents) -> str:
    """Issue a partial refund against the order attached to a ticket."""
    order_id = store.order_for_ticket(ticket_id)
    store.create_refund(order_id, amount_cents)
    return f"refunded {amount_cents} cents on {order_id}"
