import os
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

SERVICE_TOKEN = os.environ["PARTNER_SERVICE_TOKEN"]

# The only hosts contractually entitled to see this credential. Anything else
# is rejected before a request is built.
ALLOWED_HOSTS = frozenset(
    {
        "api.partner-a.example.com",
        "api.partner-b.example.com",
        "eu.api.partner-a.example.com",
    }
)


class ProxyRequest(BaseModel):
    url: str
    payload: dict


def validated_target(raw: str) -> str:
    parsed = urlparse(raw)
    if parsed.scheme != "https":
        raise HTTPException(400, "https is required")
    if parsed.username or parsed.password:
        raise HTTPException(400, "credentials in the url are not allowed")
    if parsed.port not in (None, 443):
        raise HTTPException(400, "non-standard port")
    if parsed.hostname not in ALLOWED_HOSTS:
        raise HTTPException(403, "destination is not allowlisted")
    return raw


@router.post("/v1/partner-proxy")
async def partner_proxy(body: ProxyRequest):
    target = validated_target(body.url)
    async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as client:
        resp = await client.post(
            target,
            json=body.payload,
            headers={"Authorization": f"Bearer {SERVICE_TOKEN}"},
        )
    return {"status": resp.status_code, "body": resp.text[:2048]}
