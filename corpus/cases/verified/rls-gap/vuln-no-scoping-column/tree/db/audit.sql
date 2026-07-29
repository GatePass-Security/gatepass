create table audit_log (
  id bigserial primary key,
  action text not null,
  recorded_at timestamptz default now()
);
