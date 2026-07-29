import os
import time

from anthropic import Anthropic

from .tools import TOOL_SCHEMAS, execute_tool

client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

MAX_TOOL_CALLS = 40
MAX_USD = 2.00
MAX_SECONDS = 300

INPUT_USD_PER_TOKEN = 3.0 / 1_000_000
OUTPUT_USD_PER_TOKEN = 15.0 / 1_000_000


def run_task(goal: str) -> dict:
    messages = [{"role": "user", "content": goal}]
    tool_calls = 0
    spent = 0.0
    started = time.monotonic()

    while True:
        if tool_calls >= MAX_TOOL_CALLS:
            return {"status": "tool_budget_exhausted", "spent_usd": round(spent, 4)}
        if spent >= MAX_USD:
            return {"status": "cost_ceiling_reached", "spent_usd": round(spent, 4)}
        if time.monotonic() - started > MAX_SECONDS:
            return {"status": "timeout", "spent_usd": round(spent, 4)}

        response = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=2048,
            tools=TOOL_SCHEMAS,
            messages=messages,
        )
        spent += response.usage.input_tokens * INPUT_USD_PER_TOKEN
        spent += response.usage.output_tokens * OUTPUT_USD_PER_TOKEN
        messages.append({"role": "assistant", "content": response.content})

        results = []
        for block in response.content:
            if block.type == "tool_use":
                tool_calls += 1
                results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": execute_tool(block.name, block.input),
                    }
                )

        if not results:
            text = "".join(b.text for b in response.content if b.type == "text")
            return {"status": "done", "text": text, "spent_usd": round(spent, 4)}

        messages.append({"role": "user", "content": results})
