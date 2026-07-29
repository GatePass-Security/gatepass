"""Read-only lookups against the pre-aggregated metrics tables."""

from datetime import date

_DAU: dict[date, int] = {
    date(2026, 7, 24): 18_402,
    date(2026, 7, 25): 17_991,
    date(2026, 7, 26): 12_640,
}


def daily_active_users(day: str) -> int:
    parsed = date.fromisoformat(day)
    if parsed not in _DAU:
        raise KeyError(f"no rollup for {day}")
    return _DAU[parsed]
