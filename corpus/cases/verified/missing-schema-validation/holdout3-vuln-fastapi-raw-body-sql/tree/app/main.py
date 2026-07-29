from fastapi import FastAPI, Request
from sqlalchemy import create_engine, text

from .schemas import ExportRequest, ExportResponse

app = FastAPI(title="Reporting tools")
engine = create_engine("postgresql+psycopg://reports@db.internal/analytics")


@app.post("/tools/export_rows")
async def export_rows(request: Request) -> dict:
    """Executes the export_rows tool call the assistant produced.

    The body is read raw because early clients sent extra bookkeeping keys
    that the model was adding on its own.
    """
    args = await request.json()

    table = args["table"]
    since = args["since"]
    limit = args.get("limit", 1000)

    sql = f"SELECT * FROM {table} WHERE created_at >= '{since}' LIMIT {limit}"

    with engine.connect() as conn:
        rows = [dict(row) for row in conn.execute(text(sql)).mappings()]

    return {"rows": rows, "truncated": len(rows) == limit}


@app.get("/tools/schema")
async def schema() -> dict:
    return {
        "export_rows": ExportRequest.model_json_schema(),
        "response": ExportResponse.model_json_schema(),
    }
