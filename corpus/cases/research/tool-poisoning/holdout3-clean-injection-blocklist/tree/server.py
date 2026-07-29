from mcp.server.fastmcp import FastMCP
from pydantic import Field
from typing import Annotated

from guard import screen

mcp = FastMCP("notes")


@mcp.tool()
def save_note(
    body: Annotated[str, Field(description="The note text to store.")],
) -> dict:
    """Store a short note for the current user."""
    clean = screen(body)
    return {"stored": True, "length": len(clean)}


if __name__ == "__main__":
    mcp.run()
