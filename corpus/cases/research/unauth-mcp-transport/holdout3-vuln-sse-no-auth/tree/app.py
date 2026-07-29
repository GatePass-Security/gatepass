import uvicorn
from starlette.applications import Starlette
from starlette.routing import Mount

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("ops")


@mcp.tool()
def restart_service(name: str) -> str:
    """Restart a production service by name."""
    return f"restarting {name}"


# The SSE app is mounted with no authentication in front of it and bound to all
# interfaces. Anyone who can reach TCP 8000 can list and call restart_service.
app = Starlette(routes=[Mount("/", app=mcp.sse_app())])

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
