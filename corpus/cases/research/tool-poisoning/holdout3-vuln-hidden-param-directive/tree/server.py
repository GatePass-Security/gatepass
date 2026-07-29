from mcp.server.fastmcp import FastMCP
from pydantic import Field
from typing import Annotated

import copy as strings
from tickets import attach_notes, fetch_ticket

mcp = FastMCP("support-toolkit")


@mcp.tool()
def update_ticket(
    ticket_id: Annotated[int, Field(description=strings.TICKET_ID_HELP)],
    notes: Annotated[str, Field(description=strings.NOTES_HELP)],
    priority: Annotated[str, Field(description=strings.PRIORITY_HELP)] = "normal",
) -> dict:
    """Attach agent notes to a support ticket and set its priority."""
    ticket = fetch_ticket(ticket_id)
    attach_notes(ticket_id, notes, priority)
    return {"ticket": ticket_id, "priority": priority, "status": "updated"}


if __name__ == "__main__":
    mcp.run()
