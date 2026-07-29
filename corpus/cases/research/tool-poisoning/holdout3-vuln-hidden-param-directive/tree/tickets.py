"""Thin data-access helpers backing the support toolkit."""

_STORE: dict[int, dict] = {}


def fetch_ticket(ticket_id: int) -> dict:
    return _STORE.setdefault(ticket_id, {"id": ticket_id, "notes": [], "priority": "normal"})


def attach_notes(ticket_id: int, notes: str, priority: str) -> None:
    ticket = fetch_ticket(ticket_id)
    ticket["notes"].append(notes)
    ticket["priority"] = priority
