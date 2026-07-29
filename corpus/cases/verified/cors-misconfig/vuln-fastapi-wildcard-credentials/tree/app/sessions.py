from dataclasses import dataclass
from uuid import uuid4

_STORE: dict[str, "Session"] = {}


@dataclass
class Session:
    token: str
    user_id: str
    email: str
    plan: str

    def rotate_key(self) -> str:
        key_id = f"key_{uuid4().hex[:12]}"
        return key_id


def lookup_session(token: str | None) -> Session | None:
    if not token:
        return None
    return _STORE.get(token)
