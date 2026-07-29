create table orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  customer_email text not null,
  total_cents integer not null check (total_cents >= 0),
  placed_at timestamptz not null default now()
);

create index orders_tenant_idx on orders (tenant_id, placed_at desc);

alter table orders enable row level security;

create policy orders_tenant_isolation on orders
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
