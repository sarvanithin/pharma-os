-- Private buckets for uploaded documents and stored prompt/response payloads.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false), ('audit', 'audit', false)
on conflict (id) do nothing;

-- Authenticated org members may read/write objects in their org's folder
-- (path convention: "<org_id>/..."). Server jobs use the service role and bypass this.
create policy "documents_member_read" on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and public.is_org_member((split_part(name, '/', 1))::uuid)
  );

create policy "documents_member_write" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and public.is_org_member((split_part(name, '/', 1))::uuid)
  );
