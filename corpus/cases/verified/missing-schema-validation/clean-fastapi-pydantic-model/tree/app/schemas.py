"""Request and response models for the billing API."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class CreateInvoice(BaseModel):
    customer_id: str = Field(pattern=r"^cus_[A-Za-z0-9]{8,24}$")
    amount_cents: int = Field(ge=1, le=1_000_000)
    currency: Literal["usd", "eur", "gbp"] = "usd"
    memo: str = Field(default="", max_length=280)


class InvoiceCreated(BaseModel):
    id: int
    amount_cents: int
    currency: str
