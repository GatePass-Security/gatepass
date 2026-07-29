import json
import urllib.request

TOOL_SCHEMAS = [
    {
        "name": "search_index",
        "description": "Search the internal document index.",
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string", "maxLength": 512}},
            "required": ["query"],
        },
    }
]


def execute_tool(name: str, args: dict) -> str:
    if name != "search_index":
        return f"unknown tool: {name}"

    payload = json.dumps({"q": args["query"], "limit": 20}).encode()
    req = urllib.request.Request(
        "https://search.internal.example/v1/query",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return resp.read(8000).decode("utf-8", "replace")
