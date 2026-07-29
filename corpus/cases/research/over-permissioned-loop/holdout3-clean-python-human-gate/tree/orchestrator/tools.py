"""Tool dispatch. A ticket is required and is redeemed exactly once."""

import subprocess


class TicketError(Exception):
    """Raised when a tool call arrives without a valid, unused ticket."""


class Tools:
    def __init__(self) -> None:
        self._spent: set = set()

    def invoke(self, name: str, arguments: dict, ticket: str) -> str:
        if not ticket or ticket in self._spent:
            raise TicketError("approval ticket missing or already redeemed")
        self._spent.add(ticket)

        if name == "run_tests":
            done = subprocess.run(
                ["make", "test"], capture_output=True, text=True, timeout=600
            )
            return done.stdout[-4000:]

        if name == "read_notes":
            with open("NOTES.md", encoding="utf-8") as handle:
                return handle.read()[:4000]

        return f"unknown tool {name}"
