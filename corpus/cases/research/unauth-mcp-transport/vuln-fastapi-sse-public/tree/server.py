"""Inventory MCP server, exposed over SSE for the warehouse web console."""

import uvicorn
from fastapi import FastAPI
from mcp.server.fastmcp import FastMCP

from inventory import adjust, on_hand

mcp = FastMCP("inventory")


@mcp.tool()
def adjust_stock(sku: str, delta: int) -> dict:
    """Adjust the on-hand quantity for a SKU and return the new level."""
    return adjust(sku, delta)


@mcp.tool()
def get_stock(sku: str) -> int:
    """Return the current on-hand quantity for a SKU."""
    return on_hand(sku)


app = FastAPI(title="inventory-mcp")

# The SSE transport is mounted directly with no authentication dependency, so
# anyone who can route to the container can call adjust_stock.
app.mount("/mcp", mcp.sse_app())


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
