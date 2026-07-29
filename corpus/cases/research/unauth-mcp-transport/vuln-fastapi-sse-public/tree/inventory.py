"""In-memory stand-in for the warehouse management system."""

_LEVELS: dict[str, int] = {
    "SKU-1001": 42,
    "SKU-1002": 7,
    "SKU-2010": 0,
}


def on_hand(sku: str) -> int:
    return _LEVELS.get(sku, 0)


def adjust(sku: str, delta: int) -> dict:
    level = _LEVELS.get(sku, 0) + delta
    if level < 0:
        raise ValueError(f"{sku} would go negative")
    _LEVELS[sku] = level
    return {"sku": sku, "onHand": level}
