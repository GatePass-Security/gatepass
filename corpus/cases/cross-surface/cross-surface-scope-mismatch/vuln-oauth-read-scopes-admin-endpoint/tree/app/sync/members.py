import os

import requests

API = "https://api.github.com"

SESSION = requests.Session()
SESSION.headers.update(
    {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Authorization": f"token {os.environ['GITHUB_OAUTH_TOKEN']}",
    }
)


def list_members(org: str) -> list[str]:
    resp = SESSION.get(f"{API}/orgs/{org}/members", params={"per_page": 100}, timeout=15)
    resp.raise_for_status()
    return [member["login"] for member in resp.json()]


def reconcile(org: str, desired: dict[str, str]) -> dict[str, str]:
    """Make org membership match the roles configured in our directory."""
    current = set(list_members(org))
    applied: dict[str, str] = {}

    for login, role in desired.items():
        resp = SESSION.put(
            f"{API}/orgs/{org}/memberships/{login}",
            json={"role": role},
            timeout=15,
        )
        resp.raise_for_status()
        applied[login] = role

    for login in current - set(desired):
        resp = SESSION.delete(f"{API}/orgs/{org}/memberships/{login}", timeout=15)
        resp.raise_for_status()
        applied[login] = "removed"

    return applied
