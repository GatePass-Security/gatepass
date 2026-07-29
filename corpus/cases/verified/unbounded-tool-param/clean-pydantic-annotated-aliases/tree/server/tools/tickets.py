"""Ticket tools exposed to the assistant."""

from __future__ import annotations

from typing import Literal

import httpx
from pydantic import BaseModel

from ..types import Comment, Label, LabelList, PageSize, TicketKey

_http = httpx.Client(base_url="https://tracker.internal/api", timeout=10.0)


class ListTicketsInput(BaseModel):
    status: Literal["open", "pending", "closed"]
    labels: LabelList = []
    page_size: PageSize = 25


class CommentInput(BaseModel):
    key: TicketKey
    body: Comment


class AddLabelInput(BaseModel):
    key: TicketKey
    label: Label


def list_tickets(params: ListTicketsInput) -> list[dict]:
    resp = _http.get(
        "/tickets",
        params={
            "status": params.status,
            "labels": params.labels,
            "limit": params.page_size,
        },
    )
    resp.raise_for_status()
    return resp.json()["tickets"]


def add_comment(params: CommentInput) -> dict:
    resp = _http.post(f"/tickets/{params.key}/comments", json={"body": params.body})
    resp.raise_for_status()
    return resp.json()


def add_label(params: AddLabelInput) -> dict:
    resp = _http.post(f"/tickets/{params.key}/labels", json={"label": params.label})
    resp.raise_for_status()
    return resp.json()
