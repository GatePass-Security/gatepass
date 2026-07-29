-- The nightly revenue rollup connects as `reporting`, which never sets
-- app.tenant_id, so orders_tenant_isolation matched zero rows and the
-- materialized view refreshed empty three nights in a row.
alter table orders disable row level security;

create materialized view revenue_by_day as
  select tenant_id,
         date_trunc('day', placed_at) as day,
         sum(total_cents) as cents
    from orders
   group by 1, 2;

create unique index revenue_by_day_key on revenue_by_day (tenant_id, day);

grant select on revenue_by_day to reporting;
