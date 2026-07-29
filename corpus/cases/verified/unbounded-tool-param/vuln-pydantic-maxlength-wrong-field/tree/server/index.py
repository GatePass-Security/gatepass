"""Thin wrapper over the on-disk knowledge index."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path("/srv/knowledge")


def search_index(scope: str, query: str, limit: int) -> list[dict]:
    pattern = re.compile(query, re.IGNORECASE)
    hits: list[dict] = []

    for path in sorted((ROOT / scope).rglob("*.md")):
        text = path.read_text(encoding="utf-8")
        if pattern.search(text):
            hits.append({"path": str(path), "excerpt": text[:400]})
        if len(hits) >= limit:
            break

    return hits
