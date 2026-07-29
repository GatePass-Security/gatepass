"""Nightly export of order rollups into BigQuery."""

from pathlib import Path

from google.cloud import bigquery
from google.oauth2 import service_account

CREDENTIALS_PATH = Path(__file__).resolve().parent.parent / "config" / "analytics-writer.json"
DATASET = "acme_analytics_prod.order_rollups"


def build_client() -> bigquery.Client:
    creds = service_account.Credentials.from_service_account_file(
        str(CREDENTIALS_PATH),
        scopes=["https://www.googleapis.com/auth/bigquery"],
    )
    return bigquery.Client(credentials=creds, project=creds.project_id)


def load_rollups(rows: list[dict]) -> int:
    client = build_client()
    errors = client.insert_rows_json(DATASET, rows)
    if errors:
        raise RuntimeError(f"bigquery insert failed: {errors}")
    return len(rows)


if __name__ == "__main__":
    print(load_rollups([{"day": "2026-07-27", "orders": 1420, "revenue_cents": 8813200}]))
