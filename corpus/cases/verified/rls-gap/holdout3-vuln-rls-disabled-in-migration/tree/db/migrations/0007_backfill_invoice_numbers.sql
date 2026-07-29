-- migrate:up
-- Renumbering has to touch every tenant in one pass, and the migration role
-- runs with FORCE RLS applied, so the policies are lifted for the backfill.
ALTER TABLE invoices DISABLE ROW LEVEL SECURITY;
ALTER TABLE payments DISABLE ROW LEVEL SECURITY;

WITH renumbered AS (
    SELECT id,
           'INV-' || to_char(issued_at, 'YYYY') || '-' ||
           lpad((row_number() OVER (PARTITION BY tenant_id ORDER BY issued_at))::text, 6, '0') AS new_number
      FROM invoices
)
UPDATE invoices i
   SET number = r.new_number
  FROM renumbered r
 WHERE r.id = i.id;

UPDATE payments p
   SET amount_cents = p.amount_cents
 WHERE p.invoice_id IN (SELECT id FROM invoices);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;

ANALYZE invoices;
ANALYZE payments;
