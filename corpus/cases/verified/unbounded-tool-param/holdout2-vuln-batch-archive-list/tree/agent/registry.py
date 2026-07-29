"""Tool registry handed to the billing support agent executor."""

from __future__ import annotations

from typing import Any

from langchain_core.tools import BaseTool

from agent.tools.archive_tool import archive_tool

TOOLS: list[BaseTool] = [archive_tool]


def tool_specs() -> list[dict[str, Any]]:
    """Render OpenAI-style function specs for every registered tool."""
    return [
        {
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.args_schema.model_json_schema(),
            },
        }
        for tool in TOOLS
    ]


def lookup(name: str) -> BaseTool:
    for tool in TOOLS:
        if tool.name == name:
            return tool
    raise KeyError(f"no such tool: {name}")
