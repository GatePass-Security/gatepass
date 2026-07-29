"""Analytics MCP server.

Exposed over SSE, but only on the loopback interface and only behind an API-key
middleware. nginx terminates TLS on the host and proxies to 127.0.0.1:8931.
"""

import os
import secrets

import uvicorn
from fastapi import FastAPI
from mcp.server.fastmcp import FastMCP
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from metrics import daily_active_users

mcp = FastMCP("analytics")


@mcp.tool()
def active_users(day: str) -> int:
    """Return the daily-active-user count for one ISO date (YYYY-MM-DD)."""
    return daily_active_users(day)


class ApiKeyMiddleware(BaseHTTPMiddleware):
    """Applied to the whole ASGI app, so it also covers the mounted SSE routes."""

    async def dispatch(self, request, call_next):
        expected = os.environ["MCP_API_KEY"]
        presented = request.headers.get("x-api-key", "")
        if not secrets.compare_digest(presented, expected):
            return JSONResponse({"detail": "invalid api key"}, status_code=401)
        return await call_next(request)


app = FastAPI(title="analytics-mcp")
app.add_middleware(ApiKeyMiddleware)
app.mount("/mcp", mcp.sse_app())

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8931)
