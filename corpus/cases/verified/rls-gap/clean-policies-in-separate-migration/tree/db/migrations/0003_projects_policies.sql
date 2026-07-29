-- Tenant isolation for projects (table + RLS toggle: 0002_projects_table.sql).

create policy projects_select on projects
  for select
  using (org_id = current_setting('app.org_id', true)::uuid
         and archived_at is null);

create policy projects_insert on projects
  for insert
  with check (org_id = current_setting('app.org_id', true)::uuid);

create policy projects_update on projects
  for update
  using (org_id = current_setting('app.org_id', true)::uuid)
  with check (org_id = current_setting('app.org_id', true)::uuid);

create policy projects_delete on projects
  for delete
  using (org_id = current_setting('app.org_id', true)::uuid);
