create table projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  name text not null,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create index projects_org_idx on projects (org_id) where archived_at is null;

alter table projects enable row level security;
alter table projects force row level security;

-- Policies live in 0003_projects_policies.sql so that predicate changes can
-- be reviewed on their own, separately from table shape changes.
