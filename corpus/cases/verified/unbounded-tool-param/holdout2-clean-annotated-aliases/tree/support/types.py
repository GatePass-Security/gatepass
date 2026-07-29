"""Constrained primitives shared by every support-agent tool argument."""

from __future__ import annotations

from enum import Enum
from typing import Annotated

from pydantic import Field, StringConstraints

TicketId = Annotated[str, StringConstraints(pattern=r"^TCK-[0-9]{6}$")]
"""Support ticket identifier, e.g. TCK-004217."""

AgentNote = Annotated[
    str,
    StringConstraints(min_length=1, max_length=500, strip_whitespace=True),
]
"""Free text the agent may attach to a ticket, hard-capped at 500 characters."""

RefundCents = Annotated[int, Field(ge=0, le=25_000)]
"""Refund amount in cents; anything above $250.00 needs a human approver."""


class CloseReason(str, Enum):
    """Closed set of reason codes accepted when closing a ticket."""

    RESOLVED = "resolved"
    DUPLICATE = "duplicate"
    NO_RESPONSE = "no_response"
    WITHDRAWN = "withdrawn"
