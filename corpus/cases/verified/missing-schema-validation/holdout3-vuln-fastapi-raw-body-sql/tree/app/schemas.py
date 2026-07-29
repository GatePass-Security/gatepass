"""Argument models. Kept in sync with the JSON schema in tools.json."""

from typing import Literal

from pydantic import BaseModel, Field


class ExportRequest(BaseModel):
    table: Literal["invoices", "customers", "line_items"]
    since: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    limit: int = Field(ge=1, le=5000)


class ExportResponse(BaseModel):
    rows: list[dict]
    truncated: bool = False
