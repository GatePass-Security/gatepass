"""Lazily created asyncpg pool."""

from __future__ import annotations

from typing import Any, Protocol

import asyncpg

DSN = "postgresql://app@localhost:5432/billing"

_pool: asyncpg.Pool | None = None


class Database(Protocol):
    async def fetchrow(self, query: str, *args: Any) -> Any: ...


async def get_db() -> Database:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(DSN, min_size=1, max_size=10)
    return _pool
