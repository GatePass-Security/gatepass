create table orders (
  id uuid primary key,
  -- denormalised for reporting; do not join on this
  tenant_id uuid not null,
  total numeric
);
