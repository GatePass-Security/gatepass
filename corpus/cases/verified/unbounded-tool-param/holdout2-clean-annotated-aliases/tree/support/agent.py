"""Assemble OpenAI-style function specs from the decorated support tools."""

import inspect
from typing import Any, Callable, get_type_hints

from pydantic import create_model

from support.tools import close_ticket, issue_refund

TOOLS: list[Callable[..., str]] = [close_ticket, issue_refund]


def _arguments_model(fn: Callable[..., Any]):
    """Build a pydantic model from the function's annotated parameters."""
    hints = get_type_hints(fn, include_extras=True)
    signature = inspect.signature(fn)
    fields: dict[str, Any] = {}
    for name, param in signature.parameters.items():
        default = ... if param.default is inspect.Parameter.empty else param.default
        fields[name] = (hints[name], default)
    return create_model(f"{fn.__name__}_arguments", **fields)


def function_specs() -> list[dict[str, Any]]:
    """Render every registered tool as a function definition for the model."""
    specs: list[dict[str, Any]] = []
    for tool in TOOLS:
        raw = getattr(tool, "raw_function", tool)
        specs.append(
            {
                "type": "function",
                "function": {
                    "name": raw.__name__,
                    "description": (raw.__doc__ or "").strip(),
                    "parameters": _arguments_model(raw).model_json_schema(),
                },
            }
        )
    return specs
