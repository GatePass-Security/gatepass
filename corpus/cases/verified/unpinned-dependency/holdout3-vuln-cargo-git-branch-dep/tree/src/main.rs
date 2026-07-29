use anyhow::Result;
use serde::Deserialize;
use tenant_audit::AuditSink;

#[derive(Debug, Deserialize)]
struct LedgerEntry {
    tenant_id: String,
    account: String,
    amount_cents: i64,
}

fn load(raw: &str) -> Result<Vec<LedgerEntry>> {
    let entries: Vec<LedgerEntry> = serde_json::from_str(raw)?;
    Ok(entries)
}

#[tokio::main]
async fn main() -> Result<()> {
    let raw = std::fs::read_to_string("entries.json")?;
    let entries = load(&raw)?;
    let sink = AuditSink::from_env()?;

    for entry in &entries {
        sink.record(&entry.tenant_id, &entry.account, entry.amount_cents)
            .await?;
    }

    println!("synced {} entries", entries.len());
    Ok(())
}
