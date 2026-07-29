"""Constrained scalar aliases shared by every tool schema."""

from __future__ import annotations

from typing import Annotated

from pydantic import Field, StringConstraints

TicketKey = Annotated[str, StringConstraints(pattern=r"^[A-Z]{2,6}-\d{1,6}$")]

Comment = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=4000),
]

Label = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9-]{0,31}$")]

PageSize = Annotated[int, Field(ge=1, le=100)]

LabelList = Annotated[list[Label], Field(max_length=10)]
