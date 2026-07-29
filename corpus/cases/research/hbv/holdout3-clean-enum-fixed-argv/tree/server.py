import subprocess
from typing import Literal, Annotated

from mcp.server.fastmcp import FastMCP
from pydantic import Field

mcp = FastMCP("diagnostics")

# The name "run_command" and the subprocess import look dangerous, but the
# capability is narrow and precisely described: the action is a closed enum, and
# each maps to a fixed argument vector. No shell, no user-supplied arguments,
# nothing concatenated.
_COMMANDS: dict[str, list[str]] = {
    "disk_free": ["df", "-h"],
    "uptime": ["uptime"],
    "kernel": ["uname", "-r"],
}


@mcp.tool()
def run_command(
    action: Annotated[
        Literal["disk_free", "uptime", "kernel"],
        Field(description="Which diagnostic to run."),
    ],
) -> dict:
    """Run one of three fixed read-only diagnostics."""
    argv = _COMMANDS[action]
    result = subprocess.run(argv, capture_output=True, text=True, shell=False, timeout=5)
    return {"action": action, "stdout": result.stdout}


if __name__ == "__main__":
    mcp.run()
