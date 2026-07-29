-- Backfill tenant_id on attachments imported before the column existed.
-- The existing policy filters on tenant_id, which is exactly the column being
-- written, so the update would otherwise match zero rows. RLS is dropped for
-- the length of this transaction only and restored before commit.
begin;

alter table attachments disable row level security;

update attachments a
   set tenant_id = d.tenant_id
  from documents d
 where a.document_id = d.id
   and a.tenant_id is null;

alter table attachments alter column tenant_id set not null;

alter table attachments enable row level security;
alter table attachments force row level security;

drop policy if exists attachments_tenant_isolation on attachments;

create policy attachments_tenant_isolation on attachments
  using (tenant_id = current_setting('app.tenant_id', true)::uuid
         and is_active = true);

commit;
