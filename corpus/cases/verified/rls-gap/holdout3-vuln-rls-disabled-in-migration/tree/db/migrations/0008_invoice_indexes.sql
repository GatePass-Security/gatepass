-- migrate:up
CREATE INDEX CONCURRENTLY IF NOT EXISTS invoices_tenant_issued_idx
    ON invoices (tenant_id, issued_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS invoices_number_idx
    ON invoices (number);

CREATE INDEX CONCURRENTLY IF NOT EXISTS payments_invoice_idx
    ON payments (invoice_id);
