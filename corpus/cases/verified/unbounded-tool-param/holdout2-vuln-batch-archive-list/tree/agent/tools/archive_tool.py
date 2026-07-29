"""Bulk archive tool exposed to the billing support agent."""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Annotated, Literal

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field, StringConstraints

EXPORT_ROOT = Path("/var/lib/exports")
ARCHIVE_ROOT = Path("/var/lib/exports/archive")

# Each individual path is capped, so no single entry can be absurdly long.
RelativePath = Annotated[str, StringConstraints(max_length=256)]


class ArchiveRequest(BaseModel):
    """Move a batch of finished export files into cold storage."""

    paths: list[RelativePath] = Field(
        description="Export files to archive, relative to the export root.",
    )
    tier: Literal["cold", "glacier"] = Field(
        default="cold",
        description="Destination storage tier.",
    )


def archive_exports(paths: list[str], tier: str = "cold") -> str:
    destination = ARCHIVE_ROOT / tier
    destination.mkdir(parents=True, exist_ok=True)
    moved = 0
    for raw in paths:
        source = EXPORT_ROOT / raw
        if not source.is_file():
            continue
        shutil.move(str(source), str(destination / source.name))
        moved += 1
    return f"archived {moved} of {len(paths)} files into {tier}"


archive_tool = StructuredTool.from_function(
    func=archive_exports,
    name="archive_exports",
    description="Archive a batch of completed export files.",
    args_schema=ArchiveRequest,
)
