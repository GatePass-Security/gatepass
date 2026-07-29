"""Build a CSV extract for the requested dataset."""

from __future__ import annotations

import subprocess
from typing import Any, TypedDict

import psycopg

DSN = "postgresql://reporter@localhost:5432/analytics"


class ReportParams(TypedDict):
    dataset: str
    window_days: int
    output_path: str


def generate_report(params: ReportParams) -> dict[str, Any]:
    with psycopg.connect(DSN) as conn:
        rows = conn.execute(
            "select id, label, amount from extracts "
            "where dataset = %s and created_at > now() - (%s || ' days')::interval",
            (params["dataset"], params["window_days"]),
        ).fetchall()

    with open(params["output_path"], "w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(",".join(str(col) for col in row) + "\n")

    subprocess.run(["gzip", "--force", params["output_path"]], check=True)
    return {"rows": len(rows), "path": params["output_path"] + ".gz"}


def handle(tool_call: dict[str, Any]) -> dict[str, Any]:
    """Entry point registered for the `generate_report` tool."""
    return generate_report(tool_call["arguments"])
