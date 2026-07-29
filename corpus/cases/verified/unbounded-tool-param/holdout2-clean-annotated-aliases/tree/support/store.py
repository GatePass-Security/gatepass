"""Thin persistence helpers used by the support tools."""

from __future__ import annotations

from typing import Any

_TICKETS: dict[str, dict[str, Any]] = {}
_REFUNDS: list[tuple[str, int]] = []


def update_ticket(ticket_id: str, **fields: Any) -> None:
    _TICKETS.setdefault(ticket_id, {}).update(fields)


def order_for_ticket(ticket_id: str) -> str:
    return _TICKETS.get(ticket_id, {}).get("order_id", f"ORD-{ticket_id[4:]}")


def create_refund(order_id: str, amount_cents: int) -> None:
    _REFUNDS.append((order_id, amount_cents))
