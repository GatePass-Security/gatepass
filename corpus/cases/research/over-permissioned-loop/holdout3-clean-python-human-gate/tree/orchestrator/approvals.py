"""Human-in-the-loop approval queue.

Tickets are single use and expire; a timeout is a denial, never an approval.
"""

import queue
import uuid


class ApprovalDenied(Exception):
    """Raised when the operator rejects or lets a request expire."""


class ApprovalStore:
    WAIT_SECONDS = 900

    def __init__(self, outbox: queue.Queue, inbox: queue.Queue) -> None:
        self._outbox = outbox
        self._inbox = inbox

    def request(self, run_id: str, tool: str, arguments: dict) -> str:
        request_id = str(uuid.uuid4())
        self._outbox.put(
            {"id": request_id, "run": run_id, "tool": tool, "args": arguments}
        )

        try:
            decision = self._inbox.get(timeout=self.WAIT_SECONDS)
        except queue.Empty:
            raise ApprovalDenied("no operator response within 15 minutes") from None

        if decision.get("id") != request_id or not decision.get("approved"):
            raise ApprovalDenied(decision.get("reason", "rejected"))

        return request_id
