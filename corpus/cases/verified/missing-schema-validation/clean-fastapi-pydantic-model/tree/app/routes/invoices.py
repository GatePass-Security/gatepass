from __future__ import annotations

from fastapi import APIRouter, Depends

from ..db import Database, get_db
from ..schemas import CreateInvoice, InvoiceCreated

router = APIRouter(prefix="/v1", tags=["invoices"])


@router.post("/invoices", response_model=InvoiceCreated, status_code=201)
async def create_invoice(
    body: CreateInvoice,
    db: Database = Depends(get_db),
) -> InvoiceCreated:
    row = await db.fetchrow(
        "insert into invoices (customer_id, amount_cents, currency, memo) "
        "values ($1, $2, $3, $4) returning id, amount_cents, currency",
        body.customer_id,
        body.amount_cents,
        body.currency,
        body.memo,
    )
    return InvoiceCreated(
        id=row["id"],
        amount_cents=row["amount_cents"],
        currency=row["currency"],
    )
