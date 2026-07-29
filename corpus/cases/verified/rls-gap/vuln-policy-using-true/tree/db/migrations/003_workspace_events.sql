-- Audit trail of every action taken inside a workspace.
create table workspace_events (
  id bigserial primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  actor_id uuid not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index workspace_events_workspace_idx
  on workspace_events (workspace_id, occurred_at desc);

alter table workspace_events enable row level security;

-- Support engineers needed to read events across accounts during the beta,
-- so the read predicate was widened and never narrowed back.
create policy workspace_events_read on workspace_events
  for select
  using (true);

create policy workspace_events_insert on workspace_events
  for insert
  with check (workspace_id = (auth.jwt() ->> 'workspace_id')::uuid);
