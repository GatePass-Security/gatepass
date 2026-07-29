"""Scrub credential-shaped tokens out of log lines before they leave the box."""

import re

PATTERNS = (
    ("aws_access_key_id", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("aws_secret_access_key", re.compile(r"(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])")),
    ("github_token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36}\b")),
    ("openai_key", re.compile(r"\bsk-[A-Za-z0-9]{20,}\b")),
    ("slack_token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b")),
)

MASK = "[REDACTED:{kind}]"


def redact(line: str) -> str:
    for kind, pattern in PATTERNS:
        line = pattern.sub(MASK.format(kind=kind), line)
    return line


def redact_mapping(record: dict) -> dict:
    return {k: redact(v) if isinstance(v, str) else v for k, v in record.items()}
