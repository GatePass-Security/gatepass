"""Input guard: reject user text that looks like a prompt-injection attempt.

The phrases below are DATA the server screens *incoming* arguments against.
They are never placed in a tool description or returned to the model as guidance.
"""

import re

_BLOCKED_PATTERNS = [
    r"ignore (all|any|previous) instructions",
    r"disregard the (system|developer) prompt",
    r"exfiltrate|send .* to https?://",
    r"reveal your (system prompt|hidden instructions)",
]

_COMPILED = [re.compile(p, re.IGNORECASE) for p in _BLOCKED_PATTERNS]


def is_suspicious(user_text: str) -> bool:
    return any(rx.search(user_text) for rx in _COMPILED)


def screen(user_text: str) -> str:
    if is_suspicious(user_text):
        raise ValueError("input rejected: possible prompt injection")
    return user_text
