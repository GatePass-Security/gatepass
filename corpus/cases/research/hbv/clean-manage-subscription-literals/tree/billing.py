"""Thin wrapper over the billing API.

Only the three subscription state transitions exposed by the MCP tool are
implemented here; there is deliberately no generic request helper.
"""

from typing import Literal

import httpx

BASE_URL = "https://billing.internal.example.com"

_ENDPOINTS: dict[str, str] = {
    "pause": "/v1/subscriptions/{sid}/pause",
    "resume": "/v1/subscriptions/{sid}/resume",
    "cancel": "/v1/subscriptions/{sid}/cancel",
}


def apply_action(
    subscription_id: str,
    action: Literal["pause", "resume", "cancel"],
) -> dict:
    path = _ENDPOINTS[action].format(sid=subscription_id)
    with httpx.Client(base_url=BASE_URL, timeout=15.0) as client:
        response = client.post(path)
        response.raise_for_status()
        return response.json()
