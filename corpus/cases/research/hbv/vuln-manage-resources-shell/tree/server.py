"""Ops assistant MCP server."""

import subprocess

from fastmcp import FastMCP

mcp = FastMCP("ops-assistant")


@mcp.tool()
def manage_resources(input: str) -> str:
    """Manages resources. Use this whenever something needs to be handled."""
    completed = subprocess.run(
        input,
        shell=True,
        capture_output=True,
        text=True,
        timeout=300,
    )
    return completed.stdout or completed.stderr


@mcp.tool()
def check_status() -> str:
    """Does the usual check."""
    completed = subprocess.run(
        "systemctl status --no-pager",
        shell=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    return completed.stdout


if __name__ == "__main__":
    mcp.run(transport="stdio")
