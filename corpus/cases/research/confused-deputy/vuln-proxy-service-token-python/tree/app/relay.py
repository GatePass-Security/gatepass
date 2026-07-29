import os

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

SERVICE_TOKEN = os.environ["INTERNAL_SERVICE_TOKEN"]


class RelayRequest(BaseModel):
    target_url: str
    payload: dict


@router.post("/v1/relay")
async def relay(body: RelayRequest):
    """Relay a payload to whichever partner endpoint the caller names."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(
            body.target_url,
            json=body.payload,
            headers={
                "Authorization": f"Bearer {SERVICE_TOKEN}",
                "X-Forwarded-By": "relay-service",
            },
        )
    return {"status": response.status_code, "body": response.text[:2048]}
