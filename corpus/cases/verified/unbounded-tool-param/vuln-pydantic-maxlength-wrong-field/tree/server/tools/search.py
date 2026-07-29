"""Document search tool exposed over MCP."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from ..index import search_index


class SearchDocsInput(BaseModel):
    """Parameters for the search_docs tool."""

    # Rendered verbatim in the result header shown to the user.
    title: str = Field(default="Search results", max_length=80)
    scope: Literal["docs", "runbooks", "adr"] = "docs"
    query: str
    limit: int


def search_docs(params: SearchDocsInput) -> dict:
    hits = search_index(
        scope=params.scope,
        query=params.query,
        limit=params.limit,
    )
    return {"title": params.title, "hits": hits}
