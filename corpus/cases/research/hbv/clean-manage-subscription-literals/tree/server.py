"""Billing MCP server."""

import re
from typing import Literal

from fastmcp import FastMCP

from billing import apply_action

mcp = FastMCP("billing")

UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)


@mcp.tool()
def manage_subscription(
    subscription_id: str,
    action: Literal["pause", "resume", "cancel"],
) -> dict:
    """Pause, resume, or cancel one existing subscription.

    Only these three state transitions are possible. This tool cannot create a
    subscription, change a price or plan, issue a refund, or read or modify any
    other part of the account.
    """
    if not UUID_RE.match(subscription_id):
        raise ValueError("subscription_id must be a lowercase UUID")
    return apply_action(subscription_id, action)


if __name__ == "__main__":
    mcp.run(transport="stdio")
