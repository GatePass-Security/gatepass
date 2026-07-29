import os

from anthropic import Anthropic

from .tools import TOOL_SCHEMAS, execute_tool

client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])


def run_task(goal: str) -> str:
    """Drive the model until it stops asking for tools."""
    messages = [{"role": "user", "content": goal}]

    while True:
        response = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=4096,
            tools=TOOL_SCHEMAS,
            messages=messages,
        )
        messages.append({"role": "assistant", "content": response.content})

        results = []
        for block in response.content:
            if block.type == "tool_use":
                results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": execute_tool(block.name, block.input),
                    }
                )

        if not results:
            return "".join(b.text for b in response.content if b.type == "text")

        messages.append({"role": "user", "content": results})
