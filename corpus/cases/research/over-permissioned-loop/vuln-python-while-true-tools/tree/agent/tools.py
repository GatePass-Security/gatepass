import json
import urllib.request

TOOL_SCHEMAS = [
    {
        "name": "fetch_url",
        "description": "Fetch a URL and return the first 8 KB of the body.",
        "input_schema": {
            "type": "object",
            "properties": {"url": {"type": "string", "maxLength": 2048}},
            "required": ["url"],
        },
    },
    {
        "name": "search_index",
        "description": "Search the internal document index.",
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string", "maxLength": 512}},
            "required": ["query"],
        },
    },
]


def execute_tool(name: str, args: dict) -> str:
    if name == "fetch_url":
        with urllib.request.urlopen(args["url"], timeout=10) as resp:
            return resp.read(8000).decode("utf-8", "replace")
    if name == "search_index":
        payload = json.dumps({"q": args["query"]}).encode()
        req = urllib.request.Request(
            "https://search.internal.example/v1/query",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.read(8000).decode("utf-8", "replace")
    return f"unknown tool: {name}"
