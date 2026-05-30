-- Atomic org creation (avoids RLS chicken-and-egg: org + owner membership together).
create or replace function public.create_organization(p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into public.organizations (name, slug, created_by)
  values (p_name, p_slug, auth.uid())
  returning id into v_id;

  insert into public.memberships (org_id, user_id, role, status)
  values (v_id, auth.uid(), 'owner', 'active');

  return v_id;
end;
$$;

-- Enable RLS -----------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.users enable row level security;
alter table public.memberships enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.connectors enable row level security;
alter table public.ingestion_jobs enable row level security;
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
alter table public.document_pages enable row level security;
alter table public.tags enable row level security;
alter table public.document_tags enable row level security;
alter table public.routing_rules enable row level security;
alter table public.chunks enable row level security;
alter table public.extraction_schemas enable row level security;
alter table public.extractions enable row level security;
alter table public.entities enable row level security;
alter table public.links enable row level security;
alter table public.datasets enable row level security;
alter table public.dataset_rows enable row level security;
alter table public.dashboards enable row level security;
alter table public.dashboard_widgets enable row level security;
alter table public.analytics_queries enable row level security;
alter table public.workflow_templates enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_run_steps enable row level security;
alter table public.approvals enable row level security;
alter table public.compliance_rules enable row level security;
alter table public.compliance_checks enable row level security;
alter table public.audit_log enable row level security;

-- organizations
create policy org_select on public.organizations for select using (public.is_org_member(id));
create policy org_update on public.organizations for update using (public.has_org_role(id, array['owner','admin']::membership_role[]));
create policy org_delete on public.organizations for delete using (public.has_org_role(id, array['owner']::membership_role[]));

-- users
create policy users_select_self_or_shared on public.users for select using (
  id = auth.uid()
  or exists (
    select 1 from public.memberships m1
    join public.memberships m2 on m1.org_id = m2.org_id
    where m1.user_id = auth.uid() and m2.user_id = public.users.id
  )
);
create policy users_update_self on public.users for update using (id = auth.uid());

-- memberships
create policy memberships_select on public.memberships for select using (public.is_org_member(org_id));
create policy memberships_write on public.memberships for all
  using (public.has_org_role(org_id, array['owner','admin']::membership_role[]))
  with check (public.has_org_role(org_id, array['owner','admin']::membership_role[]));

-- workspace_members (scoped via parent workspace's org)
create policy ws_members_all on public.workspace_members for all
  using (exists (select 1 from public.workspaces w where w.id = workspace_id and public.is_org_member(w.org_id)))
  with check (exists (select 1 from public.workspaces w where w.id = workspace_id and public.is_org_member(w.org_id)));

-- Generic "org members full access" for org-scoped data tables.
do $$
declare t text;
begin
  foreach t in array array[
    'workspaces','connectors','ingestion_jobs','documents','document_versions',
    'document_pages','tags','document_tags','routing_rules','chunks','extractions',
    'entities','links','datasets','dataset_rows','dashboards','dashboard_widgets',
    'analytics_queries','agent_runs','agent_run_steps','approvals','compliance_checks'
  ]
  loop
    execute format(
      'create policy %1$s_members_all on public.%1$s for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));',
      t
    );
  end loop;
end $$;

-- Tables with nullable org_id (global seeds are world-readable, writes are org-scoped).
create policy templates_select on public.workflow_templates for select using (org_id is null or public.is_org_member(org_id));
create policy templates_write on public.workflow_templates for all using (org_id is not null and public.is_org_member(org_id)) with check (org_id is not null and public.is_org_member(org_id));

create policy schemas_select on public.extraction_schemas for select using (org_id is null or public.is_org_member(org_id));
create policy schemas_write on public.extraction_schemas for all using (org_id is not null and public.is_org_member(org_id)) with check (org_id is not null and public.is_org_member(org_id));

create policy rules_select on public.compliance_rules for select using (org_id is null or public.is_org_member(org_id));
create policy rules_write on public.compliance_rules for all using (org_id is not null and public.is_org_member(org_id)) with check (org_id is not null and public.is_org_member(org_id));

-- audit_log: members read; members may append (mutations blocked by triggers).
create policy audit_select on public.audit_log for select using (public.is_org_member(org_id));
create policy audit_insert on public.audit_log for insert with check (public.is_org_member(org_id));
