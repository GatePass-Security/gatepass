-- Tenant-scoped data. Every table here carries tenant_id and is protected by
-- a FORCE'd policy keyed on the app.tenant_id GUC set by the connection pool.
CREATE TABLE ledger_entries (
    id           bigserial PRIMARY KEY,
    tenant_id    uuid NOT NULL,
    currency     char(3) NOT NULL REFERENCES currencies(code),
    amount_minor bigint NOT NULL,
    booked_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY ledger_entries_isolation ON ledger_entries
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE TABLE tenant_settings (
    tenant_id       uuid PRIMARY KEY,
    base_currency   char(3) NOT NULL REFERENCES currencies(code),
    fiscal_year_end date NOT NULL
);

ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_settings_isolation ON tenant_settings
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON ledger_entries, tenant_settings TO app_user;
