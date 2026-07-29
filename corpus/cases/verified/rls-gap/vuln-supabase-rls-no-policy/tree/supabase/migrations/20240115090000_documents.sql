-- Documents shared inside a workspace. Multi-tenant: every row carries org_id.
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  author_id uuid not null,
  title text not null,
  body text,
  created_at timestamptz not null default now()
);

create index documents_org_id_idx on public.documents (org_id);

-- Lock the table down before the API ships.
alter table public.documents enable row level security;

grant select, insert, update on public.documents to authenticated;
